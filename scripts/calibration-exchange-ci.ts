import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { CalibrationExchangeService } from "../src/server/calibrationExchange.js";
import { autonomousCalibrationRun, autonomousCalibrationWorkloadProfile } from "../tests/fixtures/autonomousCalibrationRun.js";
import type { LocalCalibrationRun } from "../src/shared/types.js";

const PLATFORM_FIXTURES = {
  windows: {
    runId: "00000000-0000-4000-8000-000000000910",
    operatingSystem: "windows",
    operatingSystemVersion: "11",
    runtimePlatform: "win32",
    architecture: "x64",
    filesystem: "ntfs",
  },
  linux: {
    runId: "00000000-0000-4000-8000-000000000911",
    operatingSystem: "ubuntu",
    operatingSystemVersion: "24.04",
    runtimePlatform: "linux",
    architecture: "x64",
    filesystem: "ext4",
  },
  macos: {
    runId: "00000000-0000-4000-8000-000000000912",
    operatingSystem: "macos",
    operatingSystemVersion: "26",
    runtimePlatform: "darwin",
    architecture: "arm64",
    filesystem: "apfs",
  },
} as const;

type FixturePlatform = keyof typeof PLATFORM_FIXTURES;

function valueAfter(argumentsList: string[], flag: string): string | null {
  const index = argumentsList.indexOf(flag);
  return index >= 0 ? argumentsList[index + 1] ?? null : null;
}

function fixturePlatform(value: string | null): FixturePlatform {
  if (!value || !(value in PLATFORM_FIXTURES)) throw new Error("calibration_exchange_ci_platform_invalid");
  return value as FixturePlatform;
}

async function temporaryService(label: string): Promise<{ root: string; service: CalibrationExchangeService }> {
  const root = await mkdtemp(join(tmpdir(), `qual-hardware-exchange-ci-${label}-`));
  const fromTemporaryRoot = relative(resolve(tmpdir()), resolve(root));
  if (!fromTemporaryRoot || fromTemporaryRoot.startsWith("..") || dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith("qual-hardware-exchange-ci-")) {
    throw new Error("calibration_exchange_ci_temporary_root_invalid");
  }
  return {
    root,
    service: new CalibrationExchangeService({
      identityDirectory: join(root, "identity"),
      evidenceDirectory: join(root, "evidence"),
      appVersion: "ci-portability-fixture/1.0.0",
    }),
  };
}

async function removeTemporaryRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: false });
  await lstat(root).then(
    () => { throw new Error("calibration_exchange_ci_temporary_cleanup_incomplete"); },
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
}

function portableRun(platform: FixturePlatform): LocalCalibrationRun {
  const fixture = PLATFORM_FIXTURES[platform];
  const run = autonomousCalibrationRun({
    id: fixture.runId,
    hardwareTemplateId: `ci-portability-${platform}-unmapped`,
    capacity: 4,
  });
  run.developmentOnly = true;
  run.fingerprint.hostnameHash = `ci-${platform}`.padEnd(16, "0");
  run.fingerprint.cpuModel = `CI ${fixture.architecture} portability fixture`;
  run.fingerprint.cpuArchitecture = fixture.architecture;
  run.fingerprint.operatingSystem = fixture.operatingSystem;
  run.fingerprint.operatingSystemVersion = fixture.operatingSystemVersion;
  run.fingerprint.filesystem = fixture.filesystem;
  if (!run.runtimeProvenance) throw new Error("calibration_exchange_ci_runtime_provenance_missing");
  run.runtimeProvenance.platform = fixture.runtimePlatform;
  run.runtimeProvenance.architecture = fixture.architecture;
  run.overallSafeCameraCapacity = null;
  run.qualityGate = {
    eligibleForCapacityExtrapolation: false,
    evidenceLevel: "representative_only",
    validationStatus: "diagnostic",
    failures: ["ci_portability_fixture_not_physical"],
    warnings: [],
  };
  run.notes.push("CI portability fixture; never eligible for hardware purchase decisions.");
  return run;
}

async function generate(platform: FixturePlatform, outputInput: string | null): Promise<void> {
  if (!outputInput) throw new Error("calibration_exchange_ci_output_required");
  const output = resolve(outputInput);
  const context = await temporaryService(`generate-${platform}`);
  try {
    const exported = await context.service.exportRun(portableRun(platform), autonomousCalibrationWorkloadProfile());
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, exported.bytes, { flag: "wx", mode: 0o600 });
    process.stdout.write(`${JSON.stringify({
      schemaVersion: "qual-hardware-calibration-exchange-ci/1.0.0",
      action: "generated",
      platform,
      fileName: basename(output),
      packageDigest: exported.packageDigest,
      compressedBytes: exported.bytes.byteLength,
      developmentOnly: true,
    })}\n`);
  } finally {
    await removeTemporaryRoot(context.root);
  }
}

async function verifyDirectory(inputDirectoryValue: string | null): Promise<void> {
  if (!inputDirectoryValue) throw new Error("calibration_exchange_ci_input_required");
  const inputDirectory = resolve(inputDirectoryValue);
  const directoryInfo = await lstat(inputDirectory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error("calibration_exchange_ci_input_invalid");
  const expectedNames = Object.keys(PLATFORM_FIXTURES).map((platform) => `${platform}.qhcal`).sort();
  const actualNames = (await readdir(inputDirectory)).filter((name) => name.endsWith(".qhcal")).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) throw new Error("calibration_exchange_ci_inventory_invalid");
  const context = await temporaryService("verify");
  try {
    const packages = [];
    for (const platform of Object.keys(PLATFORM_FIXTURES) as FixturePlatform[]) {
      const path = join(inputDirectory, `${platform}.qhcal`);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) throw new Error(`calibration_exchange_ci_file_invalid:${platform}`);
      const parsed = await context.service.parseAny(await readFile(path));
      if (parsed.format !== "qhcal" || parsed.packages.length !== 1) throw new Error(`calibration_exchange_ci_format_invalid:${platform}`);
      const packageValue = parsed.packages[0]!;
      const fixture = PLATFORM_FIXTURES[platform];
      if (packageValue.run.id !== fixture.runId || packageValue.run.developmentOnly !== true ||
          packageValue.run.overallSafeCameraCapacity !== null ||
          packageValue.run.qualityGate?.eligibleForCapacityExtrapolation !== false ||
          packageValue.run.fingerprint.operatingSystem !== fixture.operatingSystem ||
          packageValue.run.runtimeProvenance?.platform !== fixture.runtimePlatform) {
        throw new Error(`calibration_exchange_ci_payload_invalid:${platform}`);
      }
      packages.push(packageValue);
    }
    if (new Set(packages.map((item) => item.device.id)).size !== 3) throw new Error("calibration_exchange_ci_producer_identity_collision");
    const collection = await context.service.exportCollection(packages);
    const consolidated = context.service.parseQhcalSet(collection.bytes);
    if (consolidated.packages.length !== 3 || new Set(consolidated.packageDigests).size !== 3) {
      throw new Error("calibration_exchange_ci_collection_invalid");
    }
    process.stdout.write(`${JSON.stringify({
      schemaVersion: "qual-hardware-calibration-exchange-ci/1.0.0",
      action: "verified",
      receiverPlatform: process.platform,
      receiverArchitecture: process.arch,
      packages: packages.length,
      producerIdentities: new Set(packages.map((item) => item.device.id)).size,
      collectionDigest: collection.packageDigest,
      temporaryCleanup: { completed: true },
    })}\n`);
  } finally {
    await removeTemporaryRoot(context.root);
  }
}

async function selfTest(): Promise<void> {
  const matrixRoot = await mkdtemp(join(tmpdir(), "qual-hardware-exchange-ci-self-test-"));
  try {
    for (const platform of Object.keys(PLATFORM_FIXTURES) as FixturePlatform[]) {
      await generate(platform, join(matrixRoot, `${platform}.qhcal`));
    }
    await verifyDirectory(matrixRoot);
  } finally {
    await removeTemporaryRoot(matrixRoot);
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "qual-hardware-calibration-exchange-ci/1.0.0",
    action: "self-test-completed",
    packages: Object.keys(PLATFORM_FIXTURES).length,
    temporaryCleanup: { completed: true, remainingBytes: 0 },
  })}\n`);
}

const argumentsList = process.argv.slice(2);
const command = argumentsList[0];
if (!command || command === "self-test") {
  await selfTest();
} else if (command === "generate") {
  await generate(fixturePlatform(valueAfter(argumentsList, "--platform")), valueAfter(argumentsList, "--output"));
} else if (command === "verify") {
  await verifyDirectory(valueAfter(argumentsList, "--input"));
} else {
  throw new Error("Usage: calibration:exchange:ci -- self-test | generate --platform windows|linux|macos --output PATH | verify --input DIRECTORY");
}
