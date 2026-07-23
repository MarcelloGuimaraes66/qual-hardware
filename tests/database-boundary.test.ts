import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import { buildCapacityPredictions, createCalibrationPlan } from "../src/engine/calibration.js";
import { createDefaultScenario } from "../src/shared/schemas.js";
import {
  assertDedicatedSqlitePath,
  QUAL_HARDWARE_SQLITE_FILENAME,
  QUAL_HARDWARE_SQLITE_SCHEMA_VERSION,
} from "../src/server/database.js";
import { SqlitePlannerStore } from "../src/server/store.js";
import { createInternalCalibrationSession } from "../src/server/calibrationSessions.js";
import { autonomousCalibrationRun, autonomousCalibrationWorkloadProfile } from "./fixtures/autonomousCalibrationRun.js";

const cleanupDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("dedicated Qual Hardware SQLite boundary", () => {
  it("accepts only the dedicated Qual Hardware filename", () => {
    const dedicated = join(tmpdir(), "team-member", QUAL_HARDWARE_SQLITE_FILENAME);
    expect(assertDedicatedSqlitePath(dedicated)).toBe(dedicated);
    expect(() => assertDedicatedSqlitePath(join(tmpdir(), "perceptrum.sqlite"))).toThrow("Perceptrum databases are never allowed");
    expect(() => assertDedicatedSqlitePath(join(tmpdir(), "shared.db"))).toThrow(QUAL_HARDWARE_SQLITE_FILENAME);
    expect(() => assertDedicatedSqlitePath(":memory:")).toThrow("file-backed");
  });

  it("uses a versioned strict SQLite schema without product data from Perceptrum", async () => {
    const sql = await readFile(new URL("../database/sqlite-schema.sql", import.meta.url), "utf8");
    expect(sql).toContain("PRAGMA journal_mode = WAL");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS scenarios");
    expect(sql).toContain(") STRICT;");
    expect(sql).toContain(`PRAGMA user_version = ${QUAL_HARDWARE_SQLITE_SCHEMA_VERSION}`);
    expect(sql.toLowerCase()).not.toContain("perceptrum");
    expect(sql.toLowerCase()).not.toContain("postgres");
  });

  it("persists projects and the hardware catalog after closing and reopening", async () => {
    const directory = await mkdtemp(join(tmpdir(), "qual-hardware-sqlite-"));
    cleanupDirectories.push(directory);
    const databasePath = join(directory, QUAL_HARDWARE_SQLITE_FILENAME);
    const firstStore = new SqlitePlannerStore(databasePath);
    const created = await firstStore.createScenario(createDefaultScenario(25));
    expect(await firstStore.getCatalog()).toHaveLength(HARDWARE_CATALOG.length);
    await firstStore.close();

    const reopenedStore = new SqlitePlannerStore(databasePath);
    expect((await reopenedStore.getScenario(created.id))?.scenario.totalCameras).toBe(25);
    expect(await reopenedStore.getCatalog()).toHaveLength(HARDWARE_CATALOG.length);
    await reopenedStore.close();
  }, 15_000);

  it("keeps schema v9 while storing all autonomous session states as append-only events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "qual-hardware-calibration-extension-"));
    cleanupDirectories.push(directory);
    const databasePath = join(directory, QUAL_HARDWARE_SQLITE_FILENAME);
    const store = new SqlitePlannerStore(databasePath);
    const session = createInternalCalibrationSession({
      plan: createCalibrationPlan(createDefaultScenario(8), "quick", null),
      recommendationId: "00000000-0000-4000-8000-000000000210",
      scenarioId: "00000000-0000-4000-8000-000000000211",
      advancedTelemetry: false,
    });
    await store.saveCalibrationSession(session);
    await store.saveCalibrationSession({ ...session, state: "validating" });
    await store.saveCalibrationSession({ ...session, state: "cancelled", completedAt: new Date().toISOString() });
    expect((await store.getCalibrationSession(session.id))?.state).toBe("cancelled");
    await store.close();

    const database = new DatabaseSync(databasePath, { readOnly: true });
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(9);
    expect((database.prepare("SELECT COUNT(*) count FROM calibration_sessions").get() as { count: number }).count).toBe(0);
    expect((database.prepare("SELECT COUNT(*) count FROM calibration_sessions_v2").get() as { count: number }).count).toBe(1);
    expect((database.prepare("SELECT COUNT(*) count FROM calibration_session_events").get() as { count: number }).count).toBe(3);
    expect((database.prepare("SELECT extension_version FROM calibration_extension_metadata WHERE singleton=1").get() as { extension_version: number }).extension_version).toBe(2);
    for (const table of ["calibration_checkpoints", "calibration_session_lineage", "calibration_device_identities",
      "measured_system_identities", "calibration_run_provenance", "calibration_import_batches",
      "calibration_import_items", "calibration_export_events", "calibration_collection_snapshots"]) {
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)).toBeTruthy();
    }
    database.close();
  });

  it("backs up and transactionally migrates the legacy v2 session-state constraint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "qual-hardware-session-state-migration-"));
    cleanupDirectories.push(directory);
    const databasePath = join(directory, QUAL_HARDWARE_SQLITE_FILENAME);
    const firstStore = new SqlitePlannerStore(databasePath);
    const session = createInternalCalibrationSession({
      plan: createCalibrationPlan(createDefaultScenario(8), "qualification", HARDWARE_CATALOG[0]!.id),
      recommendationId: "00000000-0000-4000-8000-000000000310",
      scenarioId: "00000000-0000-4000-8000-000000000311",
      advancedTelemetry: true,
    });
    await firstStore.saveCalibrationSession(session);
    await firstStore.close();

    const legacy = new DatabaseSync(databasePath);
    const event = legacy.prepare("SELECT event_id,session_id,session_json,created_at FROM calibration_session_events").get() as Record<string, unknown>;
    legacy.exec(`DROP TABLE calibration_session_events;
      CREATE TABLE calibration_session_events (
        event_id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES calibration_sessions_v2(id),
        state TEXT NOT NULL CHECK (state IN ('pending','launching','running','cancelling','cancelled','completed','failed','interrupted','expired')),
        session_json TEXT NOT NULL CHECK (json_valid(session_json)),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX calibration_session_events_latest_idx ON calibration_session_events(session_id,event_id DESC);`);
    legacy.prepare("INSERT INTO calibration_session_events(event_id,session_id,state,session_json,created_at) VALUES(?,?,?,?,?)")
      .run(Number(event.event_id), String(event.session_id), "running", String(event.session_json), String(event.created_at));
    legacy.close();

    const migrated = new SqlitePlannerStore(databasePath);
    expect(migrated.calibrationExtensionReady).toBe(true);
    await migrated.close();
    const reopened = new DatabaseSync(databasePath, { readOnly: true });
    expect((reopened.prepare("SELECT state FROM calibration_session_events").get() as { state: string }).state).toBe("qualifying");
    expect((reopened.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    reopened.close();
    const backups = await readdir(join(directory, "schema-backups"));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^qual-hardware-pre-autonomous-state-migration-.*\.sqlite$/);
  });

  it("commits a consolidated import, provenance, predictions and assessments atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "qual-hardware-consolidated-import-"));
    cleanupDirectories.push(directory);
    const databasePath = join(directory, QUAL_HARDWARE_SQLITE_FILENAME);
    const store = new SqlitePlannerStore(databasePath);
    const run = autonomousCalibrationRun();
    const predictions = buildCapacityPredictions(HARDWARE_CATALOG, [run], [], {
      kernelVersion: run.kernelVersion!, runtimeManifestHash: run.runtimeManifestHash!,
    });
    const identity = {
      id: "f".repeat(64), publicKeyPem: "fixture-public-key", shortCode: "TEST-0001", trust: "trusted" as const,
      protection: "imported_public_key" as const, firstSeenAt: run.createdAt, updatedAt: run.completedAt,
    };
    const batch = {
      id: "00000000-0000-4000-8000-000000000950", format: "qhcal" as const,
      createdAt: run.completedAt, completedAt: run.completedAt, totalItems: 1, importedItems: 1,
      diagnosticItems: 0, duplicateItems: 0, conflictItems: 0, invalidItems: 0, pendingTrustItems: 0,
    };
    const item = {
      id: "00000000-0000-4000-8000-000000000951", batchId: batch.id, runId: run.id,
      packageDigest: "a".repeat(64), status: "imported" as const, reason: null, recordedAt: run.completedAt,
    };
    const provenance = {
      runId: run.id, source: "qhcal" as const, deviceId: identity.id, packageDigest: item.packageDigest,
      trustedAtImport: true, importedAt: run.completedAt,
    };
    const workloadProfile = autonomousCalibrationWorkloadProfile();
    await store.commitCalibrationImport({ batch, items: [item], deviceIdentities: [identity], runs: [{ run, provenance, workloadProfile }], predictions });
    expect(await store.listCalibrationRuns()).toHaveLength(1);
    expect(await store.listCalibrationRunProvenance()).toEqual([provenance]);
    expect(await store.listCapacityAssessments()).toHaveLength(predictions.length);

    await expect(store.commitCalibrationImport({
      batch: { ...batch, id: "00000000-0000-4000-8000-000000000952" },
      items: [{ ...item, id: "00000000-0000-4000-8000-000000000953", batchId: "00000000-0000-4000-8000-000000000952" }],
      deviceIdentities: [identity], runs: [{ run, provenance, workloadProfile }], predictions: [],
    })).rejects.toThrow();
    await store.close();

    const database = new DatabaseSync(databasePath, { readOnly: true });
    expect((database.prepare("SELECT COUNT(*) count FROM calibration_import_batches").get() as { count: number }).count).toBe(1);
    expect((database.prepare("SELECT COUNT(*) count FROM calibration_import_items").get() as { count: number }).count).toBe(1);
    expect((database.prepare("SELECT COUNT(*) count FROM calibration_runs_v2").get() as { count: number }).count).toBe(1);
    database.close();
  });

  it("backs up an existing v9 database before installing the additive calibration extension", async () => {
    const directory = await mkdtemp(join(tmpdir(), "qual-hardware-pre-extension-"));
    cleanupDirectories.push(directory);
    const databasePath = join(directory, QUAL_HARDWARE_SQLITE_FILENAME);
    const legacy = new DatabaseSync(databasePath);
    legacy.exec("CREATE TABLE preserved_user_data(id TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT; INSERT INTO preserved_user_data VALUES('one','keep'); PRAGMA user_version=9;");
    legacy.close();

    const store = new SqlitePlannerStore(databasePath);
    await store.close();
    const backups = await readdir(join(directory, "schema-backups"));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^qual-hardware-pre-calibration-extension-.*-[0-9a-f-]{36}\.sqlite$/);
    const backup = new DatabaseSync(join(directory, "schema-backups", backups[0]!), { readOnly: true });
    expect(Object.values(backup.prepare("PRAGMA integrity_check").get() as Record<string, unknown>)[0]).toBe("ok");
    expect((backup.prepare("SELECT value FROM preserved_user_data WHERE id='one'").get() as { value: string }).value).toBe("keep");
    backup.close();
    const reopened = new DatabaseSync(databasePath, { readOnly: true });
    expect((reopened.prepare("SELECT value FROM preserved_user_data WHERE id='one'").get() as { value: string }).value).toBe("keep");
    reopened.close();
  });

  it("rolls back a failed additive extension and keeps the existing v9 application usable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "qual-hardware-extension-failure-"));
    cleanupDirectories.push(directory);
    const databasePath = join(directory, QUAL_HARDWARE_SQLITE_FILENAME);
    const fullSchema = await readFile(new URL("../database/sqlite-schema.sql", import.meta.url), "utf8");
    const extensionBlock = /CREATE TABLE IF NOT EXISTS calibration_extension_metadata[\s\S]*?(?=CREATE TABLE IF NOT EXISTS public_benchmark_observations)/;
    const legacySchema = fullSchema.replace(extensionBlock, "");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(legacySchema);
    legacy.exec("CREATE TABLE preserved_extension_failure(id TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT; INSERT INTO preserved_extension_failure VALUES('one','keep');");
    legacy.close();
    const invalidSchemaPath = join(directory, "invalid-additive-schema.sql");
    await writeFile(invalidSchemaPath, fullSchema.replace(extensionBlock, "THIS IS NOT VALID SQLITE;\n"));

    const store = new SqlitePlannerStore(databasePath, invalidSchemaPath);
    expect(store.calibrationExtensionReady).toBe(false);
    expect(await store.getCatalog()).toHaveLength(HARDWARE_CATALOG.length);
    expect(await store.listCapacityAssessments()).toEqual([]);
    await expect(store.commitCalibrationRun({} as never, [])).rejects.toThrow("calibration_extension_unavailable");
    await store.close();

    const reopened = new DatabaseSync(databasePath, { readOnly: true });
    expect((reopened.prepare("SELECT value FROM preserved_extension_failure WHERE id='one'").get() as { value: string }).value).toBe("keep");
    expect(reopened.prepare("SELECT name FROM sqlite_master WHERE name='calibration_extension_metadata'").get()).toBeUndefined();
    reopened.close();
    expect(await readdir(join(directory, "schema-backups"))).toHaveLength(1);
  });

  it("repairs a stale partial bundled catalog before signed-cache initialization", async () => {
    const directory = await mkdtemp(join(tmpdir(), "qual-hardware-bundled-refresh-"));
    cleanupDirectories.push(directory);
    const databasePath = join(directory, QUAL_HARDWARE_SQLITE_FILENAME);
    const firstStore = new SqlitePlannerStore(databasePath);
    await firstStore.replaceCatalog(HARDWARE_CATALOG.slice(0, 2), []);
    expect(await firstStore.getCatalog()).toHaveLength(2);
    await firstStore.close();

    const reopenedStore = new SqlitePlannerStore(databasePath);
    expect(await reopenedStore.getCatalog()).toHaveLength(HARDWARE_CATALOG.length);
    expect(new Set((await reopenedStore.getCatalog()).map((item) => item.id))).toEqual(new Set(HARDWARE_CATALOG.map((item) => item.id)));
    await reopenedStore.close();
  }, 15_000);

  it("ships as a local desktop application with a loopback-only internal API", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { main: string; scripts: Record<string, string> };
    const desktopMain = await readFile(new URL("../src/desktop/main.ts", import.meta.url), "utf8");
    expect(packageJson.main).toBe("dist/server/desktop/main.js");
    expect(packageJson.scripts.start).toBe("npm run desktop:run");
    expect(packageJson.scripts["dev:web"]).toBeUndefined();
    expect(desktopMain).toContain('const HOST = "127.0.0.1"');
    expect(desktopMain).toContain("port: 0");
  });
});
