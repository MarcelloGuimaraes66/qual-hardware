import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import { CatalogUpdateService } from "../src/server/catalogUpdates.js";
import { MemoryPlannerStore } from "../src/server/store.js";

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
      const store = new MemoryPlannerStore();
      const updates = new CatalogUpdateService(store, options);
      const status = await updates.refresh();
      expect(status.catalogVersion).toBe(payload.catalogVersion);
      expect(status.source).toBe("remote");
      expect(await store.getCatalog()).toHaveLength(1);

      responseBody = JSON.stringify({ payload: { ...payload, catalogVersion: "tampered" }, signature });
      await expect(updates.refresh()).rejects.toThrow("invalid_catalog_signature");

      const cachedStore = new MemoryPlannerStore();
      const cachedUpdates = new CatalogUpdateService(cachedStore, { publicKeyPem: options.publicKeyPem, cacheFile: options.cacheFile });
      expect((await cachedUpdates.initialize()).source).toBe("cached");
      expect(await cachedStore.getCatalog()).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
