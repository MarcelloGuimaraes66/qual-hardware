import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { parseCalibrationAssetSourceLock } from "../src/server/calibrationAssetSources.js";

const repository = await realpath(process.cwd());
const authorityCommit = "d918faa0ecd6a9906b711039e5d89f78e0536c44";
const manifestPath = resolve(repository, "resources/calibration/runtime-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
  authorityCommit: string;
  pipelineImplementation: string;
  authorityContract: { relativePath: string; sha256: string };
  pipelineContract: { relativePath: string; sha256: string };
  sourceLock: { relativePath: string; sha256: string };
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalText(bytes: Uint8Array): Buffer {
  return Buffer.from(Buffer.from(bytes).toString("utf8").replace(/\r\n?/g, "\n"), "utf8");
}

async function verifyContract(contract: { relativePath: string; sha256: string }): Promise<{
  relativePath: string;
  bytes: number;
  sha256: string;
}> {
  const path = await realpath(resolve(repository, contract.relativePath));
  const relativePath = relative(repository, path);
  if (!relativePath || relativePath.startsWith(`..${sep}`) || dirname(relativePath) !== "contracts") {
    throw new Error(`Calibration contract is outside the repository contract boundary: ${contract.relativePath}`);
  }
  const bytes = await readFile(path);
  const digest = sha256(canonicalText(bytes));
  if (digest !== contract.sha256) throw new Error(`Calibration contract hash mismatch: ${contract.relativePath}`);
  const parsed = JSON.parse(bytes.toString("utf8")) as { authority?: { commit?: string }; commit?: string };
  const declaredCommit = parsed.authority?.commit ?? parsed.commit;
  if (declaredCommit !== authorityCommit) throw new Error(`Calibration contract authority mismatch: ${contract.relativePath}`);
  return { relativePath: contract.relativePath, bytes: bytes.byteLength, sha256: digest };
}

if (manifest.authorityCommit !== authorityCommit || manifest.pipelineImplementation !== "perceptrum-equivalent-v2-multi-device") {
  throw new Error("Calibration runtime manifest does not match the immutable local authority contract.");
}

const contracts = await Promise.all([
  verifyContract(manifest.authorityContract),
  verifyContract(manifest.pipelineContract),
]);
const sourceLockBytes = await readFile(resolve(repository, manifest.sourceLock.relativePath));
const sourceLockSha256 = sha256(canonicalText(sourceLockBytes));
if (sourceLockSha256 !== manifest.sourceLock.sha256) throw new Error("Calibration asset source lock hash mismatch.");
const sourceLock = parseCalibrationAssetSourceLock(JSON.parse(sourceLockBytes.toString("utf8")));
console.log(JSON.stringify({
  schemaVersion: "qual-hardware-local-calibration-contract-audit/1.0.0",
  authorityCommit,
  externalSourceAccess: false,
  contracts,
  sourceLock: {
    relativePath: manifest.sourceLock.relativePath,
    sha256: sourceLockSha256,
    assetCount: sourceLock.assets.length,
    readyForProvisioning: sourceLock.assets.every((asset) => asset.approvalStatus === "approved" && asset.blockers.length === 0),
  },
}));
