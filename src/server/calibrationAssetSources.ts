import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  REQUIRED_RUNTIME_ASSET_IDS,
  SUPPORTED_RUNTIME_TARGETS,
  safeChildPath,
  type SupportedRuntimeTarget,
} from "./calibrationRuntime.js";
import { calibrationDiskStatus, type CalibrationDiskStatus } from "./calibrationTemporaryFiles.js";

export const CALIBRATION_ASSET_SOURCES_VERSION = "qual-hardware-calibration-asset-sources/1.0.0" as const;
const STAGING_OVERHEAD_BYTES = 512 * 1024 * 1024;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const allowedSourceHosts = ["ffmpeg.org", "github.com", "huggingface.co"] as const;
function immutableApprovedSourceUrl(value: string): boolean {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !allowedSourceHosts.includes(parsed.hostname as typeof allowedSourceHosts[number])) return false;
  return parsed.hostname === "huggingface.co"
    ? /\/resolve\/[0-9a-f]{40}\//.test(parsed.pathname)
    : parsed.hostname === "github.com"
      ? /\/releases\/download\/[^/]+\//.test(parsed.pathname)
      : /^\/releases\/ffmpeg-\d+\.\d+\.\d+\.tar\.xz$/.test(parsed.pathname);
}
const repositoryPathSchema = z.string().min(1).max(500).superRefine((value, context) => {
  const segments = value.split(/[\\/]+/);
  if (value.startsWith("/") || /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(value) ||
      segments.some((segment) => segment === ".." || segment === "." || segment.length === 0)) {
    context.addIssue({ code: "custom", message: "repository_source_relative_path_required" });
  }
});
const companionSourceSchema = z.object({
  sourceKind: z.enum(["release_archive", "direct_file"]),
  url: z.string().url(),
  sha256: sha256Schema,
  sizeBytes: z.number().int().positive(),
  archiveMember: z.string().min(1).max(500).nullable(),
}).strict().superRefine((source, context) => {
  if (!immutableApprovedSourceUrl(source.url)) {
    context.addIssue({ code: "custom", message: "immutable_source_selector_required" });
  }
});

const sourceSchema = z.object({
  sourceKind: z.enum(["source_archive", "release_archive", "direct_file", "repository_source", "unavailable"]),
  url: z.string().url().nullable(),
  sha256: sha256Schema.nullable(),
  sizeBytes: z.number().int().positive().nullable(),
  archiveMember: z.string().min(1).max(500).nullable(),
  repositoryPath: repositoryPathSchema.nullable().optional().default(null),
  companionSources: z.array(companionSourceSchema).max(32).optional().default([]),
}).strict().superRefine((source, context) => {
  if (source.sourceKind === "unavailable") {
    if (source.url !== null || source.sha256 !== null || source.sizeBytes !== null || source.archiveMember !== null ||
        source.repositoryPath !== null || source.companionSources.length > 0) {
      context.addIssue({ code: "custom", message: "unavailable_source_must_be_empty" });
    }
    return;
  }
  if (source.sourceKind === "repository_source") {
    if (source.url !== null || source.archiveMember !== null || !source.repositoryPath || !source.sha256 || source.sizeBytes === null) {
      context.addIssue({ code: "custom", message: "repository_source_integrity_metadata_required" });
    }
    return;
  }
  if (source.repositoryPath !== null) {
    context.addIssue({ code: "custom", message: "remote_source_cannot_use_repository_path" });
  }
  if (!source.url || !source.sha256 || source.sizeBytes === null) {
    context.addIssue({ code: "custom", message: "source_integrity_metadata_required" });
    return;
  }
  if (!immutableApprovedSourceUrl(source.url)) context.addIssue({ code: "custom", message: "immutable_source_selector_required" });
});

const targetsSchema = z.object({
  "darwin-arm64": sourceSchema,
  "win32-x64": sourceSchema,
  "linux-x64": sourceSchema,
}).strict();

const assetSchema = z.object({
  id: z.enum(REQUIRED_RUNTIME_ASSET_IDS),
  upstream: z.string().min(1).max(200),
  version: z.string().min(1).max(200),
  revision: z.string().min(1).max(200),
  licenseSpdxCandidate: z.string().min(1).max(100).nullable(),
  licenseEvidenceUrl: z.string().url().nullable(),
  approvalStatus: z.enum(["candidate", "approved", "blocked"]),
  blockers: z.array(z.string().min(1).max(200)),
  targets: targetsSchema,
}).strict().superRefine((asset, context) => {
  if (asset.approvalStatus === "approved" && asset.blockers.length > 0) {
    context.addIssue({ code: "custom", message: "approved_asset_cannot_have_blockers" });
  }
  if (asset.approvalStatus !== "approved" && asset.blockers.length === 0) {
    context.addIssue({ code: "custom", message: "unapproved_asset_requires_blocker" });
  }
});

export const calibrationAssetSourceLockSchema = z.object({
  schemaVersion: z.literal(CALIBRATION_ASSET_SOURCES_VERSION),
  recordedAt: z.string().datetime(),
  policy: z.object({
    runtimeNetworkAccess: z.literal("forbidden"),
    acquisitionMode: z.literal("operator_supplied_offline_only"),
    approvalMode: z.literal("candidate_inventory_fail_closed"),
    allowedSourceHosts: z.tuple([z.literal("ffmpeg.org"), z.literal("github.com"), z.literal("huggingface.co")]),
  }).strict(),
  assets: z.array(assetSchema).length(REQUIRED_RUNTIME_ASSET_IDS.length),
}).strict();

export type CalibrationAssetSourceLock = z.infer<typeof calibrationAssetSourceLockSchema>;

export interface CalibrationAssetSourceTargetAudit {
  target: SupportedRuntimeTarget;
  acquisitionBytes: number;
  projectedPeakBytes: number;
  disk: CalibrationDiskStatus;
}

export interface CalibrationAssetSourceAudit {
  schemaVersion: "qual-hardware-calibration-asset-source-audit/1.0.0";
  inventoryValid: true;
  readyForProvisioning: boolean;
  assets: Array<{ id: typeof REQUIRED_RUNTIME_ASSET_IDS[number]; approvalStatus: "candidate" | "approved" | "blocked" }>;
  targets: CalibrationAssetSourceTargetAudit[];
  blockers: string[];
}

export interface CalibrationRepositorySourceDigest {
  sha256: string;
  sizeBytes: number;
  fileCount: number;
}

function canonicalRepositoryText(bytes: Buffer): Buffer {
  if (bytes.includes(0)) return bytes;
  return Buffer.from(bytes.toString("utf8").replace(/\r\n?/g, "\n"), "utf8");
}

export async function hashCalibrationRepositorySource(
  repositoryRootInput: string,
  repositoryPath: string,
): Promise<CalibrationRepositorySourceDigest> {
  const parsedPath = repositoryPathSchema.parse(repositoryPath);
  const repositoryRoot = resolve(repositoryRootInput);
  const sourceRoot = safeChildPath(repositoryRoot, parsedPath);
  const rootInfo = await lstat(sourceRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("calibration_repository_source_root_invalid");
  const files: Array<{ absolutePath: string; relativePath: string; sizeBytes: number }> = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = join(directory, entry.name);
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink()) throw new Error("calibration_repository_source_symlink_forbidden");
      if (info.isDirectory()) {
        await walk(absolutePath);
      } else if (info.isFile()) {
        const relativePath = relative(sourceRoot, absolutePath).split(sep).join("/");
        files.push({ absolutePath, relativePath, sizeBytes: info.size });
      } else {
        throw new Error("calibration_repository_source_entry_invalid");
      }
      if (files.length > 1_000) throw new Error("calibration_repository_source_file_limit");
    }
  };
  await walk(sourceRoot);
  if (files.length === 0) throw new Error("calibration_repository_source_empty");
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for (const file of files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    const content = canonicalRepositoryText(await readFile(file.absolutePath));
    sizeBytes += content.byteLength;
    if (sizeBytes > 100 * 1024 * 1024) throw new Error("calibration_repository_source_size_limit");
    hash.update(file.relativePath, "utf8");
    hash.update("\0");
    hash.update(String(content.byteLength), "utf8");
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return { sha256: hash.digest("hex"), sizeBytes, fileCount: files.length };
}

export function parseCalibrationAssetSourceLock(value: unknown): CalibrationAssetSourceLock {
  const lock = calibrationAssetSourceLockSchema.parse(value);
  const ids = new Set(lock.assets.map((asset) => asset.id));
  if (ids.size !== REQUIRED_RUNTIME_ASSET_IDS.length || REQUIRED_RUNTIME_ASSET_IDS.some((id) => !ids.has(id))) {
    throw new Error("calibration_asset_source_inventory_invalid");
  }
  return lock;
}

function acquisitionBytesForTarget(lock: CalibrationAssetSourceLock, target: SupportedRuntimeTarget): number {
  const uniqueSources = new Map<string, number>();
  for (const asset of lock.assets) {
    const source = asset.targets[target];
    for (const item of [source, ...source.companionSources]) {
      if (!item.sha256 || item.sizeBytes === null) continue;
      const key = `${item.sha256}:${item.sizeBytes}`;
      uniqueSources.set(key, item.sizeBytes);
    }
  }
  return [...uniqueSources.values()].reduce((total, size) => total + size, 0);
}

export async function auditCalibrationAssetSources(input: {
  repositoryRoot: string;
  diskStatus?: (path: string, projectedPeakBytes: number) => Promise<CalibrationDiskStatus>;
}): Promise<CalibrationAssetSourceAudit> {
  const repositoryRoot = resolve(input.repositoryRoot);
  const calibrationRoot = safeChildPath(repositoryRoot, "resources/calibration");
  const lockPath = safeChildPath(calibrationRoot, "asset-sources.lock.json");
  const lock = parseCalibrationAssetSourceLock(JSON.parse(await readFile(lockPath, "utf8")));
  const repositorySourceBlockers: string[] = [];
  const repositorySourceCache = new Map<string, Promise<CalibrationRepositorySourceDigest>>();
  for (const asset of lock.assets) {
    for (const target of SUPPORTED_RUNTIME_TARGETS) {
      const source = asset.targets[target];
      if (source.sourceKind !== "repository_source" || !source.repositoryPath || !source.sha256 || source.sizeBytes === null) continue;
      try {
        let digestPromise = repositorySourceCache.get(source.repositoryPath);
        if (!digestPromise) {
          digestPromise = hashCalibrationRepositorySource(repositoryRoot, source.repositoryPath);
          repositorySourceCache.set(source.repositoryPath, digestPromise);
        }
        const digest = await digestPromise;
        if (digest.sha256 !== source.sha256 || digest.sizeBytes !== source.sizeBytes) {
          repositorySourceBlockers.push(`source:${asset.id}:${target}:repository_integrity_mismatch`);
        }
      } catch {
        repositorySourceBlockers.push(`source:${asset.id}:${target}:repository_integrity_unavailable`);
      }
    }
  }
  const diskProvider = input.diskStatus ?? calibrationDiskStatus;
  const targets: CalibrationAssetSourceTargetAudit[] = [];
  for (const target of SUPPORTED_RUNTIME_TARGETS) {
    const acquisitionBytes = acquisitionBytesForTarget(lock, target);
    const projectedPeakBytes = acquisitionBytes * 2 + STAGING_OVERHEAD_BYTES;
    targets.push({ target, acquisitionBytes, projectedPeakBytes, disk: await diskProvider(calibrationRoot, projectedPeakBytes) });
  }
  const blockers = [
    ...repositorySourceBlockers,
    ...lock.assets.flatMap((asset) => [
      ...(asset.approvalStatus === "approved" ? [] : [`approval:${asset.id}:${asset.approvalStatus}`]),
      ...asset.blockers.map((blocker) => `asset:${asset.id}:${blocker}`),
      ...SUPPORTED_RUNTIME_TARGETS.flatMap((target) =>
        asset.targets[target].sourceKind === "unavailable" ? [`source:${asset.id}:${target}:unavailable`] : []),
    ]),
    ...targets.filter((target) => !target.disk.canStart).map((target) =>
      `disk-reserve:${target.target}:${target.disk.freeBytes}:${target.disk.reserveBytes}:${target.projectedPeakBytes}`),
  ];
  return {
    schemaVersion: "qual-hardware-calibration-asset-source-audit/1.0.0",
    inventoryValid: true,
    readyForProvisioning: blockers.length === 0,
    assets: lock.assets.map((asset) => ({ id: asset.id, approvalStatus: asset.approvalStatus })),
    targets,
    blockers,
  };
}
