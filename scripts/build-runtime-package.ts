import { createHash, createPrivateKey, sign } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import {
  CALIBRATION_RUNTIME_PACKAGE_VERSION,
  calibrationRuntimePackageManifestSchema,
  canonicalRuntimeManifestBytes,
  type CalibrationRuntimePackageManifest,
} from "../src/server/calibrationRuntimePackage.js";
import { CALIBRATION_KERNEL_VERSION } from "../src/shared/types.js";

interface PackageDefinition {
  version: string;
  target: "win32-x64" | "darwin-arm64" | "linux-x64";
  minimumAppVersion: string;
  classification: "candidate" | "production";
  keyId: string;
  createdAt: string;
  rules: Array<{ prefix: string; licenseSpdx: string; licenseRef: string; sbomRef: string }>;
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`missing_argument:${name}`);
  return value;
}

function safeRootChild(root: string, path: string): string {
  const rootPath = resolve(root);
  const candidate = resolve(path);
  const fromRoot = relative(rootPath, candidate);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error("runtime_package_source_path_unsafe");
  return candidate;
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

async function main(): Promise<void> {
  const sourceRoot = resolve(argument("--source"));
  const definitionPath = safeRootChild(sourceRoot, join(sourceRoot, argument("--definition")));
  const output = resolve(argument("--output"));
  const privateKeyPath = resolve(argument("--private-key"));
  if (!output.toLowerCase().endsWith(".qhruntime")) throw new Error("runtime_package_output_extension_required");
  const definition = JSON.parse(await readFile(definitionPath, "utf8")) as PackageDefinition;
  const files: Array<{ absolutePath: string; archivePath: string; sizeBytes: number; permissions: number }> = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = safeRootChild(sourceRoot, join(directory, entry.name));
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink()) throw new Error("runtime_package_source_symlink_forbidden");
      if (info.isDirectory()) await walk(absolutePath);
      else if (info.isFile() && absolutePath !== definitionPath) {
        const archivePath = relative(sourceRoot, absolutePath).split(sep).join("/");
        files.push({
          absolutePath,
          archivePath,
          sizeBytes: info.size,
          permissions: process.platform === "win32"
            ? (/\.(?:exe|cmd|bat)$/i.test(archivePath) ? 0o755 : 0o644)
            : info.mode & 0o777,
        });
      }
      if (files.length > 1_023) throw new Error("runtime_package_source_entry_limit");
    }
  };
  await walk(sourceRoot);
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (totalBytes > 8 * 1024 ** 3) throw new Error("runtime_package_source_size_limit");
  const manifestFiles: CalibrationRuntimePackageManifest["files"] = [];
  for (const file of files.sort((left, right) => left.archivePath.localeCompare(right.archivePath))) {
    const rule = [...definition.rules]
      .sort((left, right) => right.prefix.length - left.prefix.length)
      .find((candidate) => file.archivePath.startsWith(candidate.prefix));
    if (!rule) throw new Error(`runtime_package_metadata_missing:${file.archivePath}`);
    manifestFiles.push({
      path: file.archivePath,
      sizeBytes: file.sizeBytes,
      sha256: await sha256File(file.absolutePath),
      permissions: file.permissions,
      licenseSpdx: rule.licenseSpdx,
      licenseRef: rule.licenseRef,
      sbomRef: rule.sbomRef,
    });
  }
  const unsigned = {
    schemaVersion: CALIBRATION_RUNTIME_PACKAGE_VERSION,
    version: definition.version,
    target: definition.target,
    kernelVersion: CALIBRATION_KERNEL_VERSION,
    minimumAppVersion: definition.minimumAppVersion,
    classification: definition.classification,
    keyId: definition.keyId,
    createdAt: definition.createdAt,
    files: manifestFiles,
    signatureAlgorithm: "Ed25519" as const,
    signature: "placeholder".repeat(10),
  } satisfies CalibrationRuntimePackageManifest;
  unsigned.signature = sign(
    null,
    canonicalRuntimeManifestBytes(unsigned),
    createPrivateKey(await readFile(privateKeyPath)),
  ).toString("base64");
  const manifest = calibrationRuntimePackageManifestSchema.parse(unsigned);
  const archive = new yazl.ZipFile();
  for (const file of files) archive.addFile(file.absolutePath, file.archivePath, { compress: false, mode: file.permissions });
  archive.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"), "manifest.json", { compress: false, mode: 0o644 });
  archive.end({ forceZip64Format: totalBytes > 4 * 1024 ** 3 });
  await pipeline(archive.outputStream, createWriteStream(output, { flags: "wx" }));
  const outputInfo = await stat(output);
  process.stdout.write(`${JSON.stringify({ output, bytes: outputInfo.size, files: files.length, target: manifest.target, classification: manifest.classification })}\n`);
}

await main();
