import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { currentHostPlatform, trySelectHostPlatform } from "../platform/index.js";
import {
  CALIBRATION_KERNEL_VERSION,
  PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT,
  type CalibrationRuntimeStatus,
} from "../shared/types.js";

export const CALIBRATION_AUTHORITY_COMMIT = PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT;
export const CALIBRATION_RUNTIME_MANIFEST_VERSION = "qual-hardware-calibration-runtime-manifest/2.0.0" as const;

export const SUPPORTED_RUNTIME_TARGETS = ["darwin-arm64", "win32-x64", "linux-x64"] as const;
export type SupportedRuntimeTarget = typeof SUPPORTED_RUNTIME_TARGETS[number];
export const REQUIRED_RUNTIME_ASSET_IDS = [
  "ffmpeg",
  "ffprobe",
  "mediamtx",
  "llama-server",
  "telemetry-probe",
  "qwen-core-gguf",
  "qwen-core-mmproj",
  "qwen-core-max-gguf",
  "qwen-core-max-mmproj",
] as const;

// Filled only after licensing, SBOM and physical package verification for each
// target. An empty map intentionally keeps commercial qualification fail-closed.
const APPROVED_RUNTIME_MANIFEST_HASHES: Readonly<Record<string, string>> = Object.freeze({});
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const gitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/);
const relativePathSchema = z.string().min(1).max(500).superRefine((value, context) => {
  const segments = value.split(/[\\/]+/);
  if (isAbsolute(value) || /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(value) ||
      segments.some((segment) => segment === ".." || segment === "." || segment.length === 0)) {
    context.addIssue({ code: "custom", message: "runtime_relative_path_required" });
  }
});
const runtimeEvidenceReferenceSchema = z.object({
  relativePath: relativePathSchema,
  sha256: sha256Schema,
}).strict();
const runtimeCompanionFileSchema = z.object({
  relativePath: relativePathSchema,
  sha256: sha256Schema,
  sizeBytes: z.number().int().positive(),
}).strict();
const runtimeArtifactSchema = z.object({
  relativePath: relativePathSchema,
  sha256: sha256Schema.nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  licenseEvidence: runtimeEvidenceReferenceSchema.nullable().optional().default(null),
  sbomEvidence: runtimeEvidenceReferenceSchema.nullable().optional().default(null),
  companionFiles: z.array(runtimeCompanionFileSchema).max(256).optional().default([]),
}).strict().superRefine((artifact, context) => {
  const paths = [artifact.relativePath, ...artifact.companionFiles.map((file) => file.relativePath)];
  if (new Set(paths.map((path) => path.toLowerCase())).size !== paths.length) {
    context.addIssue({ code: "custom", message: "runtime_artifact_companion_path_duplicate" });
  }
});
const runtimeAssetSchema = z.object({
  id: z.enum(REQUIRED_RUNTIME_ASSET_IDS),
  kind: z.enum(["executable", "model"]),
  version: z.string().min(1).max(160).nullable(),
  licenseSpdx: z.string().min(1).max(160).nullable(),
  sbomRef: z.string().min(1).max(500).nullable(),
  requiredForFull: z.literal(true),
  artifacts: z.object({
    "darwin-arm64": runtimeArtifactSchema,
    "win32-x64": runtimeArtifactSchema,
    "linux-x64": runtimeArtifactSchema,
  }).strict(),
}).strict();
export const runtimeManifestSchema = z.object({
  schemaVersion: z.literal(CALIBRATION_RUNTIME_MANIFEST_VERSION),
  kernelVersion: z.string().min(1).max(160),
  authorityCommit: gitCommitSchema,
  pipelineImplementation: z.string().min(1).max(160),
  supportedTargets: z.array(z.enum(SUPPORTED_RUNTIME_TARGETS)).length(SUPPORTED_RUNTIME_TARGETS.length),
  authorityContract: z.object({ relativePath: relativePathSchema, sha256: sha256Schema }).strict(),
  pipelineContract: z.object({ relativePath: relativePathSchema, sha256: sha256Schema }).strict(),
  sourceLock: z.object({ relativePath: relativePathSchema, sha256: sha256Schema }).strict(),
  assets: z.array(runtimeAssetSchema).length(REQUIRED_RUNTIME_ASSET_IDS.length),
}).strict();
export type RuntimeManifest = z.infer<typeof runtimeManifestSchema>;

function assertExactManifestInventory(manifest: RuntimeManifest): void {
  const targets = new Set(manifest.supportedTargets);
  if (targets.size !== SUPPORTED_RUNTIME_TARGETS.length ||
      SUPPORTED_RUNTIME_TARGETS.some((target) => !targets.has(target))) {
    throw new Error("calibration_runtime_manifest_target_inventory_invalid");
  }
  const ids = manifest.assets.map((asset) => asset.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== REQUIRED_RUNTIME_ASSET_IDS.length ||
      REQUIRED_RUNTIME_ASSET_IDS.some((id) => !uniqueIds.has(id))) {
    throw new Error("calibration_runtime_manifest_asset_inventory_invalid");
  }
}

export function safeChildPath(root: string, relativePath: string): string {
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, relativePath);
  const fromRoot = relative(rootPath, candidate);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("calibration_runtime_path_outside_resource_root");
  }
  return candidate;
}

function targetKey(platform: NodeJS.Platform, architecture: string): SupportedRuntimeTarget | null {
  return trySelectHostPlatform(platform)?.runtimeTarget(architecture) ?? null;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolveHash);
    stream.once("error", rejectHash);
  });
  return hash.digest("hex");
}

async function sha256CanonicalTextFile(path: string): Promise<string> {
  const raw = await readFile(path);
  return createHash("sha256").update(raw.toString("utf8").replace(/\r\n?/g, "\n")).digest("hex");
}

async function referencedEvidenceVerified(
  root: string,
  reference: { relativePath: string; sha256: string } | null,
): Promise<boolean> {
  if (!reference) return false;
  const path = safeChildPath(root, reference.relativePath);
  try {
    await access(path, constants.R_OK);
    return await sha256CanonicalTextFile(path) === reference.sha256;
  } catch {
    return false;
  }
}

async function executableOnPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string | null> {
  const adapter = trySelectHostPlatform(platform);
  const candidates = (env.PATH ?? "").split(delimiter).filter(Boolean)
    .map((directory) => join(directory, adapter?.executableName(name) ?? name));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue to the next local path. No network discovery is permitted.
    }
  }
  return null;
}

export async function inspectCalibrationRuntime(options: {
  resourceRoot: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  env?: NodeJS.ProcessEnv;
  featureMode?: "disabled" | "diagnostic" | "full";
  executableAccess?: (path: string, platform: NodeJS.Platform) => Promise<boolean>;
  manifestApproved?: boolean;
}): Promise<CalibrationRuntimeStatus> {
  const platform = options.platform ?? currentHostPlatform.nodePlatform;
  const architecture = options.architecture ?? process.arch;
  const selectedTarget = targetKey(platform, architecture);
  const platformAdapter = trySelectHostPlatform(platform);
  const manifestPath = safeChildPath(options.resourceRoot, "resources/calibration/runtime-manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const manifest = runtimeManifestSchema.parse(JSON.parse(raw));
  assertExactManifestInventory(manifest);
  const manifestHash = createHash("sha256").update(raw.replace(/\r\n?/g, "\n")).digest("hex");
  const manifestApprovalKey = selectedTarget ?? `${platform}-${architecture}`;
  const manifestApproved = options.manifestApproved ?? APPROVED_RUNTIME_MANIFEST_HASHES[manifestApprovalKey] === manifestHash;
  const packagedRoot = selectedTarget
    ? safeChildPath(options.resourceRoot, `resources/calibration/${selectedTarget}`)
    : null;
  const env = options.env ?? process.env;
  const requestedFeatureMode = options.featureMode ?? env.QUAL_HARDWARE_CALIBRATION_FEATURE;
  const featureMode = requestedFeatureMode === "disabled" || requestedFeatureMode === "full"
    ? requestedFeatureMode : "diagnostic";
  const assets: CalibrationRuntimeStatus["assets"] = [];
  const contracts: CalibrationRuntimeStatus["contracts"] = [];
  for (const [id, definition] of [
    ["authority", manifest.authorityContract],
    ["pipeline", manifest.pipelineContract],
    ["sources", manifest.sourceLock],
  ] as const) {
    const path = safeChildPath(options.resourceRoot, definition.relativePath);
    try {
      const actualHash = await sha256CanonicalTextFile(path);
      contracts.push({
        id,
        status: actualHash === definition.sha256 ? "verified" : "mismatch",
        path,
        sha256: actualHash,
        expectedSha256: definition.sha256,
      });
    } catch {
      contracts.push({ id, status: "missing", path: null, sha256: null, expectedSha256: definition.sha256 });
    }
  }
  for (const definition of manifest.assets) {
    const artifact = selectedTarget ? definition.artifacts[selectedTarget] : null;
    const packagedPath = artifact && packagedRoot
      ? safeChildPath(packagedRoot, artifact.relativePath)
      : null;
    if (packagedPath && artifact && packagedRoot) {
      try {
        const executableAllowed = definition.kind !== "executable" || !options.executableAccess ||
          await options.executableAccess(packagedPath, platform);
        if (!executableAllowed) throw new Error("calibration_runtime_executable_permission_missing");
        const accessMode = platformAdapter?.executableAccessMode(definition.kind) ?? constants.R_OK;
        await access(packagedPath, accessMode);
        const info = await stat(packagedPath);
        const actualHash = await sha256File(packagedPath);
        const licenseEvidenceVerified = await referencedEvidenceVerified(packagedRoot, artifact.licenseEvidence);
        const sbomEvidenceVerified = await referencedEvidenceVerified(packagedRoot, artifact.sbomEvidence);
        const companionFilesVerified = (await Promise.all(artifact.companionFiles.map(async (companion) => {
          const companionPath = safeChildPath(packagedRoot, companion.relativePath);
          try {
            const companionInfo = await stat(companionPath);
            return companionInfo.isFile() && companionInfo.size === companion.sizeBytes &&
              await sha256File(companionPath) === companion.sha256;
          } catch {
            return false;
          }
        }))).every(Boolean);
        const metadataComplete = Boolean(artifact.sha256 && artifact.sizeBytes !== null && definition.version &&
          definition.licenseSpdx && artifact.licenseEvidence && artifact.sbomEvidence);
        const verified = metadataComplete && licenseEvidenceVerified && sbomEvidenceVerified &&
          companionFilesVerified && actualHash === artifact.sha256 && info.size === artifact.sizeBytes;
        assets.push({
          id: definition.id,
          status: verified ? "verified" : "mismatch",
          path: packagedPath,
          sha256: actualHash,
          sizeBytes: info.size,
          expectedSizeBytes: artifact.sizeBytes,
          version: definition.version,
          licenseSpdx: definition.licenseSpdx,
          sbomRef: artifact.sbomEvidence?.relativePath ?? definition.sbomRef,
        });
        continue;
      } catch {
        // An absent or non-executable packaged asset may only fall back to a
        // local executable for diagnostics; it can never qualify commercially.
      }
    }
    const systemPath = selectedTarget && definition.kind === "executable"
      ? await executableOnPath(definition.id, env, platform) : null;
    if (systemPath) {
      assets.push({
        id: definition.id,
        status: "system_only",
        path: systemPath,
        sha256: await sha256File(systemPath),
        sizeBytes: (await stat(systemPath)).size,
        expectedSizeBytes: artifact?.sizeBytes ?? null,
        version: definition.version,
        licenseSpdx: definition.licenseSpdx,
        sbomRef: artifact?.sbomEvidence?.relativePath ?? definition.sbomRef,
      });
    } else {
      assets.push({
        id: definition.id,
        status: "missing",
        path: null,
        sha256: null,
        sizeBytes: null,
        expectedSizeBytes: artifact?.sizeBytes ?? null,
        version: definition.version,
        licenseSpdx: definition.licenseSpdx,
        sbomRef: artifact?.sbomEvidence?.relativePath ?? definition.sbomRef,
      });
    }
  }
  const runtimeAssetsVerified = selectedTarget !== null &&
    manifest.kernelVersion === CALIBRATION_KERNEL_VERSION &&
    manifest.authorityCommit === CALIBRATION_AUTHORITY_COMMIT &&
    manifest.pipelineImplementation === "perceptrum-equivalent-v1" &&
    contracts.every((contract) => contract.status === "verified") &&
    assets.length === REQUIRED_RUNTIME_ASSET_IDS.length &&
    assets.every((asset) => asset.status === "verified");
  const readyForFullQualification = featureMode === "full" && runtimeAssetsVerified;
  const purchaseEligibleRuntime = readyForFullQualification && manifestApproved;
  const reasons = purchaseEligibleRuntime ? [] : [
    ...(featureMode === "full" ? [] : [`feature-mode:${featureMode}:full-disabled`]),
    ...(selectedTarget ? [] : [`runtime-target:${platform}-${architecture}:unsupported`]),
    "A calibração rápida está disponível em plataformas compatíveis, mas a qualificação comercial exige todos os binários e modelos empacotados com hashes aprovados.",
    ...(manifestApproved ? [] : [`runtime-manifest:${manifestApprovalKey}:not-approved`]),
    ...(manifest.pipelineImplementation === "perceptrum-equivalent-v1" ? [] : [`pipeline:${manifest.pipelineImplementation}`]),
    ...contracts.filter((contract) => contract.status !== "verified").map((contract) => `contract:${contract.id}:${contract.status}`),
    ...assets.filter((asset) => asset.status !== "verified").map((asset) => `${asset.id}:${asset.status}`),
  ];
  return {
    schemaVersion: "qual-hardware-calibration-runtime-status/1.0.0",
    kernelVersion: CALIBRATION_KERNEL_VERSION,
    authorityCommit: CALIBRATION_AUTHORITY_COMMIT,
    platform,
    architecture,
    featureMode,
    manifestApproved,
    runtimeAssetsVerified,
    readyForQuickTest: featureMode !== "disabled" && selectedTarget !== null,
    readyForFullQualification,
    manifestHash,
    contracts,
    assets,
    reasons,
  };
}
