import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { cpus, freemem, totalmem } from "node:os";
import { basename } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
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
} from "../shared/types.js";
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
  ffmpegGpuInputArguments,
  llamaComputeArguments,
  parseLlamaGpuDevices,
  selectFfmpegGpuMediaBackend,
  selectLlamaGpuDevice,
  type CalibrationGpuDevice,
} from "./calibrationCompute.js";

export const CALIBRATION_PIPELINE_CONTRACT_VERSION = "qual-hardware-calibration-pipeline-contract/1.0.0";
const CALIBRATION_MEDIA_RING_SECONDS = 2;
const CALIBRATION_MEDIA_RING_SEGMENTS = 2;

async function terminateProcessTree(child: ChildProcess, force: boolean): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolveStop) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])], {
        shell: false, windowsHide: true, stdio: "ignore",
      });
      killer.once("error", () => resolveStop());
      killer.once("exit", () => resolveStop());
    });
    return;
  }
  try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM"); }
  catch { try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch { /* The process group already exited. */ } }
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
  mediamtxConfig: string;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface PipelinePhaseMeasurement {
  phase: CalibrationPhaseMetric["name"] | "discovery";
  computeMode: CalibrationComputeMode;
  inferenceBackend: "cpu" | CalibrationGpuInferenceBackend;
  inferenceDeviceId: string;
  gpuMediaBackend: CalibrationGpuMediaBackend;
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
  framesInferred: number;
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
  hardwareTelemetry: CalibrationHardwareTelemetrySummary;
  rtspMeasured: boolean;
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
  localInferenceAvailable: boolean;
  cpuInferenceAvailable: boolean;
  gpuInferenceAvailable: boolean;
  gpuInferenceBackend: CalibrationGpuInferenceBackend;
  gpuInferenceDevice: CalibrationGpuDevice | null;
  gpuMediaAvailable: boolean;
  gpuMediaBackend: CalibrationGpuMediaBackend;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  mediamtxPath: string | null;
  rtspOrigin: string;
  aiqOrigin: string;
  unavailableReasons: string[];
}

export const CALIBRATION_NETWORK_RESERVE_PERCENT = 20;

export interface CalibrationNetworkCapacity {
  requiredIngressMbps: number;
  physicalCapacityMbps: number | null;
  usableCapacityMbps: number | null;
  verified: boolean;
  qualifyingLinkName: string | null;
}

export function evaluateCalibrationNetworkCapacity(
  profile: CalibrationWorkloadProfile,
  tier: number,
  links: CalibrationHardwarePreflight["networkLinks"],
): CalibrationNetworkCapacity {
  const allocations = allocateCalibrationCameraGroups(profile, tier);
  const requiredIngressMbps = allocations.reduce((sum, cameraCount, index) =>
    sum + cameraCount * (profile.cameraGroups[index]?.bitrateMbps ?? 0), 0);
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
  private timer: NodeJS.Timeout | null = null;

  start(intervalMs: number): void {
    this.capture();
    this.timer = setInterval(() => this.capture(), intervalMs);
    this.timer.unref();
  }

  stop(): { cpu: TelemetryMetricSummary | null; memory: TelemetryMetricSummary | null } {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.capture();
    return { cpu: metricSummary(this.cpuSamples), memory: metricSummary(this.memorySamples) };
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
  const exact = profile.cameraGroups.map((group, index) => ({
    index,
    floor: Math.floor(tier * group.sharePpm / 1_000_000),
    remainder: tier * group.sharePpm % 1_000_000,
  }));
  let remaining = tier - exact.reduce((sum, item) => sum + item.floor, 0);
  for (const item of [...exact].sort((left, right) => right.remainder - left.remainder || left.index - right.index)) {
    if (remaining <= 0) break;
    item.floor += 1;
    remaining -= 1;
  }
  return exact.sort((left, right) => left.index - right.index).map((item) => item.floor);
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

function childProcessKind(command: string): "ffmpeg" | "ffprobe" | "mediamtx" | "llama-server" {
  const name = basename(command).toLowerCase();
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

export class OfflineCalibrationPipeline {
  private files: PipelineFiles | null = null;
  private readonly children = new Set<ChildProcess>();
  private mediaMtx: ChildProcess | null = null;
  private readonly publishers: ChildProcess[] = [];
  private rtspPort: number | null = null;
  private readonly llamaServers: Array<{
    model: "core" | "core-max";
    computeMode: CalibrationComputeMode;
    origin: string;
    child: ChildProcess;
  }> = [];
  private llamaExecutable: string | null = null;
  private requiredLlamaModels: Array<"core" | "core-max"> = [];
  private mediaSequence = 0;
  private summary: CalibrationPipelineSummary | null = null;
  private diskPressureError: string | null = null;

  constructor(private readonly input: {
    workspace: CalibrationWorkspace;
    database: DatabaseSync;
    workloadProfile: CalibrationWorkloadProfile;
    runtimeStatus: CalibrationRuntimeStatus;
    hardware?: CalibrationHardwarePreflight;
    physicalNetworkLinks?: CalibrationHardwarePreflight["networkLinks"];
    advancedTelemetry?: boolean;
    timeScale: number;
    cancelled: () => boolean;
    diskStatus?: (path: string, projectedPeakBytes: number) => Promise<CalibrationDiskStatus>;
    diskCheckIntervalMs?: number;
    onChildProcess?: (event: { action: "started" | "stopped"; pid: number; kind: "ffmpeg" | "ffprobe" | "mediamtx" | "llama-server" }) => void;
  }) {}

  async initialize(): Promise<CalibrationPipelineSummary> {
    this.input.database.exec(PIPELINE_SCHEMA);
    const files: PipelineFiles = {
      sources: await Promise.all(this.input.workloadProfile.cameraGroups.map((_, index) =>
        prepareCalibrationTemporaryFile(this.input.workspace, `synthetic-source-${index}.mkv`, { retain: true }))),
      frame: await prepareCalibrationTemporaryFile(this.input.workspace, "synthetic-frame.ppm", { retain: true }),
      mediamtxConfig: await prepareCalibrationTemporaryFile(this.input.workspace, "mediamtx.yml", { retain: true }),
    };
    this.files = files;
    const ffmpeg = assetPath(this.input.runtimeStatus, "ffmpeg");
    const ffprobe = assetPath(this.input.runtimeStatus, "ffprobe");
    const mediamtx = assetPath(this.input.runtimeStatus, "mediamtx");
    const reasons: string[] = [];
    let mediaAvailable = false;
    let rtspAvailable = false;
    if (!ffmpeg || !ffprobe) {
      reasons.push("ffmpeg_or_ffprobe_unavailable");
    } else {
      const groupResults = await Promise.all(this.input.workloadProfile.cameraGroups.map(async (profile, index) => {
        try {
          const codec = profile.codec === "h265" ? "libx265" : "libx264";
          await this.run(ffmpeg, [
            "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-f", "lavfi", "-i", `testsrc2=size=${profile.width}x${profile.height}:rate=${profile.sourceFps}`,
            "-t", "2", "-an", "-pix_fmt", "yuv420p", "-c:v", codec, "-preset", "ultrafast",
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
          return true;
        } catch (error) {
          reasons.push(`synthetic_media_group_${index}:${error instanceof Error ? error.message : String(error)}`);
          return false;
        }
      }));
      mediaAvailable = groupResults.length > 0 && groupResults.every(Boolean);
      if (mediaAvailable) {
        await this.run(ffmpeg, [
          "-hide_banner", "-loglevel", "error", "-nostdin", "-i", files.sources[0]!,
          "-frames:v", "1", "-pix_fmt", "rgb24", "-y", files.frame,
        ], 15_000);
      }
    }
    if (mediaAvailable && ffmpeg && mediamtx) {
      try {
        this.rtspPort = await freeLoopbackPort();
        await writeFile(files.mediamtxConfig, [
          "logLevel: warn",
          `rtspAddress: 127.0.0.1:${this.rtspPort}`,
          "rtmp: no",
          "hls: no",
          "webrtc: no",
          "srt: no",
          "paths:",
          ...this.input.workloadProfile.cameraGroups.flatMap((_, index) => [
            `  calibration-${index}:`,
            "    source: publisher",
          ]),
          "",
        ].join("\n"), "utf8");
        this.mediaMtx = this.startBackground(mediamtx, [files.mediamtxConfig]);
        await waitForLoopbackPort(this.rtspPort, this.input.cancelled);
        for (const [index, source] of files.sources.entries()) {
          this.publishers.push(this.startBackground(ffmpeg, [
            "-hide_banner", "-loglevel", "error", "-nostdin", "-re", "-stream_loop", "-1", "-i", source,
            "-an", "-c:v", "copy", "-f", "rtsp", "-rtsp_transport", "tcp",
            `rtsp://127.0.0.1:${this.rtspPort}/calibration-${index}`,
          ]));
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
        const failedPublisher = this.publishers.find((publisher) => publisher.exitCode !== null);
        if (failedPublisher) throw new Error(`calibration_rtsp_publisher_exit_${failedPublisher.exitCode}`);
        rtspAvailable = true;
      } catch (error) {
        reasons.push(`rtsp_preflight:${error instanceof Error ? error.message : String(error)}`);
        await this.stopBackgroundProcesses();
        this.rtspPort = null;
      }
    } else if (!mediamtx) {
      reasons.push("mediamtx_unavailable");
    }
    let gpuMediaBackend: CalibrationGpuMediaBackend = "unavailable";
    if (mediaAvailable && ffmpeg && this.input.hardware?.gpuCount) {
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
    const gpuMediaAvailable = gpuMediaBackend !== "unavailable";
    if (!gpuMediaAvailable) reasons.push("approved_gpu_media_backend_unavailable");

    let cpuInferenceAvailable = false;
    let gpuInferenceAvailable = false;
    let gpuInferenceBackend = expectedGpuInferenceBackend(this.input.hardware ?? null, this.input.runtimeStatus.platform);
    let gpuInferenceDevice: CalibrationGpuDevice | null = null;
    if (mediaAvailable) {
      const requiredModels = new Set(this.input.workloadProfile.cameraGroups.flatMap((group) => group.agents)
        .flatMap((agent) => agent.model === "aiq-3.7-max" ? ["core-max" as const]
          : agent.model === "aiq-3.7" ? ["core" as const] : []));
      const executable = verifiedAssetPath(this.input.runtimeStatus, "llama-server");
      this.llamaExecutable = executable;
      this.requiredLlamaModels = [...requiredModels];
      if (!executable || requiredModels.size === 0) {
        reasons.push("approved_local_inference_assets_unavailable");
      } else {
        try {
          const listed = await this.run(executable, ["--list-devices"], 30_000);
          gpuInferenceDevice = selectLlamaGpuDevice({
            devices: parseLlamaGpuDevices(`${listed.stdout}\n${listed.stderr}`),
            expectedBackend: gpuInferenceBackend,
            gpuModel: this.input.hardware?.gpuModel ?? "",
          });
          if (gpuInferenceDevice) gpuInferenceBackend = gpuInferenceDevice.backend;
          if (!gpuInferenceDevice) reasons.push(`gpu_inference_device_unavailable:${gpuInferenceBackend}`);
        } catch (error) {
          reasons.push(`gpu_inference_device_probe:${error instanceof Error ? error.message : String(error)}`);
        }
        const modelAssetsAvailable = [...requiredModels].every((model) =>
          verifiedAssetPath(this.input.runtimeStatus, model === "core" ? "qwen-core-gguf" : "qwen-core-max-gguf") !== null &&
          verifiedAssetPath(this.input.runtimeStatus, model === "core" ? "qwen-core-mmproj" : "qwen-core-max-mmproj") !== null);
        if (!modelAssetsAvailable) reasons.push("approved_local_inference_model_bundle_incomplete");
        cpuInferenceAvailable = modelAssetsAvailable;
        gpuInferenceAvailable = modelAssetsAvailable && gpuInferenceDevice !== null;
      }
    }
    const localInferenceAvailable = cpuInferenceAvailable && gpuInferenceAvailable;
    this.summary = {
      contractVersion: CALIBRATION_PIPELINE_CONTRACT_VERSION,
      mediaAvailable,
      rtspAvailable,
      localInferenceAvailable,
      cpuInferenceAvailable,
      gpuInferenceAvailable,
      gpuInferenceBackend,
      gpuInferenceDevice,
      gpuMediaAvailable,
      gpuMediaBackend,
      ffmpegPath: ffmpeg,
      ffprobePath: ffprobe,
      mediamtxPath: mediamtx,
      rtspOrigin: this.rtspPort ? `rtsp://127.0.0.1:${this.rtspPort}/calibration-0` : "rtsp://127.0.0.1:8554/calibration-0",
      aiqOrigin: "http://127.0.0.1:8899",
      unavailableReasons: reasons,
    };
    return this.summary;
  }

  async executePhase(input: {
    phase: PipelinePhaseMeasurement["phase"];
    tier: number;
    durationSeconds: number;
    computeMode?: CalibrationComputeMode;
  }): Promise<PipelinePhaseMeasurement> {
    if (!this.files || !this.summary) throw new Error("calibration_pipeline_not_initialized");
    const computeMode = input.computeMode ?? "cpu_only";
    const inferenceAvailable = await this.activateInferenceMode(computeMode);
    const mediaAvailable = this.summary.mediaAvailable &&
      (computeMode === "cpu_only" || this.summary.gpuMediaAvailable);
    const scaledSeconds = Math.max(0.2, input.durationSeconds * this.input.timeScale);
    const groupAllocations = allocateCalibrationCameraGroups(this.input.workloadProfile, input.tier);
    const sourceFps = Math.max(...this.input.workloadProfile.cameraGroups.map((group) => group.sourceFps));
    const framesPlanned = Math.max(1, Math.floor(groupAllocations.reduce((sum, cameraCount, index) =>
      sum + cameraCount * (this.input.workloadProfile.cameraGroups[index]?.sourceFps ?? 0) * scaledSeconds, 0)));
    const requestedInferenceFps = Math.max(1, ...this.input.workloadProfile.cameraGroups
      .flatMap((group) => group.agents).map((agent) => agent.modelFps));
    const inferencesPlanned = Math.max(1, Math.floor(input.tier * requestedInferenceFps * scaledSeconds));
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
    const mediaPromise = mediaAvailable
      ? this.runMediaPipeline(scaledSeconds, input.tier, computeMode)
      : Promise.resolve({
      framesDecoded: 0, framesEncoded: 0, framesExtracted: 0, durationMs: null as number | null,
      actualConcurrentPipelines: 0,
      errors: [] as string[],
    });
    const databasePromise = this.runEquivalentRuntimeLoad(input.tier, scaledSeconds, groupAllocations);
    const memoryPromise = this.runMemoryProbe(scaledSeconds);
    const inferencePromise = inferenceAvailable
      ? this.runLocalInference(inferencesPlanned, scaledSeconds, input.tier, computeMode)
      : Promise.resolve({ successful: 0, attempted: 0, maxConcurrentRequests: 0, latencies: [] as number[] });
    const resources = new SystemResourceSampler();
    const hardwareTelemetry = new CalibrationHardwareTelemetrySampler({
      enabled: this.input.advancedTelemetry === true,
      approvedProbePath: verifiedAssetPath(this.input.runtimeStatus, "telemetry-probe"),
    });
    resources.start(Math.max(50, Math.min(1_000, scaledSeconds * 1_000 / 10)));
    hardwareTelemetry.start(Math.max(250, Math.min(1_000, scaledSeconds * 1_000 / 5)));
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
    const exactInferenceConcurrency = !inferenceAvailable || inference.maxConcurrentRequests >= input.tier;
    const exactCameraConcurrency = exactMediaConcurrency && exactInferenceConcurrency;
    const cpuWorkloadMeasured = sampledResources.cpu !== null && database.databaseOperations > 0 && media.actualConcurrentPipelines > 0;
    const gpuInferenceMeasured = computeMode === "gpu_accelerated" && inference.successful > 0 &&
      this.summary.gpuInferenceDevice !== null;
    const gpuMediaMeasured = computeMode === "gpu_accelerated" && media.framesDecoded > 0 &&
      media.framesEncoded > 0 && this.summary.gpuMediaBackend !== "unavailable";
    const gpuUtilizationMeasured = sampledHardwareTelemetry.gpuUtilizationPercent !== null &&
      sampledHardwareTelemetry.gpuMemoryUsedBytes !== null &&
      sampledHardwareTelemetry.gpuUtilizationPercent.peak > 0 &&
      sampledHardwareTelemetry.gpuMemoryUsedBytes.peak > 0;
    const combinedCpuGpuMeasured = computeMode === "gpu_accelerated" && cpuWorkloadMeasured &&
      gpuInferenceMeasured && gpuMediaMeasured && gpuUtilizationMeasured;
    const failures = [
      ...(!this.summary.mediaAvailable ? ["real_ffmpeg_pipeline_unavailable"] : []),
      ...(computeMode === "gpu_accelerated" && !this.summary.gpuMediaAvailable
        ? ["gpu_media_backend_unavailable"] : []),
      ...(!this.summary.rtspAvailable ? ["real_rtsp_runtime_unavailable"] : []),
      ...(network.physicalCapacityMbps === null ? ["physical_network_link_specification_unavailable"] : []),
      ...(network.physicalCapacityMbps !== null && !network.verified ? ["physical_network_capacity_below_20_percent_reserve"] : []),
      ...(!inferenceAvailable ? ["local_aiq_qwen_unavailable"] : []),
      ...(!inferenceAvailable ? [`${computeMode}_local_aiq_qwen_unavailable`] : []),
      ...(inferenceAvailable && inference.successful / inferencesPlanned < 0.995
        ? ["local_aiq_qwen_success_below_99_5_percent"] : []),
      ...(!cpuWorkloadMeasured ? ["cpu_workload_not_measured"] : []),
      ...(computeMode === "gpu_accelerated" && !gpuInferenceMeasured ? ["gpu_inference_not_measured"] : []),
      ...(computeMode === "gpu_accelerated" && !gpuMediaMeasured ? ["gpu_media_not_measured"] : []),
      ...(computeMode === "gpu_accelerated" && !gpuUtilizationMeasured ? ["gpu_utilization_or_vram_not_measured"] : []),
      ...(computeMode === "gpu_accelerated" && !combinedCpuGpuMeasured ? ["combined_cpu_gpu_load_not_measured"] : []),
      ...(!exactCameraConcurrency ? ["exact_concurrent_camera_load_not_executed"] : []),
      ...media.errors.map((error) => `media_pipeline:${error}`),
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
      gpuMediaBackend: computeMode === "cpu_only" ? "unavailable" : this.summary.gpuMediaBackend,
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
      framesInferred: inference.successful,
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
      hardwareTelemetry: sampledHardwareTelemetry,
      rtspMeasured: this.summary.rtspAvailable,
      mediaMeasured: mediaAvailable,
      localInferenceMeasured: inference.successful > 0,
      queueGrowthPerMinute: Math.max(database.queueGrowthPerMinute, inferenceQueueGrowthPerMinute),
      failures,
      measuredStages: [...measuredStages],
    };
  }

  async close(): Promise<void> {
    await this.stopBackgroundProcesses();
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

  private async activateInferenceMode(computeMode: CalibrationComputeMode): Promise<boolean> {
    if (!this.summary) throw new Error("calibration_pipeline_not_initialized");
    const expectedCount = this.requiredLlamaModels.length;
    const active = this.llamaServers.filter((runtime) => runtime.computeMode === computeMode && runtime.child.exitCode === null);
    if (expectedCount > 0 && active.length === expectedCount && this.llamaServers.length === expectedCount) return true;

    await this.stopLlamaServers();
    const candidateAvailable = computeMode === "cpu_only"
      ? this.summary.cpuInferenceAvailable : this.summary.gpuInferenceAvailable;
    if (!candidateAvailable || !this.llamaExecutable || expectedCount === 0) return false;

    try {
      const computeArguments = llamaComputeArguments(computeMode, this.summary.gpuInferenceDevice);
      for (const model of this.requiredLlamaModels) {
        const modelPath = verifiedAssetPath(this.input.runtimeStatus, model === "core" ? "qwen-core-gguf" : "qwen-core-max-gguf");
        const mmprojPath = verifiedAssetPath(this.input.runtimeStatus, model === "core" ? "qwen-core-mmproj" : "qwen-core-max-mmproj");
        if (!modelPath || !mmprojPath) throw new Error(`approved_${model}_assets_unavailable`);
        const port = await freeLoopbackPort();
        const child = this.startBackground(this.llamaExecutable, [
          "-m", modelPath, "--mmproj", mmprojPath, "--host", "127.0.0.1", "--port", String(port),
          "--ctx-size", "8192", "--jinja", "--log-disable", ...computeArguments,
        ]);
        const origin = `http://127.0.0.1:${port}`;
        this.llamaServers.push({ model, computeMode, origin, child });
        await this.waitForLlamaHealth(origin, child);
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
    planned: number,
    seconds: number,
    desiredConcurrency: number,
    computeMode: CalibrationComputeMode,
  ): Promise<{
    successful: number;
    attempted: number;
    maxConcurrentRequests: number;
    latencies: number[];
  }> {
    const runtimes = this.llamaServers.filter((runtime) => runtime.computeMode === computeMode);
    if (!this.files || runtimes.length === 0) return { successful: 0, attempted: 0, maxConcurrentRequests: 0, latencies: [] };
    const image = `data:image/x-portable-pixmap;base64,${(await readFile(this.files.frame)).toString("base64")}`;
    const deadline = performance.now() + seconds * 1_000;
    const latencies: number[] = [];
    let successful = 0;
    let attempted = 0;
    let maxConcurrentRequests = 0;
    do {
      if (this.input.cancelled() || this.diskPressureError) throw new Error(this.diskPressureError ?? "calibration_cancelled");
      const remaining = planned - attempted;
      if (remaining <= 0) break;
      const batch = Array.from({ length: Math.min(remaining, desiredConcurrency) }, (_, index) =>
        runtimes[index % runtimes.length]!);
      maxConcurrentRequests = Math.max(maxConcurrentRequests, batch.length);
      const outcomes = await Promise.all(batch.map(async (runtime) => {
        const started = performance.now();
        try {
          const response = await fetch(`${runtime.origin}/v1/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: AbortSignal.timeout(Math.max(30_000, seconds * 2_000)),
            body: JSON.stringify({
              model: `calibration-${runtime.model}`,
              messages: [{
                role: "user",
                content: [
                  { type: "text", text: "/no_think\nDescribe the synthetic calibration frame in at most five words." },
                  { type: "image_url", image_url: { url: image } },
                ],
              }],
              temperature: 0,
              max_tokens: 32,
            }),
          });
          const body = await response.text();
          if (!response.ok) return false;
          const parsed = JSON.parse(body) as { choices?: Array<{ message?: { content?: unknown } }> };
          return typeof parsed.choices?.[0]?.message?.content === "string";
        } catch {
          return false;
        } finally {
          latencies.push(performance.now() - started);
        }
      }));
      attempted += outcomes.length;
      successful += outcomes.filter(Boolean).length;
    } while (attempted < planned && performance.now() < deadline);
    return { successful, attempted, maxConcurrentRequests, latencies };
  }

  private async runMediaPipeline(
    seconds: number,
    tier: number,
    computeMode: CalibrationComputeMode,
  ): Promise<{
    framesDecoded: number;
    framesEncoded: number;
    framesExtracted: number;
    durationMs: number;
    actualConcurrentPipelines: number;
    errors: string[];
  }> {
    const ffmpeg = this.summary?.ffmpegPath;
    if (!ffmpeg || !this.files) throw new Error("calibration_ffmpeg_unavailable");
    const sequence = this.mediaSequence++;
    const batchSize = 32;
    const batches = allocateCalibrationCameraGroups(this.input.workloadProfile, tier).flatMap((cameraCount, group) =>
      Array.from({ length: Math.ceil(cameraCount / batchSize) }, (_, batch) => ({
        group,
        batch,
        cameraCount: Math.min(batchSize, cameraCount - batch * batchSize),
      })));
    const started = performance.now();
    const outcomes = await Promise.all(batches.map(async ({ group, batch, cameraCount }) => {
      const profile = this.input.workloadProfile.cameraGroups[group]!;
      const outputs = await Promise.all(Array.from({ length: CALIBRATION_MEDIA_RING_SEGMENTS }, (_, segment) =>
        prepareCalibrationTemporaryFile(this.input.workspace, `media-${sequence}-${group}-${batch}-${segment}.mkv`)));
      const outputPattern = outputs[0]!.replace(/-0\.mkv$/, "-%d.mkv");
      const gpuInputArguments = computeMode === "gpu_accelerated"
        ? ffmpegGpuInputArguments(this.summary?.gpuMediaBackend ?? "unavailable") : [];
      const sourceArguments = Array.from({ length: cameraCount }, () => [
        ...gpuInputArguments,
        ...(this.summary?.rtspAvailable && this.rtspPort
          ? ["-rtsp_transport", "tcp", "-i", `rtsp://127.0.0.1:${this.rtspPort}/calibration-${group}`]
          : ["-stream_loop", "-1", "-i", this.files!.sources[group]!]),
      ]).flat();
      const filter = Array.from({ length: cameraCount }, (_, index) =>
        `[${index}:v]format=bgr24,format=yuv420p[v${index}]`).join(";");
      const maps = Array.from({ length: cameraCount }, (_, index) => ["-map", `[v${index}]`]).flat();
      try {
        const encoder = ffmpegEncoder(computeMode, this.summary?.gpuMediaBackend ?? "unavailable", profile.codec);
        const result = await this.run(ffmpeg, [
          "-hide_banner", "-loglevel", "error", "-nostdin", ...sourceArguments,
          "-t", seconds.toFixed(3), "-an", "-filter_complex", filter, ...maps,
          "-c:v", encoder.encoder, ...encoder.extraArguments,
          "-b:v", `${profile.bitrateMbps}M`, "-f", "segment", "-segment_time", "1",
          "-segment_wrap", String(CALIBRATION_MEDIA_RING_SEGMENTS), "-reset_timestamps", "1",
          "-progress", "pipe:1", "-nostats", "-y", outputPattern,
        ], Math.max(15_000, seconds * 5_000));
        const framesPerStream = processFrames(result.stdout);
        return { cameraCount, frames: framesPerStream * cameraCount, outputs, error: null as string | null };
      } catch (error) {
        return { cameraCount: 0, frames: 0, outputs, error: error instanceof Error ? error.message : String(error) };
      }
    }));
    const firstOutput = outcomes.find((outcome) => outcome.cameraCount > 0)?.outputs[0];
    const extractionErrors: string[] = [];
    let frameExtracted = false;
    if (firstOutput) {
      try {
        await this.run(ffmpeg, [
          "-hide_banner", "-loglevel", "error", "-nostdin", "-i", firstOutput,
          "-frames:v", "1", "-pix_fmt", "rgb24", "-y", this.files.frame,
        ], 15_000);
        frameExtracted = true;
      } catch (error) {
        extractionErrors.push(error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180));
      }
    }
    const framesEncoded = outcomes.reduce((sum, outcome) => sum + outcome.frames, 0);
    return {
      framesDecoded: framesEncoded,
      framesEncoded,
      framesExtracted: frameExtracted ? 1 : 0,
      durationMs: performance.now() - started,
      actualConcurrentPipelines: outcomes.reduce((sum, outcome) => sum + outcome.cameraCount, 0),
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

  private run(command: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
    return new Promise<ProcessResult>((resolveProcess, rejectProcess) => {
      const started = performance.now();
      const child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.children.add(child);
      const kind = childProcessKind(command);
      if (child.pid) this.input.onChildProcess?.({ action: "started", pid: child.pid, kind });
      let stdout = "";
      let stderr = "";
      let settled = false;
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
      const timeout = setTimeout(() => {
        void terminateProcessTree(child, true);
        finish(new Error(`calibration_process_timeout:${basename(command)}`));
      }, timeoutMs);
      const cancelPoll = setInterval(() => {
        if (!this.input.cancelled() && !this.diskPressureError) return;
        void terminateProcessTree(child, false);
        finish(new Error(this.diskPressureError ?? "calibration_cancelled"));
      }, 50);
      child.once("error", (error) => finish(error));
      child.once("exit", (code, signal) => {
        if (code === 0) finish();
        else finish(new Error(`calibration_process_failed:${basename(command)}:${code ?? signal}:${stderr.slice(-500)}`));
      });
    });
  }

  private startBackground(command: string, args: string[]): ChildProcess {
    const child = spawn(command, args, {
      shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "ignore", "ignore"],
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
    await Promise.all(children.map((child) => terminateProcessTree(child, false)));
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    for (const child of children) if (child.exitCode === null) await terminateProcessTree(child, true);
    this.children.clear();
    this.mediaMtx = null;
    this.publishers.length = 0;
    this.llamaServers.length = 0;
  }
}
