import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createCalibrationPlan } from "../src/engine/calibration.js";
import { createDefaultScenario } from "../src/shared/schemas.js";
import type { CalibrationHardwarePreflight, CalibrationRuntimeStatus } from "../src/shared/types.js";
import {
  CALIBRATION_PIPELINE_CONTRACT_VERSION,
  CALIBRATION_NETWORK_RESERVE_PERCENT,
  allocateCalibrationCameraGroups,
  estimateCalibrationMediaRingBytes,
  evaluateCalibrationNetworkCapacity,
  OfflineCalibrationPipeline,
} from "../src/server/calibrationPipeline.js";
import {
  cleanupCalibrationWorkspace,
  createCalibrationWorkspace,
  prepareCalibrationTemporaryFile,
  refreshRegisteredCalibrationTemporaryFiles,
} from "../src/server/calibrationTemporaryFiles.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

function status(assets: CalibrationRuntimeStatus["assets"] = []): CalibrationRuntimeStatus {
  return {
    schemaVersion: "qual-hardware-calibration-runtime-status/1.0.0",
    kernelVersion: "qual-hardware-calibration-kernel/1.0.0",
    authorityCommit: "d918faa0ecd6a9906b711039e5d89f78e0536c44",
    platform: process.platform,
    architecture: process.arch,
    featureMode: "diagnostic",
    manifestApproved: false,
    runtimeAssetsVerified: false,
    readyForQuickTest: true,
    readyForFullQualification: false,
    manifestHash: "a".repeat(64),
    contracts: [],
    assets,
    reasons: [],
  };
}

async function executable(name: string): Promise<string | null> {
  for (const root of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(root, process.platform === "win32" ? `${name}.exe` : name);
    try { await access(candidate); return candidate; } catch { /* Continue. */ }
  }
  return null;
}

async function fixture(
  runtimeStatus: CalibrationRuntimeStatus,
  plan = createCalibrationPlan(createDefaultScenario(4), "quick"),
  advancedTelemetry = false,
  diskStatus?: () => Promise<{ totalBytes: number; freeBytes: number; reserveBytes: number; projectedPeakBytes: number; canStart: boolean }>,
  hardware?: CalibrationHardwarePreflight,
  onChildProcess?: (event: { action: "started" | "stopped"; pid: number; kind: "ffmpeg" | "ffprobe" | "mediamtx" | "llama-server" }) => void,
) {
  const root = await mkdtemp(join(tmpdir(), "qual-hardware-pipeline-test-"));
  temporaryRoots.push(root);
  const sessionId = randomUUID();
  const workspace = await createCalibrationWorkspace({ root, sessionId, runId: randomUUID(), appVersion: "test" });
  const databasePath = await prepareCalibrationTemporaryFile(workspace, "pipeline.sqlite");
  const database = new DatabaseSync(databasePath);
  const pipeline = new OfflineCalibrationPipeline({
    workspace,
    database,
    workloadProfile: plan.workloadProfile,
    runtimeStatus,
    ...(hardware ? { hardware } : {}),
    advancedTelemetry,
    timeScale: 0.001,
    cancelled: () => false,
    ...(onChildProcess ? { onChildProcess } : {}),
    ...(diskStatus ? { diskStatus, diskCheckIntervalMs: 5 } : {}),
  });
  return { root, sessionId, workspace, database, pipeline };
}

describe("offline Perceptrum-equivalent calibration pipeline", () => {
  it("keeps every active kernel module independent from Perceptrum and external providers", async () => {
    const modules = [
      "calibrationKernelService.ts", "calibrationKernelWorker.ts", "calibrationKernelProtocol.ts",
      "calibrationHardware.ts", "calibrationPipeline.ts",
      "calibrationQualification.ts", "calibrationRuntime.ts", "calibrationTelemetry.ts", "calibrationTemporaryFiles.ts",
    ];
    const source = (await Promise.all(modules.map((file) =>
      readFile(join(import.meta.dirname, "..", "src", "server", file), "utf8")))).join("\n");
    for (const forbidden of ["perceptrum://", "127.0.0.1:4000", "api.openai.com", "shell.openExternal", "https://"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("pins the golden pipeline contract to the immutable Perceptrum authority", async () => {
    const contract = JSON.parse(await readFile(join(import.meta.dirname, "..", "contracts", "calibration-pipeline-contract-v1.json"), "utf8")) as {
      schemaVersion: string;
      authority: { commit: string };
      jobRuntime: { requiredTables: string[] };
      intelligenceRuntime: { requiredTables: string[] };
    };
    expect(contract.schemaVersion).toBe(CALIBRATION_PIPELINE_CONTRACT_VERSION);
    expect(contract.authority.commit).toBe("d918faa0ecd6a9906b711039e5d89f78e0536c44");
    expect(contract.jobRuntime.requiredTables).toEqual(expect.arrayContaining(["job_runs", "job_step_runs", "camera_agent_run_results"]));
    expect(contract.intelligenceRuntime.requiredTables).toEqual(expect.arrayContaining(["intelligence_jobs", "intelligence_observations", "intelligence_audit_logs"]));
  });

  it("allocates every tier across canonical camera-group proportions without losing a camera", () => {
    const scenario = createDefaultScenario(10);
    scenario.cameraGroups = [
      { ...scenario.cameraGroups[0]!, id: randomUUID(), name: "majority", count: 7 },
      { ...structuredClone(scenario.cameraGroups[0]!), id: randomUUID(), name: "minority", count: 3, source: { ...scenario.cameraGroups[0]!.source, codec: "h265" } },
    ];
    const profile = createCalibrationPlan(scenario, "quick").workloadProfile;
    const allocation = allocateCalibrationCameraGroups(profile, 4);
    expect(allocation.reduce((sum, count) => sum + count, 0)).toBe(4);
    expect([...allocation].sort((left, right) => left - right)).toEqual([1, 3]);
    expect(allocateCalibrationCameraGroups(profile, 4_096).reduce((sum, count) => sum + count, 0)).toBe(4_096);
  });

  it("applies a 20% reserve to a verified full-duplex physical network specification", () => {
    const profile = createCalibrationPlan(createDefaultScenario(100), "quick").workloadProfile;
    const expectedIngress = profile.cameraGroups.reduce((sum, group) => sum + group.bitrateMbps * 100, 0);
    const passing = evaluateCalibrationNetworkCapacity(profile, 100, [
      { name: "ethernet", speedMbps: expectedIngress / 0.8, duplex: "full", physicalLinkVerified: true },
    ]);
    expect(CALIBRATION_NETWORK_RESERVE_PERCENT).toBe(20);
    expect(passing.requiredIngressMbps).toBeCloseTo(expectedIngress);
    expect(passing.usableCapacityMbps).toBeCloseTo(expectedIngress);
    expect(passing.verified).toBe(true);
    const unverified = evaluateCalibrationNetworkCapacity(profile, 100, [
      { name: "wifi", speedMbps: 10_000, duplex: "unknown", physicalLinkVerified: true },
    ]);
    expect(unverified.physicalCapacityMbps).toBeNull();
    expect(unverified.verified).toBe(false);
  });

  it("bounds temporary media storage with a circular window instead of the full phase duration", () => {
    const profile = createCalibrationPlan(createDefaultScenario(4_096), "full").workloadProfile;
    const twoSeconds = estimateCalibrationMediaRingBytes(profile, 4_096, 2);
    const twentyMinutes = estimateCalibrationMediaRingBytes(profile, 4_096, 1_200);
    expect(twentyMinutes).toBe(twoSeconds);
    expect(twentyMinutes).toBeGreaterThan(0);
    expect(twentyMinutes).toBeLessThan(20 * 1024 ** 3);
  });

  it("executes Jobs, Steps, Agents, Intelligence and dashboard load in an isolated SQLite database", async () => {
    const item = await fixture(status());
    const summary = await item.pipeline.initialize();
    const result = await item.pipeline.executePhase({ phase: "sustained", tier: 4, durationSeconds: 1 });
    expect(summary.contractVersion).toBe(CALIBRATION_PIPELINE_CONTRACT_VERSION);
    expect(summary.mediaAvailable).toBe(false);
    expect(result.databaseOperations).toBeGreaterThan(0);
    expect(result.dashboardQueries).toBe(result.databaseOperations * 8);
    expect(result.completedJobRuns).toBe(result.databaseOperations);
    expect(result.completedStepRuns).toBe(result.databaseOperations);
    expect(result.completedIntelligenceJobs).toBe(result.databaseOperations);
    expect(result.processedCameraCount).toBe(4);
    expect(result.queueGrowthPerMinute).toBeGreaterThan(0);
    expect(result.measuredStages).toEqual(expect.arrayContaining([
      "job_scheduler", "intelligence_scheduler", "database_persistence", "dashboard_queries", "memory_bandwidth",
    ]));
    expect(result.failures).toContain("local_aiq_qwen_unavailable");
    expect((item.database.prepare("SELECT COUNT(*) AS count FROM job_runs WHERE status='completed'").get() as { count: number }).count)
      .toBe(result.completedJobRuns);
    expect((item.database.prepare("SELECT COUNT(*) AS count FROM intelligence_jobs WHERE status='completed' AND progress=100").get() as { count: number }).count)
      .toBe(result.completedIntelligenceJobs);
    await item.pipeline.close();
    item.database.close();
    await refreshRegisteredCalibrationTemporaryFiles(item.root, item.sessionId);
    await expect(cleanupCalibrationWorkspace(item.root, item.sessionId)).resolves.toMatchObject({ bytesRemoved: expect.any(Number) });
  });

  it("accepts thermal guardrail evidence only from a verified packaged telemetry probe", async () => {
    if (process.platform === "win32") return;
    const assetRoot = await mkdtemp(join(tmpdir(), "qual-hardware-telemetry-test-"));
    temporaryRoots.push(assetRoot);
    const probePath = join(assetRoot, "telemetry-probe.cjs");
    await writeFile(probePath, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  schemaVersion: "qual-hardware-telemetry-probe/1.0.0",
  probeVersion: "0.1.0",
  platform: process.platform === "win32" ? "windows" : process.platform,
  architecture: process.arch === "x64" ? "amd64" : process.arch,
  capturedAt: new Date().toISOString(),
  quality: { thermalThrottling: "measured", cpuThermal: "measured", gpuThermal: "measured", sources: ["fixture"] },
  gpuUtilizationPercent: 47,
  gpuMemoryUsedBytes: 1048576,
  gpuTemperatureCelsius: 62,
  thermalThrottlePercent: 0,
  warnings: [],
}));
`, "utf8");
    await chmod(probePath, 0o755);
    const item = await fixture(status([{
      id: "telemetry-probe", status: "verified", path: probePath, sha256: "e".repeat(64), sizeBytes: 1,
      expectedSizeBytes: 1, version: "test", licenseSpdx: "MIT", sbomRef: "fixture",
    }]), undefined, true);
    await item.pipeline.initialize();
    const result = await item.pipeline.executePhase({ phase: "sustained", tier: 1, durationSeconds: 1 });
    expect(result.hardwareTelemetry.provider).toBe("approved-telemetry-probe");
    expect(result.hardwareTelemetry.gpuUtilizationPercent?.peak).toBe(47);
    expect(result.hardwareTelemetry.thermalThrottlePercent?.peak).toBe(0);
    expect(result.measuredStages).toContain("thermal_sustain");
    await item.pipeline.close();
    item.database.close();
    await refreshRegisteredCalibrationTemporaryFiles(item.root, item.sessionId);
    await cleanupCalibrationWorkspace(item.root, item.sessionId);
  });

  it("applies configured concurrent Jobs, grouped Steps, Intelligence streams and dashboard readers", async () => {
    const scenario = createDefaultScenario(4);
    scenario.concurrentWorkloads = {
      activeJobs: 2,
      groupedJobCameras: 4,
      intelligenceStreams: 3,
      concurrentChatSessions: 2,
      activeSearches: 1,
    };
    const item = await fixture(status(), createCalibrationPlan(scenario, "quick"));
    await item.pipeline.initialize();
    const result = await item.pipeline.executePhase({ phase: "sustained", tier: 4, durationSeconds: 1 });
    expect(result.completedJobRuns).toBe(result.databaseOperations * 2);
    expect(result.completedStepRuns).toBe(result.databaseOperations * 2 * 4);
    expect(result.completedIntelligenceJobs).toBe(result.databaseOperations * 3);
    expect(result.dashboardQueries).toBe(result.databaseOperations * 3 * 8);
    await item.pipeline.close();
    item.database.close();
    await refreshRegisteredCalibrationTemporaryFiles(item.root, item.sessionId);
    await cleanupCalibrationWorkspace(item.root, item.sessionId);
  });

  it("runs a real synthetic decode, BGR conversion, encode and frame extraction when local FFmpeg is available", async () => {
    const ffmpeg = await executable("ffmpeg");
    const ffprobe = await executable("ffprobe");
    if (!ffmpeg || !ffprobe) return;
    const asset = (id: string, path: string): CalibrationRuntimeStatus["assets"][number] => ({
      id, status: "system_only", path, sha256: "b".repeat(64), sizeBytes: 1,
      expectedSizeBytes: null, version: null, licenseSpdx: null, sbomRef: null,
    });
    const item = await fixture(status([asset("ffmpeg", ffmpeg), asset("ffprobe", ffprobe)]));
    const summary = await item.pipeline.initialize();
    expect(summary.mediaAvailable).toBe(true);
    expect(summary.rtspAvailable).toBe(false);
    const result = await item.pipeline.executePhase({ phase: "warmup", tier: 4, durationSeconds: 1 });
    expect(result.framesDecoded).toBeGreaterThan(0);
    expect(result.framesEncoded).toBeGreaterThan(0);
    expect(result.framesExtracted).toBe(1);
    expect(result.actualConcurrentMediaPipelines).toBe(4);
    expect(result.exactCameraConcurrency).toBe(true);
    expect(result.measuredStages).toEqual(expect.arrayContaining([
      "video_decode", "bgr_processing", "video_encode", "disk_read", "disk_write", "frame_extraction",
    ]));
    await item.pipeline.close();
    item.database.close();
    await refreshRegisteredCalibrationTemporaryFiles(item.root, item.sessionId);
    await cleanupCalibrationWorkspace(item.root, item.sessionId);
  }, 30_000);

  it("runs the physical Apple GPU media lane when VideoToolbox is available", async () => {
    if (process.platform !== "darwin") return;
    const ffmpeg = await executable("ffmpeg");
    const ffprobe = await executable("ffprobe");
    if (!ffmpeg || !ffprobe) return;
    const asset = (id: string, path: string): CalibrationRuntimeStatus["assets"][number] => ({
      id, status: "system_only", path, sha256: "b".repeat(64), sizeBytes: 1,
      expectedSizeBytes: null, version: null, licenseSpdx: null, sbomRef: null,
    });
    const hardware = {
      schemaVersion: "qual-hardware-calibration-hardware/1.0.0" as const,
      detectedAt: new Date().toISOString(), cpuModel: "Apple test CPU", cpuArchitecture: process.arch,
      physicalCores: 4, logicalCores: 8, gpuModel: "Apple test GPU", gpuDriver: "macOS",
      gpuArchitecture: "Apple GPU", gpuCount: 1, gpuVramBytes: null, ramBytes: 32 * 1024 ** 3,
      operatingSystem: "macos" as const, operatingSystemVersion: "test", formFactor: "workstation" as const,
      networkLinks: [],
    };
    const item = await fixture(status([asset("ffmpeg", ffmpeg), asset("ffprobe", ffprobe)]), undefined, false, undefined, hardware);
    const summary = await item.pipeline.initialize();
    if (!summary.gpuMediaAvailable) {
      await item.pipeline.close();
      item.database.close();
      await refreshRegisteredCalibrationTemporaryFiles(item.root, item.sessionId);
      await cleanupCalibrationWorkspace(item.root, item.sessionId);
      return;
    }
    const result = await item.pipeline.executePhase({ phase: "warmup", tier: 1, durationSeconds: 1, computeMode: "gpu_accelerated" });
    expect(summary.gpuMediaBackend).toBe("videotoolbox");
    expect(result.framesDecoded).toBeGreaterThan(0);
    expect(result.framesEncoded).toBeGreaterThan(0);
    expect(result.gpuMediaMeasured).toBe(true);
    await item.pipeline.close();
    item.database.close();
    await refreshRegisteredCalibrationTemporaryFiles(item.root, item.sessionId);
    await cleanupCalibrationWorkspace(item.root, item.sessionId);
  }, 30_000);

  it("sends only synthetic frames to a verified loopback llama-server contract", async () => {
    if (process.platform === "win32") return;
    const ffmpeg = await executable("ffmpeg");
    const ffprobe = await executable("ffprobe");
    if (!ffmpeg || !ffprobe) return;
    const assetRoot = await mkdtemp(join(tmpdir(), "qual-hardware-llama-test-"));
    temporaryRoots.push(assetRoot);
    const serverPath = join(assetRoot, "fake-llama-server.cjs");
    const modelPath = join(assetRoot, "core.gguf");
    const mmprojPath = join(assetRoot, "core-mmproj.gguf");
    await writeFile(serverPath, `#!/usr/bin/env node
const http = require("node:http");
const args = process.argv.slice(2);
if (args.includes("--list-devices")) {
  process.stdout.write("Metal0: Apple test GPU\\nCUDA0: NVIDIA GeForce RTX 5090\\n");
  process.exit(0);
}
const port = Number(args[args.indexOf("--port") + 1]);
const server = http.createServer((request, response) => {
  if (request.url === "/health") { response.writeHead(200); response.end("ok"); return; }
  let body = "";
  request.on("data", chunk => { body += chunk; });
  request.on("end", () => {
    const payload = JSON.parse(body);
    const image = payload.messages[0].content.find(item => item.type === "image_url");
    if (!String(image.image_url.url).startsWith("data:image/x-portable-pixmap;base64,")) {
      response.writeHead(400); response.end("invalid image"); return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "synthetic test frame" } }] }));
  });
});
server.listen(port, "127.0.0.1");
`, "utf8");
    await chmod(serverPath, 0o755);
    await writeFile(modelPath, "verified-model-fixture", "utf8");
    await writeFile(mmprojPath, "verified-mmproj-fixture", "utf8");
    const asset = (id: string, path: string, assetStatus: "verified" | "system_only"): CalibrationRuntimeStatus["assets"][number] => ({
      id, status: assetStatus, path, sha256: "c".repeat(64), sizeBytes: 1,
      expectedSizeBytes: 1, version: "test", licenseSpdx: "MIT", sbomRef: "test",
    });
    let activeLlamaServers = 0;
    let maximumActiveLlamaServers = 0;
    const item = await fixture(status([
      asset("ffmpeg", ffmpeg, "system_only"),
      asset("ffprobe", ffprobe, "system_only"),
      asset("llama-server", serverPath, "verified"),
      asset("qwen-core-gguf", modelPath, "verified"),
      asset("qwen-core-mmproj", mmprojPath, "verified"),
    ]), undefined, false, undefined, {
      schemaVersion: "qual-hardware-calibration-hardware/1.0.0",
      detectedAt: new Date().toISOString(), cpuModel: "test CPU", cpuArchitecture: process.arch,
      physicalCores: 4, logicalCores: 8, gpuModel: process.platform === "darwin" ? "Apple test GPU" : "NVIDIA GeForce RTX 5090",
      gpuDriver: "test", gpuArchitecture: process.platform === "darwin" ? "Apple GPU" : "NVIDIA CUDA",
      gpuCount: 1, gpuVramBytes: 32 * 1024 ** 3, ramBytes: 64 * 1024 ** 3,
      operatingSystem: process.platform === "darwin" ? "macos" : "ubuntu",
      operatingSystemVersion: "test", formFactor: "workstation", networkLinks: [],
    }, (event) => {
      if (event.kind !== "llama-server") return;
      activeLlamaServers += event.action === "started" ? 1 : -1;
      maximumActiveLlamaServers = Math.max(maximumActiveLlamaServers, activeLlamaServers);
    });
    const summary = await item.pipeline.initialize();
    expect(summary.localInferenceAvailable).toBe(true);
    expect(summary.cpuInferenceAvailable).toBe(true);
    expect(summary.gpuInferenceAvailable).toBe(true);
    expect(new URL(summary.aiqOrigin).hostname).toBe("127.0.0.1");
    const cpuResult = await item.pipeline.executePhase({ phase: "sustained", tier: 1, durationSeconds: 1, computeMode: "cpu_only" });
    expect(cpuResult.inferencesAttempted).toBeGreaterThan(0);
    expect(cpuResult.framesInferred).toBe(cpuResult.inferencesAttempted);
    expect(cpuResult.localInferenceMeasured).toBe(true);
    expect(cpuResult.inferenceBackend).toBe("cpu");
    expect(cpuResult.inferenceDeviceId).toBe("none");
    expect(cpuResult.measuredStages).toContain("local_inference");
    expect(cpuResult.failures).not.toContain("local_aiq_qwen_unavailable");
    const gpuResult = await item.pipeline.executePhase({ phase: "sustained", tier: 1, durationSeconds: 1, computeMode: "gpu_accelerated" });
    expect(gpuResult.inferencesAttempted).toBeGreaterThan(0);
    expect(gpuResult.framesInferred).toBe(gpuResult.inferencesAttempted);
    expect(gpuResult.localInferenceMeasured).toBe(true);
    expect(gpuResult.inferenceBackend).not.toBe("cpu");
    expect(gpuResult.inferenceDeviceId).not.toBe("none");
    expect(maximumActiveLlamaServers).toBe(1);
    await item.pipeline.close();
    item.database.close();
    await refreshRegisteredCalibrationTemporaryFiles(item.root, item.sessionId);
    await cleanupCalibrationWorkspace(item.root, item.sessionId);
  }, 30_000);

  it("publishes and consumes the synthetic source through MediaMTX on loopback when available", async () => {
    const ffmpeg = await executable("ffmpeg");
    const ffprobe = await executable("ffprobe");
    const mediamtx = await executable("mediamtx");
    if (!ffmpeg || !ffprobe || !mediamtx) return;
    const asset = (id: string, path: string): CalibrationRuntimeStatus["assets"][number] => ({
      id, status: "system_only", path, sha256: "d".repeat(64), sizeBytes: 1,
      expectedSizeBytes: null, version: null, licenseSpdx: null, sbomRef: null,
    });
    const item = await fixture(status([
      asset("ffmpeg", ffmpeg), asset("ffprobe", ffprobe), asset("mediamtx", mediamtx),
    ]));
    const summary = await item.pipeline.initialize();
    expect(summary.rtspAvailable).toBe(true);
    expect(new URL(summary.rtspOrigin).hostname).toBe("127.0.0.1");
    const result = await item.pipeline.executePhase({ phase: "sustained", tier: 1, durationSeconds: 1 });
    expect(result.rtspMeasured).toBe(true);
    expect(result.framesDecoded).toBeGreaterThan(0);
    expect(result.measuredStages).toEqual(expect.arrayContaining(["rtsp_ingest", "network_ingest"]));
    await item.pipeline.close();
    item.database.close();
    await refreshRegisteredCalibrationTemporaryFiles(item.root, item.sessionId);
    await cleanupCalibrationWorkspace(item.root, item.sessionId);
  }, 30_000);

  it("stops a phase when another process consumes the protected disk reserve", async () => {
    let checks = 0;
    const gib = 1024 ** 3;
    const item = await fixture(status(), createCalibrationPlan(createDefaultScenario(4), "quick"), false, async () => {
      checks += 1;
      const freeBytes = checks === 1 ? 20 * gib : 1 * gib;
      return { totalBytes: 100 * gib, freeBytes, reserveBytes: 15 * gib, projectedPeakBytes: 1024, canStart: checks === 1 };
    });
    await item.pipeline.initialize();
    await expect(item.pipeline.executePhase({ phase: "sustained", tier: 4, durationSeconds: 1 }))
      .rejects.toThrow("calibration_disk_reserve_violated");
    await item.pipeline.close();
    item.database.close();
    await refreshRegisteredCalibrationTemporaryFiles(item.root, item.sessionId);
    await cleanupCalibrationWorkspace(item.root, item.sessionId);
  });
});
