import { z } from "zod";
import type { CapacityScenario } from "./types.js";
import {
  AUTONOMOUS_LOCAL_CALIBRATION_VERSION,
  CALIBRATION_COMPUTE_EVIDENCE_VERSION,
  CALIBRATION_CHECKPOINT_VERSION,
  CALIBRATION_PLAN_VERSION,
  CALIBRATION_PROGRESS_VERSION,
  COMPONENT_TECHNICAL_SPECIFICATION_VERSION,
  EVIDENCE_CATALOG_VERSION,
  LEGACY_COMPONENT_TECHNICAL_SPECIFICATION_VERSION,
  LEGACY_AUTONOMOUS_LOCAL_CALIBRATION_VERSION,
  LEGACY_LOCAL_CALIBRATION_VERSION,
  LOCAL_CALIBRATION_VERSION,
  MAX_PROJECT_CAMERAS,
  LEGACY_QHCAL_PACKAGE_VERSION,
  LEGACY_QHCALSET_PACKAGE_VERSION,
  MANUFACTURER_SPECIFICATION_OBSERVATION_VERSION,
  PROCUREMENT_NEUTRAL_SPECIFICATION_VERSION,
  PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT,
  QHCAL_PACKAGE_VERSION,
  QHCALSET_PACKAGE_VERSION,
  TELEMETRY_LOCAL_CALIBRATION_VERSION,
  WORKLOAD_CONTRACT_VERSION,
} from "./types.js";

const agentFeaturesSchema = z.object({
  onlyCaptureOnMotion: z.boolean(),
  temporal: z.boolean(),
  regions: z.number().int().min(0).max(32),
  croppedFrame: z.boolean(),
  faceReferences: z.number().int().min(0).max(4),
  negativeReferences: z.number().int().min(0).max(3),
});

export const agentLoadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  model: z.enum([
    "gpt-5.4",
    "gpt-5",
    "gpt-5.4-mini",
    "gpt-5-mini",
    "aiq-3.7",
    "aiq-3.7-max",
    "opencv-portal-counter",
  ]),
  inputType: z.enum(["video", "image"]),
  packaging: z.enum(["frame_sequence", "mosaic_2x2", "mosaic_3x3"]),
  modelFps: z.number().int().min(1).max(10),
  runEverySeconds: z.union([z.literal(10), z.literal(60), z.literal(300), z.literal(600)]),
  features: agentFeaturesSchema,
});

export const cameraGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  count: z.number().int().min(1).max(MAX_PROJECT_CAMERAS),
  source: z.object({
    codec: z.enum(["h264", "h265"]),
    width: z.number().int().min(160).max(8192),
    height: z.number().int().min(120).max(8192),
    sourceFps: z.number().int().min(1).max(120),
    bitrateMbps: z.number().positive().max(500),
  }),
  decodeMode: z.enum(["cpu", "gpu"]),
  motionPercent: z.number().min(0).max(100),
  storage: z.object({
    storeVideo: z.boolean(),
    retentionDays: z.number().int().min(0).max(3650),
    raidFactor: z.number().min(1).max(3),
  }),
  agents: z.array(agentLoadSchema).min(1).max(32),
});

export const capacityScenarioSchema = z.object({
  schemaVersion: z.literal("capacity-scenario/1.0.0"),
  workloadContractVersion: z.enum([WORKLOAD_CONTRACT_VERSION, "perceptrum-workload/3.0.0", "perceptrum-workload/2.0.0", "perceptrum-workload/1.1.0", "perceptrum-workload/1.0.0"]),
  projectName: z.string().min(1).max(160),
  customerName: z.string().max(160),
  market: z.enum(["BR", "US", "DE"]),
  markets: z.array(z.enum(["BR", "US", "DE"])).min(1).max(3).optional(),
  currency: z.enum(["BRL", "USD", "EUR"]),
  perceptrumBuildHash: z.string().min(1).max(128),
  totalCameras: z.number().int().min(1).max(MAX_PROJECT_CAMERAS),
  cameraGroups: z.array(cameraGroupSchema).min(1).max(128),
  concurrentWorkloads: z.object({
    activeJobs: z.number().int().min(0).max(1024),
    groupedJobCameras: z.number().int().min(0).max(MAX_PROJECT_CAMERAS),
    concurrentChatSessions: z.number().int().min(0).max(1024),
    activeSearches: z.number().int().min(0).max(1024),
    intelligenceStreams: z.number().int().min(0).max(MAX_PROJECT_CAMERAS),
  }),
  constraints: z.object({
    infrastructureKind: z.enum(["laptop", "mini_pc", "workstation", "rack", "either"]),
    preferredCpuVendors: z.array(z.enum(["intel", "amd", "apple"])).max(3),
    preferredGpuVendors: z.array(z.enum(["nvidia", "amd", "intel", "apple"])).max(4),
    operatingSystem: z.enum(["auto", "windows", "ubuntu", "macos"]).default("auto"),
    requiredHardwareTemplateId: z.string().min(1).max(160).nullable().default(null),
    maxNodes: z.number().int().min(1).max(100_000).nullable(),
    budget: z.number().positive().nullable(),
    requireEcc: z.boolean(),
  }),
}).superRefine((value, context) => {
  const groupedCameras = value.cameraGroups.reduce((sum, group) => sum + group.count, 0);
  if (groupedCameras !== value.totalCameras) {
    context.addIssue({
      code: "custom",
      path: ["cameraGroups"],
      message: `Camera group total (${groupedCameras}) must equal totalCameras (${value.totalCameras}).`,
    });
  }
});

export const scenarioCreateSchema = z.object({ scenario: capacityScenarioSchema });
export const scenarioUpdateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  scenario: capacityScenarioSchema,
});

export const calibrationStageSchema = z.enum([
  "rtsp_ingest",
  "video_decode",
  "bgr_processing",
  "video_encode",
  "disk_write",
  "disk_read",
  "frame_extraction",
  "local_inference",
  "memory_bandwidth",
  "network_ingest",
  "job_scheduler",
  "intelligence_scheduler",
  "database_persistence",
  "dashboard_queries",
  "thermal_sustain",
]);

const operatingSystemSchema = z.enum(["windows", "ubuntu", "macos"]);
const telemetryEvidenceStatusSchema = z.enum(["measured", "unavailable", "failed", "not_applicable"]);
const calibrationComputeModeSchema = z.enum(["cpu_only", "gpu_accelerated"]);
const calibrationGpuInferenceBackendSchema = z.enum(["cuda", "metal", "vulkan", "rocm", "unavailable"]);
const calibrationGpuMediaBackendSchema = z.enum(["cuda_nvenc", "videotoolbox", "qsv", "d3d11va_amf", "vaapi", "unavailable"]);
const calibrationGpuClassificationSchema = z.enum(["compute", "media_only", "display_only", "unavailable"]);
const calibrationCpuPackageSchema = z.object({
  id: z.string().min(1).max(160),
  model: z.string().min(1).max(240),
  physicalCores: z.number().int().positive().max(4096),
  logicalCores: z.number().int().positive().max(8192),
  processorGroupIds: z.array(z.number().int().nonnegative().max(1024)).max(1024),
  numaNodeIds: z.array(z.number().int().nonnegative().max(1024)).max(1024),
});
const calibrationProcessorGroupSchema = z.object({
  id: z.number().int().nonnegative().max(1024),
  logicalProcessorCount: z.number().int().positive().max(64),
  activeProcessorMask: z.string().min(1).max(64).nullable(),
});
const calibrationNumaNodeSchema = z.object({
  id: z.number().int().nonnegative().max(1024),
  processorGroupIds: z.array(z.number().int().nonnegative().max(1024)).max(1024),
  logicalProcessorCount: z.number().int().positive().max(8192),
  memoryBytes: z.number().int().nonnegative().nullable(),
  cpuPackageIds: z.array(z.string().min(1).max(160)).max(1024),
});
const calibrationGpuDeviceSchema = z.object({
  id: z.string().min(1).max(240),
  uuid: z.string().min(1).max(240).nullable(),
  pciBusId: z.string().min(1).max(160).nullable(),
  index: z.number().int().nonnegative().max(1024),
  name: z.string().min(1).max(500),
  vendor: z.enum(["nvidia", "amd", "intel", "apple"]),
  driver: z.string().min(1).max(240),
  architecture: z.string().min(1).max(160),
  inferenceBackend: calibrationGpuInferenceBackendSchema,
  mediaBackend: calibrationGpuMediaBackendSchema,
  classification: calibrationGpuClassificationSchema,
  vramBytes: z.number().int().nonnegative().nullable(),
  numaNodeId: z.number().int().nonnegative().max(1024).nullable(),
  computeEligible: z.boolean(),
  mediaEligible: z.boolean(),
  encodeSupported: z.boolean(),
  decodeSupported: z.boolean(),
  reason: z.string().min(1).max(1_000),
});
const telemetryMetricSummarySchema = z.object({
  samples: z.number().int().nonnegative(),
  average: z.number().finite(),
  p95: z.number().finite(),
  p99: z.number().finite(),
  peak: z.number().finite(),
});

const calibrationComputeEvidenceV1Schema = z.object({
  schemaVersion: z.literal("qual-hardware-calibration-compute-evidence/1.0.0"),
  requiredModes: z.tuple([z.literal("cpu_only"), z.literal("gpu_accelerated")]),
  cpu: z.object({
    mode: z.literal("cpu_only"), backend: z.literal("cpu"), device: z.string().min(1).max(240),
    measured: z.boolean(), safeCameraCapacity: z.number().int().min(1).max(MAX_PROJECT_CAMERAS).nullable(),
    measurementCount: z.number().int().nonnegative(), failures: z.array(z.string().min(1).max(240)).max(100),
  }),
  gpu: z.object({
    mode: z.literal("gpu_accelerated"), inferenceBackend: calibrationGpuInferenceBackendSchema,
    mediaBackend: calibrationGpuMediaBackendSchema, deviceId: z.string().min(1).max(240).nullable(),
    deviceName: z.string().min(1).max(500).nullable(), inferenceMeasured: z.boolean(), mediaMeasured: z.boolean(),
    utilizationMeasured: z.boolean(), safeCameraCapacity: z.number().int().min(1).max(MAX_PROJECT_CAMERAS).nullable(),
    measurementCount: z.number().int().nonnegative(), failures: z.array(z.string().min(1).max(240)).max(100),
  }),
  combined: z.object({
    measured: z.boolean(), safeCameraCapacity: z.number().int().min(1).max(MAX_PROJECT_CAMERAS).nullable(),
    measurementCount: z.number().int().nonnegative(), failures: z.array(z.string().min(1).max(240)).max(100),
  }),
});

const calibrationComputeDeviceEvidenceSchema = z.object({
  deviceId: z.string().min(1).max(240),
  deviceName: z.string().min(1).max(500),
  classification: calibrationGpuClassificationSchema,
  inferenceBackend: calibrationGpuInferenceBackendSchema,
  mediaBackend: calibrationGpuMediaBackendSchema,
  inferenceMeasured: z.boolean(),
  mediaMeasured: z.boolean(),
  telemetryMeasured: z.boolean(),
  receivedLoad: z.boolean(),
  requestCount: z.number().int().nonnegative(),
  safeCameraCapacity: z.number().int().min(1).max(MAX_PROJECT_CAMERAS).nullable(),
  throughput: z.number().nonnegative().nullable(),
  p95LatencyMs: z.number().nonnegative().nullable(),
  peakVramBytes: z.number().int().nonnegative().nullable(),
  peakTemperatureCelsius: z.number().nonnegative().max(200).nullable(),
  peakPowerWatts: z.number().nonnegative().max(100_000).nullable(),
  throttlingObserved: z.boolean(),
  schedulerWeight: z.number().positive().max(1_000_000),
  failures: z.array(z.string().min(1).max(500)).max(100),
});

const calibrationComputeEvidenceV2Schema = calibrationComputeEvidenceV1Schema.omit({ schemaVersion: true }).extend({
  schemaVersion: z.literal(CALIBRATION_COMPUTE_EVIDENCE_VERSION),
  devices: z.array(calibrationComputeDeviceEvidenceSchema).max(1024),
  allocation: z.object({
    strategy: z.enum(["weighted_data_parallel", "single_device", "cpu_fallback"]),
    allEligibleDevicesReceivedLoad: z.boolean(),
    allLoadedDevicesHaveTelemetry: z.boolean(),
    modelSplitUsed: z.boolean(),
    modelSplitReason: z.string().min(1).max(1_000).nullable(),
    numaAware: z.boolean(),
  }),
  scaling: z.object({
    baselineDeviceCount: z.number().int().nonnegative().max(1024),
    activeDeviceCount: z.number().int().nonnegative().max(1024),
    measuredSpeedup: z.number().nonnegative().nullable(),
    efficiencyPercent: z.number().nonnegative().max(10_000).nullable(),
    linearlyExtrapolated: z.literal(false),
  }),
  degraded: z.object({
    simulatedLostDeviceId: z.string().min(1).max(240).nullable(),
    measured: z.boolean(),
    safeCameraCapacity: z.number().int().min(1).max(MAX_PROJECT_CAMERAS).nullable(),
    capacityLossPercent: z.number().min(0).max(100).nullable(),
  }),
});

export const localCalibrationRunSchema = z.object({
  schemaVersion: z.union([
    z.literal(AUTONOMOUS_LOCAL_CALIBRATION_VERSION),
    z.literal(LEGACY_AUTONOMOUS_LOCAL_CALIBRATION_VERSION),
    z.literal(LEGACY_LOCAL_CALIBRATION_VERSION),
    z.literal(TELEMETRY_LOCAL_CALIBRATION_VERSION),
    z.literal(LOCAL_CALIBRATION_VERSION),
  ]),
  id: z.string().uuid(),
  planId: z.string().uuid(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  workloadContractVersion: z.union([z.literal(WORKLOAD_CONTRACT_VERSION), z.literal("perceptrum-workload/3.0.0"), z.literal("perceptrum-workload/2.0.0")]),
  mode: z.enum(["quick", "validation", "qualification", "full"]),
  executionMode: z.enum(["readiness", "production_pipeline"]).optional(),
  developmentOnly: z.literal(true).optional(),
  fingerprint: z.object({
    hardwareTemplateId: z.string().min(1).max(160).nullable(),
    hostnameHash: z.string().min(16).max(256),
    cpuModel: z.string().min(1).max(240),
    cpuArchitecture: z.string().min(1).max(120),
    physicalCores: z.number().int().positive().max(1024),
    logicalCores: z.number().int().positive().max(2048),
    cpuPowerLimitWatts: z.number().positive().max(10_000).nullable(),
    gpuModel: z.string().min(1).max(240),
    gpuArchitecture: z.string().min(1).max(120),
    gpuCount: z.number().int().nonnegative().max(32),
    gpuVramBytes: z.number().int().nonnegative().nullable(),
    unifiedMemoryBytes: z.number().int().positive().nullable().optional(),
    gpuDriver: z.string().min(1).max(160),
    ramBytes: z.number().int().positive(),
    memoryChannels: z.number().int().positive().max(32).nullable(),
    memorySpeedMtps: z.number().positive().max(100_000).nullable(),
    storageModel: z.string().min(1).max(240),
    filesystem: z.string().min(1).max(120),
    nicModel: z.string().min(1).max(240),
    operatingSystem: operatingSystemSchema,
    operatingSystemVersion: z.string().min(1).max(240),
    powerProfile: z.string().min(1).max(160),
    formFactor: z.enum(["laptop", "mini_pc", "workstation", "rack", "unknown"]),
    coolingProfile: z.string().min(1).max(240),
    perceptrumBuildHash: z.string().min(1).max(128),
    aiqModel: z.string().min(1).max(240),
    aiqModelHash: z.string().min(1).max(256),
    inferenceBackend: z.string().min(1).max(160),
    cpuPackages: z.array(calibrationCpuPackageSchema).max(1024).optional(),
    processorGroups: z.array(calibrationProcessorGroupSchema).max(1024).optional(),
    numaNodes: z.array(calibrationNumaNodeSchema).max(1024).optional(),
    gpuDevices: z.array(calibrationGpuDeviceSchema).max(1024).optional(),
  }),
  requestedSourceFps: z.number().positive().max(120),
  measuredSourceFps: z.number().nonnegative().max(240),
  requestedInferenceFps: z.number().int().min(1).max(5),
  effectiveInferenceFps: z.number().min(0).max(5),
  framesPlanned: z.number().int().nonnegative(),
  framesExtracted: z.number().int().nonnegative(),
  framesPacked: z.number().int().nonnegative(),
  framesInferred: z.number().int().nonnegative(),
  rtspOrigin: z.string().url().refine((value) => new URL(value).hostname === "127.0.0.1", "RTSP must use 127.0.0.1"),
  aiqOrigin: z.string().url().refine((value) => new URL(value).hostname === "127.0.0.1", "AiQ must use 127.0.0.1"),
  networkPolicy: z.literal("loopback_only"),
  externalRequestCount: z.literal(0),
  openAiRequestCount: z.literal(0),
  mediaFieldCount: z.literal(0),
  credentialFieldCount: z.literal(0),
  stages: z.array(z.object({
    stage: calibrationStageSchema,
    safeCameraCapacity: z.number().nonnegative().nullable(),
    throughput: z.number().nonnegative().nullable(),
    throughputUnit: z.string().min(1).max(80),
    p95LatencyMs: z.number().nonnegative().nullable(),
    peakUtilizationPercent: z.number().min(0).max(100).nullable(),
    queueGrowthPerMinute: z.number(),
    thermalThrottlePercent: z.number().min(0).max(100).nullable(),
    evidenceStatus: telemetryEvidenceStatusSchema.optional(),
    reason: z.string().min(1).max(500).optional(),
    measurementSource: z.string().min(1).max(240).optional(),
    utilizationEvidence: z.array(z.string().min(1).max(500)).max(50).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })).min(6),
  phases: z.array(z.object({
    name: z.enum(["warmup", "ramp", "sustained", "surge"]),
    durationSeconds: z.number().int().positive(),
    loadPercent: z.number().positive(),
    cameraCount: z.number().int().positive(),
    inferenceSuccessRate: z.number().min(0).max(1),
    p99InferenceLatencyMs: z.number().nonnegative().optional(),
    inferenceIntervalMs: z.number().positive().optional(),
    inferenceIntervalSeconds: z.number().positive().optional(),
    maxQueueDepth: z.number().int().nonnegative(),
    queueGrowthPerMinute: z.number(),
    outOfMemoryCount: z.number().int().nonnegative(),
    plannedDecodedFrames: z.number().int().nonnegative().optional(),
    decodedFrames: z.number().int().nonnegative().optional(),
    frameDeliveryRate: z.number().min(0).max(1).optional(),
    thermalThrottlePercent: z.number().min(0).max(100).nullable().optional(),
  })).min(3).max(4),
  overallSafeCameraCapacity: z.number().nonnegative().nullable(),
  bottleneck: calibrationStageSchema,
  pipelineEvidence: z.object({
    complete: z.boolean(),
    isolatedDatabase: z.boolean(),
    sourceRegistered: z.boolean(),
    rtspClipProvided: z.boolean(),
    intelligenceJobQueued: z.boolean(),
    schedulerClaimedJob: z.boolean(),
    aiqLocalCompleted: z.boolean(),
    resultPersisted: z.boolean(),
    concurrentWithLoad: z.boolean().optional(),
    phaseCoverage: z.array(z.object({
      phase: z.enum(["warmup", "ramp", "sustained", "surge"]),
      completedProbeCount: z.number().int().nonnegative(),
      failedProbeCount: z.number().int().nonnegative().optional(),
    })).max(20).optional(),
  }).loose().optional(),
  qualityGate: z.object({
    eligibleForCapacityExtrapolation: z.boolean(),
    evidenceLevel: z.enum(["validated_local", "representative_only"]),
    validationStatus: z.enum(["diagnostic", "anchor_approved", "invalid"]).optional(),
    failures: z.array(z.string().max(240)).max(100),
    warnings: z.array(z.string().max(240)).max(100),
  }).optional(),
  executionHealth: z.object({
    status: z.enum(["completed", "completed_with_errors"]),
    infrastructureErrors: z.array(z.string().min(1).max(500)).max(100),
  }).optional(),
  capacityRecommendation: z.object({
    safeCameraCount: z.number().int().min(1).max(MAX_PROJECT_CAMERAS).nullable(),
    maximumTestedCameraCount: z.number().int().min(1).max(MAX_PROJECT_CAMERAS),
    confidence: z.enum(["high", "medium", "insufficient"]),
    basis: z.literal("physical_measurement"),
  }).optional(),
  sensorCoverage: z.object({
    measured: z.array(z.string().min(1).max(160)).max(200),
    unavailable: z.array(z.string().min(1).max(160)).max(200),
  }).optional(),
  runtimeTrust: z.object({
    classification: z.enum(["candidate", "production"]),
    manifestApproved: z.boolean(),
    technicalCapacityAllowed: z.literal(true),
    commercialQualificationAllowed: z.boolean(),
  }).optional(),
  limitingSubsystems: z.array(calibrationStageSchema).max(20).optional(),
  inferenceEvidence: z.object({
    requestsPlanned: z.number().int().nonnegative(),
    requestsAttempted: z.number().int().nonnegative(),
    requestsSuccessful: z.number().int().nonnegative(),
    framesPacked: z.number().int().nonnegative(),
    maximumConcurrency: z.number().int().nonnegative(),
    p95LatencyMs: z.number().nonnegative().nullable(),
    p99LatencyMs: z.number().nonnegative().nullable(),
    errors: z.array(z.string().min(1).max(500)).max(100),
  }).optional(),
  kernelVersion: z.union([z.literal("qual-hardware-calibration-kernel/1.0.0"), z.literal("qual-hardware-calibration-kernel/2.0.0")]).optional(),
  runtimeManifestHash: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  runtimeProvenance: z.object({
    platform: z.enum(["aix", "android", "darwin", "freebsd", "haiku", "linux", "openbsd", "sunos", "win32", "cygwin", "netbsd"]),
    architecture: z.string().min(1).max(120),
    featureMode: z.enum(["disabled", "diagnostic", "full"]),
    manifestApproved: z.boolean().optional(),
    contracts: z.array(z.object({
      id: z.enum(["authority", "pipeline", "sources"]),
      status: z.enum(["verified", "missing", "mismatch"]),
      sha256: z.string().regex(/^[0-9a-f]{64}$/i).nullable(),
      expectedSha256: z.string().regex(/^[0-9a-f]{64}$/i),
    })).max(10),
    assets: z.array(z.object({
      id: z.string().min(1).max(160),
      status: z.enum(["verified", "missing", "mismatch", "system_only"]),
      sha256: z.string().regex(/^[0-9a-f]{64}$/i).nullable(),
      sizeBytes: z.number().int().nonnegative().nullable(),
      expectedSizeBytes: z.number().int().nonnegative().nullable(),
      version: z.string().min(1).max(240).nullable(),
      licenseSpdx: z.string().min(1).max(240).nullable(),
      sbomRef: z.string().min(1).max(1_000).nullable(),
    })).max(100),
  }).optional(),
  workloadProfileId: z.string().min(1).max(160).optional(),
  workloadProfileSignature: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  compatiblePerceptrumCommit: z.string().regex(/^[0-9a-f]{40}$/i).optional(),
  cameraTiers: z.array(z.number().int().min(1).max(MAX_PROJECT_CAMERAS)).max(256).optional(),
  tierResults: z.array(z.object({
    tier: z.number().int().min(1).max(MAX_PROJECT_CAMERAS),
    repetition: z.number().int().min(1).max(3).nullable(),
    computeMode: calibrationComputeModeSchema.optional(),
    phase: z.enum(["discovery", "warmup", "ramp", "sustained", "surge"]),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    passed: z.boolean(),
    frameDeliveryRate: z.number().min(0).max(1),
    inferenceSuccessRate: z.number().min(0).max(1),
    p99InferenceLatencyMs: z.number().nonnegative(),
    inferenceIntervalMs: z.number().positive(),
    p95BottleneckUtilizationPercent: z.number().min(0).max(100),
    queueGrowthPerMinute: z.number(),
    outOfMemoryCount: z.number().int().nonnegative(),
    thermalThrottlePercent: z.number().min(0).max(100).nullable(),
    failures: z.array(z.string().min(1).max(240)).max(100),
  })).max(1_000).optional(),
  repetitions: z.array(z.object({
    repetition: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    tier: z.number().int().min(1).max(MAX_PROJECT_CAMERAS),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    passed: z.boolean(),
    safeCameraCapacity: z.number().int().min(0).max(MAX_PROJECT_CAMERAS),
    failures: z.array(z.string().min(1).max(240)).max(100),
  })).max(3).optional(),
  maxTestedTier: z.number().int().min(1).max(MAX_PROJECT_CAMERAS).optional(),
  capacityBound: z.enum(["exact", "at_least", "uncertain"]).optional(),
  capacityBoundary: z.object({
    seedCameraCount: z.number().int().min(1).max(MAX_PROJECT_CAMERAS),
    highestPassingCameraCount: z.number().int().min(1).max(MAX_PROJECT_CAMERAS).nullable(),
    firstFailingCameraCount: z.number().int().min(1).max(MAX_PROJECT_CAMERAS).nullable(),
    operationalSafeCameraCount: z.number().int().min(1).max(MAX_PROJECT_CAMERAS).nullable(),
    bound: z.enum(["exact", "at_least", "uncertain"]),
    adjacentBoundaryConfirmed: z.boolean(),
    confirmationRuns: z.number().int().min(1).max(10),
    generatorLimit: z.number().int().min(1).max(MAX_PROJECT_CAMERAS).nullable(),
    nonMonotonic: z.boolean(),
    searchTrace: z.array(z.object({
      cameraCount: z.number().int().min(1).max(MAX_PROJECT_CAMERAS),
      passed: z.boolean(),
      attempt: z.number().int().positive(),
      phase: z.enum(["seed", "expand", "binary", "confirm"]),
    })).max(10_000),
  }).optional(),
  repeatVariabilityPercent: z.number().nonnegative().max(10_000).optional(),
  computeEvidence: z.union([calibrationComputeEvidenceV1Schema, calibrationComputeEvidenceV2Schema]).optional(),
  networkEvidence: z.enum(["loopback_measured_physical_link_unverified", "loopback_measured_physical_link_spec_verified", "unavailable"]).optional(),
  physicalNetworkLinks: z.array(z.object({
    name: z.string().min(1).max(240),
    speedMbps: z.number().positive().nullable(),
    duplex: z.enum(["full", "half", "unknown"]),
    physicalLinkVerified: z.boolean(),
  })).max(64).optional(),
  advancedTelemetryRequested: z.boolean().optional(),
  telemetrySampleIntervalMs: z.number().int().positive().max(60_000).optional(),
  telemetrySampleCount: z.number().int().nonnegative().optional(),
  telemetryCapabilities: z.array(z.object({
    id: z.string().min(1).max(160),
    status: telemetryEvidenceStatusSchema,
    provider: z.string().min(1).max(240),
    reason: z.string().min(1).max(1_000).optional(),
  })).max(200).optional(),
  resourceSummaries: z.array(z.object({
    phase: z.string().min(1).max(120),
    computeMode: calibrationComputeModeSchema.optional(),
  }).catchall(z.union([telemetryMetricSummarySchema, z.null()]))).max(200).optional(),
  processGroups: z.array(z.object({
    group: z.string().min(1).max(120),
    sampleCount: z.number().int().nonnegative(),
    cpuUtilizationPercent: telemetryMetricSummarySchema.nullable().optional(),
    residentMemoryBytes: telemetryMetricSummarySchema.nullable().optional(),
    cumulativeCpuSeconds: telemetryMetricSummarySchema.nullable().optional(),
  }).loose()).max(100).optional(),
  artifact: z.object({
    fileName: z.string().min(1).max(500),
    payloadSha256: z.string().regex(/^[0-9a-f]{64}$/i),
    persistedAt: z.iso.datetime(),
    storage: z.enum(["documents_append_only", "application_data_append_only", "explicit_output"]),
  }).optional(),
  notes: z.array(z.string().max(500)).max(100),
}).superRefine((value, context) => {
  if (Date.parse(value.completedAt) <= Date.parse(value.startedAt)) {
    context.addIssue({ code: "custom", path: ["completedAt"], message: "Calibration completion must be after start." });
  }
  if (value.framesInferred > value.framesPacked || value.framesPacked > value.framesExtracted) {
    context.addIssue({ code: "custom", path: ["framesInferred"], message: "Frame counters are not monotonic." });
  }
  if (value.qualityGate?.eligibleForCapacityExtrapolation && value.pipelineEvidence?.complete !== true) {
    context.addIssue({ code: "custom", path: ["pipelineEvidence"], message: "Eligible calibration requires complete production-pipeline evidence." });
  }
  if (value.schemaVersion === TELEMETRY_LOCAL_CALIBRATION_VERSION || value.schemaVersion === LOCAL_CALIBRATION_VERSION ||
      value.schemaVersion === AUTONOMOUS_LOCAL_CALIBRATION_VERSION) {
    if (!value.telemetryCapabilities?.length) {
      context.addIssue({ code: "custom", path: ["telemetryCapabilities"], message: "Telemetry calibration requires capability declarations." });
    }
    value.telemetryCapabilities?.forEach((capability, index) => {
      if (capability.status !== "measured" && !capability.reason?.trim()) {
        context.addIssue({ code: "custom", path: ["telemetryCapabilities", index, "reason"], message: "Unavailable telemetry requires a reason." });
      }
    });
    if (!value.resourceSummaries || !value.processGroups) {
      context.addIssue({ code: "custom", path: ["resourceSummaries"], message: "Telemetry calibration requires resource and process summaries." });
    }
    value.stages.forEach((stage, index) => {
      if (!stage.evidenceStatus) {
        context.addIssue({ code: "custom", path: ["stages", index, "evidenceStatus"], message: "Telemetry calibration requires evidence status for every stage." });
      }
      if (stage.evidenceStatus && stage.evidenceStatus !== "measured" && !stage.reason?.trim()) {
        context.addIssue({ code: "custom", path: ["stages", index, "reason"], message: "Unavailable stage evidence requires a reason." });
      }
    });
    if (!value.artifact) {
      context.addIssue({ code: "custom", path: ["artifact"], message: "Telemetry calibration requires persisted artifact metadata." });
    }
  }
  if (value.schemaVersion === LOCAL_CALIBRATION_VERSION || value.schemaVersion === AUTONOMOUS_LOCAL_CALIBRATION_VERSION) {
    const requiredStages = new Set([
      "rtsp_ingest", "video_decode", "bgr_processing", "video_encode", "disk_write", "disk_read",
      "frame_extraction", "local_inference", "memory_bandwidth", "network_ingest", "job_scheduler",
      "intelligence_scheduler", "database_persistence", "dashboard_queries", "thermal_sustain",
    ]);
    const measuredStages = new Set(value.stages.map((stage) => stage.stage));
    for (const stage of requiredStages) {
      if (!measuredStages.has(stage as typeof value.stages[number]["stage"])) {
        context.addIssue({ code: "custom", path: ["stages"], message: `Calibration is missing required stage ${stage}.` });
      }
    }
    if ((value.mode === "qualification" || value.mode === "full") && value.phases.map((phase) => phase.name).join(",") !== "warmup,ramp,sustained,surge") {
      context.addIssue({ code: "custom", path: ["phases"], message: "Qualification requires warmup, ramp, sustained and surge phases." });
    }
    if (value.qualityGate?.eligibleForCapacityExtrapolation) {
      const proof = value.pipelineEvidence;
      const requiredProof = [
        proof?.jobSchedulerExecuted,
        proof?.jobRuntimeExecuted,
        proof?.jobStepRunsPersisted,
        proof?.databaseWritesPersisted,
        proof?.intelligenceSchedulerExecuted,
        proof?.dashboardQueriesExecuted,
      ];
      if (requiredProof.some((item) => item !== true)) {
        context.addIssue({ code: "custom", path: ["pipelineEvidence"], message: "Purchase-eligible calibration requires Jobs, Steps, Agents, Intelligence, persistence and dashboard proof." });
      }
      if (proof?.concurrentWithLoad !== true) {
        context.addIssue({ code: "custom", path: ["pipelineEvidence", "concurrentWithLoad"], message: "Purchase-eligible calibration requires the production pipeline to overlap the measured load." });
      }
      const coveredPhases = new Set(proof?.phaseCoverage?.filter((item) => item.completedProbeCount > 0).map((item) => item.phase) ?? []);
      for (const phase of ["warmup", "ramp", "sustained", "surge"] as const) {
        if (!coveredPhases.has(phase)) context.addIssue({ code: "custom", path: ["pipelineEvidence", "phaseCoverage"], message: `Purchase-eligible calibration lacks concurrent production evidence for ${phase}.` });
      }
    }
  }
  if (value.schemaVersion === AUTONOMOUS_LOCAL_CALIBRATION_VERSION) {
    if (value.mode === "full") {
      context.addIssue({ code: "custom", path: ["mode"], message: "Version 4 uses quick, validation or qualification mode." });
    }
    if (!value.kernelVersion || !value.runtimeManifestHash || !value.workloadProfileId || !value.workloadProfileSignature ||
        !value.compatiblePerceptrumCommit || !value.tierResults?.length || !value.cameraTiers?.length || !value.networkEvidence) {
      context.addIssue({ code: "custom", path: ["kernelVersion"], message: "Autonomous calibration requires kernel, profile, provenance, tiers and network evidence." });
    }
    if (value.workloadProfileId !== `workload:${value.workloadProfileSignature}`) {
      context.addIssue({ code: "custom", path: ["workloadProfileId"], message: "Autonomous calibration workload ID must match its canonical signature." });
    }
    if (value.compatiblePerceptrumCommit !== PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT ||
        (value.qualityGate?.eligibleForCapacityExtrapolation &&
          value.fingerprint.perceptrumBuildHash !== PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT)) {
      context.addIssue({ code: "custom", path: ["compatiblePerceptrumCommit"], message: "Autonomous calibration must target the approved immutable Perceptrum authority build." });
    }
    if (value.qualityGate?.eligibleForCapacityExtrapolation) {
      const compute = value.computeEvidence;
      if (!compute || !compute.cpu.measured || compute.cpu.safeCameraCapacity === null ||
          !compute.gpu.inferenceMeasured || !compute.gpu.mediaMeasured || !compute.gpu.utilizationMeasured ||
          compute.gpu.safeCameraCapacity === null || !compute.combined.measured ||
          compute.combined.safeCameraCapacity === null) {
        context.addIssue({
          code: "custom",
          path: ["computeEvidence"],
          message: "Purchase eligibility requires measured CPU-only, GPU-accelerated and concurrent CPU+GPU evidence.",
        });
      }
      if (compute?.schemaVersion === CALIBRATION_COMPUTE_EVIDENCE_VERSION &&
          (!compute.allocation.allEligibleDevicesReceivedLoad || !compute.allocation.allLoadedDevicesHaveTelemetry ||
            compute.devices.some((device) => device.classification === "compute" &&
              (!device.receivedLoad || !device.telemetryMeasured)))) {
        context.addIssue({
          code: "custom",
          path: ["computeEvidence", "allocation"],
          message: "Multi-device purchase eligibility requires load and individual telemetry for every eligible device.",
        });
      }
      if (value.repetitions?.length !== 3 || !value.repetitions.every((item) => item.passed && item.safeCameraCapacity > 0)) {
        context.addIssue({ code: "custom", path: ["repetitions"], message: "Purchase eligibility requires three successful full repetitions." });
      }
      if ((value.repeatVariabilityPercent ?? Number.POSITIVE_INFINITY) > 10) {
        context.addIssue({ code: "custom", path: ["repeatVariabilityPercent"], message: "Purchase eligibility requires at most 10% repetition variability." });
      }
      if (value.networkEvidence !== "loopback_measured_physical_link_spec_verified" ||
          !value.physicalNetworkLinks?.some((link) => link.physicalLinkVerified && link.speedMbps !== null && link.duplex === "full")) {
        context.addIssue({ code: "custom", path: ["networkEvidence"], message: "Purchase eligibility requires a verified full-duplex physical link specification in addition to loopback traffic." });
      }
      if (value.runtimeProvenance?.featureMode !== "full" || value.runtimeProvenance.manifestApproved !== true ||
          !value.runtimeProvenance.contracts.length ||
          !value.runtimeProvenance.assets.length || value.runtimeProvenance.contracts.some((item) => item.status !== "verified") ||
          value.runtimeProvenance.assets.some((item) => item.status !== "verified")) {
        context.addIssue({ code: "custom", path: ["runtimeProvenance"], message: "Purchase eligibility requires the complete verified offline runtime provenance." });
      }
    }
    if (value.capacityBound === "exact" && value.capacityBoundary &&
        (!value.capacityBoundary.adjacentBoundaryConfirmed ||
          value.capacityBoundary.highestPassingCameraCount === null ||
          value.capacityBoundary.firstFailingCameraCount !== value.capacityBoundary.highestPassingCameraCount + 1)) {
      context.addIssue({
        code: "custom",
        path: ["capacityBoundary"],
        message: "An exact capacity requires repeated adjacent passing and failing camera counts.",
      });
    }
  }
});

export const calibrationSessionProgressSchema = z.object({
  schemaVersion: z.literal(CALIBRATION_PROGRESS_VERSION),
  phase: z.string().max(120).optional(),
  stage: z.string().max(120).optional(),
  percent: z.number().min(0).max(100),
  overallPercent: z.number().min(0).max(100),
  phasePercent: z.number().min(0).max(100),
  message: z.string().max(1_000).optional(),
  tier: z.number().int().min(1).max(MAX_PROJECT_CAMERAS).optional(),
  repetition: z.number().int().min(1).max(3).optional(),
  attempt: z.number().int().min(1).max(10_000).optional(),
  computeMode: calibrationComputeModeSchema.optional(),
  sessionStartedAt: z.iso.datetime(),
  phaseStartedAt: z.iso.datetime(),
  elapsedSeconds: z.number().nonnegative(),
  estimatedRemainingSeconds: z.number().nonnegative().nullable(),
  estimatedCompletionAt: z.iso.datetime().nullable(),
  minimumDurationSeconds: z.number().nonnegative(),
  maximumDurationSeconds: z.number().nonnegative(),
  estimateConfidence: z.enum(["low", "medium", "high"]),
  estimateAdjusted: z.boolean(),
  bytesTemporary: z.number().int().nonnegative(),
  bytesRemoved: z.number().int().nonnegative(),
  bytesProjected: z.number().int().nonnegative(),
  diskFreeBytes: z.number().int().nonnegative(),
  diskReserveBytes: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
});

export const calibrationCheckpointSchema = z.object({
  schemaVersion: z.literal(CALIBRATION_CHECKPOINT_VERSION),
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  runId: z.string().uuid(),
  sequence: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  phase: z.enum(["preflight", "discovery", "qualification", "terminal"]),
  tier: z.number().int().min(1).max(MAX_PROJECT_CAMERAS).nullable(),
  repetition: z.number().int().min(1).max(3).nullable(),
  attempt: z.number().int().positive(),
  compatibility: z.object({
    hardwareDigest: z.string().regex(/^[a-f0-9]{64}$/),
    operatingSystem: z.enum(["windows", "ubuntu", "macos"]),
    operatingSystemVersion: z.string().min(1).max(240),
    gpuDriver: z.string().min(1).max(160),
    workloadProfileSignature: z.string().regex(/^[a-f0-9]{64}$/),
    targetBuildHash: z.string().min(1).max(128),
    kernelVersion: z.string().min(1).max(160),
    runtimeManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    modelHash: z.string().regex(/^[a-f0-9]{64}$/),
    calibrationPolicyHash: z.string().regex(/^[a-f0-9]{64}$/),
    appVersion: z.string().min(1).max(120),
  }),
  completedDiscoveryTiers: z.array(z.number().int().min(1).max(MAX_PROJECT_CAMERAS)).max(256),
  highestPassedDiscoveryTier: z.number().int().min(1).max(MAX_PROJECT_CAMERAS).nullable(),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const calibrationWorkloadProfileSchema = z.object({
  schemaVersion: z.literal("qual-hardware-calibration-workload-profile/1.0.0"),
  id: z.string().regex(/^workload:[a-f0-9]{64}$/),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
  targetBuildHash: z.string().min(1).max(128),
  workloadContractVersion: z.literal(WORKLOAD_CONTRACT_VERSION),
  operatingSystem: z.enum(["auto", "windows", "ubuntu", "macos"]).optional(),
  cameraGroups: z.array(z.object({
    sharePpm: z.number().int().min(0).max(1_000_000),
    codec: z.enum(["h264", "h265"]),
    width: z.number().int().min(160).max(8_192),
    height: z.number().int().min(120).max(8_192),
    sourceFps: z.number().int().min(1).max(120),
    bitrateMbps: z.number().positive().max(500),
    decodeMode: z.enum(["cpu", "gpu"]),
    motionPercent: z.number().min(0).max(100),
    storage: z.object({
      storeVideo: z.boolean(), retentionDays: z.number().int().min(0).max(3_650), raidFactor: z.number().min(1).max(3),
    }),
    agents: z.array(agentLoadSchema.omit({ id: true, name: true })).max(32),
  })).min(1).max(128),
  concurrentWorkloads: capacityScenarioSchema.shape.concurrentWorkloads,
});

const qhcalDeviceProofSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  publicKeyPem: z.string().min(80).max(4_096),
  shortCode: z.string().regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/),
});

export const qhcalPackageSchema = z.object({
  schemaVersion: z.union([z.literal(QHCAL_PACKAGE_VERSION), z.literal(LEGACY_QHCAL_PACKAGE_VERSION)]),
  packageId: z.string().uuid(),
  createdAt: z.iso.datetime(),
  device: qhcalDeviceProofSchema,
  run: localCalibrationRunSchema,
  workloadProfile: calibrationWorkloadProfileSchema,
  systemIdentity: z.object({
    hardwareDigest: z.string().regex(/^[a-f0-9]{64}$/),
    hardwareTemplateId: z.string().min(1).max(160).nullable(),
    cpuModel: z.string().min(1).max(240), cpuArchitecture: z.string().min(1).max(120),
    physicalCores: z.number().int().positive().max(1_024), logicalCores: z.number().int().positive().max(2_048),
    gpuModel: z.string().min(1).max(240), gpuArchitecture: z.string().min(1).max(120),
    gpuCount: z.number().int().nonnegative().max(64), gpuVramBytes: z.number().int().nonnegative().nullable(),
    gpuDriver: z.string().min(1).max(160), ramBytes: z.number().int().positive(),
    operatingSystem: z.enum(["windows", "ubuntu", "macos"]), operatingSystemVersion: z.string().min(1).max(240),
    formFactor: z.enum(["laptop", "mini_pc", "workstation", "rack"]).nullable(),
  }),
  provenance: z.object({
    source: z.literal("local"), producerDeviceId: z.string().regex(/^[a-f0-9]{64}$/),
    exporterVersion: z.string().min(1).max(120),
  }),
  runDigest: z.string().regex(/^[a-f0-9]{64}$/),
  signatureAlgorithm: z.literal("Ed25519"),
  signature: z.string().min(80).max(512),
});

export const qhcalSetPackageSchema = z.object({
  schemaVersion: z.union([z.literal(QHCALSET_PACKAGE_VERSION), z.literal(LEGACY_QHCALSET_PACKAGE_VERSION)]),
  collectionId: z.string().uuid(),
  createdAt: z.iso.datetime(),
  packages: z.array(qhcalPackageSchema).max(10_000),
  packageDigests: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(10_000),
  exporter: qhcalDeviceProofSchema,
  signatureAlgorithm: z.literal("Ed25519"),
  signature: z.string().min(80).max(512),
}).superRefine((value, context) => {
  if (value.packages.length !== value.packageDigests.length) {
    context.addIssue({ code: "custom", path: ["packageDigests"], message: "Collection index length must match package count." });
  }
});

export const calibrationSessionRequestSchema = z.object({
  recommendationId: z.string().uuid(),
  mode: z.enum(["quick", "validation", "qualification"]),
  targetHardwareTemplateId: z.string().min(1).max(160).nullable(),
  advancedTelemetry: z.boolean().default(false),
});

export const hardwareComponentKindSchema = z.enum([
  "cpu", "gpu", "motherboard", "memory_kit", "storage_os", "storage_retention", "nic", "psu", "cooling",
  "chassis", "oem_system", "rack_configuration", "memory", "storage", "network", "system",
]);

export const componentSpecificationEvidenceSchema = z.object({
  sourceId: z.string().min(1).max(160),
  url: z.string().url().refine((value) => new URL(value).protocol === "https:"),
  retrievedAt: z.iso.datetime(),
  evidenceLocator: z.string().min(1).max(1_000),
  rawArtifactSha256: z.string().regex(/^[0-9a-f]{64}$/i),
  licensePolicy: z.string().min(1).max(500),
});

const specificationScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const manufacturerSpecificationObservationSchema = z.object({
  schemaVersion: z.literal(MANUFACTURER_SPECIFICATION_OBSERVATION_VERSION),
  id: z.string().min(1).max(500),
  componentId: z.string().min(1).max(240),
  manufacturer: z.string().min(1).max(160),
  canonicalMpn: z.string().min(1).max(240),
  scope: z.enum(["sku", "family", "architecture", "platform"]),
  subject: z.string().min(1).max(240),
  fieldCode: z.string().regex(/^[a-z][a-z0-9_.-]{1,119}$/),
  sectionCode: z.string().regex(/^[a-z][a-z0-9_.-]{1,119}$/),
  sectionLabelPt: z.string().min(1).max(240),
  displayOrder: z.number().int().nonnegative().max(100_000),
  valueType: z.enum(["string", "number", "boolean"]),
  originalLabel: z.string().min(1).max(240),
  originalValue: specificationScalarSchema,
  originalUnit: z.string().min(1).max(80).nullable(),
  normalizedValue: specificationScalarSchema,
  normalizedUnit: z.string().min(1).max(80).nullable(),
  authority: z.enum(["official_sku", "official_family", "official_matrix", "secondary_reference"]),
  sourceId: z.string().min(1).max(160),
  sourceUrl: z.string().url().refine((value) => new URL(value).protocol === "https:"),
  retrievedAt: z.iso.datetime(),
  evidenceLocator: z.string().min(1).max(1_000),
  rawArtifactSha256: z.string().regex(/^[0-9a-f]{64}$/i),
  parserId: z.string().min(1).max(160),
  parserVersion: z.string().min(1).max(80),
  licensePolicy: z.string().min(1).max(500),
});

const technicalSpecificationResolutionSchema = z.object({
  status: z.enum(["resolved", "not_published", "ambiguous", "conflicting", "rejected"]),
  selectedObservationId: z.string().min(1).max(500).nullable(),
  observationIds: z.array(z.string().min(1).max(500)).max(100),
  rationale: z.string().min(1).max(1_000),
  resolvedAt: z.iso.datetime(),
});

export const componentTechnicalSpecificationSchema = z.object({
  schemaVersion: z.union([
    z.literal(COMPONENT_TECHNICAL_SPECIFICATION_VERSION),
    z.literal(LEGACY_COMPONENT_TECHNICAL_SPECIFICATION_VERSION),
  ]),
  componentId: z.string().min(1).max(240),
  specificationVersion: z.string().min(1).max(120),
  generatedAt: z.iso.datetime(),
  fields: z.array(z.object({
    code: z.string().regex(/^[a-z][a-z0-9_.-]{1,119}$/),
    labelPt: z.string().min(1).max(240),
    valueType: z.enum(["string", "number", "boolean"]),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    unit: z.string().min(1).max(60).nullable(),
    originalLabel: z.string().min(1).max(240).nullable(),
    originalValue: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    status: z.enum(["published", "not_published", "not_applicable", "ambiguous", "conflicting", "rejected"]),
    required: z.boolean(),
    roles: z.array(z.enum(["compatibility", "dimensioning", "procurement", "informational"])).min(1).max(4),
    sourceEvidence: z.array(componentSpecificationEvidenceSchema).max(30),
    confidence: z.enum(["official", "derived_legacy", "unverified"]),
    normalizationRule: z.string().max(500).nullable(),
    sectionCode: z.string().regex(/^[a-z][a-z0-9_.-]{1,119}$/).optional(),
    sectionLabelPt: z.string().min(1).max(240).optional(),
    displayOrder: z.number().int().nonnegative().max(100_000).optional(),
    resolution: technicalSpecificationResolutionSchema.optional(),
  })).max(500),
  completeness: z.object({
    requiredFieldCount: z.number().int().nonnegative(),
    publishedRequiredFieldCount: z.number().int().nonnegative(),
    missingRequiredFieldCodes: z.array(z.string()).max(500),
    conflictingFieldCodes: z.array(z.string()).max(500),
    percent: z.number().min(0).max(100),
    complete: z.boolean(),
    procurementReady: z.boolean(),
    reasons: z.array(z.string().max(500)).max(500),
  }),
  observations: z.array(manufacturerSpecificationObservationSchema).max(20_000).optional(),
});

export const hardwareComponentSchema = z.object({
  id: z.string().min(1).max(240),
  kind: hardwareComponentKindSchema,
  manufacturer: z.string().min(1).max(160),
  sku: z.string().min(1).max(240),
  architecture: z.string().min(1).max(160),
  specifications: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  sourceUrls: z.array(z.string().url().refine((value) => new URL(value).protocol === "https:")).min(1).max(30),
  canonicalMpn: z.string().min(1).max(240).optional(),
  aliases: z.array(z.string().min(1).max(240)).max(100).optional(),
  generation: z.enum(["current", "previous", "two_generations_back", "historical"]).optional(),
  marketState: z.enum(["active", "discontinued", "reference_only"]).optional(),
  inventoryState: z.enum(["discovered_inventory", "qualified_recommendation_universe"]).optional(),
  specificationVersion: z.string().min(1).max(120).optional(),
  compatibility: z.object({
    socket: z.string().max(120).nullable().optional(),
    chipsets: z.array(z.string().min(1).max(120)).max(100).optional(),
    minimumBios: z.string().max(160).nullable().optional(),
    memoryType: z.string().max(120).nullable().optional(),
    memoryChannels: z.number().int().positive().max(32).nullable().optional(),
    maximumMemoryGb: z.number().positive().max(131_072).nullable().optional(),
    ecc: z.boolean().nullable().optional(),
    pcieGeneration: z.number().int().min(1).max(10).nullable().optional(),
    pcieLanesRequired: z.number().int().positive().max(512).nullable().optional(),
    slotsWide: z.number().positive().max(10).nullable().optional(),
    lengthMm: z.number().positive().max(2_000).nullable().optional(),
    heightMm: z.number().positive().max(1_000).nullable().optional(),
    continuousPowerWatts: z.number().positive().max(20_000).nullable().optional(),
    transientPowerWatts: z.number().positive().max(50_000).nullable().optional(),
    coolingCapacityWatts: z.number().positive().max(50_000).nullable().optional(),
    supportedCodecs: z.array(z.enum(["h264", "h265"])).max(2).optional(),
    operatingSystems: z.array(z.enum(["windows", "ubuntu", "macos"])).max(3).optional(),
    accelerationBackends: z.array(z.string().min(1).max(120)).max(30).optional(),
    oemLocked: z.boolean().optional(),
    replaceableComponentKinds: z.array(z.enum([
      "cpu", "gpu", "motherboard", "memory_kit", "storage_os", "storage_retention", "nic", "psu", "cooling",
      "chassis", "oem_system", "rack_configuration", "memory", "storage", "network", "system",
    ])).max(30).optional(),
  }).optional(),
  evidence: z.array(componentSpecificationEvidenceSchema).max(100).optional(),
  technicalSpecification: componentTechnicalSpecificationSchema.optional(),
  discoveredAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
});

const componentBuildRoleSchema = z.enum([
  "compute", "acceleration", "platform", "memory", "operating_storage", "retention_storage", "network", "power", "cooling", "chassis", "oem_system",
]);

export const marketCompetitionAssessmentSchema = z.object({
  status: z.enum(["adequate", "limited", "restricted", "no_coverage"]),
  matchingProductCount: z.number().int().nonnegative(),
  distinctManufacturerCount: z.number().int().nonnegative(),
  matchingComponentIds: z.array(z.string().min(1).max(240)).max(100_000),
  manufacturerNames: z.array(z.string().min(1).max(160)).max(10_000),
  safeForPublication: z.boolean(),
  reasons: z.array(z.string().min(1).max(500)).max(100),
});

export const procurementNeutralSpecificationSchema = z.object({
  schemaVersion: z.literal(PROCUREMENT_NEUTRAL_SPECIFICATION_VERSION),
  id: z.string().min(1).max(280),
  recommendationAlternativeId: z.string().min(1).max(240),
  generatedAt: z.iso.datetime(),
  nodeCount: z.number().int().positive(),
  activeNodeCount: z.number().int().positive(),
  status: z.enum(["apt", "review_required", "blocked"]),
  procurementEligibility: z.enum(["eligible", "planning_only", "blocked"]),
  requirements: z.array(z.object({
    id: z.string().min(1).max(280),
    componentKind: hardwareComponentKindSchema,
    componentRole: componentBuildRoleSchema,
    characteristicCode: z.string().regex(/^[a-z][a-z0-9_.-]{1,119}$/),
    characteristic: z.string().min(1).max(240),
    comparator: z.enum(["minimum", "maximum", "range", "equals", "supports", "prohibited"]),
    value: z.union([z.string(), z.number(), z.boolean()]),
    maximumValue: z.number().optional(),
    unit: z.string().min(1).max(60).nullable(),
    mandatory: z.boolean(),
    rationale: z.string().min(1).max(1_000),
    proofMethod: z.enum(["official_datasheet", "independent_benchmark", "technical_proposal", "sample_or_poc"]),
    acceptanceCriterion: z.string().min(1).max(1_000),
    sourceStage: z.union([calibrationStageSchema, z.enum(["compatibility", "capacity", "lifecycle"])]),
    quantityPerNode: z.number().int().positive(),
    projectQuantity: z.number().int().positive(),
    matchingComponentIds: z.array(z.string().min(1).max(240)).max(100_000),
  })).max(1_000),
  marketCompetitionAssessment: marketCompetitionAssessmentSchema,
  forbiddenIdentifierFindings: z.array(z.string().min(1).max(500)).max(1_000),
  disclaimers: z.array(z.string().min(1).max(1_000)).max(100),
});

export const publicBenchmarkObservationSchema = z.object({
  schemaVersion: z.enum(["qual-hardware-benchmark-observation/2.0.0", "qual-hardware-benchmark-observation/1.0.0"]).optional(),
  id: z.string().min(1).max(240),
  hardwareTemplateId: z.string().min(1).max(160),
  stage: calibrationStageSchema,
  profileId: z.string().min(1).max(240),
  benchmarkName: z.string().min(1).max(240),
  benchmarkVersion: z.string().min(1).max(120),
  score: z.number().positive(),
  unit: z.string().min(1).max(80),
  higherIsBetter: z.boolean(),
  componentId: z.string().min(1).max(240).optional(),
  componentKind: hardwareComponentSchema.shape.kind.optional(),
  sourceTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  sourceUrl: z.string().url().refine((value) => new URL(value).protocol === "https:", "Evidence source must use HTTPS"),
  observedAt: z.iso.datetime(),
  operatingSystem: z.union([operatingSystemSchema, z.literal("any")]),
  configuration: z.string().min(20).max(2_000),
  powerWatts: z.number().positive().max(20_000).nullable().optional(),
  driverVersion: z.string().min(1).max(240).nullable().optional(),
  coolingProfile: z.string().min(1).max(240).nullable().optional(),
  sampleCount: z.number().int().positive().max(1_000_000).optional(),
  qualityFlags: z.array(z.string().min(1).max(120)).max(40).optional(),
  benchmarkSuiteId: z.string().min(1).max(240).optional(),
  metricName: z.string().min(1).max(240).optional(),
  aggregation: z.enum(["single", "mean", "median", "p95", "p99", "peak", "rate"]).optional(),
  systemFingerprint: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  evidenceLocator: z.string().min(1).max(1_000).optional(),
  rawArtifactSha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  licensePolicy: z.string().min(1).max(500).optional(),
  reproducible: z.boolean().optional(),
  originalValue: z.number().positive().optional(),
  originalUnit: z.string().min(1).max(80).optional(),
  componentIds: z.array(z.string().min(1).max(240)).max(32).optional(),
  direction: z.enum(["higher_is_better", "lower_is_better"]).optional(),
  eligibility: z.enum(["eligible", "reference_only", "rejected"]).optional(),
  rejectionReasons: z.array(z.string().min(1).max(240)).max(100).optional(),
});

export const evidenceCatalogSnapshotSchema = z.object({
  schemaVersion: z.union([z.literal(EVIDENCE_CATALOG_VERSION), z.literal("qual-hardware-evidence-catalog/3.0.0"), z.literal("qual-hardware-evidence-catalog/2.0.0")]),
  catalogVersion: z.string().min(1).max(160),
  generatedAt: z.iso.datetime(),
  components: z.array(hardwareComponentSchema).max(100_000).optional(),
  observations: z.array(publicBenchmarkObservationSchema).min(1).max(100_000),
});

export const calibrationPlanRequestSchema = z.object({
  recommendationId: z.string().uuid(),
  mode: z.enum(["quick", "validation", "qualification"]),
  targetHardwareTemplateId: z.string().min(1).max(160).nullable(),
});

export const calibrationPlanSchema = z.object({
  schemaVersion: z.literal(CALIBRATION_PLAN_VERSION),
  id: z.string().uuid(),
  targetHardwareTemplateId: z.string().min(1).max(160).nullable(),
});

export function createDefaultAgent(): CapacityScenario["cameraGroups"][number]["agents"][number] {
  return {
    id: globalThis.crypto.randomUUID(),
    name: "Continuous video analysis",
    model: "aiq-3.7",
    inputType: "video",
    packaging: "mosaic_2x2",
    modelFps: 1,
    runEverySeconds: 60,
    features: {
      onlyCaptureOnMotion: false,
      temporal: false,
      regions: 0,
      croppedFrame: false,
      faceReferences: 0,
      negativeReferences: 0,
    },
  };
}

export function createDefaultScenario(totalCameras = 8): CapacityScenario {
  return {
    schemaVersion: "capacity-scenario/1.0.0",
    workloadContractVersion: WORKLOAD_CONTRACT_VERSION,
    projectName: `Qual Hardware — ${totalCameras} cameras`,
    customerName: "",
    market: "BR",
    markets: ["BR"],
    currency: "BRL",
    perceptrumBuildHash: PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT,
    totalCameras,
    cameraGroups: [
      {
        id: globalThis.crypto.randomUUID(),
        name: "Main camera group",
        count: totalCameras,
        source: {
          codec: "h264",
          width: 1920,
          height: 1080,
          sourceFps: 15,
          bitrateMbps: 4,
        },
        decodeMode: "gpu",
        motionPercent: 100,
        storage: {
          storeVideo: false,
          retentionDays: 1,
          raidFactor: 1,
        },
        agents: [createDefaultAgent()],
      },
    ],
    concurrentWorkloads: {
      activeJobs: 0,
      groupedJobCameras: 0,
      concurrentChatSessions: 0,
      activeSearches: 0,
      intelligenceStreams: 0,
    },
    constraints: {
      infrastructureKind: "either",
      preferredCpuVendors: [],
      preferredGpuVendors: [],
      operatingSystem: "auto",
      requiredHardwareTemplateId: null,
      maxNodes: null,
      budget: null,
      requireEcc: false,
    },
  };
}
