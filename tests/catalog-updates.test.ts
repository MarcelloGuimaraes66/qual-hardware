import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import { CatalogUpdateService } from "../src/server/catalogUpdates.js";
import { SqlitePlannerStore } from "../src/server/store.js";
import { EVIDENCE_CATALOG_VERSION } from "../src/shared/types.js";
import type { EvidenceCatalogSnapshot } from "../src/shared/types.js";

const cleanupDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("signed catalog updates", () => {
  it("accepts a signed snapshot, caches it and rejects a modified signature", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const payload = {
      schemaVersion: "qual-hardware-catalog/1.0.0" as const,
      catalogVersion: "hardware-reference/test-signed",
      generatedAt: new Date().toISOString(),
      hardware: [HARDWARE_CATALOG[0]!],
      quotes: [],
    };
    const signature = sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString("base64");
    let responseBody = JSON.stringify({ payload, signature });
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(responseBody);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const directory = await mkdtemp(join(tmpdir(), "qual-hardware-catalog-"));
    cleanupDirectories.push(directory);
    const options = {
      remoteUrl: `http://127.0.0.1:${port}/catalog.json`,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      cacheFile: join(directory, "catalog.json"),
    };

    try {
      const store = new SqlitePlannerStore(join(directory, "remote", "qual-hardware.sqlite"));
      const updates = new CatalogUpdateService(store, options);
      const status = await updates.refresh();
      expect(status.catalogVersion).toBe(payload.catalogVersion);
      expect(status.source).toBe("remote");
      expect(await store.getCatalog()).toHaveLength(1);

      responseBody = JSON.stringify({ payload: { ...payload, catalogVersion: "tampered" }, signature });
      await expect(updates.refresh()).rejects.toThrow("invalid_catalog_signature");
      await store.close();

      const cachedStore = new SqlitePlannerStore(join(directory, "cached", "qual-hardware.sqlite"));
      const cachedUpdates = new CatalogUpdateService(cachedStore, { publicKeyPem: options.publicKeyPem, cacheFile: options.cacheFile });
      expect((await cachedUpdates.initialize()).source).toBe("cached");
      expect(await cachedStore.getCatalog()).toHaveLength(1);
      await cachedStore.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("persists a verification key and imports a signed catalog without a remote URL", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const payload = {
      schemaVersion: "qual-hardware-catalog/1.0.0" as const,
      catalogVersion: "hardware-reference/manual-import",
      generatedAt: new Date().toISOString(),
      hardware: [HARDWARE_CATALOG[0]!, HARDWARE_CATALOG[1]!],
      quotes: [],
    };
    const raw = JSON.stringify({
      payload,
      signature: sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString("base64"),
    });
    const directory = await mkdtemp(join(tmpdir(), "qual-hardware-manual-catalog-"));
    cleanupDirectories.push(directory);
    const options = {
      configFile: join(directory, "catalog-update-config.json"),
      cacheFile: join(directory, "catalog-snapshot.json"),
    };
    const store = new SqlitePlannerStore(join(directory, "first", "qual-hardware.sqlite"));
    const updates = new CatalogUpdateService(store, options);
    const configured = await updates.configure({
      remoteUrl: null,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    expect(configured.verificationKeyConfigured).toBe(true);
    expect(configured.remoteUpdateConfigured).toBe(false);
    expect(configured.remoteUrl).toBeNull();
    expect((await updates.importSignedSnapshot(raw)).source).toBe("imported");
    expect(await store.getCatalog()).toHaveLength(2);
    await store.close();

    const reopenedStore = new SqlitePlannerStore(join(directory, "second", "qual-hardware.sqlite"));
    const reopened = new CatalogUpdateService(reopenedStore, options);
    const status = await reopened.initialize();
    expect(status.source).toBe("cached");
    expect(status.verificationKeyConfigured).toBe(true);
    expect(await reopenedStore.getCatalog()).toHaveLength(2);
    await reopenedStore.close();
  });

  it("keeps the active evidence snapshot and records a rejected rollback without losing data", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const directory = await mkdtemp(join(tmpdir(), "qual-hardware-evidence-"));
    cleanupDirectories.push(directory);
    const store = new SqlitePlannerStore(join(directory, "qual-hardware.sqlite"));
    const updates = new CatalogUpdateService(store, {
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    const snapshot = (catalogVersion: string, generatedAt: string): EvidenceCatalogSnapshot => ({
      schemaVersion: EVIDENCE_CATALOG_VERSION,
      catalogVersion,
      generatedAt,
      components: [{
        id: "cpu-intel-test", kind: "cpu", manufacturer: "Intel", sku: "Test CPU",
        architecture: "test", specifications: { cores: 16 }, sourceUrls: ["https://www.intel.com/ark"],
      }],
      observations: [{
        id: `${catalogVersion}-decode`, hardwareTemplateId: HARDWARE_CATALOG[0]!.id,
        stage: "video_decode", profileId: "ffmpeg-h264-v1", benchmarkName: "FFmpeg H.264",
        benchmarkVersion: "1.0", score: 100, unit: "fps", higherIsBetter: true,
        componentId: "cpu-intel-test", componentKind: "cpu", sourceTier: 1,
        sourceUrl: "https://openbenchmarking.org/", observedAt: generatedAt, operatingSystem: "windows",
        configuration: "Exact SKU, disclosed power, driver, cooling and repeated sustained workload.",
      }],
    });
    const envelope = (payload: EvidenceCatalogSnapshot) => JSON.stringify({
      payload,
      signature: sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString("base64"),
    });

    const current = snapshot("evidence/current", "2026-07-18T12:00:00.000Z");
    await updates.importSignedEvidenceSnapshot(envelope(current));
    expect((await store.getActiveEvidenceSnapshot())?.catalogVersion).toBe("evidence/current");
    expect(await store.listHardwareComponents()).toHaveLength(1);

    const older = snapshot("evidence/older", "2026-07-17T12:00:00.000Z");
    await expect(updates.importSignedEvidenceSnapshot(envelope(older))).rejects.toThrow("evidence_snapshot_rollback_rejected");
    expect((await store.getActiveEvidenceSnapshot())?.catalogVersion).toBe("evidence/current");
    const runs = await store.listCatalogUpdateRuns();
    expect(runs.map((run) => run.status)).toEqual(expect.arrayContaining(["applied", "failed"]));
    await store.close();
  });
});
