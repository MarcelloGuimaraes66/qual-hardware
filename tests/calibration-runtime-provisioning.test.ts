import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CALIBRATION_ASSET_INTAKE_VERSION,
  applyCalibrationRuntimeProvisioning,
  planCalibrationRuntimeProvisioning,
} from "../src/server/calibrationRuntimeProvisioning.js";
import { REQUIRED_RUNTIME_ASSET_IDS, inspectCalibrationRuntime } from "../src/server/calibrationRuntime.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const roots: string[] = [];

async function copyProvisioningFixture(root: string): Promise<void> {
  for (const relativePath of [
    "resources/calibration/runtime-manifest.json",
    "resources/calibration/asset-sources.lock.json",
    "contracts/calibration-kernel-authority-v1.json",
    "contracts/calibration-pipeline-contract-v1.json",
  ]) {
    const destination = join(root, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(projectRoot, relativePath), destination);
  }
  const manifestPath = join(root, "resources/calibration/runtime-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    assets: Array<{
      version: string | null;
      licenseSpdx: string | null;
      artifacts: Record<string, {
        sha256: string | null;
        sizeBytes: number | null;
        licenseEvidence?: unknown;
        sbomEvidence?: unknown;
        companionFiles?: unknown[];
      }>;
    }>;
  };
  for (const asset of manifest.assets) {
    asset.version = null;
    asset.licenseSpdx = null;
    for (const artifact of Object.values(asset.artifacts)) {
      artifact.sha256 = null;
      artifact.sizeBytes = null;
      artifact.licenseEvidence = null;
      artifact.sbomEvidence = null;
      artifact.companionFiles = [];
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("calibration runtime asset provisioning", () => {
  it("plans without mutation, then atomically installs one complete verified target with a manifest backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "qual-hardware-runtime-provisioning-test-"));
    roots.push(root);
    await copyProvisioningFixture(root);
    const sourceRoot = join(root, "external-approved-input");
    await mkdir(sourceRoot, { recursive: true });
    const assets = [];
    for (const id of REQUIRED_RUNTIME_ASSET_IDS) {
      const sourcePath = join(sourceRoot, `${id}.bin`);
      const licenseEvidencePath = join(sourceRoot, `${id}.license.txt`);
      const sbomEvidencePath = join(sourceRoot, `${id}.cdx.json`);
      await writeFile(sourcePath, `platform-specific-runtime:${id}`, "utf8");
      await writeFile(licenseEvidencePath, `Fixture license for ${id}`, "utf8");
      await writeFile(sbomEvidencePath, JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", components: [{ name: id }] }), "utf8");
      const companionFiles = [];
      if (id === "llama-server") {
        const companionPath = join(sourceRoot, "cublas64_13.dll");
        await writeFile(companionPath, "fixture CUDA companion", "utf8");
        companionFiles.push({ sourcePath: companionPath, relativePath: "bin/cublas64_13.dll" });
      }
      assets.push({
        id,
        sourcePath,
        version: id === "telemetry-probe" ? "0.1.0" : "fixture-1.0.0",
        licenseSpdx: id === "telemetry-probe" ? "NOASSERTION" : "MIT",
        licenseEvidencePath,
        sbomEvidencePath,
        companionFiles,
      });
    }
    const intake = { schemaVersion: CALIBRATION_ASSET_INTAKE_VERSION, target: "linux-x64", assets };
    const planned = await planCalibrationRuntimeProvisioning({ repositoryRoot: root, intake });
    expect(planned.files).toHaveLength(REQUIRED_RUNTIME_ASSET_IDS.length * 3 + 1);
    expect(planned.stagingBytes).toBeGreaterThan(0);
    expect((await readdir(join(root, "resources/calibration"))).sort()).toEqual(["asset-sources.lock.json", "runtime-manifest.json"]);

    const ampleDiskStatus = async (_path: string, projectedPeakBytes: number) => ({
      totalBytes: 200_000,
      freeBytes: 150_000,
      reserveBytes: 10_000,
      projectedPeakBytes,
      canStart: true,
    });
    const applied = await applyCalibrationRuntimeProvisioning({ repositoryRoot: root, intake, diskStatus: ampleDiskStatus });
    expect(applied.targetRoot).toBe(join(root, "resources/calibration/linux-x64"));
    expect(applied.targetBackupPath).toBeNull();
    expect(JSON.parse(await readFile(applied.backupPath, "utf8"))).toMatchObject({ schemaVersion: "qual-hardware-calibration-runtime-manifest/3.0.0" });
    expect((await readdir(join(root, "resources/calibration"))).some((entry) => entry.startsWith(".staging-"))).toBe(false);
    const status = await inspectCalibrationRuntime({ resourceRoot: root, platform: "linux", architecture: "x64", env: { PATH: "" }, featureMode: "full" });
    expect(status.assets.every((asset) => asset.status === "verified")).toBe(true);
    expect(status.readyForFullQualification).toBe(true);
    expect(status.runtimeAssetsVerified).toBe(true);
    expect(status.manifestApproved).toBe(false);
    expect(status.reasons).toContain("runtime-manifest:linux-x64:not-approved");
    await writeFile(join(applied.targetRoot, "bin/cublas64_13.dll"), "tampered", "utf8");
    const tampered = await inspectCalibrationRuntime({ resourceRoot: root, platform: "linux", architecture: "x64", env: { PATH: "" }, featureMode: "full" });
    expect(tampered.assets.find((asset) => asset.id === "llama-server")?.status).toBe("mismatch");
    const repaired = await applyCalibrationRuntimeProvisioning({ repositoryRoot: root, intake, diskStatus: ampleDiskStatus });
    expect(repaired.targetBackupPath).not.toBeNull();
    expect(await readFile(join(repaired.targetBackupPath!, "bin/cublas64_13.dll"), "utf8")).toBe("tampered");
    const repairedStatus = await inspectCalibrationRuntime({ resourceRoot: root, platform: "linux", architecture: "x64", env: { PATH: "" }, featureMode: "full" });
    expect(repairedStatus.assets.every((asset) => asset.status === "verified")).toBe(true);
    await expect(applyCalibrationRuntimeProvisioning({ repositoryRoot: root, intake, diskStatus: ampleDiskStatus }))
      .rejects.toThrow("calibration_runtime_target_already_provisioned:linux-x64");
  });

  it("refuses provisioning before mutation when the calibration disk reserve would be crossed", async () => {
    const root = await mkdtemp(join(tmpdir(), "qual-hardware-runtime-provisioning-reserve-test-"));
    roots.push(root);
    await copyProvisioningFixture(root);
    const sourceRoot = join(root, "approved-input");
    await mkdir(sourceRoot, { recursive: true });
    const assets = [];
    for (const id of REQUIRED_RUNTIME_ASSET_IDS) {
      const sourcePath = join(sourceRoot, `${id}.bin`);
      const licenseEvidencePath = join(sourceRoot, `${id}.license.txt`);
      const sbomEvidencePath = join(sourceRoot, `${id}.cdx.json`);
      await writeFile(sourcePath, `asset:${id}`, "utf8");
      await writeFile(licenseEvidencePath, `license:${id}`, "utf8");
      await writeFile(sbomEvidencePath, JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6" }), "utf8");
      assets.push({
        id,
        sourcePath,
        version: id === "telemetry-probe" ? "0.1.0" : "fixture-1",
        licenseSpdx: id === "telemetry-probe" ? "NOASSERTION" : "MIT",
        licenseEvidencePath,
        sbomEvidencePath,
      });
    }
    const manifestBefore = await readFile(join(root, "resources/calibration/runtime-manifest.json"), "utf8");
    await expect(applyCalibrationRuntimeProvisioning({
      repositoryRoot: root,
      intake: { schemaVersion: CALIBRATION_ASSET_INTAKE_VERSION, target: "darwin-arm64", assets },
      diskStatus: async (_path, projectedPeakBytes) => ({
        totalBytes: 100, freeBytes: projectedPeakBytes, reserveBytes: 10,
        projectedPeakBytes, canStart: false,
      }),
    })).rejects.toThrow("calibration_runtime_insufficient_disk_reserve");
    expect(await readFile(join(root, "resources/calibration/runtime-manifest.json"), "utf8")).toBe(manifestBefore);
    expect((await readdir(join(root, "resources/calibration"))).sort()).toEqual(["asset-sources.lock.json", "runtime-manifest.json"]);
  });
});
