import { describe, expect, it } from "vitest";
import { buildCapacityPredictions, createCalibrationPlan, REQUIRED_CALIBRATION_STAGES } from "../src/engine/calibration.js";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import { createDefaultScenario, localCalibrationRunSchema } from "../src/shared/schemas.js";
import type { HardwareNodeTemplate, LocalCalibrationRun, PublicBenchmarkObservation } from "../src/shared/types.js";
import { AUTONOMOUS_LOCAL_CALIBRATION_VERSION, LEGACY_LOCAL_CALIBRATION_VERSION, PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT, WORKLOAD_CONTRACT_VERSION } from "../src/shared/types.js";

const base = HARDWARE_CATALOG.find((item) => item.id === "hp-z2-g1i-ultra9-rtx4500ada")!;
const catalog: HardwareNodeTemplate[] = ["anchor-a", "anchor-b", "anchor-d", "target-c"].map((id) => ({
  ...structuredClone(base), id, name: id, cpuArchitecture: "Arrow Lake", gpuArchitecture: "Ada Lovelace",
}));

function completeComputeEvidence(capacity: number): NonNullable<LocalCalibrationRun["computeEvidence"]> {
  return {
    schemaVersion: "qual-hardware-calibration-compute-evidence/1.0.0",
    requiredModes: ["cpu_only", "gpu_accelerated"],
    cpu: {
      mode: "cpu_only", backend: "cpu", device: "Intel Core Ultra 9 285K", measured: true,
      safeCameraCapacity: capacity, measurementCount: 12, failures: [],
    },
    gpu: {
      mode: "gpu_accelerated", inferenceBackend: "cuda", mediaBackend: "cuda_nvenc",
      deviceId: "CUDA0", deviceName: "NVIDIA RTX 4500 Ada", inferenceMeasured: true,
      mediaMeasured: true, utilizationMeasured: true, safeCameraCapacity: capacity,
      measurementCount: 12, failures: [],
    },
    combined: { measured: true, safeCameraCapacity: capacity, measurementCount: 12, failures: [] },
  };
}

function run(id: string, hardwareTemplateId: string, capacity: number): LocalCalibrationRun {
  return {
    schemaVersion: AUTONOMOUS_LOCAL_CALIBRATION_VERSION,
    id,
    planId: "00000000-0000-4000-8000-000000000099",
    createdAt: "2026-07-18T12:00:00.000Z",
    startedAt: "2026-07-18T12:00:00.000Z",
    completedAt: "2026-07-18T13:00:00.000Z",
    workloadContractVersion: WORKLOAD_CONTRACT_VERSION,
    mode: "qualification",
    executionMode: "production_pipeline",
    fingerprint: {
      hardwareTemplateId, hostnameHash: "0123456789abcdef", cpuModel: "Intel Core Ultra 9 285K",
      cpuArchitecture: "Arrow Lake", physicalCores: 24, logicalCores: 24, cpuPowerLimitWatts: 125,
      gpuModel: "NVIDIA RTX 4500 Ada", gpuArchitecture: "Ada Lovelace", gpuCount: 1,
      gpuVramBytes: 24 * 1024 ** 3, gpuDriver: "test", ramBytes: 128 * 1024 ** 3,
      memoryChannels: 2, memorySpeedMtps: 6400, storageModel: "test nvme", filesystem: "apfs",
      nicModel: "test nic", operatingSystem: "windows", operatingSystemVersion: "11",
      powerProfile: "performance", formFactor: "workstation", coolingProfile: "tower",
      perceptrumBuildHash: PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT, aiqModel: "Qwen3-VL-2B", aiqModelHash: "model-hash",
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
      evidenceStatus: "measured", measurementSource: "perceptrum-production-pipeline",
    })),
    phases: [
      { name: "warmup", durationSeconds: 600, loadPercent: 100, cameraCount: capacity, inferenceSuccessRate: 1, frameDeliveryRate: 1, p99InferenceLatencyMs: 100, inferenceIntervalMs: 60_000, maxQueueDepth: 1, queueGrowthPerMinute: 0, outOfMemoryCount: 0 },
      { name: "ramp", durationSeconds: 1200, loadPercent: 100, cameraCount: capacity, inferenceSuccessRate: 1, frameDeliveryRate: 1, p99InferenceLatencyMs: 100, inferenceIntervalMs: 60_000, maxQueueDepth: 1, queueGrowthPerMinute: 0, outOfMemoryCount: 0 },
      { name: "sustained", durationSeconds: 1200, loadPercent: 100, cameraCount: capacity, inferenceSuccessRate: 1, frameDeliveryRate: 1, p99InferenceLatencyMs: 100, inferenceIntervalMs: 60_000, maxQueueDepth: 1, queueGrowthPerMinute: 0, outOfMemoryCount: 0 },
      { name: "surge", durationSeconds: 600, loadPercent: 120, cameraCount: capacity, inferenceSuccessRate: 1, frameDeliveryRate: 1, p99InferenceLatencyMs: 100, inferenceIntervalMs: 60_000, maxQueueDepth: 1, queueGrowthPerMinute: 0, outOfMemoryCount: 0 },
    ],
    overallSafeCameraCapacity: capacity, bottleneck: "local_inference",
    pipelineEvidence: {
      complete: true, isolatedDatabase: true, sourceRegistered: true, rtspClipProvided: true,
      intelligenceJobQueued: true, schedulerClaimedJob: true, aiqLocalCompleted: true, resultPersisted: true,
      jobSchedulerExecuted: true, jobRuntimeExecuted: true, jobStepRunsPersisted: true,
      databaseWritesPersisted: true, intelligenceSchedulerExecuted: true, dashboardQueriesExecuted: true,
      concurrentWithLoad: true,
      cpuOnlyCompleted: true, gpuAcceleratedCompleted: true, combinedCpuGpuCompleted: true,
      phaseCoverage: ["warmup", "ramp", "sustained", "surge"].map((phase) => ({ phase: phase as "warmup" | "ramp" | "sustained" | "surge", completedProbeCount: 1, failedProbeCount: 0 })),
    },
    qualityGate: { eligibleForCapacityExtrapolation: true, evidenceLevel: "validated_local", validationStatus: "anchor_approved", failures: [], warnings: [] },
    kernelVersion: "qual-hardware-calibration-kernel/2.0.0",
    runtimeManifestHash: "c".repeat(64),
    runtimeProvenance: {
      platform: "win32", architecture: "x64", featureMode: "full",
      manifestApproved: true,
      contracts: [{ id: "authority", status: "verified", sha256: "a".repeat(64), expectedSha256: "a".repeat(64) }],
      assets: [{ id: "offline-runtime", status: "verified", sha256: "b".repeat(64), sizeBytes: 1, expectedSizeBytes: 1,
        version: "test", licenseSpdx: "MIT", sbomRef: "fixture" }],
    },
    workloadProfileId: `workload:${"d".repeat(64)}`,
    workloadProfileSignature: "d".repeat(64),
    compatiblePerceptrumCommit: "d918faa0ecd6a9906b711039e5d89f78e0536c44",
    cameraTiers: [1, 4, 8, 16, 32],
    tierResults: [{
      tier: capacity, repetition: null, phase: "discovery", startedAt: "2026-07-18T12:00:00.000Z", completedAt: "2026-07-18T12:02:00.000Z",
      passed: true, frameDeliveryRate: 1, inferenceSuccessRate: 1, p99InferenceLatencyMs: 100,
      inferenceIntervalMs: 60_000, p95BottleneckUtilizationPercent: 70, queueGrowthPerMinute: 0,
      outOfMemoryCount: 0, thermalThrottlePercent: 0, failures: [],
    }],
    repetitions: ([1, 2, 3] as const).map((repetition) => ({ repetition, tier: capacity,
      startedAt: `2026-07-18T12:0${repetition}:00.000Z`, completedAt: `2026-07-18T12:0${repetition}:59.000Z`,
      passed: true, safeCameraCapacity: capacity, failures: [] })),
    maxTestedTier: capacity,
    capacityBound: "exact",
    repeatVariabilityPercent: 0,
    computeEvidence: completeComputeEvidence(capacity),
    networkEvidence: "loopback_measured_physical_link_spec_verified",
    physicalNetworkLinks: [{ name: "test nic", speedMbps: 10_000, duplex: "full", physicalLinkVerified: true }],
    telemetryCapabilities: [{ id: "cpu.utilization", status: "measured", provider: "test" }],
    resourceSummaries: [], processGroups: [], telemetrySampleCount: 3600, telemetrySampleIntervalMs: 1000,
    artifact: { fileName: `${id}.qhcal.json`, payloadSha256: "a".repeat(64), persistedAt: "2026-07-18T13:00:00.000Z", storage: "documents_append_only" },
    notes: [],
  };
}

function observations(): PublicBenchmarkObservation[] {
  const scores: Record<string, number> = { "anchor-a": 100, "anchor-b": 200, "anchor-d": 125, "target-c": 150 };
  return catalog.flatMap((hardware) => REQUIRED_CALIBRATION_STAGES.map((stage) => ({
    id: `${hardware.id}-${stage}`, hardwareTemplateId: hardware.id, stage,
    profileId: `perceptrum-${stage}-v1`, benchmarkName: stage === "local_inference" ? "Qwen AiQ public inference" : `Public ${stage}`,
    benchmarkVersion: "1.0", score: scores[hardware.id]!, unit: "score", higherIsBetter: true as const,
    sourceTier: 1 as const, sourceUrl: `https://example.com/${stage}`, observedAt: "2026-07-18T12:00:00.000Z",
    operatingSystem: "windows" as const,
    configuration: "Exact version, performance power profile, disclosed driver and sustained cooling configuration.",
    benchmarkSuiteId: `suite-${stage}`, metricName: `metric-${stage}`, aggregation: "rate" as const,
    evidenceLocator: `fixture:${hardware.id}:${stage}`, rawArtifactSha256: "b".repeat(64),
    licensePolicy: "Redistributable normalized observation", reproducible: true,
  })));
}

describe("local calibration and conservative extrapolation", () => {
  it("creates only loopback/AiQ-local plans with the approved durations", () => {
    const quick = createCalibrationPlan(createDefaultScenario(8), "quick", "target-c");
    const full = createCalibrationPlan(createDefaultScenario(8), "qualification");
    expect(quick.localOnly).toBe(true);
    expect(quick.inferenceProvider).toBe("aiq_local");
    expect(quick.targetHardwareTemplateId).toBe("target-c");
    expect(quick.phases.map((phase) => phase.durationSeconds)).toEqual([45, 75, 90, 60]);
    expect(full.phases.map((phase) => phase.durationSeconds)).toEqual([1_800, 1_800, 23_400, 1_800]);
    expect(quick.requestedInferenceFps).toEqual([1]);
    expect(quick.executionMode).toBe("readiness");
    expect(full.executionMode).toBe("production_pipeline");
    expect(full.cameraTiers).toEqual([8]);
    expect(full.discovery.seedCameraCount).toBe(8);
    expect(full.discovery.generatorCameraLimit).toBe(1_000_000);
    expect(full.qualification).toEqual({ repetitions: 3, cooldownSeconds: 1_800, maximumVariabilityPercent: 10 });
    expect(full.workloadProfile.id).toMatch(/^workload:[0-9a-f]{64}$/);
    expect(full.instructions.join(" ")).toContain("Qual Hardware Calibration Kernel");
  });

  it("signs camera-group proportions without tying capacity evidence to the requested absolute count", () => {
    const balanced = createDefaultScenario(10);
    balanced.cameraGroups[0]!.count = 5;
    balanced.cameraGroups.push({ ...structuredClone(balanced.cameraGroups[0]!), id: crypto.randomUUID(), name: "Second", count: 5 });
    const scaled = structuredClone(balanced);
    scaled.totalCameras = 20;
    scaled.cameraGroups[0]!.count = 10;
    scaled.cameraGroups[1]!.count = 10;
    scaled.cameraGroups.forEach((group, index) => {
      group.id = crypto.randomUUID();
      group.name = `Renamed ${index}`;
      group.agents.forEach((agent) => { agent.id = crypto.randomUUID(); agent.name = `Agent ${index}`; });
    });
    const skewed = structuredClone(scaled);
    skewed.cameraGroups[0]!.count = 15;
    skewed.cameraGroups[1]!.count = 5;

    expect(createCalibrationPlan(balanced, "qualification").workloadProfile.signature)
      .toBe(createCalibrationPlan(scaled, "qualification").workloadProfile.signature);
    expect(createCalibrationPlan(skewed, "qualification").workloadProfile.signature)
      .not.toBe(createCalibrationPlan(scaled, "qualification").workloadProfile.signature);
  });

  it("requires three comparable anchors and uses the conservative per-stage reserve", () => {
    const predictions = buildCapacityPredictions(catalog, [
      run("00000000-0000-4000-8000-000000000001", "anchor-a", 10),
      run("00000000-0000-4000-8000-000000000002", "anchor-b", 18),
      run("00000000-0000-4000-8000-000000000005", "anchor-d", 11),
    ], observations());
    const target = predictions.find((item) => item.hardwareTemplateId === "target-c")!;
    expect(target.status).toBe("extrapolated_high");
    expect(target.procurementEligibility).toBe("eligible");
    expect(target.confidenceClass).toBe("A");
    expect(target.safeCameraMaximum).toBe(10);
    expect(target.stagePredictions.every((stage) => stage.anchorRunIds.length === 3)).toBe(true);
    expect(target.leaveOneOutUnsafeOverestimateCount).toBe(0);
  });

  it("keeps legacy or representative-only runs out of purchasing extrapolation", () => {
    const legacy = run("00000000-0000-4000-8000-000000000006", "anchor-a", 10);
    legacy.schemaVersion = LEGACY_LOCAL_CALIBRATION_VERSION;
    delete legacy.executionMode;
    delete legacy.pipelineEvidence;
    delete legacy.qualityGate;
    delete legacy.telemetryCapabilities;
    delete legacy.resourceSummaries;
    delete legacy.processGroups;
    delete legacy.telemetrySampleCount;
    delete legacy.telemetrySampleIntervalMs;
    delete legacy.artifact;
    const target = buildCapacityPredictions(catalog, [legacy], observations())
      .find((item) => item.hardwareTemplateId === "target-c")!;
    expect(target.status).toBe("reference_only");
    expect(target.procurementEligibility).toBe("blocked");
    expect(target.safeCameraMaximum).toBeNull();
  });

  it("labels an exact safe run as physically validated and rejects non-loopback/OpenAI evidence", () => {
    const exact = buildCapacityPredictions(catalog, [run("00000000-0000-4000-8000-000000000003", "target-c", 12)], observations())
      .find((item) => item.hardwareTemplateId === "target-c")!;
    expect(exact.status).toBe("validated_local");
    const invalid = { ...run("00000000-0000-4000-8000-000000000004", "target-c", 12), aiqOrigin: "https://api.openai.com/v1", openAiRequestCount: 1 };
    expect(localCalibrationRunSchema.safeParse(invalid).success).toBe(false);
  });

  it("uses the lowest safe result when the exact configuration was tested more than once", () => {
    const predictions = buildCapacityPredictions(catalog, [
      run("00000000-0000-4000-8000-000000000040", "target-c", 32),
      run("00000000-0000-4000-8000-000000000041", "target-c", 16),
    ], observations());
    const exact = predictions.find((item) => item.hardwareTemplateId === "target-c")!;
    expect(exact.status).toBe("validated_local");
    expect(exact.safeCameraMaximum).toBe(16);
    expect(exact.procurementEligibility).toBe("eligible");
  });

  it("does not treat three runs of the same physical configuration as three extrapolation anchors", () => {
    const predictions = buildCapacityPredictions(catalog, [
      run("00000000-0000-4000-8000-000000000042", "anchor-a", 10),
      run("00000000-0000-4000-8000-000000000043", "anchor-a", 11),
      run("00000000-0000-4000-8000-000000000044", "anchor-a", 12),
    ], observations());
    const extrapolated = predictions.find((item) => item.hardwareTemplateId === "target-c")!;
    expect(extrapolated.status).toBe("reference_only");
    expect(extrapolated.procurementEligibility).toBe("blocked");
    expect(extrapolated.safeCameraMaximum).toBeNull();
  });

  it("never recommends a machine from CPU-only or unproven GPU evidence", () => {
    const incomplete = run("00000000-0000-4000-8000-000000000045", "target-c", 32);
    incomplete.computeEvidence = {
      ...completeComputeEvidence(32),
      gpu: {
        ...completeComputeEvidence(32).gpu,
        inferenceBackend: "unavailable", mediaBackend: "unavailable", deviceId: null,
        inferenceMeasured: false, mediaMeasured: false, utilizationMeasured: false,
        safeCameraCapacity: null, failures: ["gpu_evidence_unavailable"],
      },
      combined: { measured: false, safeCameraCapacity: null, measurementCount: 0, failures: ["combined_cpu_gpu_load_incomplete"] },
    };
    incomplete.qualityGate = { ...incomplete.qualityGate!, eligibleForCapacityExtrapolation: false, validationStatus: "diagnostic" };
    incomplete.overallSafeCameraCapacity = null;
    const prediction = buildCapacityPredictions(catalog, [incomplete], observations())
      .find((item) => item.hardwareTemplateId === "target-c")!;
    expect(prediction.status).toBe("reference_only");
    expect(prediction.safeCameraMaximum).toBeNull();
    expect(prediction.procurementEligibility).toBe("blocked");
  });

  it("runs an unapproved runtime only as candidate validation and never as purchase evidence", () => {
    const candidate = run("00000000-0000-4000-8000-000000000046", "target-c", 32);
    candidate.runtimeProvenance!.manifestApproved = false;
    expect(localCalibrationRunSchema.safeParse(candidate).success).toBe(false);
    candidate.developmentOnly = true;
    candidate.overallSafeCameraCapacity = null;
    candidate.qualityGate = {
      eligibleForCapacityExtrapolation: false,
      evidenceLevel: "representative_only",
      validationStatus: "diagnostic",
      failures: ["runtime_manifest_not_approved"], warnings: [],
    };
    expect(localCalibrationRunSchema.safeParse(candidate).success).toBe(true);
    const prediction = buildCapacityPredictions(catalog, [candidate], observations())
      .find((item) => item.hardwareTemplateId === "target-c")!;
    expect(prediction.status).toBe("reference_only");
    expect(prediction.procurementEligibility).toBe("blocked");
  });

  it("rejects purchase eligibility when loopback traffic lacks a verified full-duplex physical link", () => {
    const invalid = run("00000000-0000-4000-8000-000000000022", "target-c", 12);
    invalid.networkEvidence = "loopback_measured_physical_link_unverified";
    invalid.physicalNetworkLinks = [{ name: "wifi", speedMbps: 1_200, duplex: "unknown", physicalLinkVerified: true }];
    const parsed = localCalibrationRunSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.path.includes("networkEvidence"))).toBe(true);
  });

  it("requires an explicit reason and null metrics for unavailable stage evidence", () => {
    const unavailable = run("00000000-0000-4000-8000-000000000007", "target-c", 12);
    const thermal = unavailable.stages.find((stage) => stage.stage === "thermal_sustain")!;
    thermal.evidenceStatus = "unavailable";
    thermal.safeCameraCapacity = null;
    thermal.throughput = null;
    thermal.p95LatencyMs = null;
    thermal.peakUtilizationPercent = null;
    thermal.thermalThrottlePercent = null;
    unavailable.overallSafeCameraCapacity = null;
    unavailable.qualityGate = { ...unavailable.qualityGate!, eligibleForCapacityExtrapolation: false, validationStatus: "invalid" };
    expect(localCalibrationRunSchema.safeParse(unavailable).success).toBe(false);
    thermal.reason = "Thermal counter is not exposed by this operating system.";
    expect(localCalibrationRunSchema.safeParse(unavailable).success).toBe(true);
  });

  it("never reuses capacity across different workload profile signatures", () => {
    const light = run("00000000-0000-4000-8000-000000000020", "target-c", 32);
    const heavy = run("00000000-0000-4000-8000-000000000021", "target-c", 8);
    heavy.workloadProfileId = `workload:${"e".repeat(64)}`;
    heavy.workloadProfileSignature = "e".repeat(64);
    const predictions = buildCapacityPredictions(catalog, [light, heavy], observations())
      .filter((prediction) => prediction.hardwareTemplateId === "target-c");
    expect(predictions).toHaveLength(2);
    expect(predictions.find((prediction) => prediction.workloadProfileId === `workload:${"d".repeat(64)}`)?.safeCameraMaximum).toBe(32);
    expect(predictions.find((prediction) => prediction.workloadProfileId === `workload:${"e".repeat(64)}`)?.safeCameraMaximum).toBe(8);
  });

  it("never reuses capacity across a different kernel or runtime manifest", () => {
    const calibrated = run("00000000-0000-4000-8000-000000000030", "target-c", 32);
    const compatible = buildCapacityPredictions(catalog, [calibrated], observations(), {
      kernelVersion: calibrated.kernelVersion!,
      runtimeManifestHash: calibrated.runtimeManifestHash!,
    }).find((prediction) => prediction.hardwareTemplateId === "target-c" &&
      prediction.workloadProfileId === calibrated.workloadProfileId)!;
    expect(compatible.status).toBe("validated_local");
    const incompatible = buildCapacityPredictions(catalog, [calibrated], observations(), {
      kernelVersion: calibrated.kernelVersion!,
      runtimeManifestHash: "f".repeat(64),
    });
    expect(incompatible.some((prediction) => prediction.status === "validated_local")).toBe(false);
    expect(incompatible.some((prediction) => prediction.exactCalibrationRunId === calibrated.id)).toBe(false);
  });
});
