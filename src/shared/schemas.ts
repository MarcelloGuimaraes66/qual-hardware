import { z } from "zod";
import type { CapacityScenario } from "./types.js";
import { WORKLOAD_CONTRACT_VERSION } from "./types.js";

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
  workloadContractVersion: z.enum([WORKLOAD_CONTRACT_VERSION, "perceptrum-workload/1.0.0"]),
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
    infrastructureKind: z.enum(["workstation", "rack", "either"]),
    preferredCpuVendors: z.array(z.enum(["intel", "amd"])).max(2),
    preferredGpuVendors: z.array(z.enum(["nvidia", "amd"])).max(2),
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

export function createDefaultAgent(): CapacityScenario["cameraGroups"][number]["agents"][number] {
  return {
    id: globalThis.crypto.randomUUID(),
    name: "Continuous video analysis",
    model: "gpt-5.4-mini",
    inputType: "video",
    packaging: "mosaic_2x2",
    modelFps: 1,
    runEverySeconds: 10,
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
      maxNodes: null,
      budget: null,
      requireEcc: false,
    },
  };
}
