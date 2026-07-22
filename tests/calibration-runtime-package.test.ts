import { generateKeyPairSync, sign } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import { afterEach, describe, expect, it } from "vitest";
import {
  CALIBRATION_RUNTIME_PACKAGE_VERSION,
  CalibrationRuntimePackageManager,
  canonicalRuntimeManifestBytes,
  type CalibrationRuntimePackageManifest,
} from "../src/server/calibrationRuntimePackage.js";
import { CALIBRATION_KERNEL_VERSION } from "../src/shared/types.js";
import { createHash } from "node:crypto";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function localTarget(): "win32-x64" | "darwin-arm64" | "linux-x64" {
  if (process.platform === "win32" && process.arch === "x64") return "win32-x64";
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64";
  return "linux-x64";
}

async function makePackage(input: {
  root: string;
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  keyId: string;
  classification: "candidate" | "production";
  target?: "win32-x64" | "darwin-arm64" | "linux-x64";
  version?: string;
  tamperSignature?: boolean;
}): Promise<string> {
  const payloads = new Map<string, Buffer>([
    ["licenses/runtime.txt", Buffer.from("Fixture runtime license", "utf8")],
    ["sbom/runtime.cdx.json", Buffer.from('{"bomFormat":"CycloneDX","specVersion":"1.6"}', "utf8")],
    ["resources/calibration/runtime.bin", Buffer.from(`runtime-${input.version ?? "1.0.0"}`, "utf8")],
  ]);
  const files = [...payloads].map(([path, bytes]) => ({
    path,
    sizeBytes: bytes.byteLength,
    sha256: digest(bytes),
    permissions: path.endsWith(".bin") ? 0o755 : 0o644,
    licenseSpdx: "MIT",
    licenseRef: "licenses/runtime.txt",
    sbomRef: "sbom/runtime.cdx.json",
  }));
  const unsigned = {
    schemaVersion: CALIBRATION_RUNTIME_PACKAGE_VERSION,
    version: input.version ?? "1.0.0",
    target: input.target ?? localTarget(),
    kernelVersion: CALIBRATION_KERNEL_VERSION,
    minimumAppVersion: "0.3.0",
    classification: input.classification,
    keyId: input.keyId,
    createdAt: "2026-07-22T12:00:00.000Z",
    files,
    signatureAlgorithm: "Ed25519" as const,
    signature: "placeholder".repeat(10),
  } satisfies CalibrationRuntimePackageManifest;
  unsigned.signature = sign(null, canonicalRuntimeManifestBytes(unsigned), input.privateKey).toString("base64");
  if (input.tamperSignature) unsigned.signature = `${unsigned.signature.slice(0, -2)}AA`;
  const path = join(input.root, `${input.version ?? "1.0.0"}.qhruntime`);
  const archive = new yazl.ZipFile();
  payloads.forEach((bytes, name) => archive.addBuffer(bytes, name, { compress: false }));
  archive.addBuffer(Buffer.from(`${JSON.stringify(unsigned, null, 2)}\n`, "utf8"), "manifest.json", { compress: false });
  archive.end();
  await pipeline(archive.outputStream, createWriteStream(path, { flags: "wx" }));
  return path;
}

describe("signed calibration runtime package", () => {
  it("installs a candidate atomically but keeps commercial qualification blocked", async () => {
    const root = await mkdtemp(join(tmpdir(), "qh-runtime-candidate-"));
    roots.push(root);
    const pair = generateKeyPairSync("ed25519");
    const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const packagePath = await makePackage({ root, privateKey: pair.privateKey, keyId: "candidate-test", classification: "candidate" });
    const manager = new CalibrationRuntimePackageManager({
      root: join(root, "installed"), appVersion: "0.3.0",
      trustedKeys: { "candidate-test": publicKeyPem }, productionKeyIds: new Set(),
    });
    const installation = await manager.installFile(packagePath);
    expect(installation).toMatchObject({ state: "completed", error: null });
    expect(await manager.activeResourceRoot()).toContain(installation.manifestHash);
    expect(await readFile(join((await manager.activeResourceRoot())!, "resources/calibration/runtime.bin"), "utf8")).toBe("runtime-1.0.0");
    expect(await manager.status()).toMatchObject({ qualificationAllowed: false, active: { classification: "candidate" } });
  });

  it("requires the trusted production key and swaps active/previous during rollback", async () => {
    const root = await mkdtemp(join(tmpdir(), "qh-runtime-production-"));
    roots.push(root);
    const pair = generateKeyPairSync("ed25519");
    const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const manager = new CalibrationRuntimePackageManager({
      root: join(root, "installed"), appVersion: "0.3.0",
      trustedKeys: { "production-test": publicKeyPem }, productionKeyIds: new Set(["production-test"]),
    });
    const first = await manager.installFile(await makePackage({ root, privateKey: pair.privateKey, keyId: "production-test", classification: "production", version: "1.0.0" }));
    const second = await manager.installFile(await makePackage({ root, privateKey: pair.privateKey, keyId: "production-test", classification: "production", version: "1.0.1" }));
    expect(await manager.status()).toMatchObject({ qualificationAllowed: true, active: { manifestHash: second.manifestHash }, previous: { manifestHash: first.manifestHash } });
    expect(await manager.rollback()).toMatchObject({ active: { manifestHash: first.manifestHash }, previous: { manifestHash: second.manifestHash } });
  });

  it("fails closed for an invalid signature or another platform target", async () => {
    const root = await mkdtemp(join(tmpdir(), "qh-runtime-invalid-"));
    roots.push(root);
    const pair = generateKeyPairSync("ed25519");
    const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const manager = new CalibrationRuntimePackageManager({
      root: join(root, "installed"), appVersion: "0.3.0",
      trustedKeys: { "production-test": publicKeyPem }, productionKeyIds: new Set(["production-test"]),
    });
    const invalid = await manager.installFile(await makePackage({ root, privateKey: pair.privateKey, keyId: "production-test", classification: "production", tamperSignature: true }));
    expect(invalid).toMatchObject({ state: "failed", error: "runtime_package_signature_invalid" });
    const wrongTarget = localTarget() === "linux-x64" ? "win32-x64" : "linux-x64";
    const incompatible = await manager.installFile(await makePackage({ root, privateKey: pair.privateKey, keyId: "production-test", classification: "production", target: wrongTarget, version: "1.0.1" }));
    expect(incompatible).toMatchObject({ state: "failed", error: "runtime_package_target_mismatch" });
  });

  it("reverifies the active installation and rejects post-install tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "qh-runtime-tamper-"));
    roots.push(root);
    const pair = generateKeyPairSync("ed25519");
    const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const manager = new CalibrationRuntimePackageManager({
      root: join(root, "installed"), appVersion: "0.3.0",
      trustedKeys: { "production-test": publicKeyPem }, productionKeyIds: new Set(["production-test"]),
    });
    const installed = await manager.installFile(await makePackage({ root, privateKey: pair.privateKey, keyId: "production-test", classification: "production" }));
    const active = await manager.activeResourceRoot();
    expect(installed.state).toBe("completed");
    await writeFile(join(active!, "resources/calibration/runtime.bin"), "tampered", "utf8");
    expect(await manager.activeResourceRoot()).toBeNull();
    expect(await manager.status()).toMatchObject({ qualificationAllowed: false, active: null, reasons: ["runtime_installation_invalid"] });
  });

  it("allows only one runtime installation selector at a time", async () => {
    const root = await mkdtemp(join(tmpdir(), "qh-runtime-concurrent-"));
    roots.push(root);
    let resolveSelection!: (value: string | null) => void;
    const selection = new Promise<string | null>((resolve) => { resolveSelection = resolve; });
    const manager = new CalibrationRuntimePackageManager({
      root: join(root, "installed"), appVersion: "0.3.0", trustedKeys: {}, productionKeyIds: new Set(),
      selectPackage: () => selection,
    });
    const id = manager.requestInstall();
    expect(() => manager.requestInstall()).toThrow("runtime_installation_already_in_progress");
    resolveSelection(null);
    await selection;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(manager.installation(id)?.state).toBe("cancelled");
  });
});
