import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  applyCalibrationRuntimeProvisioning,
  planCalibrationRuntimeProvisioning,
} from "../src/server/calibrationRuntimeProvisioning.js";

const argumentsList = process.argv.slice(2);
const valueAfter = (flag: string): string | null => {
  const index = argumentsList.indexOf(flag);
  return index >= 0 ? argumentsList[index + 1] ?? null : null;
};
const intakePath = valueAfter("--intake");
if (!intakePath) throw new Error("Usage: npm run calibration:runtime:prepare -- --intake /absolute/intake.json [--apply]");
const intake = JSON.parse(await readFile(resolve(intakePath), "utf8"));
const repositoryRoot = process.cwd();
const result = argumentsList.includes("--apply")
  ? await applyCalibrationRuntimeProvisioning({ repositoryRoot, intake })
  : await planCalibrationRuntimeProvisioning({ repositoryRoot, intake });
console.log(JSON.stringify({
  mode: argumentsList.includes("--apply") ? "applied" : "dry-run",
  target: result.target,
  manifestSha256: result.manifestSha256,
  fileCount: result.files.length,
  stagingBytes: result.stagingBytes,
  ...("disk" in result ? { disk: result.disk } : {}),
  ...("backupPath" in result ? {
    backupPath: result.backupPath,
    targetRoot: result.targetRoot,
    targetBackupPath: result.targetBackupPath,
  } : {}),
}, null, 2));
