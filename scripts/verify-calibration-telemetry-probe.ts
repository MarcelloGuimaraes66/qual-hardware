import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  hashCalibrationRepositorySource,
  parseCalibrationAssetSourceLock,
} from "../src/server/calibrationAssetSources.js";
import { sha256File, type SupportedRuntimeTarget } from "../src/server/calibrationRuntime.js";
import { parseApprovedTelemetryProbe } from "../src/server/calibrationTelemetry.js";

const execFileAsync = promisify(execFile);
const REQUIRED_GO_TOOLCHAIN = "go1.26.5";
const repositoryRoot = resolve(process.cwd());
const sourceDirectory = join(repositoryRoot, "tools/telemetry-probe");
const targets: Array<{
  target: SupportedRuntimeTarget;
  goos: "darwin" | "linux" | "windows";
  goarch: "arm64" | "amd64";
  fileName: string;
  magic: Buffer;
}> = [
  { target: "darwin-arm64", goos: "darwin", goarch: "arm64", fileName: "telemetry-probe", magic: Buffer.from([0xcf, 0xfa, 0xed, 0xfe]) },
  { target: "win32-x64", goos: "windows", goarch: "amd64", fileName: "telemetry-probe.exe", magic: Buffer.from("MZ") },
  { target: "linux-x64", goos: "linux", goarch: "amd64", fileName: "telemetry-probe", magic: Buffer.from([0x7f, 0x45, 0x4c, 0x46]) },
];

function hostTarget(): SupportedRuntimeTarget | null {
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64";
  if (process.platform === "win32" && process.arch === "x64") return "win32-x64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64";
  return null;
}

async function build(target: typeof targets[number], outputPath: string): Promise<void> {
  await execFileAsync("go", [
    "build",
    "-trimpath",
    "-buildvcs=false",
    "-ldflags=-s -w -buildid=",
    "-o",
    outputPath,
    ".",
  ], {
    cwd: sourceDirectory,
    env: {
      ...process.env,
      CGO_ENABLED: "0",
      GOOS: target.goos,
      GOARCH: target.goarch,
      GOTOOLCHAIN: "local",
      GOPROXY: "off",
    },
    timeout: 120_000,
    maxBuffer: 1_000_000,
    windowsHide: true,
  });
}

const sourceLock = parseCalibrationAssetSourceLock(JSON.parse(
  await readFile(join(repositoryRoot, "resources/calibration/asset-sources.lock.json"), "utf8"),
));
const sourceDefinition = sourceLock.assets.find((asset) => asset.id === "telemetry-probe");
if (!sourceDefinition) throw new Error("telemetry_probe_source_lock_missing");
const sourceDigest = await hashCalibrationRepositorySource(repositoryRoot, "tools/telemetry-probe");
for (const target of targets) {
  const locked = sourceDefinition.targets[target.target];
  if (locked.sourceKind !== "repository_source" || locked.repositoryPath !== "tools/telemetry-probe" ||
      locked.sha256 !== sourceDigest.sha256 || locked.sizeBytes !== sourceDigest.sizeBytes) {
    throw new Error(`telemetry_probe_source_lock_mismatch:${target.target}`);
  }
}

const goVersionResult = await execFileAsync("go", ["env", "GOVERSION"], {
  env: { ...process.env, GOTOOLCHAIN: "local", GOPROXY: "off" },
  timeout: 10_000,
  maxBuffer: 100_000,
  windowsHide: true,
});
const goVersion = goVersionResult.stdout.trim();
if (goVersion !== REQUIRED_GO_TOOLCHAIN) {
  throw new Error(`telemetry_probe_go_toolchain_mismatch:${goVersion}:${REQUIRED_GO_TOOLCHAIN}`);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "qual-hardware-telemetry-verify-"));
const relativeTemporaryRoot = relative(resolve(tmpdir()), resolve(temporaryRoot));
if (!relativeTemporaryRoot || relativeTemporaryRoot.startsWith("..") || dirname(resolve(temporaryRoot)) !== resolve(tmpdir()) ||
    !basename(temporaryRoot).startsWith("qual-hardware-telemetry-verify-")) {
  throw new Error("telemetry_probe_temporary_root_invalid");
}

const targetReports: Array<{
  target: SupportedRuntimeTarget;
  sha256: string;
  sizeBytes: number;
  reproducible: true;
  executableFormatVerified: true;
}> = [];
let localExecution: null | {
  target: SupportedRuntimeTarget;
  version: string;
  contractAccepted: true;
  thermalEvidence: "measured" | "partial" | "unavailable";
} = null;
try {
  const firstRoot = join(temporaryRoot, "first");
  const secondRoot = join(temporaryRoot, "second");
  await mkdir(firstRoot);
  await mkdir(secondRoot);
  for (const target of targets) {
    const firstPath = join(firstRoot, `${target.target}-${target.fileName}`);
    const secondPath = join(secondRoot, `${target.target}-${target.fileName}`);
    await build(target, firstPath);
    await build(target, secondPath);
    const [firstHash, secondHash, fileInfo, header] = await Promise.all([
      sha256File(firstPath),
      sha256File(secondPath),
      stat(firstPath),
      readFile(firstPath).then((bytes) => bytes.subarray(0, target.magic.length)),
    ]);
    if (firstHash !== secondHash) throw new Error(`telemetry_probe_build_not_reproducible:${target.target}`);
    if (!header.equals(target.magic)) throw new Error(`telemetry_probe_executable_format_invalid:${target.target}`);
    targetReports.push({
      target: target.target,
      sha256: firstHash,
      sizeBytes: fileInfo.size,
      reproducible: true,
      executableFormatVerified: true,
    });
    if (target.target === hostTarget()) {
      const [versionResult, payloadResult] = await Promise.all([
        execFileAsync(firstPath, ["--version"], { timeout: 10_000, maxBuffer: 100_000, windowsHide: true }),
        execFileAsync(firstPath, ["--format", "json"], { timeout: 10_000, maxBuffer: 1_000_000, windowsHide: true }),
      ]);
      const version = versionResult.stdout.trim();
      if (version !== "0.1.0") throw new Error(`telemetry_probe_version_invalid:${version}`);
      const accepted = parseApprovedTelemetryProbe(payloadResult.stdout);
      if (!accepted?.probeThermalEvidence) throw new Error("telemetry_probe_local_contract_rejected");
      localExecution = {
        target: target.target,
        version,
        contractAccepted: true,
        thermalEvidence: accepted.probeThermalEvidence,
      };
    }
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: false });
}
await access(temporaryRoot).then(
  () => { throw new Error("telemetry_probe_temporary_cleanup_incomplete"); },
  () => undefined,
);

process.stdout.write(`${JSON.stringify({
  schemaVersion: "qual-hardware-telemetry-build-verification/1.0.0",
  verifiedAt: new Date().toISOString(),
  goVersion,
  sourceDigest,
  targets: targetReports,
  localExecution,
  temporaryCleanup: { completed: true, remainingBytes: 0 },
}, null, 2)}\n`);
