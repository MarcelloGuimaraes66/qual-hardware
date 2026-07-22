import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CALIBRATION_ASSET_INTAKE_VERSION,
  CALIBRATION_ASSET_INTAKE_TEMPLATE_VERSION,
  applyCalibrationRuntimeProvisioning,
  createCalibrationRuntimeIntakeTemplate,
  planCalibrationRuntimeProvisioning,
} from "../src/server/calibrationRuntimeProvisioning.js";
import { REQUIRED_RUNTIME_ASSET_IDS, inspectCalibrationRuntime } from "../src/server/calibrationRuntime.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const roots: string[] = [];

interface FixtureAsset {
  id: string;
  sourcePath: string;
  version: string;
  licenseSpdx: string;
  licenseEvidencePath: string;
  sbomEvidencePath: string;
  sourcePackages?: Array<{ sourcePath: string; sha256: string; sizeBytes: number }>;
  companionFiles: Array<{ sourcePath: string; relativePath: string; sourcePackageSha256?: string }>;
}

async function integrity(path: string): Promise<{ sha256: string; sizeBytes: number }> {
  const bytes = await readFile(path);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length };
}

async function attachFixtureSourceProvenance(
  root: string,
  target: "darwin-arm64" | "win32-x64" | "linux-x64",
  assets: FixtureAsset[],
): Promise<void> {
  const lockPath = join(root, "resources/calibration/asset-sources.lock.json");
  const manifestPath = join(root, "resources/calibration/runtime-manifest.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
    assets: Array<{ id: string; targets: Record<string, {
      sourceKind: string; url: string | null; sha256: string | null; sizeBytes: number | null;
      companionSources?: Array<{ url: string; sha256: string; sizeBytes: number }>;
    }> }>;
  };
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    sourceLock: { sha256: string };
    assets: Array<{ id: string; artifacts: Record<string, { sha256: string | null; sizeBytes: number | null }> }>;
  };
  for (const asset of assets) {
    const lockedAsset = lock.assets.find((candidate) => candidate.id === asset.id)!;
    const lockedSource = lockedAsset.targets[target]!;
    const runtimeArtifact = manifest.assets.find((candidate) => candidate.id === asset.id)!.artifacts[target]!;
    const assetIntegrity = await integrity(asset.sourcePath);
    const packagesByUrl = new Map<string, { sourcePath: string; sha256: string; sizeBytes: number }>();
    if (lockedSource.sourceKind === "repository_source") {
      runtimeArtifact.sha256 = assetIntegrity.sha256;
      runtimeArtifact.sizeBytes = assetIntegrity.sizeBytes;
    } else {
      const primaryPath = lockedSource.sourceKind === "direct_file"
        ? asset.sourcePath : join(dirname(asset.sourcePath), `${asset.id}.source-package`);
      if (primaryPath !== asset.sourcePath) await writeFile(primaryPath, `locked-package:${target}:${asset.id}`, "utf8");
      const primary = { sourcePath: primaryPath, ...await integrity(primaryPath) };
      lockedSource.sha256 = primary.sha256;
      lockedSource.sizeBytes = primary.sizeBytes;
      if (lockedSource.url) packagesByUrl.set(lockedSource.url, primary);
      for (const [index, companionSource] of (lockedSource.companionSources ?? []).entries()) {
        let sourcePackage = packagesByUrl.get(companionSource.url);
        if (!sourcePackage) {
          const sourcePath = join(dirname(asset.sourcePath), `${asset.id}.companion-package-${index}`);
          await writeFile(sourcePath, `locked-companion-package:${target}:${asset.id}:${index}`, "utf8");
          sourcePackage = { sourcePath, ...await integrity(sourcePath) };
          packagesByUrl.set(companionSource.url, sourcePackage);
        }
        companionSource.sha256 = sourcePackage.sha256;
        companionSource.sizeBytes = sourcePackage.sizeBytes;
        const companionFile = asset.companionFiles[index];
        if (!companionFile) throw new Error(`fixture_companion_missing:${asset.id}:${index}`);
        companionFile.sourcePackageSha256 = sourcePackage.sha256;
      }
    }
    asset.sourcePackages = [...new Map([...packagesByUrl.values()]
      .map((sourcePackage) => [`${sourcePackage.sha256}:${sourcePackage.sizeBytes}`, sourcePackage])).values()];
  }
  const lockBytes = `${JSON.stringify(lock, null, 2)}\n`;
  await writeFile(lockPath, lockBytes, "utf8");
  manifest.sourceLock.sha256 = createHash("sha256").update(lockBytes).digest("hex");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("calibration runtime asset provisioning", () => {
  it.each(["darwin-arm64", "win32-x64", "linux-x64"] as const)(
    "generates a fail-closed, complete and target-specific intake template for %s",
    async (target) => {
      const template = await createCalibrationRuntimeIntakeTemplate({ repositoryRoot: projectRoot, target });
      expect(template).toMatchObject({
        schemaVersion: "qual-hardware-calibration-asset-intake-template/2.0.0",
        target,
        readyToApply: false,
        runtimeNetworkAccess: "forbidden",
      });
      expect(template.intake.assets.map((asset) => asset.id)).toEqual(REQUIRED_RUNTIME_ASSET_IDS);
      expect(template.sourceGuide.map((asset) => asset.id)).toEqual(REQUIRED_RUNTIME_ASSET_IDS);
      expect(template.sourceGuide.every((asset) => asset.source.sha256 && asset.source.sizeBytes)).toBe(true);
      expect(template.intake.assets.every((asset) => asset.sourcePath.startsWith("REPLACE_WITH_"))).toBe(true);
      const llamaIntake = template.intake.assets.find((asset) => asset.id === "llama-server")!;
      const llamaGuide = template.sourceGuide.find((asset) => asset.id === "llama-server")!;
      expect(llamaIntake.companionFiles).toHaveLength(llamaGuide.source.companionSources.length);
      expect(new Set(llamaIntake.sourcePackages.map((sourcePackage) => sourcePackage.sha256)).size)
        .toBe(new Set([llamaGuide.source.sha256, ...llamaGuide.source.companionSources.map((source) => source.sha256)]).size);
      await expect(planCalibrationRuntimeProvisioning({ repositoryRoot: projectRoot, intake: template }))
        .rejects.toThrow("absolute_source_path_required");
    },
  );

  it("plans without mutation, then atomically installs one complete verified target with a manifest backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "qual-hardware-runtime-provisioning-test-"));
    roots.push(root);
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
    const sourceRoot = join(root, "external-approved-input");
    await mkdir(sourceRoot, { recursive: true });
    const assets: FixtureAsset[] = [];
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
    await attachFixtureSourceProvenance(root, "linux-x64", assets);
    const intake = { schemaVersion: CALIBRATION_ASSET_INTAKE_VERSION, target: "linux-x64", assets };
    const planned = await planCalibrationRuntimeProvisioning({ repositoryRoot: root, intake });
    const wrappedPlan = await planCalibrationRuntimeProvisioning({
      repositoryRoot: root,
      intake: { schemaVersion: CALIBRATION_ASSET_INTAKE_TEMPLATE_VERSION, target: "linux-x64", intake, sourceGuide: [] },
    });
    expect(wrappedPlan).toEqual(planned);
    expect(planned.files).toHaveLength(REQUIRED_RUNTIME_ASSET_IDS.length * 3 + 1);
    expect(planned.sourcePackages).toHaveLength(8);
    const plannedLlama = planned.manifest.assets.find((asset) => asset.id === "llama-server")!.artifacts["linux-x64"];
    expect(plannedLlama.sourcePackages).toEqual([
      expect.objectContaining({ sha256: assets.find((asset) => asset.id === "llama-server")!.sourcePackages![0]!.sha256 }),
    ]);
    expect(plannedLlama.companionFiles[0]?.sourcePackageSha256).toBe(plannedLlama.sourcePackages[0]?.sha256);
    expect(planned.stagingBytes).toBeGreaterThan(0);
    expect((await readdir(join(root, "resources/calibration"))).sort()).toEqual(["asset-sources.lock.json", "runtime-manifest.json"]);

    const ffmpeg = assets.find((asset) => asset.id === "ffmpeg")!;
    const ffmpegPackagePath = ffmpeg.sourcePackages![0]!.sourcePath;
    const ffmpegPackageBytes = await readFile(ffmpegPackagePath);
    await writeFile(ffmpegPackagePath, "tampered source archive", "utf8");
    await expect(planCalibrationRuntimeProvisioning({ repositoryRoot: root, intake }))
      .rejects.toThrow("calibration_asset_source_package_integrity_mismatch:ffmpeg:0");
    await writeFile(ffmpegPackagePath, ffmpegPackageBytes);

    const directModel = assets.find((asset) => asset.id === "qwen-core-gguf")!;
    const directModelPath = directModel.sourcePath;
    const substitutedModelPath = join(sourceRoot, "substituted-qwen-core.gguf");
    await writeFile(substitutedModelPath, "substituted model", "utf8");
    directModel.sourcePath = substitutedModelPath;
    await expect(planCalibrationRuntimeProvisioning({ repositoryRoot: root, intake }))
      .rejects.toThrow("calibration_asset_direct_file_integrity_mismatch:qwen-core-gguf");
    directModel.sourcePath = directModelPath;

    const telemetry = assets.find((asset) => asset.id === "telemetry-probe")!;
    const telemetryPath = telemetry.sourcePath;
    const substitutedTelemetryPath = join(sourceRoot, "substituted-telemetry-probe");
    await writeFile(substitutedTelemetryPath, "substituted first-party binary", "utf8");
    telemetry.sourcePath = substitutedTelemetryPath;
    await expect(planCalibrationRuntimeProvisioning({ repositoryRoot: root, intake }))
      .rejects.toThrow("calibration_asset_pinned_artifact_integrity_mismatch:telemetry-probe:linux-x64");
    telemetry.sourcePath = telemetryPath;

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
    expect(JSON.parse(await readFile(applied.backupPath, "utf8"))).toMatchObject({ schemaVersion: "qual-hardware-calibration-runtime-manifest/2.0.0" });
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
    const sourceRoot = join(root, "approved-input");
    await mkdir(sourceRoot, { recursive: true });
    const assets: FixtureAsset[] = [];
    for (const id of REQUIRED_RUNTIME_ASSET_IDS) {
      const sourcePath = join(sourceRoot, `${id}.bin`);
      const licenseEvidencePath = join(sourceRoot, `${id}.license.txt`);
      const sbomEvidencePath = join(sourceRoot, `${id}.cdx.json`);
      await writeFile(sourcePath, `asset:${id}`, "utf8");
      await writeFile(licenseEvidencePath, `license:${id}`, "utf8");
      await writeFile(sbomEvidencePath, JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6" }), "utf8");
      const companionFiles = [];
      if (id === "llama-server") {
        const companionPath = join(sourceRoot, "libllama.dylib");
        await writeFile(companionPath, "fixture Metal companion", "utf8");
        companionFiles.push({ sourcePath: companionPath, relativePath: "bin/libllama.dylib" });
      }
      assets.push({
        id,
        sourcePath,
        version: id === "telemetry-probe" ? "0.1.0" : "fixture-1",
        licenseSpdx: id === "telemetry-probe" ? "NOASSERTION" : "MIT",
        licenseEvidencePath,
        sbomEvidencePath,
        companionFiles,
      });
    }
    await attachFixtureSourceProvenance(root, "darwin-arm64", assets);
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

  it("refuses an incomplete companion-library inventory before reading or mutating runtime files", async () => {
    const template = await createCalibrationRuntimeIntakeTemplate({ repositoryRoot: projectRoot, target: "win32-x64" });
    const llama = template.intake.assets.find((asset) => asset.id === "llama-server")!;
    llama.companionFiles.splice(1);
    for (const asset of template.intake.assets) {
      asset.sourcePath = "/nonexistent/asset";
      asset.licenseSpdx = "MIT";
      asset.licenseEvidencePath = "/nonexistent/license";
      asset.sbomEvidencePath = "/nonexistent/sbom";
      for (const sourcePackage of asset.sourcePackages) sourcePackage.sourcePath = "/nonexistent/package";
      for (const companion of asset.companionFiles) {
        companion.sourcePath = "/nonexistent/companion";
        companion.relativePath = "bin/companion.dll";
      }
    }
    await expect(planCalibrationRuntimeProvisioning({ repositoryRoot: projectRoot, intake: template }))
      .rejects.toThrow("calibration_asset_companion_groups_incomplete:llama-server:2:1");
  });

  it("rejects legacy v1 intake before reading any external file", async () => {
    await expect(planCalibrationRuntimeProvisioning({
      repositoryRoot: projectRoot,
      intake: { schemaVersion: "qual-hardware-calibration-asset-intake/1.0.0", target: "linux-x64", assets: [] },
    })).rejects.toThrow("calibration_asset_intake_v1_source_provenance_required");
  });
});
