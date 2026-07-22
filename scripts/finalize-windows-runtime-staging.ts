import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { CALIBRATION_KERNEL_VERSION, PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT } from "../src/shared/types.js";

const TARGET = "win32-x64" as const;

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`missing_argument:${name}`);
  return value;
}

async function digestFile(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

async function canonicalTextDigest(path: string): Promise<string> {
  return createHash("sha256").update((await readFile(path, "utf8")).replace(/\r\n?/g, "\n")).digest("hex");
}

interface AssetDefinition {
  id: string;
  kind: "executable" | "model";
  version: string;
  licenseSpdx: string;
  relativePath: string;
  licensePath: string;
  sbomPath: string;
  companions?: string[];
  sourceUrl: string;
}

async function main(): Promise<void> {
  const stage = argument("--stage");
  const repository = argument("--repository");
  const targetRoot = join(stage, "resources", "calibration", TARGET);
  const assets: AssetDefinition[] = [
    { id: "ffmpeg", kind: "executable", version: "8.1.2-30-g45f1910444", licenseSpdx: "GPL-3.0-or-later", relativePath: "bin/ffmpeg.exe", licensePath: "licenses/ffmpeg.txt", sbomPath: "sbom/ffmpeg.cdx.json", sourceUrl: "https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-07-22-13-36" },
    { id: "ffprobe", kind: "executable", version: "8.1.2-30-g45f1910444", licenseSpdx: "GPL-3.0-or-later", relativePath: "bin/ffprobe.exe", licensePath: "licenses/ffmpeg.txt", sbomPath: "sbom/ffprobe.cdx.json", sourceUrl: "https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-07-22-13-36" },
    { id: "mediamtx", kind: "executable", version: "1.18.2", licenseSpdx: "MIT", relativePath: "bin/mediamtx.exe", licensePath: "licenses/mediamtx.txt", sbomPath: "sbom/mediamtx.cdx.json", sourceUrl: "https://github.com/bluenviron/mediamtx/releases/tag/v1.18.2" },
    { id: "llama-server", kind: "executable", version: "b9637", licenseSpdx: "MIT AND LicenseRef-NVIDIA-CUDA-EULA", relativePath: "bin/llama/llama-server.exe", licensePath: "licenses/llama-cuda.txt", sbomPath: "sbom/llama-server.cdx.json", sourceUrl: "https://github.com/ggml-org/llama.cpp/releases/tag/b9637" },
    { id: "telemetry-probe", kind: "executable", version: "0.1.0-go1.26.5", licenseSpdx: "LicenseRef-AIQuimist-Internal", relativePath: "bin/telemetry-probe.exe", licensePath: "licenses/telemetry-probe.txt", sbomPath: "sbom/telemetry-probe.cdx.json", sourceUrl: "repository:tools/telemetry-probe" },
    { id: "qwen-core-gguf", kind: "model", version: "Qwen3-VL-2B-Instruct-Q4_K_M@52d6c8ff", licenseSpdx: "Apache-2.0", relativePath: "models/Qwen3VL-2B-Instruct-Q4_K_M.gguf", licensePath: "licenses/qwen-2b.txt", sbomPath: "sbom/qwen-core-gguf.cdx.json", sourceUrl: "https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/tree/52d6c8ffea26cc873ac5ad116f8631268d7eb503" },
    { id: "qwen-core-mmproj", kind: "model", version: "Qwen3-VL-2B-Instruct-mmproj-Q8_0@52d6c8ff", licenseSpdx: "Apache-2.0", relativePath: "models/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf", licensePath: "licenses/qwen-2b.txt", sbomPath: "sbom/qwen-core-mmproj.cdx.json", sourceUrl: "https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/tree/52d6c8ffea26cc873ac5ad116f8631268d7eb503" },
    { id: "qwen-core-max-gguf", kind: "model", version: "Qwen3-VL-4B-Instruct-Q4_K_M@1cd86afb", licenseSpdx: "Apache-2.0", relativePath: "models/Qwen3VL-4B-Instruct-Q4_K_M.gguf", licensePath: "licenses/qwen-4b.txt", sbomPath: "sbom/qwen-core-max-gguf.cdx.json", sourceUrl: "https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/tree/1cd86afb9a95c410a6038ab3b40d8b578c892266" },
    { id: "qwen-core-max-mmproj", kind: "model", version: "Qwen3-VL-4B-Instruct-mmproj-Q8_0@1cd86afb", licenseSpdx: "Apache-2.0", relativePath: "models/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf", licensePath: "licenses/qwen-4b.txt", sbomPath: "sbom/qwen-core-max-mmproj.cdx.json", sourceUrl: "https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/tree/1cd86afb9a95c410a6038ab3b40d8b578c892266" },
  ];
  const llamaDirectory = join(targetRoot, "bin", "llama");
  assets[3]!.companions = (await readdir(llamaDirectory)).filter((name) => name.toLowerCase().endsWith(".dll"))
    .sort().map((name) => `bin/llama/${name}`);
  for (const contract of ["calibration-kernel-authority-v1.json", "calibration-pipeline-contract-v1.json"]) {
    await mkdir(join(stage, "contracts"), { recursive: true });
    await copyFile(join(repository, "contracts", contract), join(stage, "contracts", contract));
  }
  await mkdir(join(stage, "resources", "calibration"), { recursive: true });
  await copyFile(join(repository, "resources", "calibration", "asset-sources.lock.json"), join(stage, "resources", "calibration", "asset-sources.lock.json"));
  for (const asset of assets) {
    const path = join(targetRoot, asset.relativePath);
    const info = await stat(path);
    const components = [{ name: asset.id, version: asset.version, path: asset.relativePath, sha256: await digestFile(path), bytes: info.size }];
    for (const companion of asset.companions ?? []) {
      const companionPath = join(targetRoot, companion);
      components.push({ name: basename(companion), version: asset.version, path: companion, sha256: await digestFile(companionPath), bytes: (await stat(companionPath)).size });
    }
    await mkdir(dirname(join(targetRoot, asset.sbomPath)), { recursive: true });
    await writeFile(join(targetRoot, asset.sbomPath), `${JSON.stringify({
      bomFormat: "CycloneDX", specVersion: "1.6", serialNumber: `urn:uuid:${randomUUID()}`, version: 1,
      metadata: { timestamp: "2026-07-22T12:00:00.000Z", component: { type: asset.kind === "model" ? "machine-learning-model" : "application", name: asset.id, version: asset.version } },
      components: components.map((component) => ({
        type: asset.kind === "model" ? "machine-learning-model" : "file", name: component.name, version: component.version,
        hashes: [{ alg: "SHA-256", content: component.sha256 }], licenses: [{ license: { id: asset.licenseSpdx } }],
        properties: [{ name: "qual-hardware:path", value: component.path }, { name: "qual-hardware:sizeBytes", value: String(component.bytes) }, { name: "qual-hardware:source", value: asset.sourceUrl }],
      })),
    }, null, 2)}\n`, "utf8");
  }
  const packageSbom = join(targetRoot, "sbom", "runtime-package.cdx.json");
  await writeFile(packageSbom, `${JSON.stringify({
    bomFormat: "CycloneDX", specVersion: "1.6", serialNumber: `urn:uuid:${randomUUID()}`, version: 1,
    metadata: { timestamp: "2026-07-22T12:00:00.000Z", component: { type: "application", name: "qual-hardware-calibration-runtime", version: "1.0.0" } },
    components: assets.map((asset) => ({ type: asset.kind === "model" ? "machine-learning-model" : "application", name: asset.id, version: asset.version })),
  }, null, 2)}\n`, "utf8");
  const emptyArtifact = (id: string, executable: boolean) => ({ relativePath: executable ? `bin/${id}` : `models/${id}`, sha256: null, sizeBytes: null });
  const manifestAssets = [];
  for (const asset of assets) {
    const artifactPath = join(targetRoot, asset.relativePath);
    const artifactInfo = await stat(artifactPath);
    const companionFiles = await Promise.all((asset.companions ?? []).map(async (companion) => ({
      relativePath: companion,
      sha256: await digestFile(join(targetRoot, companion)),
      sizeBytes: (await stat(join(targetRoot, companion))).size,
    })));
    manifestAssets.push({
      id: asset.id,
      kind: asset.kind,
      version: asset.version,
      licenseSpdx: asset.licenseSpdx,
      sbomRef: asset.sbomPath,
      requiredForFull: true,
      artifacts: {
        "darwin-arm64": emptyArtifact(asset.id, asset.kind === "executable"),
        "win32-x64": {
          relativePath: asset.relativePath,
          sha256: await digestFile(artifactPath),
          sizeBytes: artifactInfo.size,
          licenseEvidence: { relativePath: asset.licensePath, sha256: await canonicalTextDigest(join(targetRoot, asset.licensePath)) },
          sbomEvidence: { relativePath: asset.sbomPath, sha256: await canonicalTextDigest(join(targetRoot, asset.sbomPath)) },
          companionFiles,
        },
        "linux-x64": emptyArtifact(asset.id, asset.kind === "executable"),
      },
    });
  }
  const runtimeManifest = {
    schemaVersion: "qual-hardware-calibration-runtime-manifest/2.0.0",
    kernelVersion: CALIBRATION_KERNEL_VERSION,
    authorityCommit: PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT,
    pipelineImplementation: "perceptrum-equivalent-v1",
    supportedTargets: ["darwin-arm64", "win32-x64", "linux-x64"],
    authorityContract: { relativePath: "contracts/calibration-kernel-authority-v1.json", sha256: await canonicalTextDigest(join(stage, "contracts", "calibration-kernel-authority-v1.json")) },
    pipelineContract: { relativePath: "contracts/calibration-pipeline-contract-v1.json", sha256: await canonicalTextDigest(join(stage, "contracts", "calibration-pipeline-contract-v1.json")) },
    sourceLock: { relativePath: "resources/calibration/asset-sources.lock.json", sha256: await canonicalTextDigest(join(stage, "resources", "calibration", "asset-sources.lock.json")) },
    assets: manifestAssets,
  };
  await writeFile(join(stage, "resources", "calibration", "runtime-manifest.json"), `${JSON.stringify(runtimeManifest, null, 2)}\n`, "utf8");
  const genericLicense = `resources/calibration/${TARGET}/licenses/runtime-package.txt`;
  const genericSbom = `resources/calibration/${TARGET}/sbom/runtime-package.cdx.json`;
  const rules = [
    ...assets.map((asset) => ({ prefix: `resources/calibration/${TARGET}/${asset.relativePath}`, licenseSpdx: asset.licenseSpdx, licenseRef: `resources/calibration/${TARGET}/${asset.licensePath}`, sbomRef: `resources/calibration/${TARGET}/${asset.sbomPath}` })),
    { prefix: `resources/calibration/${TARGET}/bin/llama/`, licenseSpdx: assets[3]!.licenseSpdx, licenseRef: `resources/calibration/${TARGET}/${assets[3]!.licensePath}`, sbomRef: `resources/calibration/${TARGET}/${assets[3]!.sbomPath}` },
    { prefix: `resources/calibration/${TARGET}/licenses/`, licenseSpdx: "LicenseRef-AIQuimist-Runtime-Package", licenseRef: genericLicense, sbomRef: genericSbom },
    { prefix: `resources/calibration/${TARGET}/sbom/`, licenseSpdx: "LicenseRef-AIQuimist-Runtime-Package", licenseRef: genericLicense, sbomRef: genericSbom },
    { prefix: "contracts/", licenseSpdx: "LicenseRef-AIQuimist-Internal", licenseRef: genericLicense, sbomRef: genericSbom },
    { prefix: "resources/calibration/", licenseSpdx: "LicenseRef-AIQuimist-Internal", licenseRef: genericLicense, sbomRef: genericSbom },
  ];
  await writeFile(join(stage, "runtime-package-definition.json"), `${JSON.stringify({
    version: "1.0.0", target: TARGET, minimumAppVersion: "0.3.0", classification: "production",
    keyId: "qual-hardware-production-internal-2026", createdAt: "2026-07-22T12:00:00.000Z", rules,
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ stage, assets: assets.length, companions: assets[3]!.companions?.length ?? 0 })}\n`);
}

await main();
