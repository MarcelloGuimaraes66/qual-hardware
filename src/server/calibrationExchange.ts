import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGunzip, gunzipSync, gzipSync } from "node:zlib";
import { qhcalPackageSchema, qhcalSetPackageSchema } from "../shared/schemas.js";
import {
  QHCAL_PACKAGE_VERSION,
  QHCALSET_PACKAGE_VERSION,
  type CalibrationDeviceIdentity,
  type CalibrationNormalizedSystemIdentity,
  type CalibrationWorkloadProfile,
  type LocalCalibrationRun,
  type QhcalDeviceProof,
  type QhcalPackage,
  type QhcalSetPackage,
  type QhcalSetUnsignedPayload,
  type QhcalUnsignedPayload,
} from "../shared/types.js";
import { canonicalSha256 } from "../engine/calibrationProfile.js";
import { calibrationHardwareDigest } from "./calibrationHardware.js";

export const QHCAL_MIME = "application/vnd.qual-hardware.calibration+gzip";
export const QHCALSET_MIME = "application/vnd.qual-hardware.calibration-set+gzip";
export const QHCAL_MAX_COMPRESSED_BYTES = 20 * 1024 * 1024;
export const QHCAL_MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;
export const QHCALSET_MAX_COMPRESSED_BYTES = 250 * 1024 * 1024;
export const QHCALSET_MAX_DECOMPRESSED_BYTES = 500 * 1024 * 1024;
export const QHCALSET_MAX_RESULTS = 10_000;

interface StoredIdentity {
  schemaVersion: "qual-hardware-calibration-device-identity/1.0.0";
  id: string;
  publicKeyPem: string;
  shortCode: string;
  createdAt: string;
  protection: "operating_system" | "filesystem";
}

export interface CalibrationPrivateKeyProtection {
  isAvailable(): boolean;
  encryptString(value: string): Uint8Array;
  decryptString(value: Uint8Array): string;
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

export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(canonical(value)), "utf8");
}

export function exchangeDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}

function shortCode(digest: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = Buffer.from(digest.slice(0, 16), "hex");
  const characters = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `${characters.slice(0, 4)}-${characters.slice(4, 8)}`;
}

function deviceProof(publicKeyPem: string): QhcalDeviceProof {
  const id = createHash("sha256").update(publicKeyPem, "utf8").digest("hex");
  return { id, publicKeyPem, shortCode: shortCode(id) };
}

function normalizedSystemIdentity(run: LocalCalibrationRun): CalibrationNormalizedSystemIdentity {
  return {
    hardwareDigest: calibrationHardwareDigest(run.fingerprint),
    hardwareTemplateId: run.fingerprint.hardwareTemplateId,
    cpuModel: run.fingerprint.cpuModel, cpuArchitecture: run.fingerprint.cpuArchitecture,
    physicalCores: run.fingerprint.physicalCores, logicalCores: run.fingerprint.logicalCores,
    gpuModel: run.fingerprint.gpuModel, gpuArchitecture: run.fingerprint.gpuArchitecture,
    gpuCount: run.fingerprint.gpuCount, gpuVramBytes: run.fingerprint.gpuVramBytes,
    gpuDriver: run.fingerprint.gpuDriver, ramBytes: run.fingerprint.ramBytes,
    operatingSystem: run.fingerprint.operatingSystem, operatingSystemVersion: run.fingerprint.operatingSystemVersion,
    formFactor: run.fingerprint.formFactor,
  };
}

function unsignedQhcal(value: QhcalPackage): QhcalUnsignedPayload {
  const { signatureAlgorithm: _algorithm, signature: _signature, ...unsigned } = value;
  return unsigned;
}

function unsignedQhcalSet(value: QhcalSetPackage): QhcalSetUnsignedPayload & { exporter: QhcalDeviceProof } {
  const { signatureAlgorithm: _algorithm, signature: _signature, ...unsigned } = value;
  return unsigned;
}

function compressBounded(value: unknown, maximumBytes: number, errorCode: string): Buffer {
  const canonicalValue = canonical(value);
  const portableValue = canonicalValue && typeof canonicalValue === "object" && !Array.isArray(canonicalValue) &&
      typeof (canonicalValue as Record<string, unknown>).schemaVersion === "string"
    ? {
        schemaVersion: (canonicalValue as Record<string, unknown>).schemaVersion,
        ...Object.fromEntries(Object.entries(canonicalValue as Record<string, unknown>)
          .filter(([key]) => key !== "schemaVersion")),
      }
    : canonicalValue;
  const compressed = gzipSync(Buffer.from(JSON.stringify(portableValue), "utf8"), { level: 9 });
  if (compressed.byteLength > maximumBytes) throw new Error(errorCode);
  return compressed;
}

async function decompressPortablePackage(bytes: Uint8Array): Promise<unknown> {
  if (bytes.byteLength > QHCALSET_MAX_COMPRESSED_BYTES) throw new Error("calibration_package_compressed_size_exceeded");
  return new Promise<unknown>((resolvePackage, rejectPackage) => {
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];
    let total = 0;
    let limit = QHCAL_MAX_DECOMPRESSED_BYTES;
    let format: "qhcal" | "qhcalset" | null = null;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      gunzip.destroy();
      rejectPackage(error);
    };
    gunzip.on("data", (chunk: Buffer) => {
      if (settled) return;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (!format && total <= 256 * 1024) {
        const prefix = Buffer.concat(chunks).toString("utf8");
        if (prefix.includes(`"schemaVersion":"${QHCALSET_PACKAGE_VERSION}"`)) {
          format = "qhcalset";
          limit = QHCALSET_MAX_DECOMPRESSED_BYTES;
        } else if (prefix.includes(`"schemaVersion":"${QHCAL_PACKAGE_VERSION}"`)) {
          format = "qhcal";
        }
      }
      if (total > limit) fail(new Error("calibration_package_decompressed_size_exceeded"));
    });
    gunzip.once("error", () => fail(new Error("calibration_package_invalid_gzip")));
    gunzip.once("end", () => {
      if (settled) return;
      settled = true;
      try { resolvePackage(JSON.parse(Buffer.concat(chunks, total).toString("utf8")) as unknown); }
      catch { rejectPackage(new Error("calibration_package_invalid_json")); }
    });
    gunzip.end(bytes);
  });
}

function decompressBounded(bytes: Uint8Array, compressedLimit: number, decompressedLimit: number): unknown {
  if (bytes.byteLength > compressedLimit) throw new Error("calibration_package_compressed_size_exceeded");
  let decompressed: Buffer;
  try {
    decompressed = gunzipSync(bytes, { maxOutputLength: decompressedLimit });
  } catch (error) {
    if (error instanceof RangeError || /maxOutputLength|larger than/i.test(error instanceof Error ? error.message : String(error))) {
      throw new Error("calibration_package_decompressed_size_exceeded");
    }
    throw new Error("calibration_package_invalid_gzip");
  }
  if (decompressed.byteLength > decompressedLimit) throw new Error("calibration_package_decompressed_size_exceeded");
  try { return JSON.parse(decompressed.toString("utf8")) as unknown; }
  catch { throw new Error("calibration_package_invalid_json"); }
}

export function verifyQhcalPackage(value: QhcalPackage): { packageDigest: string; runDigest: string } {
  const parsed = qhcalPackageSchema.parse(value) as QhcalPackage;
  const proof = deviceProof(parsed.device.publicKeyPem);
  if (proof.id !== parsed.device.id || proof.shortCode !== parsed.device.shortCode) throw new Error("calibration_device_identity_mismatch");
  const runDigest = exchangeDigest(parsed.run);
  if (runDigest !== parsed.runDigest) throw new Error("calibration_run_digest_mismatch");
  const { id: _profileId, signature: _profileSignature, ...profilePayload } = parsed.workloadProfile;
  if (canonicalSha256(profilePayload) !== parsed.workloadProfile.signature ||
      parsed.workloadProfile.id !== `workload:${parsed.workloadProfile.signature}` ||
      parsed.run.workloadProfileId !== parsed.workloadProfile.id ||
      parsed.run.workloadProfileSignature !== parsed.workloadProfile.signature) {
    throw new Error("calibration_workload_profile_mismatch");
  }
  if (exchangeDigest(parsed.systemIdentity) !== exchangeDigest(normalizedSystemIdentity(parsed.run)) ||
      parsed.provenance.producerDeviceId !== parsed.device.id) {
    throw new Error("calibration_system_identity_mismatch");
  }
  const valid = verify(null, canonicalJsonBytes(unsignedQhcal(parsed)), createPublicKey(parsed.device.publicKeyPem), Buffer.from(parsed.signature, "base64"));
  if (!valid) throw new Error("calibration_package_signature_invalid");
  return { packageDigest: exchangeDigest(parsed), runDigest };
}

export function verifyQhcalSetPackage(value: QhcalSetPackage): { packageDigest: string; itemDigests: string[] } {
  const parsed = qhcalSetPackageSchema.parse(value) as QhcalSetPackage;
  if (parsed.packages.length > QHCALSET_MAX_RESULTS) throw new Error("calibration_collection_result_limit_exceeded");
  const proof = deviceProof(parsed.exporter.publicKeyPem);
  if (proof.id !== parsed.exporter.id || proof.shortCode !== parsed.exporter.shortCode) throw new Error("calibration_collection_exporter_mismatch");
  const itemDigests = parsed.packages.map((item) => {
    verifyQhcalPackage(item);
    return exchangeDigest(item);
  });
  if (itemDigests.some((digest, index) => digest !== parsed.packageDigests[index])) throw new Error("calibration_collection_index_mismatch");
  const valid = verify(null, canonicalJsonBytes(unsignedQhcalSet(parsed)), createPublicKey(parsed.exporter.publicKeyPem), Buffer.from(parsed.signature, "base64"));
  if (!valid) throw new Error("calibration_collection_signature_invalid");
  return { packageDigest: exchangeDigest(parsed), itemDigests };
}

export class CalibrationExchangeService {
  private identityPromise: Promise<{ stored: StoredIdentity; privateKeyPem: string }> | null = null;

  constructor(private readonly options: {
    identityDirectory: string;
    evidenceDirectory: string;
    privateKeyProtection?: CalibrationPrivateKeyProtection;
    appVersion?: string;
  }) {}

  async localIdentity(): Promise<CalibrationDeviceIdentity> {
    const { stored } = await this.identity();
    return {
      id: stored.id,
      publicKeyPem: stored.publicKeyPem,
      shortCode: stored.shortCode,
      trust: "trusted",
      firstSeenAt: stored.createdAt,
      updatedAt: stored.createdAt,
      protection: stored.protection,
    };
  }

  async exportRun(
    run: LocalCalibrationRun,
    workloadProfile: CalibrationWorkloadProfile | null = null,
  ): Promise<{ bytes: Buffer; fileName: string; packageDigest: string; package: QhcalPackage }> {
    const fileName = `${run.id}.qhcal`;
    await mkdir(this.options.evidenceDirectory, { recursive: true });
    const path = join(this.options.evidenceDirectory, fileName);
    try {
      const existing = await readFile(path);
      const parsed = this.parseQhcal(existing);
      if (parsed.run.id !== run.id || parsed.runDigest !== exchangeDigest(run)) throw new Error("calibration_persisted_export_conflict");
      return { bytes: existing, fileName, packageDigest: exchangeDigest(parsed), package: parsed };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!workloadProfile) throw new Error("calibration_workload_profile_unavailable_for_export");
    const { stored, privateKeyPem } = await this.identity();
    const unsigned: QhcalUnsignedPayload = {
      schemaVersion: QHCAL_PACKAGE_VERSION,
      packageId: run.id,
      createdAt: new Date().toISOString(),
      device: { id: stored.id, publicKeyPem: stored.publicKeyPem, shortCode: stored.shortCode },
      run,
      workloadProfile,
      systemIdentity: normalizedSystemIdentity(run),
      provenance: { source: "local", producerDeviceId: stored.id, exporterVersion: this.options.appVersion ?? "0.1.0" },
      runDigest: exchangeDigest(run),
    };
    const packageValue: QhcalPackage = {
      ...unsigned,
      signatureAlgorithm: "Ed25519",
      signature: sign(null, canonicalJsonBytes(unsigned), createPrivateKey(privateKeyPem)).toString("base64"),
    };
    verifyQhcalPackage(packageValue);
    const bytes = compressBounded(packageValue, QHCAL_MAX_COMPRESSED_BYTES, "calibration_package_compressed_size_exceeded");
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    return { bytes, fileName, packageDigest: exchangeDigest(packageValue), package: packageValue };
  }

  parseQhcal(bytes: Uint8Array): QhcalPackage {
    const value = qhcalPackageSchema.parse(decompressBounded(bytes, QHCAL_MAX_COMPRESSED_BYTES, QHCAL_MAX_DECOMPRESSED_BYTES)) as QhcalPackage;
    verifyQhcalPackage(value);
    return value;
  }

  async persistImportedPackage(packageValue: QhcalPackage): Promise<void> {
    verifyQhcalPackage(packageValue);
    await mkdir(this.options.evidenceDirectory, { recursive: true });
    const path = join(this.options.evidenceDirectory, `${packageValue.run.id}.qhcal`);
    const bytes = compressBounded(packageValue, QHCAL_MAX_COMPRESSED_BYTES, "calibration_package_compressed_size_exceeded");
    try {
      const existing = this.parseQhcal(await readFile(path));
      if (exchangeDigest(existing) !== exchangeDigest(packageValue)) throw new Error("calibration_persisted_export_conflict");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  }

  parseQhcalSet(bytes: Uint8Array): QhcalSetPackage {
    const value = qhcalSetPackageSchema.parse(decompressBounded(bytes, QHCALSET_MAX_COMPRESSED_BYTES, QHCALSET_MAX_DECOMPRESSED_BYTES)) as QhcalSetPackage;
    verifyQhcalSetPackage(value);
    return value;
  }

  async parseAny(bytes: Uint8Array): Promise<{ format: "qhcal"; packages: QhcalPackage[]; packageDigest: string } |
    { format: "qhcalset"; packages: QhcalPackage[]; packageDigest: string }> {
    const raw = await decompressPortablePackage(bytes) as { schemaVersion?: unknown };
    if (raw.schemaVersion === QHCAL_PACKAGE_VERSION) {
      const packageValue = qhcalPackageSchema.parse(raw) as QhcalPackage;
      verifyQhcalPackage(packageValue);
      if (bytes.byteLength > QHCAL_MAX_COMPRESSED_BYTES || canonicalJsonBytes(raw).byteLength > QHCAL_MAX_DECOMPRESSED_BYTES) {
        throw new Error("calibration_package_size_exceeded");
      }
      return { format: "qhcal", packages: [packageValue], packageDigest: exchangeDigest(packageValue) };
    }
    if (raw.schemaVersion === QHCALSET_PACKAGE_VERSION) {
      const set = qhcalSetPackageSchema.parse(raw) as QhcalSetPackage;
      const verified = verifyQhcalSetPackage(set);
      return { format: "qhcalset", packages: set.packages, packageDigest: verified.packageDigest };
    }
    throw new Error("calibration_package_schema_unsupported");
  }

  async exportCollection(packages: QhcalPackage[]): Promise<{ bytes: Buffer; fileName: string; packageDigest: string; collection: QhcalSetPackage }> {
    if (packages.length > QHCALSET_MAX_RESULTS) throw new Error("calibration_collection_result_limit_exceeded");
    for (const packageValue of packages) verifyQhcalPackage(packageValue);
    const { stored, privateKeyPem } = await this.identity();
    const collectionId = randomUUID();
    const unsigned = {
      schemaVersion: QHCALSET_PACKAGE_VERSION,
      collectionId,
      createdAt: new Date().toISOString(),
      packages,
      packageDigests: packages.map(exchangeDigest),
      exporter: { id: stored.id, publicKeyPem: stored.publicKeyPem, shortCode: stored.shortCode },
    } satisfies QhcalSetUnsignedPayload & { exporter: QhcalDeviceProof };
    const collection: QhcalSetPackage = {
      ...unsigned,
      signatureAlgorithm: "Ed25519",
      signature: sign(null, canonicalJsonBytes(unsigned), createPrivateKey(privateKeyPem)).toString("base64"),
    };
    verifyQhcalSetPackage(collection);
    const bytes = compressBounded(collection, QHCALSET_MAX_COMPRESSED_BYTES, "calibration_collection_compressed_size_exceeded");
    const fileName = `${collectionId}.qhcalset`;
    await mkdir(this.options.evidenceDirectory, { recursive: true });
    await writeFile(join(this.options.evidenceDirectory, fileName), bytes, { flag: "wx", mode: 0o600 });
    return { bytes, fileName, packageDigest: exchangeDigest(collection), collection };
  }

  private identity(): Promise<{ stored: StoredIdentity; privateKeyPem: string }> {
    this.identityPromise ??= this.loadOrCreateIdentity();
    return this.identityPromise;
  }

  private async loadOrCreateIdentity(): Promise<{ stored: StoredIdentity; privateKeyPem: string }> {
    const metadataPath = join(this.options.identityDirectory, "device-identity.json");
    const filesystemPrivatePath = join(this.options.identityDirectory, "device-identity.ed25519.pem");
    const protectedPrivatePath = join(this.options.identityDirectory, "device-identity.ed25519.safe-storage");
    let stored: StoredIdentity;
    try {
      stored = JSON.parse(await readFile(metadataPath, "utf8")) as StoredIdentity;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return this.createIdentity(metadataPath, filesystemPrivatePath, protectedPrivatePath);
    }
    try {
      const privateKeyPem = stored.protection === "operating_system"
        ? this.decryptPrivateKey(await readFile(protectedPrivatePath))
        : await readFile(filesystemPrivatePath, "utf8");
      const proof = deviceProof(stored.publicKeyPem);
      const derivedPublic = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "pem" }).toString();
      if (stored.schemaVersion !== "qual-hardware-calibration-device-identity/1.0.0" ||
          proof.id !== stored.id || proof.shortCode !== stored.shortCode || derivedPublic !== stored.publicKeyPem) {
        throw new Error("calibration_local_device_identity_invalid");
      }
      return { stored, privateKeyPem };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("calibration_local_device_identity_incomplete");
      throw error;
    }
  }

  private decryptPrivateKey(encrypted: Uint8Array): string {
    const protection = this.options.privateKeyProtection;
    if (!protection?.isAvailable()) throw new Error("calibration_operating_system_key_storage_unavailable");
    try { return protection.decryptString(encrypted); }
    catch { throw new Error("calibration_operating_system_key_decryption_failed"); }
  }

  private async createIdentity(
    metadataPath: string,
    filesystemPrivatePath: string,
    protectedPrivatePath: string,
  ): Promise<{ stored: StoredIdentity; privateKeyPem: string }> {
    await mkdir(this.options.identityDirectory, { recursive: true, mode: 0o700 });
    const pair = generateKeyPairSync("ed25519");
    const privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const proof = deviceProof(publicKeyPem);
    const createdAt = new Date().toISOString();
    const protection = this.options.privateKeyProtection;
    const useOperatingSystemProtection = protection?.isAvailable() === true;
    const stored: StoredIdentity = {
      schemaVersion: "qual-hardware-calibration-device-identity/1.0.0",
      ...proof,
      createdAt,
      protection: useOperatingSystemProtection ? "operating_system" : "filesystem",
    };
    const privatePath = useOperatingSystemProtection ? protectedPrivatePath : filesystemPrivatePath;
    const privateBytes = useOperatingSystemProtection ? protection.encryptString(privateKeyPem) : privateKeyPem;
    await writeFile(privatePath, privateBytes, { flag: "wx", mode: 0o600 });
    await writeFile(metadataPath, JSON.stringify(stored, null, 2), { flag: "wx", mode: 0o600 });
    await Promise.all([chmod(this.options.identityDirectory, 0o700), chmod(privatePath, 0o600), chmod(metadataPath, 0o600)]);
    return { stored, privateKeyPem };
  }
}
