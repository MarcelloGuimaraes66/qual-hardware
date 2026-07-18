import { z } from "zod";
import type { CapacityScenario } from "./types.js";
import {
  CALIBRATION_PLAN_VERSION,
  EVIDENCE_CATALOG_VERSION,
  LOCAL_CALIBRATION_VERSION,
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
  count: z.number().int().min(1).max(4096),
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
  workloadContractVersion: z.enum([WORKLOAD_CONTRACT_VERSION, "perceptrum-workload/1.1.0", "perceptrum-workload/1.0.0"]),
  projectName: z.string().min(1).max(160),
  customerName: z.string().max(160),
  market: z.enum(["BR", "US", "DE"]),
  currency: z.enum(["BRL", "USD", "EUR"]),
  perceptrumBuildHash: z.string().min(1).max(128),
  totalCameras: z.number().int().min(1).max(4096),
  cameraGroups: z.array(cameraGroupSchema).min(1).max(128),
  concurrentWorkloads: z.object({
    activeJobs: z.number().int().min(0).max(1024),
    groupedJobCameras: z.number().int().min(0).max(4096),
    concurrentChatSessions: z.number().int().min(0).max(1024),
    activeSearches: z.number().int().min(0).max(1024),
    intelligenceStreams: z.number().int().min(0).max(4096),
  }),
  constraints: z.object({
    infrastructureKind: z.enum(["laptop", "mini_pc", "workstation", "rack", "either"]),
    preferredCpuVendors: z.array(z.enum(["intel", "amd", "apple"])).max(3),
    preferredGpuVendors: z.array(z.enum(["nvidia", "amd", "intel", "apple"])).max(4),
    operatingSystem: z.enum(["auto", "windows", "ubuntu", "macos"]).default("auto"),
    requiredHardwareTemplateId: z.string().min(1).max(160).nullable().default(null),
    maxNodes: z.number().int().min(1).max(256).nullable(),
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

export const benchmarkMetricsSchema = z.object({
  cpuModel: z.string().min(1).max(200),
  gpuModel: z.string().min(1).max(200),
  gpuDriver: z.string().min(1).max(120),
  perceptrumBuildHash: z.string().min(1).max(128),
  workloadContractVersion: z.string().min(1).max(128),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  p95InferenceLatencyMs: z.number().nonnegative(),
  p99InferenceLatencyMs: z.number().nonnegative(),
  peakCpuPercent: z.number().min(0).max(100),
  peakRamBytes: z.number().nonnegative(),
  peakGpuPercent: z.number().min(0).max(100),
  peakVramBytes: z.number().nonnegative(),
  peakDecoderPercent: z.number().min(0).max(100),
  gpuTelemetryAvailable: z.boolean(),
  peakHandleCount: z.number().int().nonnegative(),
  peakThreadCount: z.number().int().nonnegative(),
  peakProcessCount: z.number().int().positive(),
  peakDiskWriteBytesPerSecond: z.number().nonnegative(),
  peakNetworkReceiveBytesPerSecond: z.number().nonnegative(),
  captureReadP95Ms: z.number().nonnegative(),
  decodeP95Ms: z.number().nonnegative(),
  maxQueueDepth: z.number().int().nonnegative(),
  queueGrowthPerMinute: z.number(),
  inferenceSuccessRate: z.number().min(0).max(1),
  outOfMemoryCount: z.number().int().nonnegative(),
  mediaFieldCount: z.literal(0),
  credentialFieldCount: z.literal(0),
  phases: z.array(z.object({
    name: z.enum(["warmup", "sustained", "surge"]),
    durationSeconds: z.number().int().positive(),
    loadPercent: z.number().positive(),
    p95InferenceLatencyMs: z.number().nonnegative(),
    maxQueueDepth: z.number().int().nonnegative(),
    queueGrowthPerMinute: z.number(),
    outOfMemoryCount: z.number().int().nonnegative(),
  })).length(3),
});

export const calibrationStageSchema = z.enum([
  "rtsp_ingest",
  "video_decode",
  "bgr_processing",
  "video_encode",
  "disk_write",
  "disk_read",
  "local_inference",
  "memory_bandwidth",
  "network_ingest",
  "thermal_sustain",
]);

const operatingSystemSchema = z.enum(["windows", "ubuntu", "macos"]);

export const localCalibrationRunSchema = z.object({
  schemaVersion: z.literal(LOCAL_CALIBRATION_VERSION),
  id: z.string().uuid(),
  planId: z.string().uuid(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  workloadContractVersion: z.literal(WORKLOAD_CONTRACT_VERSION),
  mode: z.enum(["quick", "full"]),
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
    gpuVramBytes: z.number().int().nonnegative(),
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
    formFactor: z.enum(["laptop", "mini_pc", "workstation", "rack"]),
    coolingProfile: z.string().min(1).max(240),
    perceptrumBuildHash: z.string().min(1).max(128),
    aiqModel: z.string().min(1).max(240),
    aiqModelHash: z.string().min(1).max(256),
    inferenceBackend: z.string().min(1).max(160),
  }),
  requestedSourceFps: z.number().positive().max(120),
  measuredSourceFps: z.number().nonnegative().max(240),
  requestedInferenceFps: z.number().int().min(1).max(5),
  effectiveInferenceFps: z.number().min(1).max(5),
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
    safeCameraCapacity: z.number().nonnegative(),
    throughput: z.number().nonnegative(),
    throughputUnit: z.string().min(1).max(80),
    p95LatencyMs: z.number().nonnegative(),
    peakUtilizationPercent: z.number().min(0).max(100),
    queueGrowthPerMinute: z.number(),
    thermalThrottlePercent: z.number().min(0).max(100),
  })).min(6),
  phases: z.array(z.object({
    name: z.enum(["warmup", "sustained", "surge"]),
    durationSeconds: z.number().int().positive(),
    loadPercent: z.number().positive(),
    cameraCount: z.number().int().positive(),
    inferenceSuccessRate: z.number().min(0).max(1),
    maxQueueDepth: z.number().int().nonnegative(),
    queueGrowthPerMinute: z.number(),
    outOfMemoryCount: z.number().int().nonnegative(),
  })).length(3),
  overallSafeCameraCapacity: z.number().nonnegative(),
  bottleneck: calibrationStageSchema,
  notes: z.array(z.string().max(500)).max(100),
}).superRefine((value, context) => {
  if (Date.parse(value.completedAt) <= Date.parse(value.startedAt)) {
    context.addIssue({ code: "custom", path: ["completedAt"], message: "Calibration completion must be after start." });
  }
  if (value.framesInferred > value.framesPacked || value.framesPacked > value.framesExtracted) {
    context.addIssue({ code: "custom", path: ["framesInferred"], message: "Frame counters are not monotonic." });
  }
});

export const publicBenchmarkObservationSchema = z.object({
  id: z.string().min(1).max(240),
  hardwareTemplateId: z.string().min(1).max(160),
  stage: calibrationStageSchema,
  profileId: z.string().min(1).max(240),
  benchmarkName: z.string().min(1).max(240),
  benchmarkVersion: z.string().min(1).max(120),
  score: z.number().positive(),
  unit: z.string().min(1).max(80),
  higherIsBetter: z.literal(true),
  sourceTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  sourceUrl: z.string().url().refine((value) => new URL(value).protocol === "https:", "Evidence source must use HTTPS"),
  observedAt: z.iso.datetime(),
  operatingSystem: z.union([operatingSystemSchema, z.literal("any")]),
  configuration: z.string().min(20).max(2_000),
});

export const evidenceCatalogSnapshotSchema = z.object({
  schemaVersion: z.literal(EVIDENCE_CATALOG_VERSION),
  catalogVersion: z.string().min(1).max(160),
  generatedAt: z.iso.datetime(),
  observations: z.array(publicBenchmarkObservationSchema).min(1).max(100_000),
});

export const calibrationPlanRequestSchema = z.object({
  recommendationId: z.string().uuid(),
  mode: z.enum(["quick", "full"]),
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
    currency: "BRL",
    perceptrumBuildHash: "unversioned",
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
