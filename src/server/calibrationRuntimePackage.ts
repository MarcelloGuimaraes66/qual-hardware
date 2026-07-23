import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { z } from "zod";
import { currentHostPlatform, trySelectHostPlatform } from "../platform/index.js";
import {
  CALIBRATION_KERNEL_VERSION,
  type CalibrationRuntimeInstallation,
  type CalibrationRuntimePackageStatus,
} from "../shared/types.js";

export const CALIBRATION_RUNTIME_PACKAGE_VERSION = "qual-hardware-calibration-runtime-package/1.0.0" as const;
const MAX_PACKAGE_BYTES = 8 * 1024 ** 3;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ENTRIES = 1_024;
const MAX_EXPANSION_RATIO = 100;
const TARGETS = ["win32-x64", "darwin-arm64", "linux-x64"] as const;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const safeArchivePathSchema = z.string().min(1).max(500).superRefine((value, context) => {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (value !== normalized || isAbsolute(value) || /^(?:[a-z]:|\/)/i.test(value) ||
      segments.some((segment) => !segment || segment === "." || segment === "..")) {
    context.addIssue({ code: "custom", message: "runtime_package_path_invalid" });
  }
});

const runtimeFileSchema = z.object({
  path: safeArchivePathSchema,
  sizeBytes: z.number().int().nonnegative().max(MAX_PACKAGE_BYTES),
  sha256: sha256Schema,
  permissions: z.number().int().min(0).max(0o777),
  licenseSpdx: z.string().min(1).max(160),
  licenseRef: safeArchivePathSchema,
  sbomRef: safeArchivePathSchema,
}).strict();

export const calibrationRuntimePackageManifestSchema = z.object({
  schemaVersion: z.literal(CALIBRATION_RUNTIME_PACKAGE_VERSION),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/),
  target: z.enum(TARGETS),
  kernelVersion: z.literal(CALIBRATION_KERNEL_VERSION),
  minimumAppVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  classification: z.enum(["candidate", "production"]),
  keyId: z.string().regex(/^[A-Za-z0-9._-]{3,120}$/),
  createdAt: z.iso.datetime(),
  files: z.array(runtimeFileSchema).min(1).max(MAX_ENTRIES - 1),
  signatureAlgorithm: z.literal("Ed25519"),
  signature: z.string().min(80).max(512),
}).strict().superRefine((manifest, context) => {
  const paths = manifest.files.map((file) => file.path.toLowerCase());
  if (new Set(paths).size !== paths.length) context.addIssue({ code: "custom", path: ["files"], message: "runtime_package_file_duplicate" });
  const inventory = new Set(manifest.files.map((file) => file.path));
  manifest.files.forEach((file, index) => {
    if (!inventory.has(file.licenseRef)) context.addIssue({ code: "custom", path: ["files", index, "licenseRef"], message: "runtime_package_license_missing" });
    if (!inventory.has(file.sbomRef)) context.addIssue({ code: "custom", path: ["files", index, "sbomRef"], message: "runtime_package_sbom_missing" });
  });
});

export type CalibrationRuntimePackageManifest = z.infer<typeof calibrationRuntimePackageManifestSchema>;

interface RuntimePointerEntry {
  manifestHash: string;
  version: string;
  classification: "candidate" | "production";
  keyId: string;
  installedAt: string;
}

interface RuntimePointer {
  schemaVersion: "qual-hardware-calibration-runtime-active/1.0.0";
  target: typeof TARGETS[number];
  active: RuntimePointerEntry;
  previous: RuntimePointerEntry | null;
}

interface ArchiveInventory {
  manifest: CalibrationRuntimePackageManifest;
  entries: Map<string, Entry>;
  manifestHash: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().filter((key) => record[key] !== undefined)
      .map((key) => [key, canonical(record[key])]));
  }
  return value;
}

export function canonicalRuntimeManifestBytes(manifest: CalibrationRuntimePackageManifest, includeSignature = false): Buffer {
  const payload: Record<string, unknown> = structuredClone(manifest);
  if (!includeSignature) delete payload.signature;
  return Buffer.from(JSON.stringify(canonical(payload)), "utf8");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256Path(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

async function relativeFileInventory(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("runtime_installation_link_detected");
    if (entry.isDirectory()) files.push(...await relativeFileInventory(root, path));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    else throw new Error("runtime_installation_entry_invalid");
  }
  return files.sort();
}

function targetFor(platform: NodeJS.Platform = currentHostPlatform.nodePlatform, architecture: string = process.arch): typeof TARGETS[number] | null {
  return trySelectHostPlatform(platform)?.runtimeTarget(architecture) ?? null;
}

function semverTuple(value: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = value.split(".").map((item) => Number.parseInt(item, 10));
  return [major, minor, patch];
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = semverTuple(actual);
  const right = semverTuple(minimum);
  return left[0] > right[0] || left[0] === right[0] && (left[1] > right[1] || left[1] === right[1] && left[2] >= right[2]);
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolveZip, rejectZip) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) rejectZip(error ?? new Error("runtime_package_zip_open_failed"));
      else resolveZip(zip);
    });
  });
}

function readEntry(zip: ZipFile, entry: Entry, maximumBytes: number): Promise<Buffer> {
  return new Promise((resolveEntry, rejectEntry) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) { rejectEntry(error ?? new Error("runtime_package_entry_open_failed")); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > maximumBytes) stream.destroy(new Error("runtime_package_manifest_too_large"));
        else chunks.push(chunk);
      });
      stream.once("error", rejectEntry);
      stream.once("end", () => resolveEntry(Buffer.concat(chunks, bytes)));
    });
  });
}

function isLink(entry: Entry): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

async function inspectArchive(path: string): Promise<ArchiveInventory> {
  const packageInfo = await stat(path);
  if (!packageInfo.isFile() || packageInfo.size <= 0 || packageInfo.size > MAX_PACKAGE_BYTES) throw new Error("runtime_package_size_invalid");
  const zip = await openZip(path);
  const entries = new Map<string, Entry>();
  let manifestBytes: Buffer | null = null;
  let expandedBytes = 0;
  try {
    await new Promise<void>((resolveEntries, rejectEntries) => {
      let count = 0;
      zip.on("error", rejectEntries);
      zip.on("entry", (entry: Entry) => {
        void (async () => {
          count += 1;
          if (count > MAX_ENTRIES) throw new Error("runtime_package_entry_limit_exceeded");
          const name = entry.fileName.replaceAll("\\", "/");
          if (entry.fileName !== name || name.startsWith("/") || /^(?:[a-z]:)/i.test(name) ||
              name.split("/").some((segment) => segment === "." || segment === "..") || isLink(entry)) {
            throw new Error("runtime_package_entry_unsafe");
          }
          const duplicateKey = name.toLowerCase();
          if ([...entries.keys()].some((candidate) => candidate.toLowerCase() === duplicateKey)) throw new Error("runtime_package_entry_duplicate");
          entries.set(name, entry);
          expandedBytes += entry.uncompressedSize;
          if (expandedBytes > MAX_PACKAGE_BYTES) throw new Error("runtime_package_expanded_size_exceeded");
          if (entry.uncompressedSize > 10 * 1024 * 1024 && entry.uncompressedSize / Math.max(1, entry.compressedSize) > MAX_EXPANSION_RATIO) {
            throw new Error("runtime_package_expansion_ratio_exceeded");
          }
          if (name === "manifest.json") manifestBytes = await readEntry(zip, entry, MAX_MANIFEST_BYTES);
          zip.readEntry();
        })().catch(rejectEntries);
      });
      zip.on("end", resolveEntries);
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  const completeManifestBytes = manifestBytes as Buffer | null;
  if (!completeManifestBytes) throw new Error("runtime_package_manifest_missing");
  const manifest = calibrationRuntimePackageManifestSchema.parse(JSON.parse(completeManifestBytes.toString("utf8")));
  const expected = new Set(["manifest.json", ...manifest.files.map((file) => file.path)]);
  const actual = new Set([...entries.keys()].filter((name) => !name.endsWith("/")));
  if (expected.size !== actual.size || [...expected].some((name) => !actual.has(name))) throw new Error("runtime_package_inventory_mismatch");
  return { manifest, entries, manifestHash: sha256(canonicalRuntimeManifestBytes(manifest, true)) };
}

function safeInstallPath(root: string, relativePath: string): string {
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, relativePath);
  const fromRoot = relative(rootPath, candidate);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error("runtime_package_install_path_unsafe");
  return candidate;
}

async function safeRemoveStaging(root: string, staging: string): Promise<void> {
  const rootPath = resolve(root);
  const stagingPath = resolve(staging);
  const fromRoot = relative(rootPath, stagingPath);
  if (!/^\.staging-[a-f0-9]{32}$/.test(fromRoot.replaceAll("\\", "/"))) throw new Error("runtime_package_staging_cleanup_unsafe");
  await rm(stagingPath, { recursive: true, force: true });
}

async function extractArchive(path: string, staging: string, manifest: CalibrationRuntimePackageManifest): Promise<void> {
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  const zip = await openZip(path);
  try {
    await new Promise<void>((resolveEntries, rejectEntries) => {
      zip.on("error", rejectEntries);
      zip.on("entry", (entry: Entry) => {
        void (async () => {
          if (entry.fileName === "manifest.json" || entry.fileName.endsWith("/")) { zip.readEntry(); return; }
          const definition = expected.get(entry.fileName);
          if (!definition || entry.uncompressedSize !== definition.sizeBytes) throw new Error("runtime_package_file_size_mismatch");
          const destination = safeInstallPath(staging, entry.fileName);
          await mkdir(dirname(destination), { recursive: true });
          const digest = createHash("sha256");
          let bytes = 0;
          const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.byteLength;
            digest.update(chunk);
            callback(null, chunk);
          } });
          const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, rejectStream) => {
            zip.openReadStream(entry, (error, value) => error || !value
              ? rejectStream(error ?? new Error("runtime_package_entry_open_failed")) : resolveStream(value));
          });
          await pipeline(stream, meter, createWriteStream(destination, { flags: "wx" }));
          if (bytes !== definition.sizeBytes || digest.digest("hex") !== definition.sha256) throw new Error("runtime_package_file_hash_mismatch");
          if (currentHostPlatform.nodePlatform !== "win32") await chmod(destination, definition.permissions);
          zip.readEntry();
        })().catch(rejectEntries);
      });
      zip.on("end", resolveEntries);
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

async function writePointer(root: string, pointer: RuntimePointer): Promise<void> {
  const destination = join(root, "active.json");
  const temporary = join(root, `.active-${randomUUID().replaceAll("-", "")}.tmp`);
  await writeFile(temporary, `${JSON.stringify(pointer, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, destination);
}

export class CalibrationRuntimePackageManager {
  private readonly installations = new Map<string, CalibrationRuntimeInstallation>();
  private readonly verificationInFlight = new Map<string, Promise<boolean>>();
  private installing = false;

  constructor(private readonly options: {
    root: string;
    appVersion: string;
    platform?: NodeJS.Platform;
    architecture?: string;
    trustedKeys: Readonly<Record<string, string>>;
    productionKeyIds: ReadonlySet<string>;
    selectPackage?: () => Promise<string | null>;
    onActivated?: () => void;
  }) {}

  async status(): Promise<CalibrationRuntimePackageStatus> {
    const target = targetFor(this.options.platform, this.options.architecture);
    const pointer = await this.readPointer();
    const pointerActive = pointer?.target === target ? pointer.active : null;
    const activeValid = pointerActive && target ? await this.verifyInstalledSingleFlight(pointerActive, target).catch(() => false) : false;
    const active = activeValid ? pointerActive : null;
    const production = active?.classification === "production" && this.options.productionKeyIds.has(active.keyId);
    return {
      schemaVersion: "qual-hardware-calibration-runtime-package-status/1.0.0",
      target,
      active,
      previous: pointer?.target === target ? pointer.previous : null,
      installationInProgress: this.installing,
      qualificationAllowed: Boolean(production),
      reasons: [
        ...(target ? [] : ["runtime_target_unsupported"]),
        ...(active ? [] : pointerActive ? ["runtime_installation_invalid"] : ["runtime_not_installed"]),
        ...(active && !production ? ["runtime_not_production_trusted"] : []),
      ],
    };
  }

  requestInstall(): string {
    if (this.installing) throw new Error("runtime_installation_already_in_progress");
    if (!this.options.selectPackage) throw new Error("runtime_package_selector_unavailable");
    const installationId = randomUUID();
    const now = new Date().toISOString();
    this.installations.set(installationId, { installationId, state: "selecting", createdAt: now, updatedAt: now, manifestHash: null, error: null });
    this.installing = true;
    void this.options.selectPackage().then(async (path) => {
      if (!path) { this.updateInstallation(installationId, "cancelled"); return; }
      await this.installFile(path, installationId);
    }).catch((error: unknown) => this.updateInstallation(installationId, "failed", null, error)).finally(() => { this.installing = false; });
    return installationId;
  }

  installation(id: string): CalibrationRuntimeInstallation | null {
    const value = this.installations.get(id);
    return value ? structuredClone(value) : null;
  }

  async installFile(path: string, installationId = randomUUID()): Promise<CalibrationRuntimeInstallation> {
    const existing = this.installations.get(installationId);
    if (this.installing && !existing) throw new Error("runtime_installation_already_in_progress");
    const ownsInstallationLock = !this.installing;
    if (ownsInstallationLock) this.installing = true;
    const now = new Date().toISOString();
    if (!existing) this.installations.set(installationId, { installationId, state: "validating", createdAt: now, updatedAt: now, manifestHash: null, error: null });
    else this.updateInstallation(installationId, "validating");
    let staging = "";
    try {
      await mkdir(this.options.root, { recursive: true });
      const inventory = await inspectArchive(path);
      const target = targetFor(this.options.platform, this.options.architecture);
      if (!target || inventory.manifest.target !== target) throw new Error("runtime_package_target_mismatch");
      if (!versionAtLeast(this.options.appVersion, inventory.manifest.minimumAppVersion)) throw new Error("runtime_package_app_version_incompatible");
      const publicKey = this.options.trustedKeys[inventory.manifest.keyId];
      if (!publicKey) throw new Error("runtime_package_signing_key_untrusted");
      if (!verify(null, canonicalRuntimeManifestBytes(inventory.manifest), createPublicKey(publicKey), Buffer.from(inventory.manifest.signature, "base64"))) {
        throw new Error("runtime_package_signature_invalid");
      }
      if (inventory.manifest.classification === "production" && !this.options.productionKeyIds.has(inventory.manifest.keyId)) {
        throw new Error("runtime_package_production_key_required");
      }
      const declaredBytes = inventory.manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0);
      const disk = await statfs(this.options.root);
      const freeBytes = Number(disk.bavail) * Number(disk.bsize);
      if (freeBytes < declaredBytes + 512 * 1024 ** 2) throw new Error("runtime_package_insufficient_disk_space");
      const targetRoot = join(this.options.root, target);
      await mkdir(targetRoot, { recursive: true });
      const finalRoot = safeInstallPath(targetRoot, inventory.manifestHash);
      if (!(await stat(finalRoot).catch(() => null))) {
        staging = safeInstallPath(targetRoot, `.staging-${randomUUID().replaceAll("-", "")}`);
        await mkdir(staging, { recursive: false });
        this.updateInstallation(installationId, "installing", inventory.manifestHash);
        await extractArchive(path, staging, inventory.manifest);
        await rename(staging, finalRoot);
        staging = "";
      } else if (!await this.verifyInstalled({
        manifestHash: inventory.manifestHash,
        version: inventory.manifest.version,
        classification: inventory.manifest.classification,
        keyId: inventory.manifest.keyId,
        installedAt: new Date().toISOString(),
      }, target).catch(() => false)) {
        throw new Error("runtime_package_existing_installation_invalid");
      }
      const pointer = await this.readPointer();
      const entry: RuntimePointerEntry = {
        manifestHash: inventory.manifestHash,
        version: inventory.manifest.version,
        classification: inventory.manifest.classification,
        keyId: inventory.manifest.keyId,
        installedAt: new Date().toISOString(),
      };
      if (!await this.verifyInstalled(entry, target)) throw new Error("runtime_package_post_install_verification_failed");
      await writePointer(this.options.root, {
        schemaVersion: "qual-hardware-calibration-runtime-active/1.0.0",
        target,
        active: entry,
        previous: pointer?.target === target && pointer.active.manifestHash !== entry.manifestHash ? pointer.active : pointer?.previous ?? null,
      });
      this.options.onActivated?.();
      this.updateInstallation(installationId, "completed", inventory.manifestHash);
    } catch (error) {
      if (staging) await safeRemoveStaging(dirname(staging), staging).catch(() => undefined);
      this.updateInstallation(installationId, "failed", null, error);
    } finally {
      if (ownsInstallationLock) this.installing = false;
    }
    return structuredClone(this.installations.get(installationId)!);
  }

  async rollback(): Promise<CalibrationRuntimePackageStatus> {
    if (this.installing) throw new Error("runtime_installation_in_progress");
    const pointer = await this.readPointer();
    if (!pointer?.previous) throw new Error("runtime_rollback_unavailable");
    if (!await this.verifyInstalledSingleFlight(pointer.previous, pointer.target)) throw new Error("runtime_rollback_installation_invalid");
    await writePointer(this.options.root, { ...pointer, active: pointer.previous, previous: pointer.active });
    this.options.onActivated?.();
    return this.status();
  }

  async activeResourceRoot(): Promise<string | null> {
    const pointer = await this.readPointer();
    const target = targetFor(this.options.platform, this.options.architecture);
    if (!pointer || pointer.target !== target) return null;
    if (!await this.verifyInstalledSingleFlight(pointer.active, pointer.target).catch(() => false)) return null;
    return safeInstallPath(join(this.options.root, pointer.target), pointer.active.manifestHash);
  }

  private verifyInstalledSingleFlight(entry: RuntimePointerEntry, target: typeof TARGETS[number]): Promise<boolean> {
    const key = `${target}:${entry.manifestHash}`;
    const existing = this.verificationInFlight.get(key);
    if (existing) return existing;
    const verification = this.verifyInstalled(entry, target)
      .finally(() => {
        if (this.verificationInFlight.get(key) === verification) this.verificationInFlight.delete(key);
      });
    this.verificationInFlight.set(key, verification);
    return verification;
  }

  private updateInstallation(id: string, state: CalibrationRuntimeInstallation["state"], manifestHash: string | null = null, error?: unknown): void {
    const current = this.installations.get(id);
    if (!current) return;
    this.installations.set(id, {
      ...current,
      state,
      updatedAt: new Date().toISOString(),
      manifestHash: manifestHash ?? current.manifestHash,
      error: error ? (error instanceof Error ? error.message : String(error)).slice(0, 1_000) : null,
    });
  }

  private async readPointer(): Promise<RuntimePointer | null> {
    try {
      const value = JSON.parse(await readFile(join(this.options.root, "active.json"), "utf8")) as RuntimePointer;
      if (value.schemaVersion !== "qual-hardware-calibration-runtime-active/1.0.0" || !TARGETS.includes(value.target)) return null;
      return value;
    } catch {
      return null;
    }
  }

  private async verifyInstalled(entry: RuntimePointerEntry, target: typeof TARGETS[number]): Promise<boolean> {
    const root = safeInstallPath(join(this.options.root, target), entry.manifestHash);
    if (!(await stat(root).catch(() => null))?.isDirectory()) return false;
    const manifest = calibrationRuntimePackageManifestSchema.parse(JSON.parse(await readFile(join(root, "manifest.json"), "utf8")));
    if (manifest.target !== target || manifest.version !== entry.version || manifest.classification !== entry.classification ||
        manifest.keyId !== entry.keyId || sha256(canonicalRuntimeManifestBytes(manifest, true)) !== entry.manifestHash) return false;
    const publicKey = this.options.trustedKeys[manifest.keyId];
    if (!publicKey || !verify(null, canonicalRuntimeManifestBytes(manifest), createPublicKey(publicKey), Buffer.from(manifest.signature, "base64"))) return false;
    if (manifest.classification === "production" && !this.options.productionKeyIds.has(manifest.keyId)) return false;
    const expected = ["manifest.json", ...manifest.files.map((file) => file.path)].sort();
    const actual = await relativeFileInventory(root);
    if (expected.length !== actual.length || expected.some((file, index) => file !== actual[index])) return false;
    for (const file of manifest.files) {
      const path = safeInstallPath(root, file.path);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.sizeBytes || await sha256Path(path) !== file.sha256) return false;
      if (currentHostPlatform.nodePlatform !== "win32" && (info.mode & 0o777) !== file.permissions) return false;
    }
    return true;
  }
}
