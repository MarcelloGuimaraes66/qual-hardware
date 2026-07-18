import { sign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { HARDWARE_CATALOG_VERSION } from "../src/engine/catalog.js";
import { createStore } from "../src/server/store.js";

const privateKey = process.env.CATALOG_SIGNING_PRIVATE_KEY?.replaceAll("\\n", "\n");
if (!privateKey) throw new Error("CATALOG_SIGNING_PRIVATE_KEY is required and must remain only on the private catalog publisher.");

const store = createStore();
try {
  const payload = {
    schemaVersion: "qual-hardware-catalog/1.0.0" as const,
    catalogVersion: process.env.CATALOG_VERSION ?? HARDWARE_CATALOG_VERSION,
    generatedAt: new Date().toISOString(),
    hardware: await store.getCatalog(),
    quotes: await store.getQuotes(),
  };
  const signature = sign(null, Buffer.from(JSON.stringify(payload), "utf8"), privateKey).toString("base64");
  const output = resolve(process.env.CATALOG_SNAPSHOT_OUTPUT ?? "data/catalog/catalog-snapshot.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ payload, signature }), "utf8");
  console.log(JSON.stringify({ output, catalogVersion: payload.catalogVersion, hardware: payload.hardware.length, quotes: payload.quotes.length }));
} finally {
  await store.close();
}
