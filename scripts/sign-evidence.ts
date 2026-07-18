import { sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evidenceCatalogSnapshotSchema } from "../src/shared/schemas.js";

const privateKey = process.env.CATALOG_SIGNING_PRIVATE_KEY?.replaceAll("\\n", "\n");
if (!privateKey) throw new Error("CATALOG_SIGNING_PRIVATE_KEY is required and must remain only on the private evidence publisher.");

const source = resolve(process.env.EVIDENCE_SNAPSHOT_INPUT ?? "data/evidence/evidence-snapshot.json");
const output = resolve(process.env.EVIDENCE_SIGNED_OUTPUT ?? "data/evidence/evidence-snapshot.signed.json");
if (source === output) throw new Error("Evidence input and signed output must be different files.");
const payload = evidenceCatalogSnapshotSchema.parse(JSON.parse(await readFile(source, "utf8")));
const signature = sign(null, Buffer.from(JSON.stringify(payload), "utf8"), privateKey).toString("base64");
await writeFile(output, JSON.stringify({ payload, signature }), { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({
  output,
  catalogVersion: payload.catalogVersion,
  components: payload.components?.length ?? 0,
  observations: payload.observations.length,
}));
