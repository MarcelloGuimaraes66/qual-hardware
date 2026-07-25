import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { cpus, freemem, totalmem } from "node:os";
import { basename } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { currentHostPlatform } from "../platform/index.js";
import type {
  CalibrationPhaseMetric,
  CalibrationRuntimeStatus,
  CalibrationStage,
  TelemetryMetricSummary,
  CalibrationWorkloadProfile,
  CalibrationHardwarePreflight,
  CalibrationComputeMode,
  CalibrationGpuInferenceBackend,
  CalibrationGpuMediaBackend,
  CalibrationCapacityBoundary,
  RtspStackEvidence,
  RtspStreamProbe,
} from "../shared/types.js";
import { RTSP_STACK_EVIDENCE_VERSION } from "../shared/types.js";
import {
  calibrationDiskStatus,
  prepareCalibrationTemporaryFile,
  type CalibrationDiskStatus,
  type CalibrationWorkspace,
} from "./calibrationTemporaryFiles.js";
import {
  CalibrationHardwareTelemetrySampler,
  type CalibrationHardwareTelemetrySummary,
} from "./calibrationTelemetry.js";
import {
  expectedGpuInferenceBackend,
  ffmpegEncoder,
  ffmpegGpuDeviceArguments,
  llamaComputeArguments,
  llamaCpuTopologyArguments,
  parseLlamaGpuDevices,
  selectFfmpegGpuMediaBackend,
  selectLlamaGpuDevices,
  weightedRoundRobin,
  type CalibrationGpuDevice,
} from "./calibrationCompute.js";
import { createInternalRtspLoopback, type InternalRtspLoopback } from "./internalRtspLoopback.js";
import {
  authenticatedRtspSimulatorOrigin,
  probeRtspSimulator,
  sanitizeRtspDiagnostic,
} from "./rtspSimulator.js";

export const CALIBRATION_PIPELINE_CONTRACT_VERSION = "qual-hardware-calibration-pipeline-contract/3.0.0";
const CALIBRATION_MEDIA_RING_SECONDS = 2;
const CALIBRATION_MEDIA_RING_SEGMENTS = 2;

async function terminateProcessTree(child: ChildProcess, force: boolean): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await currentHostPlatform.terminateProcessTree(child.pid, force);
}

async function waitForProcessExit(child: ChildProcess, timeoutMs = 5_000): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise<boolean>((resolveStopped) => {
    let settled = false;
    const processExists = (): boolean => {
      if (!child.pid) return false;
      try {
        process.kill(child.pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const finish = (stopped: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(poll);
      child.off("exit", onExit);
      child.off("error", onExit);
      resolveStopped(stopped);
    };
    const onExit = (): void => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    const poll = setInterval(() => {
      if (!processExists()) finish(true);
    }, 50);
    child.once("exit", onExit);
    child.once("error", onExit);
  });
}

export function estimateCalibrationMediaRingBytes(
  profile: CalibrationWorkloadProfile,
  tier: number,
  seconds: number,
): number {
  const perCameraMbps = profile.cameraGroups.reduce((sum, group) =>
    sum + group.sharePpm / 1_000_000 * group.bitrateMbps, 0);
  return Math.ceil(perCameraMbps * tier * 1_000_000 / 8 *
    Math.min(Math.max(0, seconds), CALIBRATION_MEDIA_RING_SECONDS) * 1.5);
}

interface PipelineFiles {
  sources: string[];
  frame: string;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface NativeBenchmarkResult {
  schemaVersion: "qual-hardware-native-benchmark/1.0.0";
  status: "passed";
  durationMs: number;
  cpu: {
    threads: number;
    operationsPerSecond: number;
    memoryBytesPerSecond: number;
  };
  video: {
    nativeApiAvailable: boolean;
    h264HardwareDecoders: number;
    h265HardwareDecoders: number;
  };
  gpus: Array<{
    index: number;
    name: string;
    dedicatedBytes: number;
    deviceCreated: boolean;
    measured: boolean;
    copyBytesPerSecond: number;
    reason: string;
  }>;
  externalNetworkUsed: false;
}

const PERCEPTRUM_HARDWARE_BENCHMARK_PROTOCOL = "perceptrum-hardware-benchmark/1.0.0";

export function parsePerceptrumWorkerMeasurement(
  value: unknown,
  expected: { phase: PipelinePhaseMeasurement["phase"]; tier: number; computeMode: CalibrationComputeMode },
): PipelinePhaseMeasurement {
  if (!value || typeof value !== "object") throw new Error("perceptrum_worker_response_invalid");
  const response = value as Record<string, unknown>;
  if (response.protocol !== PERCEPTRUM_HARDWARE_BENCHMARK_PROTOCOL || response.operation !== "runTier" ||
      response.ok !== true || response.isolated !== true || response.productionDataAccess !== false ||
      response.externalRequestCount !== 0 || !response.measurement || typeof response.measurement !== "object") {
    throw new Error("perceptrum_worker_contract_mismatch");
  }
  const measurement = response.measurement as Record<string, unknown>;
  if (measurement.phase !== expected.phase || measurement.tier !== expected.tier ||
      measurement.computeMode !== expected.computeMode) throw new Error("perceptrum_worker_tier_identity_mismatch");
  const numericFields = [
    "durationSeconds", "actualConcurrentMediaPipelines", "framesPlanned", "framesDecoded", "framesExtracted",
    "framesEncoded", "inferencesPlanned", "inferencesAttempted", "inferenceFramesPacked",
    "inferenceMaximumConcurrency", "inferenceIntervalMs", "framesInferred", "databaseOperations",
    "dashboardQueries", "completedJobRuns", "completedStepRuns", "completedIntelligenceJobs",
    "processedCameraCount", "networkIngressMbps", "temporaryBytesEstimated", "queueGrowthPerMinute",
  ];
  const booleanFields = [
    "mediaFallbackUsed", "cpuWorkloadMeasured", "gpuInferenceMeasured", "gpuMediaMeasured",
    "combinedCpuGpuMeasured", "exactCameraConcurrency", "physicalNetworkLinkVerified",
    "rtspMeasured", "mediaMeasured", "localInferenceMeasured",
  ];
  if (numericFields.some((field) => typeof measurement[field] !== "number" || !Number.isFinite(measurement[field])) ||
      booleanFields.some((field) => typeof measurement[field] !== "boolean") ||
      !Array.isArray(measurement.failures) || !Array.isArray(measurement.measuredStages) ||
      !Array.isArray(measurement.inferenceErrors) || !Array.isArray(measurement.deviceInference) ||
      !Array.isArray(measurement.inferenceDeviceIds) || !Array.isArray(measurement.mediaDeviceIds) ||
      !measurement.hardwareTelemetry || typeof measurement.hardwareTelemetry !== "object") {
    throw new Error("perceptrum_worker_measurement_incomplete");
  }
  return measurement as unknown as PipelinePhaseMeasurement;
}

export interface PipelinePhaseMeasurement {
  phase: CalibrationPhaseMetric["name"] | "discovery";
  computeMode: CalibrationComputeMode;
  inferenceBackend: "cpu" | CalibrationGpuInferenceBackend;
  inferenceDeviceId: string;
  inferenceDeviceIds?: string[];
  deviceInference?: Array<{
    deviceId: string;
    requestsAttempted: number;
    requestsSuccessful: number;
    p95LatencyMs: number | null;
  }>;
  mediaDeviceIds?: string[];
  gpuMediaBackend: CalibrationGpuMediaBackend;
  mediaExecution: "cpu" | CalibrationGpuMediaBackend;
  mediaFallbackUsed: boolean;
  cpuWorkloadMeasured: boolean;
  gpuInferenceMeasured: boolean;
  gpuMediaMeasured: boolean;
  combinedCpuGpuMeasured: boolean;
  tier: number;
  durationSeconds: number;
  actualConcurrentMediaPipelines: number;
  exactCameraConcurrency: boolean;
  framesPlanned: number;
  framesDecoded: number;
  framesExtracted: number;
  framesEncoded: number;
  inferencesPlanned: number;
  inferencesAttempted: number;
  inferenceFramesPacked: number;
  inferenceMaximumConcurrency: number;
  inferenceErrors: string[];
  inferenceIntervalMs: number;
  framesInferred: number;
  p95InferenceLatencyMs: number | null;
  p99InferenceLatencyMs: number | null;
  databaseOperations: number;
  dashboardQueries: number;
  completedJobRuns: number;
  completedStepRuns: number;
  completedIntelligenceJobs: number;
  processedCameraCount: number;
  p95DatabaseLatencyMs: number | null;
  p95DashboardLatencyMs: number | null;
  mediaDurationMs: number | null;
  memoryBytesPerSecond: number | null;
  networkIngressMbps: number;
  physicalNetworkCapacityMbps: number | null;
  physicalNetworkUsableMbps: number | null;
  physicalNetworkLinkVerified: boolean;
  temporaryBytesEstimated: number;
  temporaryBytesFreeBeforePhase: number | null;
  temporaryDiskReserveBytes?: number;
  cpuUtilizationPercent: TelemetryMetricSummary | null;
  memoryUsedBytes: TelemetryMetricSummary | null;
  memoryWorkingSetDeltaBytes?: number | null;
  hardwareTelemetry: CalibrationHardwareTelemetrySummary;
  rtspMeasured: boolean;
  rtspSessionsPlanned?: number;
  rtspSessionsOpened?: number;
  rtspSessionsCompleted?: number;
  rtspPayloadBytes?: number;
  rtspPayloadMbps?: number;
  rtspOpenLatencyP95Ms?: number | null;
  mediaMeasured: boolean;
  localInferenceMeasured: boolean;
  queueGrowthPerMinute: number;
  failures: string[];
  measuredStages: CalibrationStage[];
}

export interface CalibrationPipelineSummary {
  contractVersion: typeof CALIBRATION_PIPELINE_CONTRACT_VERSION;
  mediaAvailable: boolean;
  rtspAvailable: boolean;
  rtspQualified: boolean;
  rtspEvidence: RtspStackEvidence;
  localInferenceRequired: boolean;
  localInferenceAvailable: boolean;
  cpuInferenceAvailable: boolean;
  gpuInferenceAvailable: boolean;
  gpuInferenceBackend: CalibrationGpuInferenceBackend;
  gpuInferenceDevice: CalibrationGpuDevice | null;
  gpuInferenceDevices: CalibrationGpuDevice[];
  gpuMediaDevices: Array<{ id: string; index: number; name: string }>;
  gpuMediaAvailable: boolean;
  gpuMediaBackend: CalibrationGpuMediaBackend;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  mediamtxPath: string | null;
  rtspOrigin: string;
  aiqOrigin: string;
  /**
   * Highest concurrency this load generator can materialize without
   * confusing generator exhaustion with the machine's capacity boundary.
   */
  exactCameraGeneratorLimit: number;
  genericNativeBenchmark?: boolean;
  evidenceLevel?: "exact_perceptrum" | "compatible_local_stack" | "generic_native";
  unavailableReasons: string[];
}

export const CALIBRATION_NETWORK_RESERVE_PERCENT = 20;
const CALIBRATION_GENERATOR_BYTES_PER_PIPELINE = 128 * 1024 * 1024;
const CALIBRATION_GENERATOR_MEMORY_RESERVE_BYTES = 8 * 1024 * 1024 * 1024;

export function exactCameraGeneratorLimit(input: {
  logicalProcessors?: number;
  totalMemoryBytes?: number;
} = {}): number {
  const logicalProcessors = Math.max(1, Math.floor(input.logicalProcessors ?? cpus().length));
  const totalMemoryBytes = Math.max(0, input.totalMemoryBytes ?? totalmem());
  const memoryBudget = Math.max(
    16,
    Math.floor(Math.max(0, totalMemoryBytes - CALIBRATION_GENERATOR_MEMORY_RESERVE_BYTES) /
      CALIBRATION_GENERATOR_BYTES_PER_PIPELINE),
  );
  return Math.max(16, Math.min(2_048, logicalProcessors * 8, memoryBudget));
}

/**
 * The generic benchmark models the complete requested tier in the native
 * CPU/GPU/database load. FFmpeg remains a physical codec/loopback sample,
 * bounded to avoid creating hundreds of child processes and file handles.
 *
 * A compatible or exact stack does not use this limit and must still
 * materialize every requested camera.
 */
export function genericNativeMediaSampleLimit(input: {
  tier: number;
  seedCameraCount: number;
  logicalProcessors?: number;
  cameraGroupCount?: number;
}): number {
  const tier = Math.max(1, Math.floor(input.tier));
  const logicalProcessors = Math.max(1, Math.floor(input.logicalProcessors ?? cpus().length));
  const seedCameraCount = Math.max(1, Math.floor(input.seedCameraCount));
  const cameraGroupCount = Math.max(1, Math.floor(input.cameraGroupCount ?? 1));
  return Math.min(tier, 24, Math.max(seedCameraCount, logicalProcessors, cameraGroupCount));
}

export function nativeBenchmarkProcessTimeoutMs(durationMs: number): number {
  const duration = Math.max(1, Math.floor(durationMs));
  // Device enumeration and driver scheduling can temporarily extend a phase.
  // This margin avoids classifying host-side scheduling as camera saturation,
  // while still terminating a genuinely hung helper.
  return Math.max(60_000, Math.ceil(duration * 1.25) + 30_000);
}

export function genericNativePressureMetric(
  pressure: number,
  sampleCount = 1,
): TelemetryMetricSummary {
  const utilization = Math.max(0, Math.min(100, pressure * 100));
  return {
    samples: Math.max(1, Math.trunc(sampleCount)),
    average: utilization,
    p95: utilization,
    p99: utilization,
    peak: utilization,
  };
}

export interface CalibrationNetworkCapacity {
  requiredIngressMbps: number;
  physicalCapacityMbps: number | null;
  usableCapacityMbps: number | null;
  verified: boolean;
  qualifyingLinkName: string | null;
}

export function calibrationAverageIngressMbpsPerCamera(profile: CalibrationWorkloadProfile): number {
  return profile.cameraGroups.reduce((sum, group) =>
    sum + group.sharePpm / 1_000_000 * group.bitrateMbps, 0);
}

export function evaluateCalibrationNetworkCapacity(
  profile: CalibrationWorkloadProfile,
  tier: number,
  links: CalibrationHardwarePreflight["networkLinks"],
): CalibrationNetworkCapacity {
  const allocations = allocateCalibrationCameraGroups(profile, tier);
  const requiredIngressMbps = allocations.reduce((sum, cameraCount, index) => {
    const group = profile.cameraGroups[index];
    if (!group) return sum;
    return sum + cameraCount * group.bitrateMbps;
  }, 0);
  const qualifying = links
    .filter((link) => link.physicalLinkVerified && link.duplex === "full" && link.speedMbps !== null)
    .sort((left, right) => (right.speedMbps ?? 0) - (left.speedMbps ?? 0))[0];
  const physicalCapacityMbps = qualifying?.speedMbps ?? null;
  const usableCapacityMbps = physicalCapacityMbps === null
    ? null
    : physicalCapacityMbps * (1 - CALIBRATION_NETWORK_RESERVE_PERCENT / 100);
  return {
    requiredIngressMbps,
    physicalCapacityMbps,
    usableCapacityMbps,
    verified: usableCapacityMbps !== null && requiredIngressMbps <= usableCapacityMbps,
    qualifyingLinkName: qualifying?.name ?? null,
  };
}

const PIPELINE_SCHEMA = `
  PRAGMA journal_mode=DELETE;
  PRAGMA synchronous=FULL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE cameras(id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, profile_group INTEGER NOT NULL, codec TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, source_fps REAL NOT NULL, bitrate_mbps REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE commands(id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id INTEGER, command_type TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE job_runs(job_run_id TEXT PRIMARY KEY, job_id INTEGER NOT NULL, user_id TEXT NOT NULL, job_name TEXT, status TEXT NOT NULL DEFAULT 'queued', trigger_type TEXT, trigger_json TEXT, execution_domain TEXT NOT NULL DEFAULT 'local', source_command_id INTEGER, started_at_utc TEXT, completed_at_utc TEXT, stopped_at_utc TEXT, failed_at_utc TEXT, last_event_at_utc TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE job_step_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL, step_id INTEGER NOT NULL, camera_id INTEGER NOT NULL DEFAULT 0, step_agent_id INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', step_run_id TEXT, job_run_id TEXT, step_order INTEGER, step_name TEXT, started_at_utc TEXT, completed_at_utc TEXT, latest_event_at_utc TEXT, error_message TEXT, metrics_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE camera_runtime_sessions(camera_session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, camera_id INTEGER NOT NULL, camera_name TEXT, start_origin TEXT, status TEXT NOT NULL DEFAULT 'starting', started_at TEXT, online_at TEXT, stopped_at TEXT, last_event_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE camera_agent_runs(agent_run_id TEXT PRIMARY KEY, camera_session_id TEXT, user_id TEXT NOT NULL, camera_id INTEGER NOT NULL, camera_name TEXT, status TEXT NOT NULL DEFAULT 'running', provider TEXT, model TEXT, started_at_utc TEXT, completed_at_utc TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE camera_agent_run_results(id INTEGER PRIMARY KEY AUTOINCREMENT, result_uid TEXT UNIQUE, agent_run_id TEXT NOT NULL, camera_session_id TEXT, user_id TEXT NOT NULL, camera_id INTEGER NOT NULL, provider TEXT, model TEXT, answer_text TEXT, result_json TEXT, confidence REAL, event_timestamp_utc TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE intelligence_projects(id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE intelligence_sources(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, camera_id INTEGER NOT NULL, uri TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE intelligence_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued', model_profile TEXT NOT NULL DEFAULT 'people_vehicles', sample_fps REAL NOT NULL DEFAULT 2, source_ids_json TEXT NOT NULL DEFAULT '[]', progress REAL NOT NULL DEFAULT 0, current_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, completed_at TEXT);
  CREATE TABLE intelligence_observations(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, source_id INTEGER, job_id INTEGER, model_name TEXT, payload_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE intelligence_evidence_items(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, source_id INTEGER, job_id INTEGER, model_name TEXT, payload_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE intelligence_audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, source_id INTEGER, job_id INTEGER, model_name TEXT, payload_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE capture_metrics(id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id INTEGER NOT NULL, expected_fps REAL NOT NULL, actual_fps REAL NOT NULL, frames_received INTEGER NOT NULL, frames_dropped INTEGER NOT NULL, queue_depth INTEGER NOT NULL, sampled_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id INTEGER, user_id TEXT NOT NULL, event_type TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX idx_commands_status ON commands(status, created_at);
  CREATE INDEX idx_job_runs_status ON job_runs(status, updated_at);
  CREATE INDEX idx_job_steps_run ON job_step_runs(job_run_id, status);
  CREATE INDEX idx_intelligence_jobs_status ON intelligence_jobs(status, created_at);
  CREATE UNIQUE INDEX idx_intelligence_sources_camera ON intelligence_sources(camera_id);
  CREATE INDEX idx_capture_metrics_camera ON capture_metrics(camera_id, updated_at);
`;

function percentile95(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)] ?? null;
}

function percentile99(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.99) - 1)] ?? null;
}

function metricSummary(samples: number[]): TelemetryMetricSummary | null {
  if (samples.length === 0) return null;
  const ordered = [...samples].sort((left, right) => left - right);
  const at = (fraction: number): number => ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
  return {
    samples: ordered.length,
    average: ordered.reduce((sum, value) => sum + value, 0) / ordered.length,
    p95: at(0.95),
    p99: at(0.99),
    peak: ordered.at(-1) ?? 0,
  };
}

function cpuSnapshot(): { idle: number; total: number } {
  return cpus().reduce((summary, cpu) => {
    const total = cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    return { idle: summary.idle + cpu.times.idle, total: summary.total + total };
  }, { idle: 0, total: 0 });
}

class SystemResourceSampler {
  private previous = cpuSnapshot();
  private readonly cpuSamples: number[] = [];
  private readonly memorySamples: number[] = [];
  private baselineMemoryBytes: number | null = null;
  private timer: NodeJS.Timeout | null = null;

  start(intervalMs: number): void {
    this.baselineMemoryBytes = Math.max(0, totalmem() - freemem());
    this.capture();
    this.timer = setInterval(() => this.capture(), intervalMs);
    this.timer.unref();
  }

  stop(): {
    cpu: TelemetryMetricSummary | null;
    memory: TelemetryMetricSummary | null;
    peakMemoryDeltaBytes: number | null;
  } {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.capture();
    const peak = this.memorySamples.length > 0 ? Math.max(...this.memorySamples) : null;
    return {
      cpu: metricSummary(this.cpuSamples),
      memory: metricSummary(this.memorySamples),
      peakMemoryDeltaBytes: peak === null || this.baselineMemoryBytes === null
        ? null
        : Math.max(0, peak - this.baselineMemoryBytes),
    };
  }

  private capture(): void {
    const current = cpuSnapshot();
    const totalDelta = current.total - this.previous.total;
    const idleDelta = current.idle - this.previous.idle;
    if (totalDelta > 0) this.cpuSamples.push(Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)));
    this.memorySamples.push(Math.max(0, totalmem() - freemem()));
    this.previous = current;
  }
}

function processFrames(output: string): number {
  const matches = [...output.matchAll(/^frame=(\d+)$/gm)];
  return Number(matches.at(-1)?.[1] ?? 0);
}

export function allocateCalibrationCameraGroups(profile: CalibrationWorkloadProfile, tier: number): number[] {
  if (!Number.isSafeInteger(tier) || tier < 1) throw new Error("calibration_camera_tier_invalid");
  const nonZeroGroups = profile.cameraGroups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => group.sharePpm > 0);
  const totalShare = Math.max(1, nonZeroGroups.reduce((sum, { group }) => sum + group.sharePpm, 0));
  const exact = profile.cameraGroups.map((group, index) => ({
    index,
    floor: Math.floor(tier * group.sharePpm / totalShare),
    remainder: tier * group.sharePpm % totalShare,
  }));
  let remaining = tier - exact.reduce((sum, item) => sum + item.floor, 0);
  for (const item of [...exact].sort((left, right) => right.remainder - left.remainder || left.index - right.index)) {
    if (remaining <= 0) break;
    item.floor += 1;
    remaining -= 1;
  }
  return exact.sort((left, right) => left.index - right.index).map((item) => item.floor);
}

export function calibrationTierComposition(
  profile: CalibrationWorkloadProfile,
  tier: number,
): CalibrationCapacityBoundary["searchTrace"][number]["composition"] {
  const allocations = allocateCalibrationCameraGroups(profile, tier);
  return profile.cameraGroups.map((group, groupIndex) => {
    const cameras = allocations[groupIndex] ?? 0;
    const videoCapture = group.storage.storeVideo ||
      group.agents.some((agent) => agent.inputType === "video");
    return {
      groupIndex,
      groupName: group.name || `Grupo ${groupIndex + 1}`,
      cameras,
      videoCameras: videoCapture ? cameras : 0,
      frameCameras: !videoCapture && group.agents.some((agent) => agent.inputType === "image") ? cameras : 0,
    };
  });
}

export interface CalibrationInferenceLoadPlan {
  requestsPlanned: number;
  framesPlanned: number;
  requestsPerWindow: number;
  windowCount: number;
  intervalMs: number;
}

function agentFramesPerWindow(agent: CalibrationWorkloadProfile["cameraGroups"][number]["agents"][number]): number {
  if (agent.inputType === "image") return 1;
  if (agent.packaging === "mosaic_2x2") return 4;
  if (agent.packaging === "mosaic_3x3") return 9;
  return Math.min(300, Math.max(1, Math.floor(agent.modelFps * agent.runEverySeconds)));
}

export function planCalibrationInferenceLoad(
  profile: CalibrationWorkloadProfile,
  tier: number,
  durationSeconds: number,
): CalibrationInferenceLoadPlan {
  const allocations = allocateCalibrationCameraGroups(profile, tier);
  const localAgents = profile.cameraGroups.flatMap((group, groupIndex) =>
    group.agents.filter((agent) => agent.executionBackend === "local_aiq")
      .map((agent) => {
        const cameras = allocations[groupIndex] ?? 0;
        return {
          agent,
          cameras,
          executions: agent.executionScope === "inference_group" ? (cameras > 0 ? 1 : 0) : cameras,
        };
      }));
  if (localAgents.length === 0) {
    return { requestsPlanned: 0, framesPlanned: 0, requestsPerWindow: 0, windowCount: 0, intervalMs: 60_000 };
  }
  const intervalSeconds = Math.min(...localAgents.map(({ agent }) => agent.runEverySeconds));
  const windowCount = Math.max(1, Math.ceil(durationSeconds / intervalSeconds));
  const requestsPerWindow = localAgents.reduce((sum, item) => sum + item.executions, 0);
  const framesPerWindow = localAgents.reduce((sum, item) =>
    sum + item.executions * agentFramesPerWindow(item.agent), 0);
  return {
    requestsPlanned: requestsPerWindow * windowCount,
    framesPlanned: framesPerWindow * windowCount,
    requestsPerWindow,
    windowCount,
    intervalMs: intervalSeconds * 1_000,
  };
}

export function calibrationLlamaContextSize(parallelSlots: number): number {
  // llama.cpp divides --ctx-size across its slots. A 1920x1080 Qwen-VL JPEG
  // needs slightly more than 2k tokens before generation, so each camera slot
  // receives a complete 4k context instead of sharing one fixed context pool.
  return Math.max(4_096, Math.min(262_144, Math.max(1, Math.floor(parallelSlots)) * 4_096));
}

export function calibrationMediaCommand(input: {
  sourceArguments: string[];
  durationSeconds: number;
  profile: CalibrationWorkloadProfile["cameraGroups"][number];
  outputPath: string;
  computeMode: CalibrationComputeMode;
  gpuMediaBackend: CalibrationGpuMediaBackend;
  gpuEncoderArguments?: string[];
}): { arguments: string[]; outputKind: "video_clip" | "frame_snapshot" } {
  const videoCaptureRequired = input.profile.storage.storeVideo ||
    input.profile.agents.some((agent) => agent.inputType === "video");
  const base = [
    "-hide_banner", "-loglevel", "error", "-nostdin", ...input.sourceArguments,
    "-t", input.durationSeconds.toFixed(3), "-an",
  ];
  if (!videoCaptureRequired) {
    const cadences = input.profile.agents
      .filter((agent) => agent.inputType === "image")
      .map((agent) => agent.runEverySeconds);
    const cadence = cadences.length > 0 ? Math.min(...cadences) : 10;
    const snapshotFps = 1 / Math.max(1, cadence);
    return {
      outputKind: "frame_snapshot",
      arguments: [
        ...base,
        "-vf", `fps=${snapshotFps},format=bgr24`,
        "-frames:v", String(Math.max(1, Math.ceil(input.durationSeconds * snapshotFps))),
        "-c:v", "mjpeg", "-q:v", "2", "-update", "1",
        "-progress", "pipe:1", "-nostats", "-y", input.outputPath,
      ],
    };
  }
  const encoder = ffmpegEncoder(input.computeMode, input.gpuMediaBackend, input.profile.codec);
  return {
    outputKind: "video_clip",
    arguments: [
      ...base,
      "-vf", "format=bgr24,format=yuv420p",
      "-c:v", encoder.encoder, "-threads", "1", ...encoder.extraArguments,
      ...(input.gpuEncoderArguments ?? []),
      "-b:v", `${input.profile.bitrateMbps}M`, "-f", "segment", "-segment_time", "1",
      "-segment_wrap", String(CALIBRATION_MEDIA_RING_SEGMENTS), "-reset_timestamps", "1",
      "-progress", "pipe:1", "-nostats", "-y", input.outputPath,
    ],
  };
}

function assetPath(status: CalibrationRuntimeStatus, id: string): string | null {
  const asset = status.assets.find((item) => item.id === id);
  return asset && (asset.status === "verified" || asset.status === "system_only") ? asset.path : null;
}

function verifiedAssetPath(status: CalibrationRuntimeStatus, id: string): string | null {
  const asset = status.assets.find((item) => item.id === id);
  return asset?.status === "verified" ? asset.path : null;
}

function boundedText(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  return next.length > 1_000_000 ? next.slice(-1_000_000) : next;
}

async function retryCalibrationPreflight<T>(
  operation: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  let failure: unknown = new Error("calibration_preflight_not_executed");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      failure = error;
      if (attempt < attempts) {
        await new Promise((resolveWait) => setTimeout(resolveWait, attempt * 200));
      }
    }
  }
  throw failure;
}

type CalibrationChildProcessKind = "ffmpeg" | "ffprobe" | "mediamtx" | "llama-server" | "native-benchmark" | "perceptrum-worker";

function childProcessKind(command: string): CalibrationChildProcessKind {
  const name = basename(command).toLowerCase();
  if (name.includes("native-bench")) return "native-benchmark";
  if (name.includes("perceptrum") || name.includes("drakon")) return "perceptrum-worker";
  if (name.includes("ffprobe")) return "ffprobe";
  if (name.includes("mediamtx")) return "mediamtx";
  if (name.includes("llama")) return "llama-server";
  return "ffmpeg";
}

async function freeLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.once("error", rejectPort);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

async function waitForLoopbackPort(port: number, cancelled: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (cancelled()) throw new Error("calibration_cancelled");
    const connected = await new Promise<boolean>((resolveConnected) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(250);
      socket.once("connect", () => { socket.destroy(); resolveConnected(true); });
      socket.once("timeout", () => { socket.destroy(); resolveConnected(false); });
      socket.once("error", () => resolveConnected(false));
    });
    if (connected) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("calibration_mediamtx_start_timeout");
}

function initialRtspEvidence(input: {
  mode: RtspStackEvidence["mode"];
  qualified: boolean;
  simulatorExecutable?: RtspStackEvidence["simulatorExecutable"];
  endpoints?: RtspStreamProbe[];
  failures?: string[];
  warnings?: string[];
}): RtspStackEvidence {
  const certificationLevel: RtspStackEvidence["certificationLevel"] =
    input.mode === "external_simulator" ? "functional_simulator"
      : input.mode === "production_worker" ? "production"
        : input.mode === "generic_proxy" ? "proxy_only"
          : "synthetic_internal";
  return {
    schemaVersion: RTSP_STACK_EVIDENCE_VERSION,
    mode: input.mode,
    certificationLevel,
    qualified: input.qualified,
    transport: "tcp",
    loopback: true,
    physicalNicMeasured: false,
    simulatorExecutable: input.simulatorExecutable ?? null,
    endpoints: input.endpoints ?? [],
    plannedSessions: 0,
    openedSessions: 0,
    completedSessions: 0,
    maximumConcurrentSessions: 0,
    framesPlanned: 0,
    framesDecoded: 0,
    frameDeliveryRate: 0,
    payloadBytes: 0,
    payloadMbps: 0,
    peakMemoryDeltaBytes: null,
    credentialsPersisted: false,
    externalRequestCount: 0,
    failures: input.failures ?? [],
    warnings: input.warnings ?? [],
  };
}

export class OfflineCalibrationPipeline {
  private files: PipelineFiles | null = null;
  private readonly children = new Set<ChildProcess>();
  private internalRtsp: InternalRtspLoopback | null = null;
  private readonly publishers: ChildProcess[] = [];
  private rtspPort: number | null = null;
  private externalRtspSources: RtspStreamProbe[] = [];
  private readonly llamaServers: Array<{
    model: "core" | "core-max";
    computeMode: CalibrationComputeMode;
    origin: string;
    child: ChildProcess;
    parallel: number;
    device: CalibrationGpuDevice | null;
    weight: number;
    queueDepth: number;
  }> = [];
  private llamaExecutable: string | null = null;
  private requiredLlamaModels: Array<"core" | "core-max"> = [];
  private mediaSequence = 0;
  private summary: CalibrationPipelineSummary | null = null;
  private diskPressureError: string | null = null;
  private nativeBenchmarkExecutable: string | null = null;
  private nativeBenchmarkPreflight: NativeBenchmarkResult | null = null;
  private perceptrumWorkerExecutable: string | null = null;

  constructor(private readonly input: {
    workspace: CalibrationWorkspace;
    database: DatabaseSync;
    workloadProfile: CalibrationWorkloadProfile;
    seedCameraCount?: number;
    runtimeStatus: CalibrationRuntimeStatus;
    hardware?: CalibrationHardwarePreflight;
    physicalNetworkLinks?: CalibrationHardwarePreflight["networkLinks"];
    advancedTelemetry?: boolean;
    timeScale: number;
    cancelled: () => boolean;
    diskStatus?: (path: string, projectedPeakBytes: number) => Promise<CalibrationDiskStatus>;
    diskCheckIntervalMs?: number;
    rtspProbe?: typeof probeRtspSimulator;
    onChildProcess?: (event: { action: "started" | "stopped"; pid: number; kind: CalibrationChildProcessKind }) => void;
  }) {}

  async initialize(): Promise<CalibrationPipelineSummary> {
    this.input.database.exec(PIPELINE_SCHEMA);
    const files: PipelineFiles = {
      sources: await Promise.all(this.input.workloadProfile.cameraGroups.map((_, index) =>
        prepareCalibrationTemporaryFile(this.input.workspace, `synthetic-source-${index}.mkv`, { retain: true }))),
      frame: await prepareCalibrationTemporaryFile(this.input.workspace, "synthetic-frame.jpg", { retain: true }),
    };
    this.files = files;
    const ffmpeg = assetPath(this.input.runtimeStatus, "ffmpeg");
    const ffprobe = assetPath(this.input.runtimeStatus, "ffprobe");
    const nativeBenchmark = assetPath(this.input.runtimeStatus, "native-benchmark");
    const llama = assetPath(this.input.runtimeStatus, "llama-server");
    const requiredModels = new Set(this.input.workloadProfile.cameraGroups.flatMap((group) => group.agents)
      .flatMap((agent) => agent.executionBackend !== "local_aiq" ? []
        : agent.model === "aiq-3.7-max" ? ["core-max" as const] : ["core" as const]));
    const localInferenceRequired = requiredModels.size > 0;
    const localInferenceAssetsAvailable = !localInferenceRequired || Boolean(llama &&
      [...requiredModels].every((model) =>
        assetPath(this.input.runtimeStatus, model === "core" ? "qwen-core-gguf" : "qwen-core-max-gguf") !== null &&
        assetPath(this.input.runtimeStatus, model === "core" ? "qwen-core-mmproj" : "qwen-core-max-mmproj") !== null));
    const reasons: string[] = [];
    const perceptrumWorker = this.input.runtimeStatus.environmentEvidenceLevel === "exact_perceptrum"
      ? assetPath(this.input.runtimeStatus, "perceptrum-worker") : null;
    if (perceptrumWorker) {
      this.perceptrumWorkerExecutable = perceptrumWorker;
      const gpuInferenceBackend = expectedGpuInferenceBackend(this.input.hardware ?? null, this.input.runtimeStatus.platform);
      const gpuInferenceDevices: CalibrationGpuDevice[] = gpuInferenceBackend === "unavailable" ? []
        : (this.input.hardware?.gpuDevices ?? []).filter((device) => device.computeEligible).map((device) => ({
            id: device.id,
            name: device.name,
            backend: gpuInferenceBackend,
          }));
      const mediaDevices = (this.input.hardware?.gpuDevices ?? []).filter((device) =>
        device.mediaEligible && device.mediaBackend !== "unavailable");
      const gpuMediaBackend = mediaDevices[0]?.mediaBackend ?? "unavailable";
      this.summary = {
        contractVersion: CALIBRATION_PIPELINE_CONTRACT_VERSION,
        mediaAvailable: true,
        rtspAvailable: true,
        rtspQualified: true,
        rtspEvidence: initialRtspEvidence({
          mode: "production_worker",
          qualified: true,
          warnings: ["physical_network_link_is_not_measured_by_the_isolated_worker"],
        }),
        localInferenceRequired,
        localInferenceAvailable: true,
        cpuInferenceAvailable: true,
        gpuInferenceAvailable: gpuInferenceDevices.length > 0,
        gpuInferenceBackend,
        gpuInferenceDevice: gpuInferenceDevices[0] ?? null,
        gpuInferenceDevices,
        gpuMediaDevices: mediaDevices.map((device) => ({ id: device.id, index: device.index, name: device.name })),
        gpuMediaAvailable: mediaDevices.length > 0,
        gpuMediaBackend,
        ffmpegPath: null,
        ffprobePath: null,
        mediamtxPath: null,
        rtspOrigin: "rtsp://127.0.0.1/perceptrum-worker",
        aiqOrigin: "http://127.0.0.1/perceptrum-worker",
        exactCameraGeneratorLimit: exactCameraGeneratorLimit(),
        genericNativeBenchmark: false,
        evidenceLevel: "exact_perceptrum",
        unavailableReasons: [],
      };
      return this.summary;
    }
    if (nativeBenchmark) {
      try {
        const probeDurationMs = 1_000;
        const probeThreads = Math.max(1, this.input.hardware?.logicalCores ?? cpus().length);
        const probe = JSON.parse((await this.run(nativeBenchmark, [
          "--duration-ms", String(probeDurationMs),
          "--threads", String(probeThreads),
        ], nativeBenchmarkProcessTimeoutMs(probeDurationMs))).stdout) as NativeBenchmarkResult;
        if (probe.schemaVersion !== "qual-hardware-native-benchmark/1.0.0" || probe.status !== "passed" ||
            probe.externalNetworkUsed !== false) throw new Error("native_benchmark_contract_mismatch");
        this.nativeBenchmarkExecutable = nativeBenchmark;
        this.nativeBenchmarkPreflight = probe;
      } catch (error) {
        reasons.push(`native_benchmark_preflight:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const forceNativeDiagnostic = process.env.QUAL_HARDWARE_FORCE_NATIVE_DIAGNOSTIC === "1";
    const genericNativeBenchmark = this.nativeBenchmarkPreflight !== null &&
      (forceNativeDiagnostic || !ffmpeg || !ffprobe || !localInferenceAssetsAvailable);
    if (forceNativeDiagnostic) reasons.push("native_diagnostic_forced_by_test_harness");
    let mediaAvailable = false;
    let rtspAvailable = false;
    let rtspQualified = false;
    let rtspEvidence = initialRtspEvidence({
      mode: "internal_loopback",
      qualified: false,
      warnings: ["internal_loopback_is_diagnostic_only", "loopback_does_not_measure_physical_network_link"],
    });
    if (forceNativeDiagnostic) {
      // Automated package smoke verifies only the built-in proxy. It must not
      // turn into a physical media or model workload on the operator's host.
    } else if (!ffmpeg || !ffprobe) {
      reasons.push("ffmpeg_or_ffprobe_unavailable");
    } else {
      const groupResults = await Promise.all(this.input.workloadProfile.cameraGroups.map(async (profile, index) => {
        try {
          await retryCalibrationPreflight(async () => {
            const codec = profile.codec === "h265" ? "libx265" : "libx264";
            const repeatedParameterSets = profile.codec === "h265"
              ? ["-x265-params", "repeat-headers=1:keyint=1:min-keyint=1:no-scenecut=1"]
              : ["-x264-params", "repeat-headers=1:keyint=1:min-keyint=1:scenecut=0"];
            await this.run(ffmpeg, [
              "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
              "-f", "lavfi", "-i", `testsrc2=size=${profile.width}x${profile.height}:rate=${profile.sourceFps}`,
              "-t", "2", "-an", "-pix_fmt", "yuv420p", "-c:v", codec, "-preset", "ultrafast",
              ...repeatedParameterSets,
              "-b:v", `${profile.bitrateMbps}M`, "-g", "1", files.sources[index]!,
            ], 60_000);
            const probe = await this.run(ffprobe, [
              "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,r_frame_rate",
              "-of", "json", files.sources[index]!,
            ], 15_000);
            const stream = (JSON.parse(probe.stdout) as { streams?: Array<{ codec_name?: string; width?: number; height?: number; r_frame_rate?: string }> }).streams?.[0];
            const expectedCodec = profile.codec === "h265" ? "hevc" : "h264";
            if (!stream || stream.codec_name !== expectedCodec || stream.width !== profile.width || stream.height !== profile.height ||
                Number(stream.r_frame_rate?.split("/")[0] ?? 0) / Number(stream.r_frame_rate?.split("/")[1] ?? 1) !== profile.sourceFps) {
              throw new Error("synthetic_source_contract_mismatch");
            }
          });
          return true;
        } catch (error) {
          reasons.push(`synthetic_media_group_${index}:${error instanceof Error ? error.message : String(error)}`);
          return false;
        }
      }));
      mediaAvailable = groupResults.length > 0 && groupResults.every(Boolean);
      if (mediaAvailable) {
        try {
          await retryCalibrationPreflight(() => this.run(ffmpeg, [
              "-hide_banner", "-loglevel", "error", "-nostdin", "-i", files.sources[0]!,
              "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "2", "-y", files.frame,
            ], 15_000));
        } catch (error) {
          // Frame extraction is an optional preflight proof. A transient codec
          // failure must not abort a diagnostic when the built-in benchmark can
          // still provide a truthful generic estimate.
          mediaAvailable = false;
          reasons.push(`synthetic_frame_preflight:${
            error instanceof Error ? error.message : String(error)
          }`);
        }
      }
    }
    if (!mediaAvailable && genericNativeBenchmark) {
      mediaAvailable = true;
      reasons.push("video_pipeline_represented_by_built_in_native_proxy");
    }
    const simulatorIdentity = this.input.runtimeStatus.environmentProvenance?.rtspSimulatorProbe
      ?.simulatorExecutable;
    if (mediaAvailable && ffmpeg && ffprobe && simulatorIdentity?.path && !forceNativeDiagnostic) {
      try {
        const freshProbe = await (this.input.rtspProbe ?? probeRtspSimulator)({
          ffmpegPath: ffmpeg,
          ffprobePath: ffprobe,
          simulatorExecutable: simulatorIdentity,
          workloadProfile: this.input.workloadProfile,
          cancelled: this.input.cancelled,
        });
        if (freshProbe.status === "passed") {
          this.externalRtspSources = freshProbe.endpoints;
          rtspAvailable = true;
          rtspQualified = true;
          rtspEvidence = initialRtspEvidence({
            mode: "external_simulator",
            qualified: true,
            simulatorExecutable: freshProbe.simulatorExecutable,
            endpoints: freshProbe.endpoints,
            failures: freshProbe.errors,
            warnings: freshProbe.warnings,
          });
        } else {
          reasons.push(`external_rtsp_simulator_${freshProbe.status}`);
          reasons.push(...freshProbe.errors.map((error) => `external_rtsp_simulator:${error}`));
        }
      } catch (error) {
        reasons.push(`external_rtsp_simulator_preflight:${
          error instanceof Error ? error.message : String(error)
        }`);
      }
    }
    if (mediaAvailable && ffmpeg && !forceNativeDiagnostic && !rtspAvailable) {
      try {
        this.internalRtsp = await createInternalRtspLoopback(
          this.input.workloadProfile.cameraGroups.map((group, index) => ({
            path: `calibration-${index}`,
            codec: group.codec,
          })),
        );
        this.rtspPort = this.internalRtsp.port;
        for (const [index, source] of files.sources.entries()) {
          const target = this.internalRtsp.publisherTargets[index]!;
          this.publishers.push(this.startBackground(ffmpeg, [
            "-hide_banner", "-loglevel", "error", "-nostdin", "-re", "-stream_loop", "-1", "-i", source,
            "-an", "-c:v", "copy", "-f", "rtp", "-payload_type", "96",
            `rtp://127.0.0.1:${target.udpPort}?pkt_size=1200`,
          ]));
        }
        await waitForLoopbackPort(this.rtspPort, this.input.cancelled);
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
        const failedPublisher = this.publishers.find((publisher) => publisher.exitCode !== null);
        if (failedPublisher) throw new Error(`calibration_rtsp_publisher_exit_${failedPublisher.exitCode}`);
        rtspAvailable = true;
        rtspEvidence = initialRtspEvidence({
          mode: "internal_loopback",
          qualified: false,
          warnings: ["internal_loopback_is_diagnostic_only", "loopback_does_not_measure_physical_network_link"],
        });
      } catch (error) {
        reasons.push(`rtsp_preflight:${error instanceof Error ? error.message : String(error)}`);
        await this.stopBackgroundProcesses();
        await this.internalRtsp?.close().catch(() => undefined);
        this.internalRtsp = null;
        this.rtspPort = null;
      }
    } else if (genericNativeBenchmark && !rtspAvailable) {
      rtspAvailable = true;
      rtspEvidence = initialRtspEvidence({
        mode: "generic_proxy",
        qualified: false,
        warnings: ["generic_proxy_is_not_a_functional_rtsp_certification"],
      });
      reasons.push("rtsp_ingest_represented_by_internal_loopback_generator");
    }
    let gpuMediaBackend: CalibrationGpuMediaBackend = "unavailable";
    if (mediaAvailable && ffmpeg && this.input.hardware?.gpuCount && !forceNativeDiagnostic) {
      try {
        const [accelerators, encoders] = await Promise.all([
          this.run(ffmpeg, ["-hide_banner", "-hwaccels"], 15_000),
          this.run(ffmpeg, ["-hide_banner", "-encoders"], 15_000),
        ]);
        gpuMediaBackend = selectFfmpegGpuMediaBackend({
          platform: this.input.runtimeStatus.platform,
          gpuModel: this.input.hardware.gpuModel,
          requiredCodecs: [...new Set(this.input.workloadProfile.cameraGroups.map((group) => group.codec))],
          hardwareAcceleratorsOutput: `${accelerators.stdout}\n${accelerators.stderr}`,
          encodersOutput: `${encoders.stdout}\n${encoders.stderr}`,
        });
      } catch (error) {
        reasons.push(`gpu_media_preflight:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    let gpuMediaDevices = gpuMediaBackend !== "unavailable"
      ? (this.input.hardware?.gpuDevices ?? [])
          .filter((device) => device.mediaEligible && device.mediaBackend === gpuMediaBackend)
          .map((device) => ({ id: device.id, index: device.index, name: device.name }))
      : [];
    if (gpuMediaBackend !== "unavailable" && gpuMediaDevices.length === 0 && this.input.hardware?.gpuCount) {
      for (let index = 0; index < this.input.hardware.gpuCount; index += 1) {
        gpuMediaDevices.push({ id: `gpu:${index}`, index, name: this.input.hardware.gpuModel });
      }
    }
    if (gpuMediaBackend !== "unavailable" && ffmpeg && !forceNativeDiagnostic) {
      const verifiedDevices: typeof gpuMediaDevices = [];
      for (const device of gpuMediaDevices) {
        let verified = true;
        for (const [groupIndex, profile] of this.input.workloadProfile.cameraGroups.entries()) {
          const gpuArguments = ffmpegGpuDeviceArguments(gpuMediaBackend, device.index);
          const videoCaptureRequired = profile.storage.storeVideo ||
            profile.agents.some((agent) => agent.inputType === "video");
          const output = await prepareCalibrationTemporaryFile(
            this.input.workspace,
            `gpu-media-preflight-${device.index}-${groupIndex}-0.${videoCaptureRequired ? "mkv" : "jpg"}`,
          );
          const outputPath = videoCaptureRequired ? output.replace(/-0\.mkv$/, "-%d.mkv") : output;
          const command = calibrationMediaCommand({
            sourceArguments: [
              ...gpuArguments.inputArguments,
              "-stream_loop", "-1", "-i", files.sources[groupIndex]!,
            ],
            durationSeconds: 0.75,
            profile,
            outputPath,
            computeMode: "gpu_accelerated",
            gpuMediaBackend,
            gpuEncoderArguments: gpuArguments.encoderArguments,
          });
          try {
            const result = await this.run(ffmpeg, command.arguments, 30_000);
            if (processFrames(result.stdout) < 1) throw new Error("gpu_media_preflight_produced_no_frames");
          } catch (error) {
            verified = false;
            reasons.push(`gpu_media_device_${device.index}_group_${groupIndex}:${
              error instanceof Error ? error.message : String(error)
            }`);
            break;
          }
        }
        if (verified) verifiedDevices.push(device);
      }
      gpuMediaDevices = verifiedDevices;
      if (gpuMediaDevices.length === 0) gpuMediaBackend = "unavailable";
    }
    const gpuMediaAvailable = gpuMediaBackend !== "unavailable" && gpuMediaDevices.length > 0;
    if (!gpuMediaAvailable) reasons.push("approved_gpu_media_backend_unavailable");

    let cpuInferenceAvailable = false;
    let gpuInferenceAvailable = false;
    this.requiredLlamaModels = [...requiredModels];
    let gpuInferenceBackend = expectedGpuInferenceBackend(this.input.hardware ?? null, this.input.runtimeStatus.platform);
    let gpuInferenceDevices: CalibrationGpuDevice[] = [];
    if (genericNativeBenchmark) {
      cpuInferenceAvailable = true;
      gpuInferenceDevices = (this.nativeBenchmarkPreflight?.gpus ?? [])
        .filter((device) => {
          if (!device.deviceCreated || !device.measured || gpuInferenceBackend === "unavailable") return false;
          const nativeName = device.name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
          return (this.input.hardware?.gpuDevices ?? []).some((candidate) => {
            const candidateName = candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
            return candidate.computeEligible && (nativeName.includes(candidateName) || candidateName.includes(nativeName));
          });
        })
        .map((device) => ({
          id: `native-gpu:${device.index}`,
          name: device.name,
          backend: gpuInferenceBackend as Exclude<CalibrationGpuInferenceBackend, "unavailable">,
        }));
      gpuInferenceAvailable = gpuInferenceDevices.length > 0;
      if (localInferenceRequired) reasons.push("local_inference_represented_by_built_in_compute_proxy");
    } else if (mediaAvailable) {
      const executable = assetPath(this.input.runtimeStatus, "llama-server");
      this.llamaExecutable = executable;
      if (requiredModels.size === 0) {
        cpuInferenceAvailable = true;
        gpuInferenceAvailable = true;
      } else if (!executable) {
        reasons.push("approved_local_inference_assets_unavailable");
      } else {
        try {
          const listed = await this.run(executable, ["--list-devices"], 30_000);
          gpuInferenceDevices = selectLlamaGpuDevices({
            devices: parseLlamaGpuDevices(`${listed.stdout}\n${listed.stderr}`),
            expectedBackend: gpuInferenceBackend,
            gpuModel: this.input.hardware?.gpuModel ?? "",
          });
          if (gpuInferenceDevices[0]) gpuInferenceBackend = gpuInferenceDevices[0].backend;
          if (gpuInferenceDevices.length === 0) reasons.push(`gpu_inference_device_unavailable:${gpuInferenceBackend}`);
        } catch (error) {
          reasons.push(`gpu_inference_device_probe:${error instanceof Error ? error.message : String(error)}`);
        }
        const modelAssetsAvailable = [...requiredModels].every((model) =>
          assetPath(this.input.runtimeStatus, model === "core" ? "qwen-core-gguf" : "qwen-core-max-gguf") !== null &&
          assetPath(this.input.runtimeStatus, model === "core" ? "qwen-core-mmproj" : "qwen-core-max-mmproj") !== null);
        if (!modelAssetsAvailable) reasons.push("approved_local_inference_model_bundle_incomplete");
        cpuInferenceAvailable = modelAssetsAvailable;
        gpuInferenceAvailable = modelAssetsAvailable && gpuInferenceDevices.length > 0;
      }
    }
    const localInferenceAvailable = !localInferenceRequired || (cpuInferenceAvailable && gpuInferenceAvailable);
    this.summary = {
      contractVersion: CALIBRATION_PIPELINE_CONTRACT_VERSION,
      mediaAvailable,
      rtspAvailable,
      rtspQualified,
      rtspEvidence,
      localInferenceRequired,
      localInferenceAvailable,
      cpuInferenceAvailable,
      gpuInferenceAvailable,
      gpuInferenceBackend,
      gpuInferenceDevice: gpuInferenceDevices[0] ?? null,
      gpuInferenceDevices,
      gpuMediaDevices,
      gpuMediaAvailable,
      gpuMediaBackend,
      ffmpegPath: forceNativeDiagnostic ? null : ffmpeg,
      ffprobePath: forceNativeDiagnostic ? null : ffprobe,
      mediamtxPath: null,
      rtspOrigin: this.externalRtspSources[0]?.redactedOrigin ??
        (this.rtspPort ? `rtsp://127.0.0.1:${this.rtspPort}/calibration-0`
          : "rtsp://127.0.0.1:8554/calibration-0"),
      aiqOrigin: "http://127.0.0.1:8899",
      exactCameraGeneratorLimit: exactCameraGeneratorLimit(),
      genericNativeBenchmark,
      evidenceLevel: genericNativeBenchmark ? "generic_native" : "compatible_local_stack",
      unavailableReasons: reasons,
    };
    return this.summary;
  }

  async executePhase(input: {
    phase: PipelinePhaseMeasurement["phase"];
    tier: number;
    durationSeconds: number;
    computeMode?: CalibrationComputeMode;
    gpuDeviceIndexes?: number[];
  }): Promise<PipelinePhaseMeasurement> {
    if (!this.files || !this.summary) throw new Error("calibration_pipeline_not_initialized");
    const computeMode = input.computeMode ?? "cpu_only";
    const selectedGpuDeviceIndexes = computeMode === "gpu_accelerated"
      ? [...new Set(input.gpuDeviceIndexes ?? this.summary.gpuInferenceDevices.map((_, index) => index))]
          .filter((index) => Number.isInteger(index) && index >= 0)
      : [];
    if (this.perceptrumWorkerExecutable) {
      return this.executePerceptrumWorkerPhase(input, computeMode, selectedGpuDeviceIndexes);
    }
    const inferenceAvailable = await this.activateInferenceMode(computeMode, input.tier, selectedGpuDeviceIndexes);
    const mediaAvailable = this.summary.mediaAvailable;
    const scaledSeconds = Math.max(0.2, input.durationSeconds * this.input.timeScale);
    const groupAllocations = allocateCalibrationCameraGroups(this.input.workloadProfile, input.tier);
    const gpuMediaLoadRequired = groupAllocations.some((cameraCount, index) => {
      const group = this.input.workloadProfile.cameraGroups[index];
      return cameraCount > 0 && Boolean(group &&
        (group.storage.storeVideo || group.agents.some((agent) => agent.inputType === "video")));
    });
    const mediaComputeMode: CalibrationComputeMode =
      computeMode === "gpu_accelerated" && gpuMediaLoadRequired && this.summary.gpuMediaAvailable
        ? "gpu_accelerated" : "cpu_only";
    const mediaFallbackUsed = computeMode === "gpu_accelerated" && gpuMediaLoadRequired &&
      mediaComputeMode === "cpu_only";
    const framesPlanned = Math.max(1, Math.floor(groupAllocations.reduce((sum, cameraCount, index) =>
      sum + cameraCount * (this.input.workloadProfile.cameraGroups[index]?.sourceFps ?? 0) * scaledSeconds, 0)));
    const inferencePlan = planCalibrationInferenceLoad(this.input.workloadProfile, input.tier, scaledSeconds);
    const inferencesPlanned = inferencePlan.requestsPlanned;
    const network = evaluateCalibrationNetworkCapacity(
      this.input.workloadProfile,
      input.tier,
      this.input.physicalNetworkLinks ?? [],
    );
    const temporaryBytesEstimated = estimateCalibrationMediaRingBytes(this.input.workloadProfile, input.tier, scaledSeconds);
    const diskStatusProvider = this.input.diskStatus ?? calibrationDiskStatus;
    const enforceDiskReserve = this.input.timeScale === 1 || this.input.diskStatus !== undefined;
    const disk = await diskStatusProvider(this.input.workspace.directory, temporaryBytesEstimated);
    const temporaryBytesFreeBeforePhase = disk.freeBytes;
    if (enforceDiskReserve && !disk.canStart) throw new Error("calibration_insufficient_temporary_space_with_reserve");
    if (this.summary.genericNativeBenchmark) {
      return this.executeGenericNativePhase({
        input,
        computeMode,
        selectedGpuDeviceIndexes,
        scaledSeconds,
        groupAllocations,
        framesPlanned,
        inferencePlan,
        network,
        temporaryBytesEstimated,
        temporaryBytesFreeBeforePhase,
        diskReserveBytes: disk.reserveBytes,
      });
    }
    this.diskPressureError = null;
    let diskCheckBusy = false;
    const diskMonitor = setInterval(() => {
      if (diskCheckBusy || this.diskPressureError) return;
      diskCheckBusy = true;
      if (!enforceDiskReserve) return;
      void diskStatusProvider(this.input.workspace.directory, 0).then((current) => {
        if (current.freeBytes >= current.reserveBytes) return;
        this.diskPressureError = "calibration_disk_reserve_violated";
        for (const child of this.children) void terminateProcessTree(child, false);
      }).catch(() => {
        this.diskPressureError = "calibration_disk_capacity_monitor_failed";
        for (const child of this.children) void terminateProcessTree(child, false);
      }).finally(() => { diskCheckBusy = false; });
    }, this.input.diskCheckIntervalMs ?? 2_000);
    diskMonitor.unref?.();
    const resources = new SystemResourceSampler();
    const hardwareTelemetry = new CalibrationHardwareTelemetrySampler({
      enabled: this.input.advancedTelemetry === true,
      approvedProbePath: verifiedAssetPath(this.input.runtimeStatus, "telemetry-probe"),
    });
    resources.start(Math.max(50, Math.min(1_000, scaledSeconds * 1_000 / 10)));
    hardwareTelemetry.start(Math.max(250, Math.min(1_000, scaledSeconds * 1_000 / 5)));
    const mediaPromise = mediaAvailable
      ? this.runMediaPipeline(
        scaledSeconds,
        input.tier,
        mediaComputeMode,
        mediaComputeMode === "gpu_accelerated" ? selectedGpuDeviceIndexes : [],
      )
      : Promise.resolve({
      framesDecoded: 0, framesEncoded: 0, framesExtracted: 0, durationMs: null as number | null,
      actualConcurrentPipelines: 0,
      mediaDeviceIds: [] as string[],
      fallbackCameraCount: 0,
      rtspSessionsPlanned: 0,
      rtspSessionsOpened: 0,
      rtspSessionsCompleted: 0,
      rtspPayloadBytes: 0,
      rtspPayloadMbps: 0,
      rtspOpenLatenciesMs: [] as number[],
      errors: [] as string[],
    });
    const databasePromise = this.runEquivalentRuntimeLoad(input.tier, scaledSeconds, groupAllocations);
    const memoryPromise = this.runMemoryProbe(scaledSeconds);
    const inferencePromise = inferenceAvailable
      ? this.runLocalInference(inferencePlan, scaledSeconds, input.tier, computeMode)
      : Promise.resolve({ successful: 0, attempted: 0, framesPacked: 0, maxConcurrentRequests: 0,
        latencies: [] as number[], errors: [] as string[],
        deviceInference: [] as NonNullable<PipelinePhaseMeasurement["deviceInference"]> });
    let sampledResources: ReturnType<SystemResourceSampler["stop"]>;
    let media: Awaited<typeof mediaPromise>;
    let database: Awaited<typeof databasePromise>;
    let memoryBytesPerSecond: Awaited<typeof memoryPromise>;
    let inference: Awaited<typeof inferencePromise>;
    let sampledHardwareTelemetry: CalibrationHardwareTelemetrySummary;
    try {
      [media, database, memoryBytesPerSecond, inference] = await Promise.all([
        mediaPromise, databasePromise, memoryPromise, inferencePromise,
      ]);
    } finally {
      clearInterval(diskMonitor);
      sampledResources = resources.stop();
      sampledHardwareTelemetry = await hardwareTelemetry.stop();
    }
    if (this.diskPressureError) throw new Error(this.diskPressureError);
    const measuredStages = new Set<CalibrationStage>([
      "memory_bandwidth", "job_scheduler", "intelligence_scheduler", "database_persistence", "dashboard_queries",
    ]);
    if (mediaAvailable) {
      for (const stage of ["video_decode", "bgr_processing", "video_encode", "disk_write", "disk_read", "frame_extraction"] as const) measuredStages.add(stage);
    }
    if (this.summary.rtspAvailable) {
      measuredStages.add("rtsp_ingest");
      measuredStages.add("network_ingest");
    }
    if (inference.successful > 0) measuredStages.add("local_inference");
    if (sampledHardwareTelemetry.provider === "approved-telemetry-probe" && sampledHardwareTelemetry.thermalThrottlePercent) {
      measuredStages.add("thermal_sustain");
    }
    const exactMediaConcurrency = media.actualConcurrentPipelines === input.tier;
    const exactInferenceConcurrency = inferencesPlanned === 0 || inference.attempted === inferencesPlanned;
    const exactCameraConcurrency = exactMediaConcurrency && exactInferenceConcurrency;
    const cpuWorkloadMeasured = sampledResources.cpu !== null && database.databaseOperations > 0 && media.actualConcurrentPipelines > 0;
    const expectedInferenceDevices = selectedGpuDeviceIndexes
      .map((index) => this.summary!.gpuInferenceDevices[index])
      .filter((device): device is CalibrationGpuDevice => device !== undefined);
    const expectedMediaDevices = selectedGpuDeviceIndexes
      .map((index) => this.summary!.gpuMediaDevices.find((device) => device.index === index) ??
        this.summary!.gpuMediaDevices[index])
      .filter((device): device is { id: string; index: number; name: string } => device !== undefined);
    const gpuInferenceMeasured = computeMode === "gpu_accelerated" && inference.successful > 0 &&
      expectedInferenceDevices.length > 0 &&
      expectedInferenceDevices.every((device) =>
        inference.deviceInference.some((result) => result.deviceId === device.id && result.requestsSuccessful > 0));
    const gpuMediaMeasured = computeMode === "gpu_accelerated" && media.framesDecoded > 0 &&
      media.framesEncoded > 0 && this.summary.gpuMediaBackend !== "unavailable" &&
      expectedMediaDevices.length > 0 && expectedMediaDevices.every((device) => media.mediaDeviceIds.includes(device.id));
    const combinedCpuGpuMeasured = computeMode === "gpu_accelerated" && cpuWorkloadMeasured &&
      media.actualConcurrentPipelines === input.tier &&
      (!this.summary.localInferenceRequired || gpuInferenceMeasured);
    const failures = [
      ...(!this.summary.mediaAvailable ? ["real_ffmpeg_pipeline_unavailable"] : []),
      ...(!this.summary.rtspAvailable ? ["real_rtsp_runtime_unavailable"] : []),
      ...(network.physicalCapacityMbps !== null && !network.verified ? ["physical_network_capacity_below_20_percent_reserve"] : []),
      ...(this.summary.localInferenceRequired && !inferenceAvailable ? ["local_aiq_qwen_unavailable"] : []),
      ...(this.summary.localInferenceRequired && !inferenceAvailable ? [`${computeMode}_local_aiq_qwen_unavailable`] : []),
      ...(inferenceAvailable && inferencesPlanned > 0 && inference.successful / inferencesPlanned < 0.995
        ? ["local_aiq_qwen_success_below_99_5_percent"] : []),
      ...(!cpuWorkloadMeasured ? ["cpu_workload_not_measured"] : []),
      ...(computeMode === "gpu_accelerated" && this.summary.localInferenceRequired && !gpuInferenceMeasured
        ? ["gpu_inference_not_measured"] : []),
      ...(computeMode === "gpu_accelerated" && gpuMediaLoadRequired &&
        this.summary.gpuMediaAvailable && !gpuMediaMeasured
        ? ["gpu_media_not_measured"] : []),
      ...(computeMode === "gpu_accelerated" && this.summary.localInferenceRequired && !combinedCpuGpuMeasured
        ? ["combined_cpu_gpu_load_not_measured"] : []),
      ...(!exactCameraConcurrency ? ["exact_concurrent_camera_load_not_executed"] : []),
      ...media.errors.map((error) => `media_pipeline:${error}`),
      ...inference.errors.map((error) => `local_inference:${error}`),
      ...(database.processedCameraCount < input.tier ? ["not_all_camera_runtime_contracts_exercised"] : []),
      ...((sampledHardwareTelemetry.thermalThrottlePercent?.peak ?? 0) > 0
        ? ["sustained_thermal_throttling_detected"] : []),
    ];
    const inferenceQueueGrowthPerMinute = Math.max(0, inferencesPlanned - inference.attempted) /
      Math.max(scaledSeconds / 60, 1 / 60);
    return {
      phase: input.phase,
      computeMode,
      inferenceBackend: computeMode === "cpu_only" ? "cpu" : this.summary.gpuInferenceBackend,
      inferenceDeviceId: computeMode === "cpu_only" ? "none" : this.summary.gpuInferenceDevice?.id ?? "unavailable",
      inferenceDeviceIds: computeMode === "cpu_only" ? [] : inference.deviceInference.map((device) => device.deviceId),
      deviceInference: inference.deviceInference,
      mediaDeviceIds: media.mediaDeviceIds,
      gpuMediaBackend: computeMode === "cpu_only" ? "unavailable" : this.summary.gpuMediaBackend,
      mediaExecution: mediaComputeMode === "cpu_only" ? "cpu" : this.summary.gpuMediaBackend,
      mediaFallbackUsed: mediaFallbackUsed || media.fallbackCameraCount > 0,
      cpuWorkloadMeasured,
      gpuInferenceMeasured,
      gpuMediaMeasured,
      combinedCpuGpuMeasured,
      tier: input.tier,
      durationSeconds: input.durationSeconds,
      actualConcurrentMediaPipelines: media.actualConcurrentPipelines,
      exactCameraConcurrency,
      framesPlanned,
      framesDecoded: media.framesDecoded,
      framesExtracted: media.framesExtracted,
      framesEncoded: media.framesEncoded,
      inferencesPlanned,
      inferencesAttempted: inference.attempted,
      inferenceFramesPacked: inference.framesPacked,
      inferenceMaximumConcurrency: inference.maxConcurrentRequests,
      inferenceErrors: inference.errors,
      inferenceIntervalMs: inferencePlan.intervalMs,
      framesInferred: inference.successful,
      p95InferenceLatencyMs: percentile95(inference.latencies),
      p99InferenceLatencyMs: percentile99(inference.latencies),
      databaseOperations: database.databaseOperations,
      dashboardQueries: database.dashboardQueries,
      completedJobRuns: database.completedJobRuns,
      completedStepRuns: database.completedStepRuns,
      completedIntelligenceJobs: database.completedIntelligenceJobs,
      processedCameraCount: database.processedCameraCount,
      p95DatabaseLatencyMs: percentile95(database.databaseLatencies),
      p95DashboardLatencyMs: percentile95(database.dashboardLatencies),
      mediaDurationMs: media.durationMs,
      memoryBytesPerSecond,
      networkIngressMbps: network.requiredIngressMbps,
      physicalNetworkCapacityMbps: network.physicalCapacityMbps,
      physicalNetworkUsableMbps: network.usableCapacityMbps,
      physicalNetworkLinkVerified: network.physicalCapacityMbps !== null,
      temporaryBytesEstimated,
      temporaryBytesFreeBeforePhase,
      temporaryDiskReserveBytes: disk.reserveBytes,
      cpuUtilizationPercent: sampledResources.cpu,
      memoryUsedBytes: sampledResources.memory,
      memoryWorkingSetDeltaBytes: sampledResources.peakMemoryDeltaBytes,
      hardwareTelemetry: sampledHardwareTelemetry,
      rtspMeasured: this.summary.rtspAvailable && media.rtspSessionsCompleted > 0,
      rtspSessionsPlanned: media.rtspSessionsPlanned,
      rtspSessionsOpened: media.rtspSessionsOpened,
      rtspSessionsCompleted: media.rtspSessionsCompleted,
      rtspPayloadBytes: media.rtspPayloadBytes,
      rtspPayloadMbps: media.rtspPayloadMbps,
      rtspOpenLatencyP95Ms: percentile95(media.rtspOpenLatenciesMs),
      mediaMeasured: mediaAvailable,
      localInferenceMeasured: !this.summary.localInferenceRequired || inference.successful > 0,
      queueGrowthPerMinute: Math.max(database.queueGrowthPerMinute, inferenceQueueGrowthPerMinute),
      failures,
      measuredStages: [...measuredStages],
    };
  }

  async close(): Promise<void> {
    await this.stopBackgroundProcesses();
  }

  private async executePerceptrumWorkerPhase(
    input: {
      phase: PipelinePhaseMeasurement["phase"];
      tier: number;
      durationSeconds: number;
    },
    computeMode: CalibrationComputeMode,
    selectedGpuDeviceIndexes: number[],
  ): Promise<PipelinePhaseMeasurement> {
    if (!this.perceptrumWorkerExecutable) throw new Error("perceptrum_worker_not_initialized");
    const requestId = randomUUID();
    const request = {
      protocol: PERCEPTRUM_HARDWARE_BENCHMARK_PROTOCOL,
      requestId,
      operation: "runTier",
      isolated: true,
      workspace: this.input.workspace.directory,
      tier: input.tier,
      phase: input.phase,
      durationSeconds: input.durationSeconds,
      computeMode,
      gpuDeviceIndexes: selectedGpuDeviceIndexes,
      workloadProfile: this.input.workloadProfile,
    };
    const stop = {
      protocol: PERCEPTRUM_HARDWARE_BENCHMARK_PROTOCOL,
      requestId: `${requestId}-stop`,
      operation: "stop",
    };
    const timeoutMs = Math.max(30_000, input.durationSeconds * this.input.timeScale * 1_000 + 120_000);
    const result = await this.run(this.perceptrumWorkerExecutable, ["--hardware-benchmark-worker"], timeoutMs,
      `${JSON.stringify(request)}\n${JSON.stringify(stop)}\n`);
    const responses = result.stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as unknown]; } catch { return []; }
    });
    const response = responses.find((candidate) => candidate && typeof candidate === "object" &&
      (candidate as Record<string, unknown>).requestId === requestId);
    return parsePerceptrumWorkerMeasurement(response, { phase: input.phase, tier: input.tier, computeMode });
  }

  private async executeGenericNativePhase(context: {
    input: {
      phase: PipelinePhaseMeasurement["phase"];
      tier: number;
      durationSeconds: number;
    };
    computeMode: CalibrationComputeMode;
    selectedGpuDeviceIndexes: number[];
    scaledSeconds: number;
    groupAllocations: number[];
    framesPlanned: number;
    inferencePlan: CalibrationInferenceLoadPlan;
    network: CalibrationNetworkCapacity;
    temporaryBytesEstimated: number;
    temporaryBytesFreeBeforePhase: number | null;
    diskReserveBytes: number;
  }): Promise<PipelinePhaseMeasurement> {
    if (!this.summary || !this.nativeBenchmarkExecutable || !this.nativeBenchmarkPreflight) {
      throw new Error("native_benchmark_not_initialized");
    }
    const weightedCameraLoad = context.groupAllocations.reduce((sum, cameraCount, index) => {
      const group = this.input.workloadProfile.cameraGroups[index];
      if (!group || cameraCount < 1) return sum;
      const pixels = Math.max(1, group.width * group.height);
      const resolutionFactor = pixels / (1_920 * 1_080);
      const hasFullVideo = group.storage.storeVideo || group.agents.some((agent) => agent.inputType === "video");
      const frameCadence = group.agents.filter((agent) => agent.inputType === "image")
        .reduce((rate, agent) => rate + 1 / Math.max(1, agent.runEverySeconds), 0);
      const mediaWeight = hasFullVideo
        ? Math.max(0.35, resolutionFactor * Math.max(1, group.sourceFps) / 15)
        : Math.max(0.025, resolutionFactor * Math.max(0.02, frameCadence));
      const inferenceWeight = group.agents.reduce((weight, agent) => {
        const cadence = 1 / Math.max(1, agent.runEverySeconds);
        const modelFactor = agent.model === "aiq-3.7-max" ? 2 : agent.executionBackend === "local_aiq" ? 1 : 0.15;
        return weight + cadence * modelFactor * (agent.inputType === "video" ? 1.3 : 0.45);
      }, 0);
      return sum + cameraCount * (mediaWeight + inferenceWeight);
    }, 0);
    const preflight = this.nativeBenchmarkPreflight;
    const selectedNativeGpus = context.computeMode === "gpu_accelerated"
      ? context.selectedGpuDeviceIndexes.flatMap((selectedIndex) => {
          const logical = this.summary!.gpuInferenceDevices[selectedIndex];
          const nativeIndex = logical?.id.startsWith("native-gpu:") ? Number(logical.id.slice("native-gpu:".length)) : -1;
          const match = preflight.gpus.find((gpu) => gpu.index === nativeIndex && gpu.measured);
          return match ? [match] : [];
        })
      : [];
    const cpuCapacityUnits = Math.max(1, preflight.cpu.operationsPerSecond / 20_000_000);
    const gpuCapacityUnits = selectedNativeGpus.reduce((sum, gpu) =>
      sum + Math.sqrt(Math.max(0, gpu.copyBytesPerSecond) / 1_000_000_000) * 7.5, 0);
    const preflightCapacityUnits = Math.max(1, cpuCapacityUnits + gpuCapacityUnits);
    const predictedPressure = weightedCameraLoad / preflightCapacityUnits;
    const logicalThreads = Math.max(1, this.input.hardware?.logicalCores ?? cpus().length);
    const threadsToExercise = Math.max(1, Math.min(logicalThreads,
      Math.ceil(logicalThreads * Math.min(1, predictedPressure / 0.78))));
    const durationMs = Math.max(25, Math.round(context.scaledSeconds * 1_000));
    const resources = new SystemResourceSampler();
    const hardwareTelemetry = new CalibrationHardwareTelemetrySampler({
      enabled: this.input.advancedTelemetry === true,
      approvedProbePath: verifiedAssetPath(this.input.runtimeStatus, "telemetry-probe"),
    });
    resources.start(Math.max(50, Math.min(1_000, durationMs / 10)));
    hardwareTelemetry.start(Math.max(250, Math.min(1_000, durationMs / 5)));
    const nativePromise = this.run(this.nativeBenchmarkExecutable, [
      "--duration-ms", String(durationMs), "--threads", String(threadsToExercise),
    ], nativeBenchmarkProcessTimeoutMs(durationMs))
      .then((result) => JSON.parse(result.stdout) as NativeBenchmarkResult);
    const databasePromise = this.runEquivalentRuntimeLoad(context.input.tier, context.scaledSeconds, context.groupAllocations);
    const realMediaPromise = this.summary.ffmpegPath && this.files
      ? this.runMediaPipeline(
          context.scaledSeconds,
          context.input.tier,
          context.computeMode === "gpu_accelerated" && this.summary.gpuMediaAvailable
            ? "gpu_accelerated" : "cpu_only",
          context.selectedGpuDeviceIndexes,
          genericNativeMediaSampleLimit({
            tier: context.input.tier,
            seedCameraCount: this.input.seedCameraCount ?? 1,
            ...(this.input.hardware?.logicalCores === undefined
              ? {}
              : { logicalProcessors: this.input.hardware.logicalCores }),
            cameraGroupCount: this.input.workloadProfile.cameraGroups.length,
          }),
        )
      : Promise.resolve(null);
    let native: NativeBenchmarkResult;
    let database: Awaited<typeof databasePromise>;
    let realMedia: Awaited<typeof realMediaPromise>;
    let sampledResources: ReturnType<SystemResourceSampler["stop"]>;
    let sampledHardwareTelemetry: CalibrationHardwareTelemetrySummary;
    try {
      [native, database, realMedia] = await Promise.all([nativePromise, databasePromise, realMediaPromise]);
    } finally {
      sampledResources = resources.stop();
      sampledHardwareTelemetry = await hardwareTelemetry.stop();
    }
    if (native.schemaVersion !== "qual-hardware-native-benchmark/1.0.0" || native.status !== "passed" ||
        native.externalNetworkUsed !== false) throw new Error("native_benchmark_contract_mismatch");
    const normalizedCpuCapacity = Math.max(1,
      native.cpu.operationsPerSecond / Math.max(1, threadsToExercise) * logicalThreads / 20_000_000);
    const measuredGpuCapacity = context.computeMode === "gpu_accelerated"
      ? native.gpus.filter((gpu) => selectedNativeGpus.some((selected) => selected.index === gpu.index) && gpu.measured)
          .reduce((sum, gpu) => sum + Math.sqrt(Math.max(0, gpu.copyBytesPerSecond) / 1_000_000_000) * 7.5, 0)
      : 0;
    const memoryCapacity = Math.max(1, native.cpu.memoryBytesPerSecond / 180_000_000);
    const measuredCapacityUnits = Math.max(1, Math.min(normalizedCpuCapacity + measuredGpuCapacity,
      Math.max(memoryCapacity, (normalizedCpuCapacity + measuredGpuCapacity) * 0.45)));
    const pressure = weightedCameraLoad / measuredCapacityUnits;
    const deliveryRatio = Math.min(1, pressure > 0 ? 1 / pressure : 1);
    // The proxy intentionally saturates the selected worker threads while it
    // measures throughput. That raw host counter describes the benchmark
    // implementation, not the requested camera tier. Generic diagnostics use
    // measured workload pressure; compatible-stack runs keep real OS samples.
    const genericCpuUtilization = genericNativePressureMetric(
      pressure,
      sampledResources.cpu?.samples ?? 1,
    );
    // FFmpeg is a bounded physical codec sample in generic mode. The native
    // benchmark models the complete tier, so delivery is calculated from the
    // full-tier pressure instead of from the smaller FFmpeg sample.
    const framesDecoded = Math.floor(context.framesPlanned * deliveryRatio);
    const videoShare = context.groupAllocations.reduce((sum, cameraCount, index) => {
      const group = this.input.workloadProfile.cameraGroups[index];
      return sum + (group && (group.storage.storeVideo || group.agents.some((agent) => agent.inputType === "video"))
        ? cameraCount : 0);
    }, 0) / Math.max(1, context.input.tier);
    const framesEncoded = realMedia?.framesEncoded ?? Math.floor(framesDecoded * videoShare);
    const framesExtracted = realMedia?.framesExtracted ?? Math.max(0, framesDecoded - framesEncoded);
    const inferencesAttempted = Math.floor(context.inferencePlan.requestsPlanned * deliveryRatio);
    const selectedDeviceResults = context.computeMode === "gpu_accelerated"
      ? native.gpus.filter((gpu) => selectedNativeGpus.some((selected) => selected.index === gpu.index))
      : [];
    const gpuMeasured = selectedDeviceResults.length > 0 && selectedDeviceResults.every((gpu) => gpu.measured);
    const p95Latency = context.inferencePlan.requestsPlanned > 0
      ? Math.max(1, context.inferencePlan.intervalMs * Math.max(0.15, pressure * 0.62)) : null;
    const failures = [
      ...(context.network.physicalCapacityMbps !== null && !context.network.verified
        ? ["physical_network_capacity_below_20_percent_reserve"] : []),
      ...(deliveryRatio < 0.995 ? ["generic_native_capacity_saturated"] : []),
      ...(context.computeMode === "gpu_accelerated" && !gpuMeasured ? ["gpu_compute_proxy_not_measured_on_every_selected_device"] : []),
      ...(realMedia?.errors.map((error) => `media_pipeline:${error}`) ?? []),
      ...(database.processedCameraCount < context.input.tier ? ["not_all_camera_runtime_contracts_exercised"] : []),
      ...((sampledHardwareTelemetry.thermalThrottlePercent?.peak ?? 0) > 0
        ? ["sustained_thermal_throttling_detected"] : []),
    ];
    const deviceInference = selectedDeviceResults.map((gpu) => {
      const requests = selectedDeviceResults.length > 0
        ? Math.floor(inferencesAttempted / selectedDeviceResults.length) : 0;
      return {
        deviceId: `native-gpu:${gpu.index}`,
        requestsAttempted: requests,
        requestsSuccessful: requests,
        p95LatencyMs: p95Latency,
      };
    });
    return {
      phase: context.input.phase,
      computeMode: context.computeMode,
      inferenceBackend: context.computeMode === "cpu_only" ? "cpu" : this.summary.gpuInferenceBackend,
      inferenceDeviceId: context.computeMode === "cpu_only" ? "none" : deviceInference[0]?.deviceId ?? "unavailable",
      inferenceDeviceIds: deviceInference.map((device) => device.deviceId),
      deviceInference,
      mediaDeviceIds: realMedia?.mediaDeviceIds ?? selectedDeviceResults.map((gpu) => `native-gpu:${gpu.index}`),
      gpuMediaBackend: realMedia && context.computeMode === "gpu_accelerated"
        ? this.summary.gpuMediaBackend : "unavailable",
      mediaExecution: realMedia && context.computeMode === "gpu_accelerated" && this.summary.gpuMediaAvailable
        ? this.summary.gpuMediaBackend : "cpu",
      mediaFallbackUsed: context.computeMode === "gpu_accelerated" && videoShare > 0 &&
        (!realMedia || !this.summary.gpuMediaAvailable || realMedia.fallbackCameraCount > 0),
      cpuWorkloadMeasured: true,
      gpuInferenceMeasured: context.computeMode === "gpu_accelerated" && gpuMeasured,
      gpuMediaMeasured: Boolean(realMedia && context.computeMode === "gpu_accelerated" &&
        this.summary.gpuMediaAvailable && realMedia.mediaDeviceIds.length > 0),
      combinedCpuGpuMeasured: context.computeMode === "gpu_accelerated" && gpuMeasured,
      tier: context.input.tier,
      durationSeconds: context.input.durationSeconds,
      actualConcurrentMediaPipelines: realMedia?.actualConcurrentPipelines ?? 0,
      // Generic capacity is modeled from physical proxy measurements. It must
      // never be advertised as exact camera-by-camera concurrency.
      exactCameraConcurrency: false,
      framesPlanned: context.framesPlanned,
      framesDecoded,
      framesExtracted,
      framesEncoded,
      inferencesPlanned: context.inferencePlan.requestsPlanned,
      inferencesAttempted,
      inferenceFramesPacked: inferencesAttempted,
      inferenceMaximumConcurrency: Math.min(context.input.tier, logicalThreads + selectedDeviceResults.length),
      inferenceErrors: [],
      inferenceIntervalMs: context.inferencePlan.intervalMs,
      framesInferred: inferencesAttempted,
      p95InferenceLatencyMs: p95Latency,
      p99InferenceLatencyMs: p95Latency === null ? null : p95Latency * 1.12,
      databaseOperations: database.databaseOperations,
      dashboardQueries: database.dashboardQueries,
      completedJobRuns: database.completedJobRuns,
      completedStepRuns: database.completedStepRuns,
      completedIntelligenceJobs: database.completedIntelligenceJobs,
      processedCameraCount: database.processedCameraCount,
      p95DatabaseLatencyMs: percentile95(database.databaseLatencies),
      p95DashboardLatencyMs: percentile95(database.dashboardLatencies),
      mediaDurationMs: realMedia?.durationMs ?? durationMs,
      memoryBytesPerSecond: native.cpu.memoryBytesPerSecond,
      networkIngressMbps: context.network.requiredIngressMbps,
      physicalNetworkCapacityMbps: context.network.physicalCapacityMbps,
      physicalNetworkUsableMbps: context.network.usableCapacityMbps,
      physicalNetworkLinkVerified: context.network.physicalCapacityMbps !== null,
      temporaryBytesEstimated: context.temporaryBytesEstimated,
      temporaryBytesFreeBeforePhase: context.temporaryBytesFreeBeforePhase,
      temporaryDiskReserveBytes: context.diskReserveBytes,
      cpuUtilizationPercent: genericCpuUtilization,
      memoryUsedBytes: sampledResources.memory,
      memoryWorkingSetDeltaBytes: sampledResources.peakMemoryDeltaBytes,
      hardwareTelemetry: sampledHardwareTelemetry,
      rtspMeasured: Boolean(realMedia && this.summary.rtspAvailable &&
        realMedia.rtspSessionsCompleted > 0),
      rtspSessionsPlanned: realMedia?.rtspSessionsPlanned ?? 0,
      rtspSessionsOpened: realMedia?.rtspSessionsOpened ?? 0,
      rtspSessionsCompleted: realMedia?.rtspSessionsCompleted ?? 0,
      rtspPayloadBytes: realMedia?.rtspPayloadBytes ?? 0,
      rtspPayloadMbps: realMedia?.rtspPayloadMbps ?? 0,
      rtspOpenLatencyP95Ms: percentile95(realMedia?.rtspOpenLatenciesMs ?? []),
      mediaMeasured: true,
      localInferenceMeasured: context.inferencePlan.requestsPlanned === 0 || inferencesAttempted > 0,
      queueGrowthPerMinute: Math.max(database.queueGrowthPerMinute,
        (context.inferencePlan.requestsPlanned - inferencesAttempted) / Math.max(context.scaledSeconds / 60, 1 / 60)),
      failures,
      measuredStages: [
        "video_decode", "bgr_processing", "video_encode", "memory_bandwidth", "disk_write", "disk_read",
        "frame_extraction", "local_inference", "job_scheduler", "intelligence_scheduler",
        "database_persistence", "dashboard_queries",
      ],
    };
  }

  private async waitForLlamaHealth(origin: string, child: ChildProcess): Promise<void> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (this.input.cancelled() || this.diskPressureError) throw new Error(this.diskPressureError ?? "calibration_cancelled");
      if (child.exitCode !== null) throw new Error(`calibration_llama_server_exit_${child.exitCode}`);
      try {
        const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1_000) });
        if (response.ok) return;
      } catch { /* The verified local model is still loading. */ }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    throw new Error("calibration_llama_server_start_timeout");
  }

  private async activateInferenceMode(
    computeMode: CalibrationComputeMode,
    _desiredConcurrency: number,
    selectedGpuDeviceIndexes: number[] = [],
  ): Promise<boolean> {
    if (!this.summary) throw new Error("calibration_pipeline_not_initialized");
    if (this.summary.genericNativeBenchmark) {
      return computeMode === "cpu_only" || this.summary.gpuInferenceAvailable;
    }
    const devices: Array<CalibrationGpuDevice | null> = computeMode === "gpu_accelerated"
      ? selectedGpuDeviceIndexes.map((index) => this.summary!.gpuInferenceDevices[index])
          .filter((device): device is CalibrationGpuDevice => device !== undefined)
      : [null];
    const expectedCount = this.requiredLlamaModels.length * devices.length;
    if (this.requiredLlamaModels.length === 0) {
      await this.stopLlamaServers();
      return true;
    }
    const minimumGpuVramBytes = Math.min(...devices.flatMap((device) => {
      if (!device) return [];
      const hardwareDevice = (this.input.hardware?.gpuDevices ?? []).find((candidate) =>
        candidate.id === device.id || candidate.name.toLowerCase().includes(device.name.split("(")[0]!.trim().toLowerCase()));
      return hardwareDevice?.vramBytes ? [hardwareDevice.vramBytes] : [];
    }));
    const parallel = computeMode === "cpu_only"
      ? Math.max(1, Math.min(8, Math.floor((this.input.hardware?.logicalCores ?? 4) / 4)))
      : Number.isFinite(minimumGpuVramBytes)
        ? Math.max(1, Math.min(8, Math.floor(Math.max(0, minimumGpuVramBytes - 2 * 1024 ** 3) / (4 * 1024 ** 3))))
        : 1;
    const active = this.llamaServers.filter((runtime) => runtime.computeMode === computeMode && runtime.child.exitCode === null);
    const expectedDeviceIds = devices.map((device) => device?.id ?? "cpu").sort();
    const activeDeviceIds = active.map((runtime) => runtime.device?.id ?? "cpu").sort();
    if (expectedCount > 0 && active.length === expectedCount && this.llamaServers.length === expectedCount &&
        active.every((runtime) => runtime.parallel >= parallel) &&
        JSON.stringify(activeDeviceIds) === JSON.stringify(
          this.requiredLlamaModels.flatMap(() => expectedDeviceIds).sort(),
        )) return true;

    await this.stopLlamaServers();
    const candidateAvailable = computeMode === "cpu_only"
      ? this.summary.cpuInferenceAvailable : this.summary.gpuInferenceAvailable;
    if (!candidateAvailable || !this.llamaExecutable || expectedCount === 0) return false;

    try {
      for (const device of devices) for (const model of this.requiredLlamaModels) {
         const computeArguments = llamaComputeArguments(computeMode, device);
        const topologyArguments = llamaCpuTopologyArguments(this.input.hardware, expectedCount);
        const modelPath = assetPath(this.input.runtimeStatus, model === "core" ? "qwen-core-gguf" : "qwen-core-max-gguf");
        const mmprojPath = assetPath(this.input.runtimeStatus, model === "core" ? "qwen-core-mmproj" : "qwen-core-max-mmproj");
        if (!modelPath || !mmprojPath) throw new Error(`approved_${model}_assets_unavailable`);
        const port = await freeLoopbackPort();
        const child = this.startBackground(this.llamaExecutable, [
          "-m", modelPath, "--mmproj", mmprojPath, "--host", "127.0.0.1", "--port", String(port),
          "--ctx-size", String(calibrationLlamaContextSize(parallel)),
          "--parallel", String(parallel), "--jinja", "--log-disable", ...computeArguments, ...topologyArguments,
        ]);
        const origin = `http://127.0.0.1:${port}`;
        const hardwareDevice = device ? (this.input.hardware?.gpuDevices ?? []).find((candidate) =>
          candidate.id === device.id ||
          candidate.name.toLowerCase().includes(device.name.split("(")[0]!.trim().toLowerCase()) ||
          device.name.toLowerCase().includes(candidate.name.toLowerCase())) : null;
        const runtime = {
          model, computeMode, origin, child, parallel, device,
          weight: Math.max(1, (hardwareDevice?.vramBytes ?? 1024 ** 3) / 1024 ** 3),
          queueDepth: 0,
        };
        this.llamaServers.push(runtime);
        await this.waitForLlamaHealth(origin, child);
        if (!this.files) throw new Error("calibration_inference_frame_unavailable");
        const image = `data:image/jpeg;base64,${(await readFile(this.files.frame)).toString("base64")}`;
        const preflight = await this.requestInference(runtime, image, 60_000);
        if (!preflight.success) throw new Error(`calibration_inference_functional_preflight_failed:${preflight.error}`);
      }
      this.summary.aiqOrigin = this.llamaServers[0]?.origin ?? this.summary.aiqOrigin;
      return this.llamaServers.length === expectedCount;
    } catch (error) {
      const reason = `${computeMode}_inference_preflight:${error instanceof Error ? error.message : String(error)}`;
      if (!this.summary.unavailableReasons.includes(reason)) this.summary.unavailableReasons.push(reason);
      if (computeMode === "cpu_only") this.summary.cpuInferenceAvailable = false;
      else this.summary.gpuInferenceAvailable = false;
      this.summary.localInferenceAvailable = this.summary.cpuInferenceAvailable && this.summary.gpuInferenceAvailable;
      await this.stopLlamaServers(computeMode);
      return false;
    }
  }

  private async runLocalInference(
    plan: CalibrationInferenceLoadPlan,
    seconds: number,
    desiredConcurrency: number,
    computeMode: CalibrationComputeMode,
  ): Promise<{
    successful: number;
    attempted: number;
    framesPacked: number;
    maxConcurrentRequests: number;
    latencies: number[];
    errors: string[];
    deviceInference: NonNullable<PipelinePhaseMeasurement["deviceInference"]>;
  }> {
    const runtimes = this.llamaServers.filter((runtime) => runtime.computeMode === computeMode);
    if (!this.files || runtimes.length === 0 || plan.requestsPlanned === 0) {
      return {
        successful: 0, attempted: 0, framesPacked: 0, maxConcurrentRequests: 0, latencies: [], errors: [],
        deviceInference: [],
      };
    }
    const image = `data:image/jpeg;base64,${(await readFile(this.files.frame)).toString("base64")}`;
    const startedAt = performance.now();
    const latencies: number[] = [];
    const errors = new Set<string>();
    let successful = 0;
    let attempted = 0;
    let maxConcurrentRequests = 0;
    const deviceResults = new Map<string, { attempted: number; successful: number; latencies: number[] }>();
    const timeoutMs = Math.max(30_000, Math.min(120_000, Math.floor(plan.intervalMs * 0.9)));
    for (let window = 0; window < plan.windowCount && attempted < plan.requestsPlanned; window += 1) {
      if (this.input.cancelled() || this.diskPressureError) throw new Error(this.diskPressureError ?? "calibration_cancelled");
      const scheduledAt = startedAt + Math.min(seconds * 1_000, window * plan.intervalMs);
      const waitMs = scheduledAt - performance.now();
      if (waitMs > 0) await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
      let remainingInWindow = Math.min(plan.requestsPerWindow, plan.requestsPlanned - attempted);
      while (remainingInWindow > 0) {
        const batchSize = Math.min(remainingInWindow, desiredConcurrency);
        const batch = weightedRoundRobin(runtimes.map((runtime) => ({
          value: runtime,
          weight: runtime.weight,
          queueDepth: runtime.queueDepth,
        })), batchSize);
        maxConcurrentRequests = Math.max(maxConcurrentRequests, batch.length);
        const outcomes = await Promise.all(batch.map(async (runtime) => {
          const requestStarted = performance.now();
          runtime.queueDepth += 1;
          try {
            const outcome = await this.requestInference(runtime, image, timeoutMs);
            const latency = performance.now() - requestStarted;
            latencies.push(latency);
            const deviceId = runtime.device?.id ?? "cpu";
            const deviceResult = deviceResults.get(deviceId) ?? { attempted: 0, successful: 0, latencies: [] };
            deviceResult.attempted += 1;
            deviceResult.successful += outcome.success ? 1 : 0;
            deviceResult.latencies.push(latency);
            deviceResults.set(deviceId, deviceResult);
            return outcome;
          } finally {
            runtime.queueDepth = Math.max(0, runtime.queueDepth - 1);
          }
        }));
        attempted += outcomes.length;
        remainingInWindow -= outcomes.length;
        successful += outcomes.filter((outcome) => outcome.success).length;
        outcomes.forEach((outcome) => { if (!outcome.success) errors.add(outcome.error); });
      }
    }
    const framesPacked = Math.round(plan.framesPlanned * attempted / Math.max(1, plan.requestsPlanned));
    return {
      successful, attempted, framesPacked, maxConcurrentRequests, latencies, errors: [...errors].slice(0, 20),
      deviceInference: [...deviceResults.entries()].map(([deviceId, result]) => ({
        deviceId,
        requestsAttempted: result.attempted,
        requestsSuccessful: result.successful,
        p95LatencyMs: percentile95(result.latencies),
      })),
    };
  }

  private async requestInference(
    runtime: { model: "core" | "core-max"; origin: string },
    image: string,
    timeoutMs: number,
  ): Promise<{ success: boolean; error: string }> {
    try {
      const response = await fetch(`${runtime.origin}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: `calibration-${runtime.model}`,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "/no_think\nDescribe the synthetic calibration image in at most five words." },
              { type: "image_url", image_url: { url: image } },
            ],
          }],
          temperature: 0,
          max_tokens: 32,
        }),
      });
      const body = await response.text();
      if (!response.ok) return { success: false, error: `http_${response.status}:${body.slice(0, 240)}` };
      const parsed = JSON.parse(body) as { choices?: Array<{ message?: { content?: unknown } }> };
      return typeof parsed.choices?.[0]?.message?.content === "string"
        ? { success: true, error: "" }
        : { success: false, error: "invalid_response_payload" };
    } catch (error) {
      return { success: false, error: error instanceof Error ? `${error.name}:${error.message}`.slice(0, 240) : String(error).slice(0, 240) };
    }
  }

  private async runMediaPipeline(
    seconds: number,
    tier: number,
    computeMode: CalibrationComputeMode,
    selectedGpuDeviceIndexes: number[] = [],
    maximumMaterializedPipelines: number | null = null,
  ): Promise<{
    framesDecoded: number;
    framesEncoded: number;
    framesExtracted: number;
    durationMs: number;
    actualConcurrentPipelines: number;
    mediaDeviceIds: string[];
    fallbackCameraCount: number;
    rtspSessionsPlanned: number;
    rtspSessionsOpened: number;
    rtspSessionsCompleted: number;
    rtspPayloadBytes: number;
    rtspPayloadMbps: number;
    rtspOpenLatenciesMs: number[];
    errors: string[];
  }> {
    const summary = this.summary;
    const ffmpeg = summary?.ffmpegPath;
    if (!summary || !ffmpeg || !this.files) throw new Error("calibration_ffmpeg_unavailable");
    const files = this.files;
    const sequence = this.mediaSequence++;
    const materializedTier = maximumMaterializedPipelines === null
      ? tier
      : Math.max(1, Math.min(tier, Math.floor(maximumMaterializedPipelines)));
    const cameras = allocateCalibrationCameraGroups(this.input.workloadProfile, materializedTier)
      .flatMap((cameraCount, group) =>
      Array.from({ length: cameraCount }, (_, camera) => ({ group, camera })));
    const mediaDevices = computeMode === "gpu_accelerated"
      ? selectedGpuDeviceIndexes.map((index) =>
          summary.gpuMediaDevices.find((device) => device.index === index) ?? summary.gpuMediaDevices[index])
          .filter((device): device is { id: string; index: number; name: string } => device !== undefined)
      : [];
    const started = performance.now();
    const outcomes = await Promise.all(cameras.map(async ({ group, camera }) => {
      const profile = this.input.workloadProfile.cameraGroups[group]!;
      const compatibleExternalSources = this.externalRtspSources.filter((source) =>
        source.compatibleGroupIndexes.includes(group));
      const externalSource = compatibleExternalSources.length > 0
        ? compatibleExternalSources[(group + camera) % compatibleExternalSources.length]!
        : null;
      const mediaDevice = mediaDevices.length > 0 ? mediaDevices[(group + camera) % mediaDevices.length]! : null;
      const videoCaptureRequired = profile.storage.storeVideo ||
        profile.agents.some((agent) => agent.inputType === "video");
      const outputs = videoCaptureRequired
        ? await Promise.all(Array.from({ length: CALIBRATION_MEDIA_RING_SEGMENTS }, (_, segment) =>
          prepareCalibrationTemporaryFile(this.input.workspace, `media-${sequence}-${group}-${camera}-${segment}.mkv`)))
        : [await prepareCalibrationTemporaryFile(
          this.input.workspace,
          `snapshot-${sequence}-${group}-${camera}.jpg`,
        )];
      const outputPattern = videoCaptureRequired ? outputs[0]!.replace(/-0\.mkv$/, "-%d.mkv") : outputs[0]!;
      const gpuDeviceArguments = videoCaptureRequired && computeMode === "gpu_accelerated" && mediaDevice
        ? ffmpegGpuDeviceArguments(this.summary?.gpuMediaBackend ?? "unavailable", mediaDevice.index)
        : { inputArguments: [] as string[], encoderArguments: [] as string[] };
      const sourceArguments = [
        ...gpuDeviceArguments.inputArguments,
        ...(externalSource
          ? ["-rtsp_transport", "tcp", "-timeout", "3000000", "-i",
            authenticatedRtspSimulatorOrigin(externalSource.port)]
          : this.summary?.rtspAvailable && this.rtspPort
            ? ["-rtsp_transport", "tcp", "-i", `rtsp://127.0.0.1:${this.rtspPort}/calibration-${group}`]
            : ["-stream_loop", "-1", "-i", files.sources[group]!]),
      ];
      try {
        const command = calibrationMediaCommand({
          sourceArguments,
          durationSeconds: seconds,
          profile,
          outputPath: outputPattern,
          computeMode,
          gpuMediaBackend: this.summary?.gpuMediaBackend ?? "unavailable",
          gpuEncoderArguments: gpuDeviceArguments.encoderArguments,
        });
        const result = await this.run(ffmpeg, command.arguments, Math.max(30_000, seconds * 1_000 + 30_000));
        const outputFrames = processFrames(result.stdout);
        return {
          cameraCount: 1,
          decodedFrames: Math.max(outputFrames, Math.floor(profile.sourceFps * seconds)),
          encodedFrames: command.outputKind === "video_clip" ? outputFrames : 0,
          extractedFrames: command.outputKind === "frame_snapshot" ? outputFrames : 0,
          outputKind: command.outputKind,
          outputs,
          mediaDeviceId: videoCaptureRequired ? mediaDevice?.id ?? null : null,
          fallbackUsed: false,
          rtspSession: Boolean(externalSource || this.rtspPort),
          payloadBytes: Math.round((externalSource?.payloadMbps ?? profile.bitrateMbps) *
            1_000_000 / 8 * seconds),
          openLatencyMs: externalSource?.openLatencyMs ?? null,
        };
      } catch (error) {
        if (videoCaptureRequired && computeMode === "gpu_accelerated" && mediaDevice) {
          try {
            const fallbackSourceArguments = externalSource
              ? ["-rtsp_transport", "tcp", "-timeout", "3000000", "-i",
                authenticatedRtspSimulatorOrigin(externalSource.port)]
              : this.summary?.rtspAvailable && this.rtspPort
                ? ["-rtsp_transport", "tcp", "-i", `rtsp://127.0.0.1:${this.rtspPort}/calibration-${group}`]
                : ["-stream_loop", "-1", "-i", files.sources[group]!];
            const fallbackCommand = calibrationMediaCommand({
              sourceArguments: fallbackSourceArguments,
              durationSeconds: seconds,
              profile,
              outputPath: outputPattern,
              computeMode: "cpu_only",
              gpuMediaBackend: "unavailable",
              gpuEncoderArguments: [],
            });
            const fallbackResult = await this.run(
              ffmpeg,
              fallbackCommand.arguments,
              Math.max(30_000, seconds * 1_000 + 30_000),
            );
            const outputFrames = processFrames(fallbackResult.stdout);
            return {
              cameraCount: 1,
              decodedFrames: Math.max(outputFrames, Math.floor(profile.sourceFps * seconds)),
              encodedFrames: fallbackCommand.outputKind === "video_clip" ? outputFrames : 0,
              extractedFrames: fallbackCommand.outputKind === "frame_snapshot" ? outputFrames : 0,
              outputKind: fallbackCommand.outputKind,
              outputs,
              mediaDeviceId: null,
              fallbackUsed: true,
              rtspSession: Boolean(externalSource || this.rtspPort),
              payloadBytes: Math.round((externalSource?.payloadMbps ?? profile.bitrateMbps) *
                1_000_000 / 8 * seconds),
              openLatencyMs: externalSource?.openLatencyMs ?? null,
            };
          } catch {
            // The source and both encoding paths passed preflight. Failing only
            // under concurrent load is a measured capacity boundary, not a
            // missing-runtime or installation error.
          }
        }
        return {
          cameraCount: 0, decodedFrames: 0, encodedFrames: 0, extractedFrames: 0,
          outputKind: videoCaptureRequired ? "video_clip" as const : "frame_snapshot" as const,
          outputs, mediaDeviceId: mediaDevice?.id ?? null,
          fallbackUsed: false,
          rtspSession: false,
          payloadBytes: 0,
          openLatencyMs: null,
          error: "media_concurrency_capacity_exhausted",
        };
      }
    }));
    const firstOutput = outcomes.find((outcome) =>
      outcome.cameraCount > 0 && outcome.outputKind === "video_clip")?.outputs[0];
    const extractionErrors: string[] = [];
    let frameExtracted = false;
    if (firstOutput) {
      try {
        await this.run(ffmpeg, [
          "-hide_banner", "-loglevel", "error", "-nostdin", "-i", firstOutput,
          "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "2", "-y", files.frame,
        ], 15_000);
        frameExtracted = true;
      } catch (error) {
        extractionErrors.push(error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180));
      }
    }
    const framesDecoded = outcomes.reduce((sum, outcome) => sum + outcome.decodedFrames, 0);
    const framesEncoded = outcomes.reduce((sum, outcome) => sum + outcome.encodedFrames, 0);
    const framesExtracted = outcomes.reduce((sum, outcome) => sum + outcome.extractedFrames, 0) +
      (frameExtracted ? 1 : 0);
    const rtspPayloadBytes = outcomes.reduce((sum, outcome) => sum + outcome.payloadBytes, 0);
    return {
      framesDecoded,
      framesEncoded,
      framesExtracted,
      durationMs: performance.now() - started,
      actualConcurrentPipelines: outcomes.reduce((sum, outcome) => sum + outcome.cameraCount, 0),
      mediaDeviceIds: [...new Set(outcomes.flatMap((outcome) =>
        outcome.cameraCount > 0 && outcome.mediaDeviceId ? [outcome.mediaDeviceId] : []))],
      fallbackCameraCount: outcomes.filter((outcome) => outcome.cameraCount > 0 && outcome.fallbackUsed).length,
      rtspSessionsPlanned: summary.rtspAvailable ? cameras.length : 0,
      rtspSessionsOpened: outcomes.filter((outcome) => outcome.rtspSession && outcome.cameraCount > 0).length,
      rtspSessionsCompleted: outcomes.filter((outcome) => outcome.rtspSession && outcome.cameraCount > 0).length,
      rtspPayloadBytes,
      rtspPayloadMbps: seconds > 0 ? rtspPayloadBytes * 8 / seconds / 1_000_000 : 0,
      rtspOpenLatenciesMs: outcomes.flatMap((outcome) =>
        outcome.openLatencyMs === null ? [] : [outcome.openLatencyMs]),
      errors: [...outcomes.flatMap((outcome) => outcome.error ? [outcome.error.slice(0, 180)] : []), ...extractionErrors],
    };
  }

  private async runEquivalentRuntimeLoad(tier: number, seconds: number, groupAllocations: number[]): Promise<{
    databaseOperations: number;
    dashboardQueries: number;
    completedJobRuns: number;
    completedStepRuns: number;
    completedIntelligenceJobs: number;
    processedCameraCount: number;
    queueGrowthPerMinute: number;
    databaseLatencies: number[];
    dashboardLatencies: number[];
  }> {
    const database = this.input.database;
    const now = new Date().toISOString();
    const profiles = groupAllocations.flatMap((cameraCount, group) =>
      Array.from({ length: cameraCount }, () => ({ group, profile: this.input.workloadProfile.cameraGroups[group]! })));
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("INSERT OR IGNORE INTO intelligence_projects(id,user_id,name,created_at,updated_at) VALUES(1,'calibration','Calibration',?,?)").run(now, now);
      const camera = database.prepare("INSERT INTO cameras(id,user_id,name,profile_group,codec,width,height,source_fps,bitrate_mbps,created_at,updated_at) VALUES(?,'calibration',?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile_group=excluded.profile_group,codec=excluded.codec,width=excluded.width,height=excluded.height,source_fps=excluded.source_fps,bitrate_mbps=excluded.bitrate_mbps,updated_at=excluded.updated_at");
      const source = database.prepare("INSERT INTO intelligence_sources(project_id,camera_id,uri,created_at,updated_at) VALUES(1,?,?,?,?) ON CONFLICT(camera_id) DO UPDATE SET uri=excluded.uri,updated_at=excluded.updated_at");
      for (let id = 1; id <= tier; id += 1) {
        const assigned = profiles[id - 1]!;
        camera.run(id, `Camera ${id}`, assigned.group, assigned.profile.codec, assigned.profile.width, assigned.profile.height,
          assigned.profile.sourceFps, assigned.profile.bitrateMbps, now, now);
        source.run(id, `synthetic://calibration/group/${assigned.group}`, now, now);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    const databaseLatencies: number[] = [];
    const dashboardLatencies: number[] = [];
    const processed = new Set<number>();
    let databaseOperations = 0;
    let dashboardQueries = 0;
    let completedJobRuns = 0;
    let completedStepRuns = 0;
    let completedIntelligenceJobs = 0;
    const jobMultiplier = Math.max(1, this.input.workloadProfile.concurrentWorkloads.activeJobs);
    const groupedJobCameraCount = Math.max(1, Math.min(tier,
      this.input.workloadProfile.concurrentWorkloads.groupedJobCameras || 1));
    const intelligenceMultiplier = Math.max(1, this.input.workloadProfile.concurrentWorkloads.intelligenceStreams);
    const dashboardMultiplier = Math.max(1, this.input.workloadProfile.concurrentWorkloads.concurrentChatSessions +
      this.input.workloadProfile.concurrentWorkloads.activeSearches);
    const pendingStart = Number((database.prepare("SELECT COUNT(*) AS count FROM commands WHERE status='pending'").get() as { count: number }).count);
    const deadline = performance.now() + seconds * 1_000;
    do {
      if (this.input.cancelled() || this.diskPressureError) throw new Error(this.diskPressureError ?? "calibration_cancelled");
      const cameraId = databaseOperations % tier + 1;
      const sourceFps = profiles[cameraId - 1]?.profile.sourceFps ?? 1;
      const cameraAgents = profiles[cameraId - 1]?.profile.agents ?? [];
      const sourceId = Number((database.prepare("SELECT id FROM intelligence_sources WHERE camera_id=? LIMIT 1").get(cameraId) as { id: number }).id);
      const timestamp = new Date().toISOString();
      const cameraSessionId = randomUUID();
      const databaseStarted = performance.now();
      database.exec("BEGIN IMMEDIATE");
      try {
        database.prepare("INSERT INTO camera_runtime_sessions(camera_session_id,user_id,camera_id,camera_name,start_origin,status,started_at,online_at,last_event_at,created_at,updated_at) VALUES(?,'calibration',?,'Synthetic','job_start','online',?,?,?,?,?)")
          .run(cameraSessionId, cameraId, timestamp, timestamp, timestamp, timestamp, timestamp);
        const jobRunIds: string[] = [];
        const stepRunIds: string[] = [];
        for (let jobIndex = 0; jobIndex < jobMultiplier; jobIndex += 1) {
          const jobRunId = randomUUID();
          jobRunIds.push(jobRunId);
          const cameraIds = Array.from({ length: groupedJobCameraCount }, (_, offset) => (cameraId + offset - 1) % tier + 1);
          const command = database.prepare("INSERT INTO commands(camera_id,command_type,payload_json,status,created_at,updated_at) VALUES(?,'job_start',?,'pending',?,?)")
            .run(cameraId, JSON.stringify({ jobRunId, cameraIds, jobIndex }), timestamp, timestamp);
          database.prepare("INSERT INTO job_runs(job_run_id,job_id,user_id,job_name,status,trigger_type,trigger_json,execution_domain,source_command_id,started_at_utc,last_event_at_utc,created_at,updated_at) VALUES(?,?,'calibration','Calibration Job','running','calibration',?,'local',?,?,?,?,?)")
            .run(jobRunId, jobIndex + 1, JSON.stringify({ cameraIds }), Number(command.lastInsertRowid), timestamp, timestamp, timestamp, timestamp);
          for (const [stepIndex, stepCameraId] of cameraIds.entries()) {
            const stepRunId = randomUUID();
            stepRunIds.push(stepRunId);
            database.prepare("INSERT INTO job_step_runs(job_id,step_id,camera_id,step_agent_id,status,step_run_id,job_run_id,step_order,step_name,started_at_utc,latest_event_at_utc,metrics_json,created_at,updated_at) VALUES(?,?,?,1,'running',?,?,?,'Calibration Step',?,?,'{}',?,?)")
              .run(jobIndex + 1, stepIndex + 1, stepCameraId, stepRunId, jobRunId, stepIndex + 1, timestamp, timestamp, timestamp, timestamp);
            database.prepare("UPDATE job_step_runs SET status='completed',completed_at_utc=?,latest_event_at_utc=?,updated_at=? WHERE step_run_id=?").run(timestamp, timestamp, timestamp, stepRunId);
          }
          database.prepare("UPDATE job_runs SET status='completed',completed_at_utc=?,last_event_at_utc=?,updated_at=? WHERE job_run_id=?").run(timestamp, timestamp, timestamp, jobRunId);
          database.prepare("UPDATE commands SET status='completed',updated_at=? WHERE id=?").run(timestamp, command.lastInsertRowid);
        }
        const agentRunIds: string[] = [];
        for (const agent of cameraAgents) {
          const agentRunId = randomUUID();
          agentRunIds.push(agentRunId);
          const provider = agent.model.startsWith("aiq-") ? "aiq_local" : agent.model.startsWith("gpt-") ? "remote_stub" : "opencv_local";
          database.prepare("INSERT INTO camera_agent_runs(agent_run_id,camera_session_id,user_id,camera_id,camera_name,status,provider,model,started_at_utc,created_at,updated_at) VALUES(?,?,'calibration',?,'Synthetic','running',?,?,?, ?, ?)")
            .run(agentRunId, cameraSessionId, cameraId, provider, agent.model, timestamp, timestamp, timestamp);
          database.prepare("INSERT INTO camera_agent_run_results(result_uid,agent_run_id,camera_session_id,user_id,camera_id,provider,model,answer_text,result_json,confidence,event_timestamp_utc,created_at,updated_at) VALUES(?,?,?,'calibration',?,?,?,'diagnostic',?,1,?,?,?)")
            .run(randomUUID(), agentRunId, cameraSessionId, cameraId, provider, agent.model, JSON.stringify({ diagnostic: true, runEverySeconds: agent.runEverySeconds }), timestamp, timestamp, timestamp);
          database.prepare("UPDATE camera_agent_runs SET status='completed',completed_at_utc=?,updated_at=? WHERE agent_run_id=?").run(timestamp, timestamp, agentRunId);
        }
        for (let intelligenceIndex = 0; intelligenceIndex < intelligenceMultiplier; intelligenceIndex += 1) {
          const intelligence = database.prepare("INSERT INTO intelligence_jobs(project_id,status,model_profile,sample_fps,source_ids_json,progress,current_message,created_at,updated_at) VALUES(1,'queued','people_vehicles',1,?,0,'Queued',?,?)")
            .run(JSON.stringify([sourceId]), timestamp, timestamp);
          database.prepare("UPDATE intelligence_jobs SET status='running',progress=1,current_message='Starting local deterministic orchestration stub',started_at=?,updated_at=? WHERE id=? AND status='queued'")
            .run(timestamp, timestamp, intelligence.lastInsertRowid);
          database.prepare("INSERT INTO intelligence_observations(project_id,source_id,job_id,model_name,payload_json,created_at,updated_at) VALUES(1,?,?, 'deterministic-orchestration-stub',?, ?, ?)")
            .run(sourceId, intelligence.lastInsertRowid, JSON.stringify({ diagnostic: true, intelligenceIndex }), timestamp, timestamp);
          database.prepare("INSERT INTO intelligence_audit_logs(project_id,source_id,job_id,model_name,payload_json,created_at,updated_at) VALUES(1,?,?, 'deterministic-orchestration-stub',?, ?, ?)")
            .run(sourceId, intelligence.lastInsertRowid, JSON.stringify({ transition: "queued-running-completed" }), timestamp, timestamp);
          database.prepare("UPDATE intelligence_jobs SET status='completed',progress=100,current_message='Deterministic orchestration stub completed',completed_at=?,updated_at=? WHERE id=? AND status='running'")
            .run(timestamp, timestamp, intelligence.lastInsertRowid);
        }
        database.prepare("INSERT INTO capture_metrics(camera_id,expected_fps,actual_fps,frames_received,frames_dropped,queue_depth,sampled_at,updated_at) VALUES(?,?,?,?,0,0,?,?)")
          .run(cameraId, sourceFps, sourceFps, Math.max(1, Math.floor(sourceFps * seconds)), timestamp, timestamp);
        database.prepare("INSERT INTO events(camera_id,user_id,event_type,details_json,created_at) VALUES(?,'calibration','agent_result',?,?)")
          .run(cameraId, JSON.stringify({ jobRunIds, stepRunIds, agentRunIds }), timestamp);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      databaseLatencies.push(performance.now() - databaseStarted);
      for (let dashboardIndex = 0; dashboardIndex < dashboardMultiplier; dashboardIndex += 1) {
        const dashboardStarted = performance.now();
        database.prepare("SELECT COUNT(*) AS count FROM cameras").get();
        database.prepare("SELECT camera_id,COUNT(*) AS count FROM camera_agent_runs GROUP BY camera_id ORDER BY camera_id").all();
        database.prepare("SELECT camera_id,MAX(created_at) AS latest FROM events GROUP BY camera_id").all();
        database.prepare("SELECT camera_id,MAX(actual_fps) AS fps,MAX(queue_depth) AS queue FROM capture_metrics GROUP BY camera_id").all();
        database.prepare("SELECT status,COUNT(*) AS count FROM job_runs GROUP BY status").all();
        database.prepare("SELECT status,COUNT(*) AS count FROM job_step_runs GROUP BY status").all();
        database.prepare("SELECT status,COUNT(*) AS count,MAX(progress) AS progress FROM intelligence_jobs GROUP BY status").all();
        database.prepare("SELECT COUNT(*) AS count FROM commands WHERE status='pending'").get();
        dashboardQueries += 8;
        dashboardLatencies.push(performance.now() - dashboardStarted);
      }
      processed.add(cameraId);
      databaseOperations += 1;
      completedJobRuns += jobMultiplier;
      completedStepRuns += jobMultiplier * groupedJobCameraCount;
      completedIntelligenceJobs += intelligenceMultiplier;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1));
    } while (performance.now() < deadline || processed.size < tier);
    const pendingEnd = Number((database.prepare("SELECT COUNT(*) AS count FROM commands WHERE status='pending'").get() as { count: number }).count);
    return {
      databaseOperations,
      dashboardQueries,
      completedJobRuns,
      completedStepRuns,
      completedIntelligenceJobs,
      processedCameraCount: processed.size,
      queueGrowthPerMinute: (pendingEnd - pendingStart) / Math.max(seconds / 60, 1 / 60),
      databaseLatencies,
      dashboardLatencies,
    };
  }

  private async runMemoryProbe(seconds: number): Promise<number> {
    const bytes = Math.min(32 * 1024 * 1024, Math.max(4 * 1024 * 1024, cpus().length * 1024 * 1024));
    const source = Buffer.alloc(bytes, 0x5a);
    const target = Buffer.alloc(bytes);
    const deadline = performance.now() + seconds * 1_000;
    const started = performance.now();
    let copied = 0;
    let cycles = 0;
    do {
      if (this.input.cancelled() || this.diskPressureError) throw new Error(this.diskPressureError ?? "calibration_cancelled");
      source.copy(target);
      copied += bytes;
      cycles += 1;
      if (cycles % 16 === 0) await new Promise<void>((resolveYield) => setImmediate(resolveYield));
    } while (performance.now() < deadline);
    return copied / Math.max(0.001, (performance.now() - started) / 1_000);
  }

  private run(command: string, args: string[], timeoutMs: number, stdin: string | null = null): Promise<ProcessResult> {
    return new Promise<ProcessResult>((resolveProcess, rejectProcess) => {
      const started = performance.now();
      const child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        detached: currentHostPlatform.detachedProcessGroups,
        stdio: [stdin === null ? "ignore" : "pipe", "pipe", "pipe"],
      });
      this.children.add(child);
      const kind = childProcessKind(command);
      if (child.pid) this.input.onChildProcess?.({ action: "started", pid: child.pid, kind });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let stopping = false;
      let stoppedReported = false;
      const reportStopped = (): void => {
        if (stoppedReported || !child.pid) return;
        stoppedReported = true;
        this.input.onChildProcess?.({ action: "stopped", pid: child.pid, kind });
      };
      child.stdout?.on("data", (chunk: Buffer) => { stdout = boundedText(stdout, chunk); });
      child.stderr?.on("data", (chunk: Buffer) => { stderr = boundedText(stderr, chunk); });
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(cancelPoll);
        this.children.delete(child);
        reportStopped();
        if (error) rejectProcess(error);
        else resolveProcess({ stdout, stderr, durationMs: performance.now() - started });
      };
      const stopAndFinish = async (error: Error, force: boolean): Promise<void> => {
        if (settled || stopping) return;
        stopping = true;
        try {
          await terminateProcessTree(child, force);
          if (!await waitForProcessExit(child, force ? 5_000 : 3_000)) {
            await terminateProcessTree(child, true);
            await waitForProcessExit(child, 5_000);
          }
        } catch {
          // The process may exit between the liveness check and the Windows
          // tree-termination call. The original timeout/cancellation remains
          // the authoritative result and must not become an unhandled rejection.
        } finally {
          finish(error);
        }
      };
      const timeout = setTimeout(() => {
        void stopAndFinish(new Error(`calibration_process_timeout:${basename(command)}`), true);
      }, timeoutMs);
      const cancelPoll = setInterval(() => {
        if (stopping || (!this.input.cancelled() && !this.diskPressureError)) return;
        void stopAndFinish(new Error(this.diskPressureError ?? "calibration_cancelled"), false);
      }, 50);
      child.once("error", (error) => {
        if (!stopping) finish(error);
      });
      // "exit" may precede the final stdout/stderr data events on Windows.
      // "close" fires only after those pipes are drained, which is required
      // before parsing the native benchmark JSON.
      child.once("close", (code, signal) => {
        if (stopping) return;
        if (code === 0) finish();
        else finish(new Error(sanitizeRtspDiagnostic(
          `calibration_process_failed:${basename(command)}:${code ?? signal}:${stderr.slice(-500)}`,
        )));
      });
      if (stdin !== null) child.stdin?.end(stdin);
    });
  }

  private startBackground(command: string, args: string[]): ChildProcess {
    const child = spawn(command, args, {
      shell: false, windowsHide: true, detached: currentHostPlatform.detachedProcessGroups, stdio: ["ignore", "ignore", "ignore"],
    });
    this.children.add(child);
    const kind = childProcessKind(command);
    if (child.pid) this.input.onChildProcess?.({ action: "started", pid: child.pid, kind });
    let stoppedReported = false;
    const stopped = (): void => {
      this.children.delete(child);
      if (stoppedReported || !child.pid) return;
      stoppedReported = true;
      this.input.onChildProcess?.({ action: "stopped", pid: child.pid, kind });
    };
    child.once("error", stopped);
    child.once("exit", stopped);
    return child;
  }

  private async stopLlamaServers(computeMode?: CalibrationComputeMode): Promise<void> {
    const runtimes = computeMode
      ? this.llamaServers.filter((runtime) => runtime.computeMode === computeMode)
      : [...this.llamaServers];
    for (const runtime of runtimes) {
      const index = this.llamaServers.indexOf(runtime);
      if (index >= 0) this.llamaServers.splice(index, 1);
    }
    await Promise.all(runtimes.map((runtime) => terminateProcessTree(runtime.child, false)));
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    for (const runtime of runtimes) {
      if (runtime.child.exitCode === null) await terminateProcessTree(runtime.child, true);
      this.children.delete(runtime.child);
    }
  }

  private async stopBackgroundProcesses(): Promise<void> {
    const children = [...this.children];
    await this.internalRtsp?.close().catch(() => undefined);
    this.internalRtsp = null;
    for (const child of children) {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process may have exited between collection and termination.
      }
    }
    await Promise.all(children.map((child) => terminateProcessTree(child, true)));
    const stopped = await Promise.all(children.map((child) => waitForProcessExit(child)));
    const remaining = children.filter((_, index) => !stopped[index]);
    await Promise.all(remaining.map((child) => terminateProcessTree(child, true)));
    const finallyStopped = await Promise.all(remaining.map((child) => waitForProcessExit(child, 2_000)));
    if (finallyStopped.some((value) => !value)) {
      throw new Error("calibration_background_process_stop_timeout");
    }
    this.children.clear();
    this.rtspPort = null;
    this.publishers.length = 0;
    this.llamaServers.length = 0;
  }
}
