import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  applyCalibrationRuntimeProvisioning,
  createCalibrationRuntimeIntakeTemplate,
  planCalibrationRuntimeProvisioning,
} from "../src/server/calibrationRuntimeProvisioning.js";

const argumentsList = process.argv.slice(2);
const valueAfter = (flag: string): string | null => {
  const index = argumentsList.indexOf(flag);
  return index >= 0 ? argumentsList[index + 1] ?? null : null;
};
const intakePath = valueAfter("--intake");
const templateTarget = valueAfter("--target");
const printTemplate = argumentsList.includes("--print-template");
const apply = argumentsList.includes("--apply");
const usage = "Usage: npm run calibration:runtime:prepare -- --intake /absolute/intake.json [--apply] | --target <darwin-arm64|win32-x64|linux-x64> --print-template";
if (printTemplate) {
  if (!templateTarget || intakePath || apply) throw new Error(usage);
  const template = await createCalibrationRuntimeIntakeTemplate({ repositoryRoot: process.cwd(), target: templateTarget });
  process.stdout.write(`${JSON.stringify(template, null, 2)}\n`);
} else {
  if (!intakePath || templateTarget) throw new Error(usage);
  const intake = JSON.parse(await readFile(resolve(intakePath), "utf8"));
  const repositoryRoot = process.cwd();
  const result = apply
    ? await applyCalibrationRuntimeProvisioning({ repositoryRoot, intake })
    : await planCalibrationRuntimeProvisioning({ repositoryRoot, intake });
  console.log(JSON.stringify({
    mode: apply ? "applied" : "dry-run",
    target: result.target,
    manifestSha256: result.manifestSha256,
    fileCount: result.files.length,
    verifiedSourcePackageCount: result.sourcePackages.length,
    stagingBytes: result.stagingBytes,
    ...("disk" in result ? { disk: result.disk } : {}),
    ...("backupPath" in result ? {
      backupPath: result.backupPath,
      targetRoot: result.targetRoot,
      targetBackupPath: result.targetBackupPath,
    } : {}),
  }, null, 2));
}
