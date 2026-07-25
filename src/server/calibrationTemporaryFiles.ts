import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rmdir, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { CalibrationTemporaryFileState } from "../shared/types.js";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MARKER = "qual-hardware-calibration-temporary-workspace/2.0.0";
const MANIFEST_NAME = "session-manifest.json";
const MANIFEST_TEMP_NAME = ".session-manifest.write.tmp";
const GIB = 1024 ** 3;
const MINIMUM_RESERVE_BYTES = 10 * GIB;
const MAXIMUM_RESERVE_BYTES = 50 * GIB;
const WINDOWS_FILE_RELEASE_RETRIES = 20;
const ABANDONED_WORKSPACE_FILE = /^(?:session-manifest\.json|\.session-manifest\.write\.tmp|telemetry\.jsonl|pipeline-probe\.sqlite(?:-(?:wal|shm))?|synthetic-frame\.jpg|synthetic-source-\d+\.mkv|gpu-media-preflight-\d+-\d+-\d+\.(?:mkv|jpg)|media-\d+-\d+-\d+-\d+\.mkv|snapshot-\d+-\d+-\d+\.jpg)$/;

function isTransientFileLock(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EBUSY" || code === "EPERM";
}

async function unlinkRegisteredFile(path: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await unlink(path);
      return;
    } catch (error) {
      if (!isTransientFileLock(error) || attempt >= WINDOWS_FILE_RELEASE_RETRIES) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(250, 25 * (attempt + 1))));
    }
  }
}

export interface TemporaryFileEntry {
  relativePath: string;
  size: number;
  sha256: string;
  state: CalibrationTemporaryFileState;
  phase: string;
  attempt: number;
  expectedSize: number | null;
  createdAt: string;
  removedAt: string | null;
  lifecycleReason: string | null;
}

export interface TemporaryWorkspaceManifest {
  marker: typeof MARKER;
  sessionId: string;
  runId: string;
  appVersion: string;
  createdAt: string;
  files: TemporaryFileEntry[];
}

export interface CalibrationWorkspace {
  root: string;
  directory: string;
  manifestPath: string;
  manifest: TemporaryWorkspaceManifest;
  currentPhase: string;
  currentAttempt: number;
  manifestWriteQueue: Promise<void>;
}

export interface CalibrationDiskStatus {
  totalBytes: number;
  freeBytes: number;
  reserveBytes: number;
  projectedPeakBytes: number;
  canStart: boolean;
}

function assertSessionId(sessionId: string): void {
  if (!SESSION_ID.test(sessionId)) throw new Error("calibration_workspace_invalid_session_id");
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}

function safeRelativePath(value: string): string {
  if (!value || value.includes("\0") || value.split(/[\\/]/).includes("..")) {
    throw new Error("calibration_workspace_invalid_relative_path");
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized === MANIFEST_NAME || basename(normalized) !== normalized) {
    throw new Error("calibration_workspace_nested_or_reserved_path");
  }
  return normalized;
}

async function persistCalibrationWorkspaceManifest(workspace: CalibrationWorkspace): Promise<void> {
  const temporaryPath = join(workspace.directory, MANIFEST_TEMP_NAME);
  const write = workspace.manifestWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const interruptedWrite = await lstat(temporaryPath).catch((error: unknown) =>
        isNotFound(error) ? null : Promise.reject(error));
      if (interruptedWrite) {
        if (!interruptedWrite.isFile() || interruptedWrite.isSymbolicLink()) {
          throw new Error("calibration_workspace_manifest_temporary_invalid");
        }
        await unlinkRegisteredFile(temporaryPath);
      }
      await writeFile(temporaryPath, JSON.stringify(workspace.manifest, null, 2), { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, workspace.manifestPath);
    });
  workspace.manifestWriteQueue = write;
  await write;
}

async function fileSha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function assertDirectChild(root: string, candidate: string, sessionId: string): Promise<void> {
  const canonicalRoot = await realpath(root);
  const canonicalCandidate = await realpath(candidate);
  if (dirname(canonicalCandidate) !== canonicalRoot || basename(canonicalCandidate) !== sessionId ||
      relative(canonicalRoot, canonicalCandidate).includes(sep)) {
    throw new Error("calibration_workspace_outside_controlled_root");
  }
  const candidateStat = await lstat(canonicalCandidate);
  if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink()) throw new Error("calibration_workspace_not_owned_directory");
}

export async function createCalibrationWorkspace(input: {
  root: string;
  sessionId: string;
  runId: string;
  appVersion: string;
}): Promise<CalibrationWorkspace> {
  assertSessionId(input.sessionId);
  const root = resolve(input.root);
  await mkdir(root, { recursive: true });
  const directory = join(root, input.sessionId);
  await mkdir(directory, { recursive: false });
  const manifest: TemporaryWorkspaceManifest = {
    marker: MARKER,
    sessionId: input.sessionId,
    runId: input.runId,
    appVersion: input.appVersion,
    createdAt: new Date().toISOString(),
    files: [],
  };
  const manifestPath = join(directory, MANIFEST_NAME);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { encoding: "utf8", flag: "wx" });
  return {
    root, directory, manifestPath, manifest, currentPhase: "preflight", currentAttempt: 1,
    manifestWriteQueue: Promise.resolve(),
  };
}

export function setCalibrationWorkspaceOwner(workspace: CalibrationWorkspace, phase: string, attempt: number): void {
  workspace.currentPhase = phase.slice(0, 120) || "unknown";
  workspace.currentAttempt = Math.max(1, Math.floor(attempt));
}

export async function registerCalibrationTemporaryFile(
  workspace: CalibrationWorkspace,
  relativePath: string,
  metadata: { expectedSize?: number | null; retain?: boolean } = {},
): Promise<TemporaryFileEntry> {
  const normalized = safeRelativePath(relativePath);
  const path = join(workspace.directory, normalized);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("calibration_workspace_file_must_be_regular");
  const previous = workspace.manifest.files.find((item) => item.relativePath === normalized);
  const continuingEntry = previous && previous.state !== "deleted" ? previous : null;
  const entry: TemporaryFileEntry = {
    relativePath: normalized,
    size: info.size,
    sha256: await fileSha256(path),
    state: metadata.retain ? "retained" : continuingEntry?.state === "retained" ? "retained" : "active",
    phase: continuingEntry?.phase ?? workspace.currentPhase,
    attempt: continuingEntry?.attempt ?? workspace.currentAttempt,
    expectedSize: metadata.expectedSize ?? continuingEntry?.expectedSize ?? null,
    createdAt: continuingEntry?.createdAt ?? new Date().toISOString(),
    removedAt: null,
    lifecycleReason: metadata.retain ? "retained_until_terminal_cleanup" : continuingEntry?.lifecycleReason ?? null,
  };
  const index = workspace.manifest.files.findIndex((item) => item.relativePath === normalized);
  if (index >= 0) workspace.manifest.files[index] = entry;
  else workspace.manifest.files.push(entry);
  await persistCalibrationWorkspaceManifest(workspace);
  return entry;
}

export async function prepareCalibrationTemporaryFile(
  workspace: CalibrationWorkspace,
  relativePath: string,
  metadata: { expectedSize?: number | null; retain?: boolean } = {},
): Promise<string> {
  const normalized = safeRelativePath(relativePath);
  const path = join(workspace.directory, normalized);
  await writeFile(path, Buffer.alloc(0), { flag: "wx" });
  await registerCalibrationTemporaryFile(workspace, normalized, metadata);
  return path;
}

export async function readCalibrationWorkspace(root: string, sessionId: string): Promise<CalibrationWorkspace> {
  assertSessionId(sessionId);
  const controlledRoot = resolve(root);
  const directory = join(controlledRoot, sessionId);
  await assertDirectChild(controlledRoot, directory, sessionId);
  const manifestPath = join(directory, MANIFEST_NAME);
  const manifestInfo = await lstat(manifestPath);
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw new Error("calibration_workspace_manifest_invalid");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as TemporaryWorkspaceManifest;
  if (manifest.marker !== MARKER || manifest.sessionId !== sessionId || !SESSION_ID.test(manifest.runId)) {
    throw new Error("calibration_workspace_manifest_not_owned");
  }
  for (const entry of manifest.files) {
    if (!entry.state) entry.state = "active";
    if (!entry.phase) entry.phase = "legacy";
    if (!entry.attempt) entry.attempt = 1;
    if (entry.expectedSize === undefined) entry.expectedSize = null;
    if (!entry.createdAt) entry.createdAt = manifest.createdAt;
    if (entry.removedAt === undefined) entry.removedAt = null;
    if (entry.lifecycleReason === undefined) entry.lifecycleReason = null;
  }
  return {
    root: controlledRoot, directory, manifestPath, manifest, currentPhase: "recovery", currentAttempt: 1,
    manifestWriteQueue: Promise.resolve(),
  };
}

export function calibrationDiskReserveBytes(totalBytes: number): number {
  return Math.min(MAXIMUM_RESERVE_BYTES, Math.max(MINIMUM_RESERVE_BYTES, Math.floor(totalBytes * 0.15)));
}

export async function calibrationDiskStatus(path: string, projectedPeakBytes: number): Promise<CalibrationDiskStatus> {
  const information = await statfs(path);
  const totalBytes = Number(information.blocks) * Number(information.bsize);
  const freeBytes = Number(information.bavail) * Number(information.bsize);
  const reserveBytes = calibrationDiskReserveBytes(totalBytes);
  const projected = Math.max(0, Math.ceil(projectedPeakBytes));
  return { totalBytes, freeBytes, reserveBytes, projectedPeakBytes: projected, canStart: freeBytes >= reserveBytes + projected };
}

export async function markCalibrationPhaseReclaimable(
  workspace: CalibrationWorkspace,
  phase: string,
  attempt: number,
): Promise<number> {
  let bytes = 0;
  for (const entry of workspace.manifest.files) {
    if (entry.phase !== phase || entry.attempt !== attempt || entry.state !== "active") continue;
    entry.state = "reclaimable";
    entry.lifecycleReason = "checkpoint_committed";
    bytes += entry.size;
  }
  await persistCalibrationWorkspaceManifest(workspace);
  return bytes;
}

export async function reclaimCalibrationPhaseFiles(
  workspace: CalibrationWorkspace,
  phase: string,
  attempt: number,
): Promise<{ bytesRemoved: number; filesRemoved: number }> {
  await markCalibrationPhaseReclaimable(workspace, phase, attempt);
  let bytesRemoved = 0;
  let filesRemoved = 0;
  for (const entry of workspace.manifest.files) {
    if (entry.phase !== phase || entry.attempt !== attempt || entry.state !== "reclaimable") continue;
    const path = join(workspace.directory, safeRelativePath(entry.relativePath));
    const info = await lstat(path).catch((error: unknown) => isNotFound(error) ? null : Promise.reject(error));
    if (!info) {
      entry.state = "deleted";
      entry.removedAt = new Date().toISOString();
      entry.lifecycleReason = "already_absent_after_checkpoint";
      continue;
    }
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("calibration_workspace_file_changed");
    const currentHash = await fileSha256(path);
    if (currentHash !== entry.sha256) throw new Error(`calibration_workspace_hash_changed:${entry.relativePath}`);
    try {
      await unlinkRegisteredFile(path);
    } catch (error) {
      if (!isTransientFileLock(error)) throw error;
      // Windows can retain a codec handle briefly after the child process has
      // exited. Reclaiming between tiers is an optimization, so defer this
      // registered file to the mandatory terminal cleanup instead of aborting
      // an otherwise valid capacity run.
      entry.lifecycleReason = "phase_reclaim_deferred_file_lock";
      continue;
    }
    bytesRemoved += info.size;
    filesRemoved += 1;
    entry.state = "deleted";
    entry.removedAt = new Date().toISOString();
    entry.lifecycleReason = "phase_reclaimed_after_checkpoint";
  }
  await persistCalibrationWorkspaceManifest(workspace);
  return { bytesRemoved, filesRemoved };
}

export async function calibrationWorkspaceBytes(root: string, sessionId: string): Promise<number> {
  const workspace = await readCalibrationWorkspace(root, sessionId);
  let total = 0;
  for (const entry of workspace.manifest.files) {
    const path = join(workspace.directory, safeRelativePath(entry.relativePath));
    const info = await lstat(path).catch((error: unknown) => {
      if (isNotFound(error)) return null;
      throw error;
    });
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("calibration_workspace_file_changed");
    total += info.size;
  }
  return total;
}

export async function refreshRegisteredCalibrationTemporaryFiles(
  root: string,
  sessionId: string,
  liveWorkspace?: CalibrationWorkspace,
): Promise<CalibrationWorkspace> {
  const workspace = await readCalibrationWorkspace(root, sessionId);
  const registered = new Set(workspace.manifest.files.filter((entry) => entry.state !== "deleted")
    .map((entry) => safeRelativePath(entry.relativePath)));
  const entries = await readdir(workspace.directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === MANIFEST_NAME || entry.name === MANIFEST_TEMP_NAME) continue;
    if (!registered.has(entry.name) || entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`calibration_workspace_unregistered_entry:${entry.name}`);
    }
  }
  for (const relativePath of registered) {
    const present = await lstat(join(workspace.directory, relativePath)).then(() => true).catch((error: unknown) => {
      if (isNotFound(error)) return false;
      throw error;
    });
    if (present) {
      const current = workspace.manifest.files.find((entry) => entry.relativePath === relativePath);
      await registerCalibrationTemporaryFile(workspace, relativePath, { retain: current?.state === "retained" });
    }
  }
  if (liveWorkspace) {
    if (resolve(liveWorkspace.root) !== resolve(workspace.root) ||
        resolve(liveWorkspace.directory) !== resolve(workspace.directory) ||
        liveWorkspace.manifest.sessionId !== workspace.manifest.sessionId) {
      throw new Error("calibration_workspace_refresh_target_mismatch");
    }
    liveWorkspace.manifest = workspace.manifest;
    liveWorkspace.manifestWriteQueue = workspace.manifestWriteQueue;
    return liveWorkspace;
  }
  return workspace;
}

export async function cleanupCalibrationWorkspace(root: string, sessionId: string): Promise<{ bytesRemoved: number }> {
  const workspace = await readCalibrationWorkspace(root, sessionId);
  const entries = await readdir(workspace.directory, { withFileTypes: true });
  const allowed = new Set([MANIFEST_NAME, MANIFEST_TEMP_NAME, ...workspace.manifest.files.filter((entry) => entry.state !== "deleted")
    .map((entry) => safeRelativePath(entry.relativePath))]);
  for (const entry of entries) {
    if (!allowed.has(entry.name) || entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`calibration_workspace_unregistered_entry:${entry.name}`);
    }
  }
  const interruptedManifestWrite = join(workspace.directory, MANIFEST_TEMP_NAME);
  const interruptedManifestInfo = await lstat(interruptedManifestWrite).catch((error: unknown) =>
    isNotFound(error) ? null : Promise.reject(error));
  if (interruptedManifestInfo) {
    if (!interruptedManifestInfo.isFile() || interruptedManifestInfo.isSymbolicLink()) {
      throw new Error("calibration_workspace_manifest_temporary_invalid");
    }
    await unlinkRegisteredFile(interruptedManifestWrite);
  }
  let bytesRemoved = 0;
  for (const entry of workspace.manifest.files) {
    if (entry.state === "deleted") continue;
    const path = join(workspace.directory, safeRelativePath(entry.relativePath));
    const info = await lstat(path).catch((error: unknown) => {
      if (isNotFound(error)) return null;
      throw error;
    });
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("calibration_workspace_file_changed");
    const currentHash = await fileSha256(path);
    if (currentHash !== entry.sha256) throw new Error(`calibration_workspace_hash_changed:${entry.relativePath}`);
    bytesRemoved += info.size;
    await unlinkRegisteredFile(path);
  }
  const remaining = await readdir(workspace.directory);
  if (remaining.length !== 1 || remaining[0] !== MANIFEST_NAME) {
    throw new Error("calibration_workspace_contains_entry_after_file_cleanup");
  }
  await unlinkRegisteredFile(workspace.manifestPath);
  await rmdir(workspace.directory);
  return { bytesRemoved };
}

/**
 * Recovers only a registered, abandoned calibration directory whose manifest
 * was truncated during an operating-system/process interruption. This is not a
 * general recursive delete: the direct child, UUID and every regular filename
 * must match the closed set emitted by the calibration kernel.
 */
export async function cleanupAbandonedCalibrationWorkspace(
  root: string,
  sessionId: string,
): Promise<{ bytesRemoved: number }> {
  assertSessionId(sessionId);
  const controlledRoot = resolve(root);
  const directory = join(controlledRoot, sessionId);
  await assertDirectChild(controlledRoot, directory, sessionId);
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length === 0) throw new Error("calibration_abandoned_workspace_empty");
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !ABANDONED_WORKSPACE_FILE.test(entry.name)) {
      throw new Error(`calibration_abandoned_workspace_unrecognized_entry:${entry.name}`);
    }
    const canonical = await realpath(join(directory, entry.name));
    if (dirname(canonical) !== await realpath(directory)) {
      throw new Error("calibration_abandoned_workspace_entry_outside_session");
    }
  }
  let bytesRemoved = 0;
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const info = await lstat(path);
    bytesRemoved += info.size;
    await unlinkRegisteredFile(path);
  }
  await rmdir(directory);
  return { bytesRemoved };
}

export async function remainingCalibrationWorkspaceBytes(root: string, sessionId: string): Promise<number> {
  try {
    return await calibrationWorkspaceBytes(root, sessionId);
  } catch {
    const directory = join(resolve(root), sessionId);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    let total = 0;
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      total += (await stat(join(directory, entry.name))).size;
    }
    return total;
  }
}
