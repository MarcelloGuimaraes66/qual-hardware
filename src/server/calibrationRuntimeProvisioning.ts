import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import {
  REQUIRED_RUNTIME_ASSET_IDS,
  SUPPORTED_RUNTIME_TARGETS,
  runtimeManifestSchema,
  safeChildPath,
  sha256File,
  type RuntimeManifest,
  type SupportedRuntimeTarget,
} from "./calibrationRuntime.js";
import { parseCalibrationAssetSourceLock } from "./calibrationAssetSources.js";
import { calibrationDiskStatus, type CalibrationDiskStatus } from "./calibrationTemporaryFiles.js";

export const CALIBRATION_ASSET_INTAKE_VERSION = "qual-hardware-calibration-asset-intake/1.0.0" as const;
export const CALIBRATION_ASSET_INTAKE_TEMPLATE_VERSION = "qual-hardware-calibration-asset-intake-template/1.0.0" as const;
const absoluteExistingPathSchema = z.string().min(1).max(4_096).refine((value) => isAbsolute(value), "absolute_source_path_required");
const intakeRelativePathSchema = z.string().min(1).max(500).superRefine((value, context) => {
  const segments = value.split(/[\\/]+/);
  if (isAbsolute(value) || /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(value) ||
      segments.some((segment) => segment === ".." || segment === "." || segment.length === 0) ||
      /replace_with/i.test(value)) {
    context.addIssue({ code: "custom", message: "runtime_relative_path_required" });
  }
});
const intakeAssetSchema = z.object({
  id: z.enum(REQUIRED_RUNTIME_ASSET_IDS),
  sourcePath: absoluteExistingPathSchema,
  version: z.string().min(1).max(160).refine((value) => !/^replace_/i.test(value), "asset_version_placeholder_forbidden"),
  licenseSpdx: z.string().min(1).max(160).refine((value) => !/^replace_/i.test(value), "license_placeholder_forbidden"),
  licenseEvidencePath: absoluteExistingPathSchema,
  sbomEvidencePath: absoluteExistingPathSchema,
  companionFiles: z.array(z.object({
    sourcePath: absoluteExistingPathSchema,
    relativePath: intakeRelativePathSchema,
  }).strict()).max(256).optional().default([]),
}).strict();
export const calibrationAssetIntakeSchema = z.object({
  schemaVersion: z.literal(CALIBRATION_ASSET_INTAKE_VERSION),
  target: z.enum(SUPPORTED_RUNTIME_TARGETS),
  assets: z.array(intakeAssetSchema).length(REQUIRED_RUNTIME_ASSET_IDS.length),
}).strict();
export type CalibrationAssetIntake = z.infer<typeof calibrationAssetIntakeSchema>;

const calibrationAssetIntakeTemplateWrapperSchema = z.object({
  schemaVersion: z.literal(CALIBRATION_ASSET_INTAKE_TEMPLATE_VERSION),
  target: z.enum(SUPPORTED_RUNTIME_TARGETS),
  intake: z.unknown(),
}).passthrough();

export interface CalibrationAssetIntakeTemplate {
  schemaVersion: typeof CALIBRATION_ASSET_INTAKE_TEMPLATE_VERSION;
  target: SupportedRuntimeTarget;
  readyToApply: false;
  runtimeNetworkAccess: "forbidden";
  instructions: string[];
  intake: {
    schemaVersion: typeof CALIBRATION_ASSET_INTAKE_VERSION;
    target: SupportedRuntimeTarget;
    assets: Array<{
      id: typeof REQUIRED_RUNTIME_ASSET_IDS[number];
      sourcePath: string;
      version: string;
      licenseSpdx: string;
      licenseEvidencePath: string;
      sbomEvidencePath: string;
      companionFiles: Array<{ sourcePath: string; relativePath: string }>;
    }>;
  };
  sourceGuide: Array<{
    id: typeof REQUIRED_RUNTIME_ASSET_IDS[number];
    destinationRelativePath: string;
    upstream: string;
    revision: string;
    versionCandidate: string;
    licenseSpdxCandidate: string | null;
    licenseEvidenceUrl: string | null;
    approvalStatus: "candidate" | "approved" | "blocked";
    blockers: string[];
    source: ReturnType<typeof parseCalibrationAssetSourceLock>["assets"][number]["targets"][SupportedRuntimeTarget];
  }>;
}

interface PreparedFile {
  id: string;
  kind: "asset" | "companion" | "license" | "sbom";
  sourcePath: string;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  executable: boolean;
}

export interface CalibrationRuntimeProvisioningPlan {
  target: SupportedRuntimeTarget;
  manifest: RuntimeManifest;
  manifestSha256: string;
  files: PreparedFile[];
  stagingBytes: number;
}

function intakeFromInput(input: unknown): { intake: CalibrationAssetIntake; templateTarget: SupportedRuntimeTarget | null } {
  const template = calibrationAssetIntakeTemplateWrapperSchema.safeParse(input);
  const intake = calibrationAssetIntakeSchema.parse(template.success ? template.data.intake : input);
  if (template.success && template.data.target !== intake.target) {
    throw new Error("calibration_asset_intake_template_target_mismatch");
  }
  return { intake, templateTarget: template.success ? template.data.target : null };
}

export async function createCalibrationRuntimeIntakeTemplate(input: {
  repositoryRoot: string;
  target: unknown;
}): Promise<CalibrationAssetIntakeTemplate> {
  const repositoryRoot = resolve(input.repositoryRoot);
  const target = z.enum(SUPPORTED_RUNTIME_TARGETS).parse(input.target);
  const manifestPath = safeChildPath(repositoryRoot, "resources/calibration/runtime-manifest.json");
  const manifest = runtimeManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const sourceLockPath = safeChildPath(repositoryRoot, manifest.sourceLock.relativePath);
  const sourceLockBytes = await readFile(sourceLockPath, "utf8");
  const sourceLockHash = createHash("sha256").update(sourceLockBytes).digest("hex");
  if (sourceLockHash !== manifest.sourceLock.sha256) throw new Error("calibration_asset_source_lock_hash_mismatch");
  const sourceLock = parseCalibrationAssetSourceLock(JSON.parse(sourceLockBytes));
  const assets = REQUIRED_RUNTIME_ASSET_IDS.map((id) => {
    const sourceDefinition = sourceLock.assets.find((asset) => asset.id === id);
    const runtimeDefinition = manifest.assets.find((asset) => asset.id === id);
    if (!sourceDefinition || !runtimeDefinition) throw new Error(`calibration_asset_template_inventory_missing:${id}`);
    const source = sourceDefinition.targets[target];
    return {
      intake: {
        id,
        sourcePath: `REPLACE_WITH_ABSOLUTE_PATH_TO_${id.toUpperCase().replaceAll("-", "_")}`,
        version: sourceDefinition.version,
        licenseSpdx: `REPLACE_WITH_APPROVED_SPDX_FOR_${id.toUpperCase().replaceAll("-", "_")}`,
        licenseEvidencePath: `REPLACE_WITH_ABSOLUTE_LICENSE_PATH_FOR_${id.toUpperCase().replaceAll("-", "_")}`,
        sbomEvidencePath: `REPLACE_WITH_ABSOLUTE_CYCLONEDX_PATH_FOR_${id.toUpperCase().replaceAll("-", "_")}`,
        companionFiles: source.companionSources.map((_companion, index) => ({
          sourcePath: `REPLACE_WITH_ABSOLUTE_COMPANION_PATH_FOR_${id.toUpperCase().replaceAll("-", "_")}_GROUP_${index + 1}`,
          relativePath: `REPLACE_WITH_RELATIVE_BIN_PATH_FOR_${id.toUpperCase().replaceAll("-", "_")}_GROUP_${index + 1}`,
        })),
      },
      guide: {
        id,
        destinationRelativePath: runtimeDefinition.artifacts[target].relativePath,
        upstream: sourceDefinition.upstream,
        revision: sourceDefinition.revision,
        versionCandidate: sourceDefinition.version,
        licenseSpdxCandidate: sourceDefinition.licenseSpdxCandidate,
        licenseEvidenceUrl: sourceDefinition.licenseEvidenceUrl,
        approvalStatus: sourceDefinition.approvalStatus,
        blockers: [...sourceDefinition.blockers],
        source,
      },
    };
  });
  return {
    schemaVersion: CALIBRATION_ASSET_INTAKE_TEMPLATE_VERSION,
    target,
    readyToApply: false,
    runtimeNetworkAccess: "forbidden",
    instructions: [
      "Preencha somente com ativos obtidos e revisados fora da execução da calibração.",
      "Substitua todos os valores REPLACE_WITH; caminhos devem ser absolutos e apontar para arquivos regulares, nunca links simbólicos.",
      "O campo licenseSpdx exige decisão humana; licenseSpdxCandidate é apenas referência e não representa aprovação.",
      "Para cada grupo auxiliar, liste todos os arquivos extraídos necessários e preserve o destino dentro da raiz do runtime.",
      "Use este mesmo arquivo com --intake após preencher o objeto intake; o guia de origem é informativo e não autoriza download em runtime.",
    ],
    intake: {
      schemaVersion: CALIBRATION_ASSET_INTAKE_VERSION,
      target,
      assets: assets.map((asset) => asset.intake),
    },
    sourceGuide: assets.map((asset) => asset.guide),
  };
}

async function targetInventory(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error("calibration_runtime_existing_target_symlink_forbidden");
    if (info.isDirectory()) files.push(...await targetInventory(root, path));
    else if (info.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    else throw new Error("calibration_runtime_existing_target_entry_invalid");
  }
  return files.sort();
}

async function targetMatchesPlan(targetRoot: string, plan: CalibrationRuntimeProvisioningPlan): Promise<boolean> {
  const expected = [...plan.files].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const actual = await targetInventory(targetRoot);
  if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index]?.relativePath)) return false;
  for (const file of expected) {
    const path = safeChildPath(targetRoot, file.relativePath);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.sizeBytes || await sha256File(path) !== file.sha256) return false;
  }
  return true;
}

async function regularSource(path: string, label: string): Promise<{ size: number; sha256: string }> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) throw new Error(`calibration_asset_source_invalid:${label}`);
  return { size: info.size, sha256: await sha256File(path) };
}

async function validateCycloneDx(path: string, id: string): Promise<void> {
  let value: unknown;
  try { value = JSON.parse(await readFile(path, "utf8")); } catch { throw new Error(`calibration_asset_sbom_invalid_json:${id}`); }
  if (!value || typeof value !== "object" || (value as { bomFormat?: unknown }).bomFormat !== "CycloneDX" ||
      typeof (value as { specVersion?: unknown }).specVersion !== "string") {
    throw new Error(`calibration_asset_sbom_not_cyclonedx:${id}`);
  }
}

function assertExactIntake(intake: CalibrationAssetIntake): void {
  const ids = new Set(intake.assets.map((asset) => asset.id));
  if (ids.size !== REQUIRED_RUNTIME_ASSET_IDS.length || REQUIRED_RUNTIME_ASSET_IDS.some((id) => !ids.has(id))) {
    throw new Error("calibration_asset_intake_inventory_invalid");
  }
}

export async function planCalibrationRuntimeProvisioning(input: {
  repositoryRoot: string;
  intake: unknown;
}): Promise<CalibrationRuntimeProvisioningPlan> {
  const repositoryRoot = resolve(input.repositoryRoot);
  const { intake } = intakeFromInput(input.intake);
  assertExactIntake(intake);
  const manifestPath = safeChildPath(repositoryRoot, "resources/calibration/runtime-manifest.json");
  const manifest = runtimeManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const sourceLockPath = safeChildPath(repositoryRoot, manifest.sourceLock.relativePath);
  const sourceLock = parseCalibrationAssetSourceLock(JSON.parse(await readFile(sourceLockPath, "utf8")));
  const sourceDefinitions = new Map(sourceLock.assets.map((asset) => [asset.id, asset]));
  for (const item of intake.assets) {
    const sourceDefinition = sourceDefinitions.get(item.id);
    if (!sourceDefinition) throw new Error(`calibration_asset_source_inventory_missing:${item.id}`);
    const requiredCompanionGroups = sourceDefinition.targets[intake.target].companionSources.length;
    if (item.companionFiles.length < requiredCompanionGroups) {
      throw new Error(`calibration_asset_companion_groups_incomplete:${item.id}:${requiredCompanionGroups}:${item.companionFiles.length}`);
    }
  }
  const files: PreparedFile[] = [];
  for (const item of intake.assets) {
    const definition = manifest.assets.find((asset) => asset.id === item.id);
    if (!definition) throw new Error(`calibration_runtime_manifest_asset_missing:${item.id}`);
    if (definition.version && definition.version !== item.version) throw new Error(`calibration_asset_version_conflict:${item.id}`);
    if (definition.licenseSpdx && definition.licenseSpdx !== item.licenseSpdx) throw new Error(`calibration_asset_license_conflict:${item.id}`);
    const asset = await regularSource(item.sourcePath, `${item.id}:asset`);
    const license = await regularSource(item.licenseEvidencePath, `${item.id}:license`);
    const sbom = await regularSource(item.sbomEvidencePath, `${item.id}:sbom`);
    const companions = await Promise.all(item.companionFiles.map(async (file, index) => ({
      ...file,
      ...await regularSource(file.sourcePath, `${item.id}:companion:${index}`),
    })));
    await validateCycloneDx(item.sbomEvidencePath, item.id);
    const artifact = definition.artifacts[intake.target];
    const licenseRelativePath = `licenses/${item.id}.txt`;
    const sbomRelativePath = `sbom/${item.id}.cdx.json`;
    definition.version = item.version;
    definition.licenseSpdx = item.licenseSpdx;
    artifact.sha256 = asset.sha256;
    artifact.sizeBytes = asset.size;
    artifact.licenseEvidence = { relativePath: licenseRelativePath, sha256: license.sha256 };
    artifact.sbomEvidence = { relativePath: sbomRelativePath, sha256: sbom.sha256 };
    artifact.companionFiles = companions.map((file) => ({
      relativePath: file.relativePath,
      sha256: file.sha256,
      sizeBytes: file.size,
    }));
    files.push(
      { id: item.id, kind: "asset", sourcePath: item.sourcePath, relativePath: artifact.relativePath,
        sha256: asset.sha256, sizeBytes: asset.size, executable: definition.kind === "executable" },
      { id: item.id, kind: "license", sourcePath: item.licenseEvidencePath, relativePath: licenseRelativePath,
        sha256: license.sha256, sizeBytes: license.size, executable: false },
      { id: item.id, kind: "sbom", sourcePath: item.sbomEvidencePath, relativePath: sbomRelativePath,
        sha256: sbom.sha256, sizeBytes: sbom.size, executable: false },
      ...companions.map((file) => ({
        id: item.id, kind: "companion" as const, sourcePath: file.sourcePath, relativePath: file.relativePath,
        sha256: file.sha256, sizeBytes: file.size, executable: false,
      })),
    );
  }
  const destinationPaths = files.map((file) => file.relativePath.toLowerCase());
  if (new Set(destinationPaths).size !== destinationPaths.length) {
    throw new Error("calibration_asset_intake_destination_duplicate");
  }
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  return {
    target: intake.target,
    manifest,
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    files,
    stagingBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0) + Buffer.byteLength(manifestBytes, "utf8"),
  };
}

export async function applyCalibrationRuntimeProvisioning(input: {
  repositoryRoot: string;
  intake: unknown;
  diskStatus?: (path: string, projectedPeakBytes: number) => Promise<CalibrationDiskStatus>;
}): Promise<CalibrationRuntimeProvisioningPlan & {
  backupPath: string;
  targetRoot: string;
  targetBackupPath: string | null;
  disk: CalibrationDiskStatus;
}> {
  const repositoryRoot = resolve(input.repositoryRoot);
  const plan = await planCalibrationRuntimeProvisioning({ repositoryRoot, intake: input.intake });
  const calibrationRoot = safeChildPath(repositoryRoot, "resources/calibration");
  const targetRoot = safeChildPath(calibrationRoot, plan.target);
  const existingTarget = await lstat(targetRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existingTarget && (!existingTarget.isDirectory() || existingTarget.isSymbolicLink())) {
    throw new Error(`calibration_runtime_existing_target_invalid:${plan.target}`);
  }
  if (existingTarget && await targetMatchesPlan(targetRoot, plan)) {
    throw new Error(`calibration_runtime_target_already_provisioned:${plan.target}`);
  }
  const disk = await (input.diskStatus ?? calibrationDiskStatus)(calibrationRoot, plan.stagingBytes);
  if (!disk.canStart) {
    throw new Error(`calibration_runtime_insufficient_disk_reserve:${plan.stagingBytes}:${disk.freeBytes}:${disk.reserveBytes}`);
  }
  const stagingRoot = safeChildPath(calibrationRoot, `.staging-${randomUUID()}`);
  const manifestPath = safeChildPath(calibrationRoot, "runtime-manifest.json");
  const manifestBytes = `${JSON.stringify(plan.manifest, null, 2)}\n`;
  const manifestTemporaryPath = safeChildPath(calibrationRoot, `.runtime-manifest-${randomUUID()}.tmp`);
  const backupsRoot = safeChildPath(calibrationRoot, "manifest-backups");
  const backupPath = safeChildPath(backupsRoot, `runtime-manifest.${Date.now()}.${await sha256File(manifestPath)}.${randomUUID()}.json`);
  const targetBackupsRoot = safeChildPath(calibrationRoot, "runtime-target-backups");
  const targetBackupPath = existingTarget
    ? safeChildPath(targetBackupsRoot, `${plan.target}.${Date.now()}.${randomUUID()}`) : null;
  const failedTargetsRoot = safeChildPath(calibrationRoot, "runtime-failed-targets");
  const failedTargetPath = safeChildPath(failedTargetsRoot, `${plan.target}.${Date.now()}.${randomUUID()}`);
  let previousTargetMoved = false;
  let previousManifestMoved = false;
  let stagedTargetInstalled = false;
  await mkdir(stagingRoot, { recursive: false });
  try {
    for (const file of plan.files) {
      const destination = safeChildPath(stagingRoot, file.relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(file.sourcePath, destination, constants.COPYFILE_EXCL);
      if (file.executable && plan.target !== "win32-x64") await chmod(destination, 0o755);
      if (await sha256File(destination) !== file.sha256) throw new Error(`calibration_asset_copy_hash_mismatch:${file.id}:${file.kind}`);
    }
    await mkdir(backupsRoot, { recursive: true });
    if (targetBackupPath) await mkdir(targetBackupsRoot, { recursive: true });
    await writeFile(manifestTemporaryPath, manifestBytes, { encoding: "utf8", flag: "wx" });
    if (targetBackupPath) {
      await rename(targetRoot, targetBackupPath);
      previousTargetMoved = true;
    }
    await rename(manifestPath, backupPath);
    previousManifestMoved = true;
    await rename(stagingRoot, targetRoot);
    stagedTargetInstalled = true;
    await rename(manifestTemporaryPath, manifestPath);
    previousManifestMoved = false;
  } catch (error) {
    if (stagedTargetInstalled) {
      await mkdir(failedTargetsRoot, { recursive: true });
      await rename(targetRoot, failedTargetPath).catch(() => undefined);
      stagedTargetInstalled = false;
    }
    if (previousTargetMoved && targetBackupPath) {
      await rename(targetBackupPath, targetRoot).catch(() => undefined);
      previousTargetMoved = false;
    }
    if (previousManifestMoved) {
      await rename(backupPath, manifestPath).catch(() => undefined);
      previousManifestMoved = false;
    }
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(manifestTemporaryPath, { force: true }).catch(() => undefined);
  }
  return { ...plan, backupPath, targetRoot, targetBackupPath, disk };
}
