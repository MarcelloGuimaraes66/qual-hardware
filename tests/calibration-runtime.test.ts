import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CALIBRATION_RUNTIME_MANIFEST_VERSION,
  inspectCalibrationRuntime,
} from "../src/server/calibrationRuntime.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots: string[] = [];
const targetKeys = ["darwin-arm64", "win32-x64", "linux-x64"] as const;

type MutableManifest = {
  schemaVersion: string;
  authorityContract: { relativePath: string; sha256: string };
  pipelineContract: { relativePath: string; sha256: string };
  sourceLock: { relativePath: string; sha256: string };
  assets: Array<{
    id: string;
    kind: "executable" | "model";
    version: string | null;
    licenseSpdx: string | null;
    sbomRef: string | null;
    artifacts: Record<typeof targetKeys[number], {
      relativePath: string;
      sha256: string | null;
      sizeBytes: number | null;
      licenseEvidence?: { relativePath: string; sha256: string } | null;
      sbomEvidence?: { relativePath: string; sha256: string } | null;
    }>;
  }>;
};

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function makeRuntimeFixture(
  selectedTarget: typeof targetKeys[number],
  options: { nonExecutableId?: string; mutate?: (manifest: MutableManifest) => void } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "qual-hardware-runtime-test-"));
  temporaryRoots.push(root);
  const manifest = JSON.parse(await readFile(join(projectRoot, "resources/calibration/runtime-manifest.json"), "utf8")) as MutableManifest;
  for (const contract of [manifest.authorityContract, manifest.pipelineContract, manifest.sourceLock]) {
    const destination = join(root, contract.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(projectRoot, contract.relativePath), destination);
  }
  for (const asset of manifest.assets) {
    asset.version = "fixture-1";
    asset.licenseSpdx = "MIT";
    asset.sbomRef = "sbom/fixture.cdx.json";
    const artifact = asset.artifacts[selectedTarget];
    const bytes = Buffer.from(`${selectedTarget}:${asset.id}:platform-specific-bytes`, "utf8");
    artifact.sha256 = sha256(bytes);
    artifact.sizeBytes = bytes.byteLength;
    const destination = join(root, "resources/calibration", selectedTarget, artifact.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    if (asset.kind === "executable" && asset.id !== options.nonExecutableId) await chmod(destination, 0o755);
    const licenseBytes = Buffer.from(`Fixture license evidence for ${asset.id}`, "utf8");
    const sbomBytes = Buffer.from(JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", component: asset.id }), "utf8");
    artifact.licenseEvidence = { relativePath: `licenses/${asset.id}.txt`, sha256: sha256(licenseBytes) };
    artifact.sbomEvidence = { relativePath: `sbom/${asset.id}.cdx.json`, sha256: sha256(sbomBytes) };
    const licensePath = join(root, "resources/calibration", selectedTarget, artifact.licenseEvidence.relativePath);
    const sbomPath = join(root, "resources/calibration", selectedTarget, artifact.sbomEvidence.relativePath);
    await mkdir(dirname(licensePath), { recursive: true });
    await mkdir(dirname(sbomPath), { recursive: true });
    await writeFile(licensePath, licenseBytes);
    await writeFile(sbomPath, sbomBytes);
  }
  options.mutate?.(manifest);
  const manifestPath = join(root, "resources/calibration/runtime-manifest.json");
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return root;
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("offline calibration runtime manifest", () => {
  it("ships the candidate telemetry probe but blocks commercial qualification while the remaining runtime is absent", async () => {
    const status = await inspectCalibrationRuntime({
      resourceRoot: projectRoot,
      platform: "linux",
      architecture: "x64",
      env: { PATH: "" },
    });
    expect(status.authorityCommit).toBe("d918faa0ecd6a9906b711039e5d89f78e0536c44");
    expect(status.featureMode).toBe("diagnostic");
    expect(status.readyForQuickTest).toBe(true);
    expect(status.readyForFullQualification).toBe(false);
    expect(status.contracts.every((contract) => contract.status === "verified")).toBe(true);
    expect(status.assets.find((asset) => asset.id === "telemetry-probe")?.status).toBe("verified");
    expect(status.assets.filter((asset) => asset.id !== "telemetry-probe").every((asset) => asset.status === "missing")).toBe(true);
    expect(status.reasons).toContain("ffmpeg:missing");
    expect(status.reasons).toContain("runtime-manifest:linux-x64:not-approved");
  });

  it("verifies the packaged telemetry-probe hash, size, license notice and SBOM for all targets", async () => {
    const selected = [
      ["darwin", "arm64"],
      ["win32", "x64"],
      ["linux", "x64"],
    ] as const;
    for (const [selectedPlatform, architecture] of selected) {
      const status = await inspectCalibrationRuntime({
        resourceRoot: projectRoot,
        platform: selectedPlatform,
        architecture,
        env: { PATH: "" },
      });
      const telemetry = status.assets.find((asset) => asset.id === "telemetry-probe");
      expect(telemetry).toMatchObject({ status: "verified", version: "0.1.0", licenseSpdx: "NOASSERTION" });
      expect(telemetry?.sizeBytes).toBeGreaterThan(2_000_000);
      expect(status.readyForFullQualification).toBe(false);
    }
  });

  it("selects and verifies distinct artifacts for each supported platform", async () => {
    const darwinRoot = await makeRuntimeFixture("darwin-arm64");
    const windowsRoot = await makeRuntimeFixture("win32-x64");
    const darwin = await inspectCalibrationRuntime({ resourceRoot: darwinRoot, platform: "darwin", architecture: "arm64", env: { PATH: "" }, featureMode: "full" });
    const windows = await inspectCalibrationRuntime({ resourceRoot: windowsRoot, platform: "win32", architecture: "x64", env: { PATH: "" }, featureMode: "full" });
    expect(darwin.assets.every((asset) => asset.status === "verified")).toBe(true);
    expect(windows.assets.every((asset) => asset.status === "verified")).toBe(true);
    expect(darwin.assets.find((asset) => asset.id === "ffmpeg")?.sha256)
      .not.toBe(windows.assets.find((asset) => asset.id === "ffmpeg")?.sha256);
    expect(windows.assets.find((asset) => asset.id === "ffmpeg")?.path).toMatch(/ffmpeg\.exe$/);
    expect(darwin.readyForFullQualification).toBe(true);
    expect(darwin.runtimeAssetsVerified).toBe(true);
    expect(darwin.manifestApproved).toBe(false);
    expect(darwin.reasons).toContain("runtime-manifest:darwin-arm64:not-approved");
  });

  it.runIf(process.platform !== "win32")("requires execute permission for packaged Unix executables", async () => {
    const root = await makeRuntimeFixture("linux-x64", { nonExecutableId: "ffmpeg" });
    const status = await inspectCalibrationRuntime({ resourceRoot: root, platform: "linux", architecture: "x64", env: { PATH: "" }, featureMode: "full" });
    expect(status.assets.find((asset) => asset.id === "ffmpeg")?.status).toBe("missing");
    expect(status.readyForFullQualification).toBe(false);
  });

  it("rejects an asset when its packaged SBOM evidence is missing or altered", async () => {
    const root = await makeRuntimeFixture("linux-x64");
    await writeFile(join(root, "resources/calibration/linux-x64/sbom/ffmpeg.cdx.json"), "tampered", "utf8");
    const status = await inspectCalibrationRuntime({ resourceRoot: root, platform: "linux", architecture: "x64", env: { PATH: "" }, featureMode: "full" });
    expect(status.assets.find((asset) => asset.id === "ffmpeg")?.status).toBe("mismatch");
    expect(status.assets.filter((asset) => asset.id !== "ffmpeg").every((asset) => asset.status === "verified")).toBe(true);
    expect(status.readyForFullQualification).toBe(false);
  });

  it("rejects traversal paths and duplicate required assets before touching them", async () => {
    const traversalRoot = await makeRuntimeFixture("linux-x64", {
      mutate: (manifest) => { manifest.assets[0]!.artifacts["linux-x64"].relativePath = "../outside"; },
    });
    await expect(inspectCalibrationRuntime({ resourceRoot: traversalRoot, platform: "linux", architecture: "x64", env: { PATH: "" } }))
      .rejects.toThrow(/runtime_relative_path_required/);

    const duplicateRoot = await makeRuntimeFixture("linux-x64", {
      mutate: (manifest) => { manifest.assets[1]!.id = manifest.assets[0]!.id; },
    });
    await expect(inspectCalibrationRuntime({ resourceRoot: duplicateRoot, platform: "linux", architecture: "x64", env: { PATH: "" } }))
      .rejects.toThrow("calibration_runtime_manifest_asset_inventory_invalid");
  });

  it("blocks every launch on unsupported targets or when the rollback flag is set", async () => {
    const unsupported = await inspectCalibrationRuntime({ resourceRoot: projectRoot, platform: "freebsd", architecture: "x64", env: { PATH: "" } });
    expect(unsupported.readyForQuickTest).toBe(false);
    expect(unsupported.readyForFullQualification).toBe(false);
    expect(unsupported.reasons).toContain("runtime-target:freebsd-x64:unsupported");

    const disabled = await inspectCalibrationRuntime({
      resourceRoot: projectRoot,
      platform: "darwin",
      architecture: "arm64",
      env: { PATH: "" },
      featureMode: "disabled",
    });
    expect(disabled.featureMode).toBe("disabled");
    expect(disabled.readyForQuickTest).toBe(false);
    expect(disabled.readyForFullQualification).toBe(false);
    expect(disabled.reasons).toContain("feature-mode:disabled:full-disabled");
  });

  it("ships only the v2 manifest contract", async () => {
    const manifest = JSON.parse(await readFile(join(projectRoot, "resources/calibration/runtime-manifest.json"), "utf8")) as MutableManifest;
    expect(manifest.schemaVersion).toBe(CALIBRATION_RUNTIME_MANIFEST_VERSION);
    expect(manifest.assets).toHaveLength(9);
    expect(manifest.assets.every((asset) => targetKeys.every((target) => Boolean(asset.artifacts[target])))).toBe(true);
  });
});
