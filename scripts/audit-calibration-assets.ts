import { auditCalibrationAssetSources } from "../src/server/calibrationAssetSources.js";

const report = await auditCalibrationAssetSources({ repositoryRoot: process.cwd() });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (process.argv.includes("--require-ready") && !report.readyForProvisioning) process.exitCode = 2;
