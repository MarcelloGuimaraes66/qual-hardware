import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, recommendationEligibleRuns } from "../src/server/app.js";
import {
  CalibrationExchangeService,
  canonicalJsonBytes,
  exchangeDigest,
  QHCAL_MIME,
} from "../src/server/calibrationExchange.js";
import { MemoryPlannerStore } from "../src/server/store.js";
import { autonomousCalibrationRun, autonomousCalibrationWorkloadProfile } from "./fixtures/autonomousCalibrationRun.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function service(label: string): Promise<CalibrationExchangeService> {
  const root = await mkdtemp(join(tmpdir(), `qual-hardware-${label}-`));
  roots.push(root);
  return new CalibrationExchangeService({ identityDirectory: join(root, "identity"), evidenceDirectory: join(root, "evidence") });
}

function requestBody(bytes: Buffer): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

describe("signed portable calibration exchange", () => {
  it("exports real gzip, verifies Ed25519 and imports across installations", async () => {
    const origin = await service("origin");
    const collector = await service("collector");
    const run = autonomousCalibrationRun();
    const exported = await origin.exportRun(run, autonomousCalibrationWorkloadProfile());
    expect(exported.fileName.endsWith(".qhcal")).toBe(true);
    expect(exported.bytes.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    const serialized = gunzipSync(exported.bytes).toString("utf8");
    expect(serialized.startsWith('{"schemaVersion":"qual-hardware-calibration-package/1.0.0"')).toBe(true);
    const topLevelKeys = Object.keys(JSON.parse(serialized) as Record<string, unknown>);
    expect(topLevelKeys.slice(1)).toEqual([...topLevelKeys.slice(1)].sort());
    expect(collector.parseQhcal(exported.bytes).run.id).toBe(run.id);
    expect((await readFile(join(roots[0]!, "evidence", exported.fileName))).equals(exported.bytes)).toBe(true);
  });

  it("rejects a tampered signed payload and a decompression bomb", async () => {
    const origin = await service("tamper");
    const exported = await origin.exportRun(autonomousCalibrationRun(), autonomousCalibrationWorkloadProfile());
    const raw = JSON.parse(gunzipSync(exported.bytes).toString("utf8")) as { run: { notes: string[] } };
    raw.run.notes.push("tampered");
    expect(() => origin.parseQhcal(gzipSync(canonicalJsonBytes(raw)))).toThrow(/digest|signature/);
    await expect(origin.parseAny(gzipSync(Buffer.alloc(51 * 1024 * 1024, 1)))).rejects.toThrow("decompressed_size_exceeded");
  });

  it("requires first-use trust, imports without the source session and ignores duplicates", async () => {
    const origin = await service("api-origin");
    const collectorRoot = await mkdtemp(join(tmpdir(), "qual-hardware-api-collector-"));
    roots.push(collectorRoot);
    const exported = await origin.exportRun(autonomousCalibrationRun(), autonomousCalibrationWorkloadProfile());
    const store = new MemoryPlannerStore();
    const app = createApp(store, undefined, {
      calibrationIdentityDirectory: join(collectorRoot, "identity"),
      calibrationEvidenceDirectory: join(collectorRoot, "evidence"),
      documentsDirectory: collectorRoot,
    });
    const first = await app.request("/api/calibration-imports", { method: "POST", headers: { "content-type": QHCAL_MIME }, body: requestBody(exported.bytes) });
    expect(first.status).toBe(409);
    const pending = await first.json() as { devices: Array<{ id: string }> };
    expect(pending.devices).toHaveLength(1);
    expect((await store.listCalibrationSessions())).toHaveLength(0);
    await app.request(`/api/calibration-devices/${pending.devices[0]!.id}/trust`, { method: "POST" });
    const preview = await app.request("/api/calibration-imports?preview=1", {
      method: "POST", headers: { "content-type": QHCAL_MIME }, body: requestBody(exported.bytes),
    });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ preview: true, batch: { importedItems: 1, totalItems: 1 } });
    expect(await store.listCalibrationRuns()).toHaveLength(0);
    const imported = await app.request("/api/calibration-imports", { method: "POST", headers: { "content-type": QHCAL_MIME }, body: requestBody(exported.bytes) });
    expect(imported.status).toBe(201);
    expect((await store.listCalibrationRuns()).map((run) => run.id)).toEqual([autonomousCalibrationRun().id]);
    const duplicate = await app.request("/api/calibration-imports", { method: "POST", headers: { "content-type": QHCAL_MIME }, body: requestBody(exported.bytes) });
    expect(duplicate.status).toBe(201);
    const duplicateBody = await duplicate.json() as { batch: { duplicateItems: number }; importedRuns: string[] };
    expect(duplicateBody.batch.duplicateItems).toBe(1);
    expect(duplicateBody.importedRuns).toEqual([]);
    expect(exchangeDigest((await origin.parseQhcal(exported.bytes)))).toBe(exported.packageDigest);

    const conflictingOrigin = await service("api-conflict-origin");
    const conflictingRun = autonomousCalibrationRun();
    conflictingRun.notes.push("different signed result with the same run id");
    const conflicting = await conflictingOrigin.exportRun(conflictingRun, autonomousCalibrationWorkloadProfile());
    const pendingConflict = await app.request("/api/calibration-imports", {
      method: "POST", headers: { "content-type": QHCAL_MIME }, body: requestBody(conflicting.bytes),
    });
    expect(pendingConflict.status).toBe(409);
    const pendingConflictBody = await pendingConflict.json() as { devices: Array<{ id: string }> };
    await app.request(`/api/calibration-devices/${pendingConflictBody.devices[0]!.id}/trust`, { method: "POST" });
    const rejectedConflict = await app.request("/api/calibration-imports", {
      method: "POST", headers: { "content-type": QHCAL_MIME }, body: requestBody(conflicting.bytes),
    });
    expect(rejectedConflict.status).toBe(201);
    expect(await rejectedConflict.json()).toMatchObject({ batch: { conflictItems: 1 }, importedRuns: [] });
    expect(await store.listCalibrationRuns()).toHaveLength(1);
  });

  it("protects a new private key with the operating-system adapter when one is available", async () => {
    const root = await mkdtemp(join(tmpdir(), "qual-hardware-protected-identity-"));
    roots.push(root);
    const protection = {
      isAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`protected:${Buffer.from(value).toString("base64")}`),
      decryptString: (value: Uint8Array) => Buffer.from(Buffer.from(value).toString().slice("protected:".length), "base64").toString(),
    };
    const options = { identityDirectory: join(root, "identity"), evidenceDirectory: join(root, "evidence"), privateKeyProtection: protection };
    const first = new CalibrationExchangeService(options);
    const identity = await first.localIdentity();
    expect(identity.protection).toBe("operating_system");
    const encrypted = await readFile(join(root, "identity", "device-identity.ed25519.safe-storage"), "utf8");
    expect(encrypted).not.toContain("BEGIN PRIVATE KEY");
    const second = new CalibrationExchangeService(options);
    expect((await second.localIdentity()).id).toBe(identity.id);
  });

  it("removes revoked or unmapped imported evidence from commercial calculation without deleting it", async () => {
    const origin = await service("revocation-origin");
    const exported = await origin.exportRun(autonomousCalibrationRun(), autonomousCalibrationWorkloadProfile());
    const store = new MemoryPlannerStore();
    const now = new Date().toISOString();
    const identity = {
      id: exported.package.device.id, publicKeyPem: exported.package.device.publicKeyPem,
      shortCode: exported.package.device.shortCode, trust: "trusted" as const,
      protection: "imported_public_key" as const, firstSeenAt: now, updatedAt: now,
    };
    const run = exported.package.run;
    const batchId = randomUUID();
    await store.commitCalibrationImport({
      batch: { id: batchId, format: "qhcal", createdAt: now, completedAt: now, totalItems: 1,
        importedItems: 1, diagnosticItems: 0, duplicateItems: 0, conflictItems: 0, invalidItems: 0, pendingTrustItems: 0 },
      items: [{ id: randomUUID(), batchId, runId: run.id,
        packageDigest: exported.packageDigest, status: "imported", reason: null, recordedAt: now }],
      deviceIdentities: [identity],
      runs: [{ run, workloadProfile: exported.package.workloadProfile, provenance: {
        runId: run.id, source: "qhcal", deviceId: identity.id, packageDigest: exported.packageDigest,
        trustedAtImport: true, importedAt: now,
      } }],
      predictions: [],
    });
    expect(await recommendationEligibleRuns(store, [run])).toEqual([run]);
    expect(await recommendationEligibleRuns(store, [run], false)).toEqual([]);
    await store.setCalibrationDeviceTrust(identity.id, "revoked");
    expect(await recommendationEligibleRuns(store, [run])).toEqual([]);
    expect(await store.listCalibrationRuns()).toHaveLength(1);
    const unmapped = autonomousCalibrationRun({ id: "00000000-0000-4000-8000-000000000981", hardwareTemplateId: "unmapped" });
    expect(await recommendationEligibleRuns(store, [unmapped])).toEqual([]);
  });

  it("can disable portable exchange independently without deleting stored evidence", async () => {
    const store = new MemoryPlannerStore();
    const app = createApp(store, undefined, { calibrationFeatures: { exchange: false } });
    const imported = await app.request("/api/calibration-imports", { method: "POST", body: new Uint8Array([1, 2, 3]) });
    expect(imported.status).toBe(503);
    expect(await imported.json()).toEqual({ error: "calibration_exchange_feature_disabled" });
    const exported = await app.request("/api/calibration-collections/export", { method: "POST", body: "{}" });
    expect(exported.status).toBe(503);
    expect(await store.listCalibrationRuns()).toEqual([]);
  });

  it("consolidates ten signed machine results in one portable collection", async () => {
    const origin = await service("ten-machines-origin");
    const collectorRoot = await mkdtemp(join(tmpdir(), "qual-hardware-ten-machines-collector-"));
    roots.push(collectorRoot);
    const packages = await Promise.all(Array.from({ length: 10 }, async (_unused, index) => {
      const run = autonomousCalibrationRun({
        id: `00000000-0000-4000-8000-${String(1_000 + index).padStart(12, "0")}`,
        hardwareTemplateId: `fixture-machine-${index + 1}`,
        capacity: 4 * (index + 1),
      });
      run.fingerprint.physicalCores += index;
      run.fingerprint.logicalCores += index;
      run.fingerprint.hostnameHash = String(index + 1).padStart(16, "0");
      return (await origin.exportRun(run, autonomousCalibrationWorkloadProfile())).package;
    }));
    const collection = await origin.exportCollection(packages);
    const store = new MemoryPlannerStore();
    const app = createApp(store, undefined, {
      calibrationIdentityDirectory: join(collectorRoot, "identity"),
      calibrationEvidenceDirectory: join(collectorRoot, "evidence"),
      documentsDirectory: collectorRoot,
    });
    const first = await app.request("/api/calibration-imports", {
      method: "POST", headers: { "content-type": "application/octet-stream" }, body: requestBody(collection.bytes),
    });
    expect(first.status).toBe(409);
    const pending = await first.json() as { devices: Array<{ id: string }> };
    await app.request(`/api/calibration-devices/${pending.devices[0]!.id}/trust`, { method: "POST" });
    const imported = await app.request("/api/calibration-imports", {
      method: "POST", headers: { "content-type": "application/octet-stream" }, body: requestBody(collection.bytes),
    });
    expect(imported.status).toBe(201);
    expect(await store.listCalibrationRuns()).toHaveLength(10);
    expect(await (await app.request("/api/calibration-collection/status")).json()).toMatchObject({ runs: 10, measuredSystems: 10 });
    const reexported = await app.request("/api/calibration-collections/export", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(reexported.status).toBe(200);
    const collector = new CalibrationExchangeService({
      identityDirectory: join(collectorRoot, "identity"), evidenceDirectory: join(collectorRoot, "evidence"),
    });
    const consolidated = collector.parseQhcalSet(new Uint8Array(await reexported.arrayBuffer()));
    expect(new Set(consolidated.packages.map((item) => item.device.id))).toEqual(new Set([packages[0]!.device.id]));
  });
});
