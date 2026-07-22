import { REQUIRED_CALIBRATION_STAGES } from "../../src/engine/calibration.js";
import { buildCalibrationWorkloadProfile } from "../../src/engine/calibrationProfile.js";
import { createDefaultScenario } from "../../src/shared/schemas.js";
import { PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT, WORKLOAD_CONTRACT_VERSION, type CalibrationWorkloadProfile, type LocalCalibrationRun } from "../../src/shared/types.js";

export function autonomousCalibrationWorkloadProfile(): CalibrationWorkloadProfile {
  return buildCalibrationWorkloadProfile(createDefaultScenario(16));
}

export function autonomousCalibrationRun(input: {
  id?: string;
  hardwareTemplateId?: string;
  capacity?: number;
  runtimeManifestHash?: string;
} = {}): LocalCalibrationRun {
  const id = input.id ?? "00000000-0000-4000-8000-000000000901";
  const capacity = input.capacity ?? 16;
  const workloadProfile = autonomousCalibrationWorkloadProfile();
  return {
    schemaVersion: "qual-hardware-local-calibration/4.0.0",
    id,
    planId: "00000000-0000-4000-8000-000000000902",
    createdAt: "2026-07-22T10:00:00.000Z",
    startedAt: "2026-07-22T10:00:00.000Z",
    completedAt: "2026-07-22T11:00:00.000Z",
    workloadContractVersion: WORKLOAD_CONTRACT_VERSION,
    mode: "qualification",
    executionMode: "production_pipeline",
    fingerprint: {
      hardwareTemplateId: input.hardwareTemplateId ?? "hp-z2-g1i-ultra9-rtx4500ada",
      hostnameHash: "0123456789abcdef", cpuModel: "Intel Core Ultra 9 285K", cpuArchitecture: "Arrow Lake",
      physicalCores: 24, logicalCores: 24, cpuPowerLimitWatts: 125,
      gpuModel: "NVIDIA RTX 4500 Ada", gpuArchitecture: "Ada Lovelace", gpuCount: 1,
      gpuVramBytes: 24 * 1024 ** 3, gpuDriver: "test-driver", ramBytes: 128 * 1024 ** 3,
      memoryChannels: 2, memorySpeedMtps: 6400, storageModel: "test nvme", filesystem: "ntfs",
      nicModel: "test nic", operatingSystem: "windows", operatingSystemVersion: "11",
      powerProfile: "performance", formFactor: "workstation", coolingProfile: "tower",
      perceptrumBuildHash: PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT,
      aiqModel: "Qwen3-VL-2B", aiqModelHash: "b".repeat(64), inferenceBackend: "llama.cpp-cuda",
    },
    requestedSourceFps: 15, measuredSourceFps: 15, requestedInferenceFps: 1, effectiveInferenceFps: 1,
    framesPlanned: 300, framesExtracted: 300, framesPacked: 300, framesInferred: 300,
    rtspOrigin: "rtsp://127.0.0.1:8554", aiqOrigin: "http://127.0.0.1:8899",
    networkPolicy: "loopback_only", externalRequestCount: 0, openAiRequestCount: 0,
    mediaFieldCount: 0, credentialFieldCount: 0,
    stages: REQUIRED_CALIBRATION_STAGES.map((stage) => ({
      stage, safeCameraCapacity: capacity, throughput: capacity, throughputUnit: "camera-equivalent",
      p95LatencyMs: 100, peakUtilizationPercent: 70, queueGrowthPerMinute: 0, thermalThrottlePercent: 0,
      evidenceStatus: "measured", measurementSource: "qual-hardware-offline-pipeline",
    })),
    phases: (["warmup", "ramp", "sustained", "surge"] as const).map((name) => ({
      name, durationSeconds: name === "warmup" || name === "surge" ? 600 : 1200,
      loadPercent: name === "surge" ? 120 : 100, cameraCount: capacity,
      inferenceSuccessRate: 1, frameDeliveryRate: 1, p99InferenceLatencyMs: 100, inferenceIntervalMs: 60_000,
      maxQueueDepth: 0, queueGrowthPerMinute: 0, outOfMemoryCount: 0, thermalThrottlePercent: 0,
    })),
    overallSafeCameraCapacity: capacity,
    bottleneck: "local_inference",
    pipelineEvidence: {
      complete: true, isolatedDatabase: true, sourceRegistered: true, rtspClipProvided: true,
      intelligenceJobQueued: true, schedulerClaimedJob: true, aiqLocalCompleted: true, resultPersisted: true,
      jobSchedulerExecuted: true, jobRuntimeExecuted: true, jobStepRunsPersisted: true,
      databaseWritesPersisted: true, intelligenceSchedulerExecuted: true, dashboardQueriesExecuted: true,
      concurrentWithLoad: true,
      cpuOnlyCompleted: true, gpuAcceleratedCompleted: true, combinedCpuGpuCompleted: true,
      phaseCoverage: (["warmup", "ramp", "sustained", "surge"] as const)
        .map((phase) => ({ phase, completedProbeCount: 1, failedProbeCount: 0 })),
    },
    qualityGate: { eligibleForCapacityExtrapolation: true, evidenceLevel: "validated_local", validationStatus: "anchor_approved", failures: [], warnings: [] },
    kernelVersion: "qual-hardware-calibration-kernel/2.0.0",
    runtimeManifestHash: input.runtimeManifestHash ?? "c".repeat(64),
    runtimeProvenance: {
      platform: "win32", architecture: "x64", featureMode: "full",
      manifestApproved: true,
      contracts: [{ id: "authority", status: "verified", sha256: "a".repeat(64), expectedSha256: "a".repeat(64) }],
      assets: [{ id: "offline-runtime", status: "verified", sha256: "b".repeat(64), sizeBytes: 1,
        expectedSizeBytes: 1, version: "test", licenseSpdx: "MIT", sbomRef: "fixture" }],
    },
    workloadProfileId: workloadProfile.id,
    workloadProfileSignature: workloadProfile.signature,
    compatiblePerceptrumCommit: PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT,
    cameraTiers: [1, 4, 8, 16, 32],
    tierResults: [{ tier: capacity, repetition: null, phase: "discovery",
      startedAt: "2026-07-22T10:00:00.000Z", completedAt: "2026-07-22T10:02:00.000Z", passed: true,
      frameDeliveryRate: 1, inferenceSuccessRate: 1, p99InferenceLatencyMs: 100, inferenceIntervalMs: 60_000,
      p95BottleneckUtilizationPercent: 70, queueGrowthPerMinute: 0, outOfMemoryCount: 0, thermalThrottlePercent: 0, failures: [] }],
    repetitions: ([1, 2, 3] as const).map((repetition) => ({ repetition, tier: capacity,
      startedAt: `2026-07-22T10:0${repetition}:00.000Z`, completedAt: `2026-07-22T10:0${repetition}:59.000Z`,
      passed: true, safeCameraCapacity: capacity, failures: [] })),
    maxTestedTier: capacity, capacityBound: "exact", repeatVariabilityPercent: 0,
    computeEvidence: {
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
    },
    networkEvidence: "loopback_measured_physical_link_spec_verified",
    physicalNetworkLinks: [{ name: "ethernet", speedMbps: 10_000, duplex: "full", physicalLinkVerified: true }],
    telemetryCapabilities: [{ id: "cpu.utilization", status: "measured", provider: "test" }],
    resourceSummaries: [], processGroups: [], telemetrySampleCount: 3_600, telemetrySampleIntervalMs: 1_000,
    artifact: {
      fileName: `${id}.qhcal.json`, payloadSha256: "e".repeat(64),
      persistedAt: "2026-07-22T11:00:00.000Z", storage: "documents_append_only",
    },
    notes: [],
  };
}
