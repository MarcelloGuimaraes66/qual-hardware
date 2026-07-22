import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  auditCalibrationAssetSources,
  hashCalibrationRepositorySource,
  parseCalibrationAssetSourceLock,
} from "../src/server/calibrationAssetSources.js";
import { REQUIRED_RUNTIME_ASSET_IDS, SUPPORTED_RUNTIME_TARGETS } from "../src/server/calibrationRuntime.js";

const projectRoot = new URL("..", import.meta.url).pathname;

async function sourceLockFixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL("../resources/calibration/asset-sources.lock.json", import.meta.url), "utf8"));
}

describe("calibration asset source lock", () => {
  it("validates the exact cross-platform inventory and remains fail-closed until every candidate is approved", async () => {
    const lock = parseCalibrationAssetSourceLock(await sourceLockFixture());
    expect(lock.assets.map((asset) => asset.id)).toEqual(REQUIRED_RUNTIME_ASSET_IDS);
    expect(Object.keys(lock.assets[0]!.targets)).toEqual(SUPPORTED_RUNTIME_TARGETS);
    const report = await auditCalibrationAssetSources({
      repositoryRoot: projectRoot,
      diskStatus: async (_path, projectedPeakBytes) => ({
        totalBytes: 100_000_000_000,
        freeBytes: 90_000_000_000,
        reserveBytes: 10_000_000_000,
        projectedPeakBytes,
        canStart: true,
      }),
    });
    expect(report.inventoryValid).toBe(true);
    expect(report.readyForProvisioning).toBe(false);
    expect(report.targets).toHaveLength(3);
    expect(report.targets.every((target) => target.projectedPeakBytes > 9_000_000_000)).toBe(true);
    expect(report.blockers).toContain("asset:telemetry-probe:platform_binary_review_required");
    expect(report.blockers).not.toContain(expect.stringContaining("repository_integrity_"));
    expect(report.blockers).not.toContain(expect.stringContaining("disk-reserve:"));
  });

  it("locks the internal telemetry probe source tree by path, bytes and content hash", async () => {
    const lock = parseCalibrationAssetSourceLock(await sourceLockFixture());
    const telemetry = lock.assets.find((asset) => asset.id === "telemetry-probe")!;
    const source = telemetry.targets["darwin-arm64"];
    expect(source.sourceKind).toBe("repository_source");
    expect(source.repositoryPath).toBe("tools/telemetry-probe");
    const digest = await hashCalibrationRepositorySource(projectRoot, source.repositoryPath!);
    expect(digest).toMatchObject({ sha256: source.sha256, sizeBytes: source.sizeBytes });
    expect(digest.fileCount).toBeGreaterThan(5);
  });

  it("pins the complete Windows CUDA bundle and counts a reused archive only once", async () => {
    const lock = parseCalibrationAssetSourceLock(await sourceLockFixture());
    const llama = lock.assets.find((asset) => asset.id === "llama-server")!;
    const windows = llama.targets["win32-x64"];
    expect(windows.archiveMember).toBe("llama-server.exe");
    expect(windows.companionSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: windows.url, sha256: windows.sha256, archiveMember: "*.dll" }),
      expect.objectContaining({
        url: expect.stringContaining("cudart-llama-bin-win-cuda-13.3-x64.zip"),
        archiveMember: "*.dll",
      }),
    ]));

    const report = await auditCalibrationAssetSources({
      repositoryRoot: projectRoot,
      diskStatus: async (_path, projectedPeakBytes) => ({
        totalBytes: Number.MAX_SAFE_INTEGER,
        freeBytes: Number.MAX_SAFE_INTEGER,
        reserveBytes: 0,
        projectedPeakBytes,
        canStart: true,
      }),
    });
    const uniqueWindowsSources = new Map<string, number>();
    for (const asset of lock.assets) {
      const source = asset.targets["win32-x64"];
      for (const item of [source, ...source.companionSources]) {
        if (item.sha256 && item.sizeBytes !== null) uniqueWindowsSources.set(`${item.sha256}:${item.sizeBytes}`, item.sizeBytes);
      }
    }
    const expectedAcquisitionBytes = [...uniqueWindowsSources.values()].reduce((sum, size) => sum + size, 0);
    expect(report.targets.find((target) => target.target === "win32-x64")?.acquisitionBytes)
      .toBe(expectedAcquisitionBytes);
  });

  it("pins dynamic-library companions for macOS Metal and Linux Vulkan", async () => {
    const lock = parseCalibrationAssetSourceLock(await sourceLockFixture());
    const llama = lock.assets.find((asset) => asset.id === "llama-server")!;
    expect(llama.targets["darwin-arm64"].companionSources).toEqual([
      expect.objectContaining({ archiveMember: "*.dylib" }),
    ]);
    expect(llama.targets["linux-x64"]).toMatchObject({
      url: expect.stringContaining("ubuntu-vulkan-x64"),
      companionSources: [expect.objectContaining({ archiveMember: "*.so*" })],
    });
  });

  it("reports insufficient reserve without downloading or mutating an asset", async () => {
    const report = await auditCalibrationAssetSources({
      repositoryRoot: projectRoot,
      diskStatus: async (_path, projectedPeakBytes) => ({
        totalBytes: 100,
        freeBytes: 20,
        reserveBytes: 50,
        projectedPeakBytes,
        canStart: false,
      }),
    });
    expect(report.readyForProvisioning).toBe(false);
    expect(report.blockers.filter((blocker) => blocker.startsWith("disk-reserve:"))).toHaveLength(3);
  });

  it("rejects duplicate inventory and mutable model selectors", async () => {
    const duplicate = await sourceLockFixture();
    const duplicateAssets = duplicate.assets as Array<Record<string, unknown>>;
    duplicateAssets[1] = structuredClone(duplicateAssets[0]!);
    expect(() => parseCalibrationAssetSourceLock(duplicate)).toThrow("calibration_asset_source_inventory_invalid");

    const mutable = await sourceLockFixture();
    const mutableAssets = mutable.assets as Array<{ id: string; targets: Record<string, { url: string | null }> }>;
    const model = mutableAssets.find((asset) => asset.id === "qwen-core-gguf")!;
    model.targets["darwin-arm64"]!.url = model.targets["darwin-arm64"]!.url!.replace(/resolve\/[0-9a-f]{40}\//, "resolve/main/");
    expect(() => parseCalibrationAssetSourceLock(mutable)).toThrow("immutable_source_selector_required");
  });
});
