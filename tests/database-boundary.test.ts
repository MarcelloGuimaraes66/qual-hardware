import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import { createDefaultScenario } from "../src/shared/schemas.js";
import {
  assertDedicatedSqlitePath,
  QUAL_HARDWARE_SQLITE_FILENAME,
  QUAL_HARDWARE_SQLITE_SCHEMA_VERSION,
} from "../src/server/database.js";
import { SqlitePlannerStore } from "../src/server/store.js";

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
  });

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
