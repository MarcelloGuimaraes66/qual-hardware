import { describe, expect, it } from "vitest";
import { buildCapacityPredictions, createCalibrationPlan, REQUIRED_CALIBRATION_STAGES } from "../src/engine/calibration.js";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import { createDefaultScenario, localCalibrationRunSchema } from "../src/shared/schemas.js";
import type { HardwareNodeTemplate, LocalCalibrationRun, PublicBenchmarkObservation } from "../src/shared/types.js";
import { LOCAL_CALIBRATION_VERSION, WORKLOAD_CONTRACT_VERSION } from "../src/shared/types.js";

const base = HARDWARE_CATALOG.find((item) => item.id === "hp-z2-g1i-ultra9-rtx4500ada")!;
const catalog: HardwareNodeTemplate[] = ["anchor-a", "anchor-b", "target-c"].map((id) => ({
  ...structuredClone(base), id, name: id, cpuArchitecture: "Arrow Lake", gpuArchitecture: "Ada Lovelace",
}));

function run(id: string, hardwareTemplateId: string, capacity: number): LocalCalibrationRun {
  return {
    schemaVersion: LOCAL_CALIBRATION_VERSION,
    id,
    planId: "00000000-0000-4000-8000-000000000099",
    createdAt: "2026-07-18T12:00:00.000Z",
    startedAt: "2026-07-18T12:00:00.000Z",
    completedAt: "2026-07-18T13:00:00.000Z",
    workloadContractVersion: WORKLOAD_CONTRACT_VERSION,
    mode: "full",
    fingerprint: {
      hardwareTemplateId, hostnameHash: "0123456789abcdef", cpuModel: "Intel Core Ultra 9 285K",
      cpuArchitecture: "Arrow Lake", physicalCores: 24, logicalCores: 24, cpuPowerLimitWatts: 125,
      gpuModel: "NVIDIA RTX 4500 Ada", gpuArchitecture: "Ada Lovelace", gpuCount: 1,
      gpuVramBytes: 24 * 1024 ** 3, gpuDriver: "test", ramBytes: 128 * 1024 ** 3,
      memoryChannels: 2, memorySpeedMtps: 6400, storageModel: "test nvme", filesystem: "apfs",
      nicModel: "test nic", operatingSystem: "windows", operatingSystemVersion: "11",
      powerProfile: "performance", formFactor: "workstation", coolingProfile: "tower",
      perceptrumBuildHash: "test-build", aiqModel: "Qwen3-VL-2B", aiqModelHash: "model-hash",
      inferenceBackend: "llama.cpp-cuda",
    },
    requestedSourceFps: 15, measuredSourceFps: 15, requestedInferenceFps: 5, effectiveInferenceFps: 5,
    framesPlanned: 300, framesExtracted: 300, framesPacked: 300, framesInferred: 300,
    rtspOrigin: "rtsp://127.0.0.1:8554", aiqOrigin: "http://127.0.0.1:8899",
    networkPolicy: "loopback_only", externalRequestCount: 0, openAiRequestCount: 0,
    mediaFieldCount: 0, credentialFieldCount: 0,
    stages: REQUIRED_CALIBRATION_STAGES.map((stage) => ({
      stage, safeCameraCapacity: capacity, throughput: capacity, throughputUnit: "camera-equivalent",
      p95LatencyMs: 100, peakUtilizationPercent: 80, queueGrowthPerMinute: 0, thermalThrottlePercent: 0,
    })),
    phases: [
      { name: "warmup", durationSeconds: 600, loadPercent: 100, cameraCount: capacity, inferenceSuccessRate: 1, maxQueueDepth: 1, queueGrowthPerMinute: 0, outOfMemoryCount: 0 },
      { name: "sustained", durationSeconds: 2400, loadPercent: 100, cameraCount: capacity, inferenceSuccessRate: 1, maxQueueDepth: 1, queueGrowthPerMinute: 0, outOfMemoryCount: 0 },
      { name: "surge", durationSeconds: 600, loadPercent: 120, cameraCount: capacity, inferenceSuccessRate: 1, maxQueueDepth: 1, queueGrowthPerMinute: 0, outOfMemoryCount: 0 },
    ],
    overallSafeCameraCapacity: capacity, bottleneck: "local_inference", notes: [],
  };
}

function observations(): PublicBenchmarkObservation[] {
  const scores: Record<string, number> = { "anchor-a": 100, "anchor-b": 200, "target-c": 150 };
  return catalog.flatMap((hardware) => REQUIRED_CALIBRATION_STAGES.map((stage) => ({
    id: `${hardware.id}-${stage}`, hardwareTemplateId: hardware.id, stage,
    profileId: `perceptrum-${stage}-v1`, benchmarkName: `Public ${stage}`,
    benchmarkVersion: "1.0", score: scores[hardware.id]!, unit: "score", higherIsBetter: true as const,
    sourceTier: 1 as const, sourceUrl: `https://example.com/${stage}`, observedAt: "2026-07-18T12:00:00.000Z",
    operatingSystem: "windows" as const,
    configuration: "Exact version, performance power profile, disclosed driver and sustained cooling configuration.",
  })));
}

describe("local calibration and conservative extrapolation", () => {
  it("creates only loopback/AiQ-local plans with the approved durations", () => {
    const quick = createCalibrationPlan(createDefaultScenario(8), "quick", "target-c");
    const full = createCalibrationPlan(createDefaultScenario(8), "full");
    expect(quick.localOnly).toBe(true);
    expect(quick.inferenceProvider).toBe("aiq_local");
    expect(quick.targetHardwareTemplateId).toBe("target-c");
    expect(quick.phases.map((phase) => phase.durationSeconds)).toEqual([120, 300, 180]);
    expect(full.phases.map((phase) => phase.durationSeconds)).toEqual([600, 2400, 600]);
    expect(quick.requestedInferenceFps).toEqual([1]);
  });

  it("uses the conservative per-stage minimum and 20 percent class-A reserve", () => {
    const predictions = buildCapacityPredictions(catalog, [
      run("00000000-0000-4000-8000-000000000001", "anchor-a", 10),
      run("00000000-0000-4000-8000-000000000002", "anchor-b", 18),
    ], observations());
    const target = predictions.find((item) => item.hardwareTemplateId === "target-c")!;
    expect(target.status).toBe("extrapolated_high");
    expect(target.confidenceClass).toBe("A");
    expect(target.safeCameraMaximum).toBe(10);
    expect(target.stagePredictions.every((stage) => stage.anchorRunIds.length === 2)).toBe(true);
    expect(target.leaveOneOutUnsafeOverestimateCount).toBe(0);
  });

  it("labels an exact safe run as physically validated and rejects non-loopback/OpenAI evidence", () => {
    const exact = buildCapacityPredictions(catalog, [run("00000000-0000-4000-8000-000000000003", "target-c", 12)], observations())
      .find((item) => item.hardwareTemplateId === "target-c")!;
    expect(exact.status).toBe("validated_local");
    const invalid = { ...run("00000000-0000-4000-8000-000000000004", "target-c", 12), aiqOrigin: "https://api.openai.com/v1", openAiRequestCount: 1 };
    expect(localCalibrationRunSchema.safeParse(invalid).success).toBe(false);
  });
});
