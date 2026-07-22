import { describe, expect, it } from "vitest";
import { REQUIRED_CALIBRATION_STAGES } from "../src/engine/calibration.js";
import { evaluateCalibrationQualification } from "../src/server/calibrationQualification.js";
import type { PipelinePhaseMeasurement } from "../src/server/calibrationPipeline.js";
import type { CalibrationPhaseMetric, CalibrationRepetitionResult, TelemetryMetricSummary } from "../src/shared/types.js";

const phases: CalibrationPhaseMetric["name"][] = ["warmup", "ramp", "sustained", "surge"];
const metric = (value: number): TelemetryMetricSummary => ({
  samples: 10, average: value, p95: value, p99: value, peak: value,
});

function measurement(
  phase: CalibrationPhaseMetric["name"],
  computeMode: "cpu_only" | "gpu_accelerated" = "cpu_only",
): PipelinePhaseMeasurement {
  const tier = phase === "surge" ? 120 : 100;
  const gpu = computeMode === "gpu_accelerated";
  return {
    phase,
    computeMode,
    inferenceBackend: gpu ? "cuda" : "cpu",
    inferenceDeviceId: gpu ? "Cuda0" : "none",
    gpuMediaBackend: gpu ? "cuda_nvenc" : "unavailable",
    cpuWorkloadMeasured: true,
    gpuInferenceMeasured: gpu,
    gpuMediaMeasured: gpu,
    combinedCpuGpuMeasured: gpu,
    tier,
    durationSeconds: 600,
    actualConcurrentMediaPipelines: tier,
    exactCameraConcurrency: true,
    framesPlanned: 1_000,
    framesDecoded: 1_000,
    framesExtracted: 1_000,
    framesEncoded: 1_000,
    inferencesPlanned: 100,
    inferencesAttempted: 100,
    framesInferred: 100,
    p99InferenceLatencyMs: 1_000,
    databaseOperations: 100,
    dashboardQueries: 800,
    completedJobRuns: 100,
    completedStepRuns: 100,
    completedIntelligenceJobs: 100,
    processedCameraCount: tier,
    p95DatabaseLatencyMs: 2,
    p95DashboardLatencyMs: 2,
    mediaDurationMs: 1_000,
    memoryBytesPerSecond: 1_000_000,
    networkIngressMbps: 1_000,
    physicalNetworkCapacityMbps: 10_000,
    physicalNetworkUsableMbps: 8_000,
    physicalNetworkLinkVerified: true,
    temporaryBytesEstimated: 1_000_000,
    temporaryBytesFreeBeforePhase: 100_000_000,
    cpuUtilizationPercent: metric(50),
    memoryUsedBytes: metric(10_000_000),
    hardwareTelemetry: {
      provider: "approved-telemetry-probe",
      sampleCount: 10,
      gpuUtilizationPercent: metric(50),
      gpuMemoryUsedBytes: metric(1_000_000),
      gpuTemperatureCelsius: metric(60),
      gpuPowerWatts: metric(100),
      cpuTemperatureCelsius: null,
      thermalThrottlePercent: metric(0),
    },
    rtspMeasured: true,
    mediaMeasured: true,
    localInferenceMeasured: true,
    queueGrowthPerMinute: 0,
    failures: [],
    measuredStages: [...REQUIRED_CALIBRATION_STAGES],
  };
}

function repetitions(): CalibrationRepetitionResult[] {
  return ([1, 2, 3] as const).map((repetition) => ({
    repetition,
    tier: 100,
    startedAt: `2026-07-21T0${repetition}:00:00.000Z`,
    completedAt: `2026-07-21T0${repetition}:01:00.000Z`,
    passed: true,
    safeCameraCapacity: 100,
    failures: [],
  }));
}

function validInput() {
  return {
    mode: "qualification" as const,
    runtimeReady: true,
    authorityAndProfileExact: true,
    timeScale: 1,
    selectedTier: 100,
    phaseNames: phases,
    mediaAvailable: true,
    rtspAvailable: true,
    localInferenceAvailable: true,
    cpuInferenceAvailable: true,
    gpuInferenceAvailable: true,
    gpuMediaAvailable: true,
    externalRequestCount: 0,
    openAiRequestCount: 0,
    measurements: [1, 2, 3].flatMap(() => phases.flatMap((phase) => [
      measurement(phase, "cpu_only"), measurement(phase, "gpu_accelerated"),
    ])),
    repetitions: repetitions(),
  };
}

describe("commercial calibration qualification", () => {
  it("approves only a complete physical three-repetition proof", () => {
    const result = evaluateCalibrationQualification(validInput());
    expect(result.eligible).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.pipelineComplete).toBe(true);
    expect(result.repeatVariabilityPercent).toBe(0);
    expect(result.qualifiedMeasurements).toHaveLength(24);
  });

  it("does not let an expected failed upper discovery tier contaminate a successful lower qualification", () => {
    const input = validInput();
    input.measurements.unshift({
      ...measurement("warmup"), phase: "discovery", tier: 256,
      actualConcurrentMediaPipelines: 0, exactCameraConcurrency: false,
      physicalNetworkUsableMbps: 100, networkIngressMbps: 2_000,
      failures: ["physical_network_capacity_below_20_percent_reserve"],
    });
    expect(evaluateCalibrationQualification(input).eligible).toBe(true);
  });

  it("fails closed when any mandatory proof is absent or external traffic is observed", () => {
    const input = validInput();
    input.externalRequestCount = 1;
    input.measurements[0]!.hardwareTelemetry.thermalThrottlePercent = null;
    input.measurements[1]!.hardwareTelemetry.gpuMemoryUsedBytes = null;
    input.measurements[2]!.temporaryBytesFreeBeforePhase = null;
    input.measurements[3]!.exactCameraConcurrency = false;
    const result = evaluateCalibrationQualification(input);
    expect(result.eligible).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      "external_network_request_detected",
      "approved_thermal_guardrail_unavailable",
      "gpu_or_vram_guardrail_unavailable",
      "cpu_memory_or_disk_guardrail_unavailable",
      "exact_camera_concurrency_not_executed",
    ]));
  });

  it("enforces the 20% physical-network reserve independently of loopback traffic", () => {
    const input = validInput();
    input.measurements[0]!.physicalNetworkUsableMbps = 999;
    const result = evaluateCalibrationQualification(input);
    expect(result.eligible).toBe(false);
    expect(result.physicalNetworkSpecificationComplete).toBe(true);
    expect(result.failures).toContain("physical_network_capacity_below_20_percent_reserve");
  });

  it("rejects more than 10% variation in repeated physical measurements", () => {
    const input = validInput();
    input.measurements[16]!.p99InferenceLatencyMs = 1_200;
    const result = evaluateCalibrationQualification(input);
    expect(result.repeatVariabilityPercent).toBeCloseTo(20);
    expect(result.eligible).toBe(false);
    expect(result.failures).toContain("repetition_capacity_variability_exceeded");
  });
});
