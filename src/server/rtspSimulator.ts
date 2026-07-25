import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createConnection } from "node:net";
import { currentHostPlatform } from "../platform/index.js";
import {
  RTSP_SIMULATOR_PROBE_VERSION,
  type CalibrationWorkloadProfile,
  type RtspSimulatorProbeResult,
  type RtspStreamProbe,
} from "../shared/types.js";

const RTSP_HOST = "127.0.0.1" as const;
const RTSP_PATH = "Streaming/Channels/101" as const;
const RTSP_TRANSPORT = "tcp" as const;
const RTSP_USER = "admin";
const RTSP_PASSWORD = "admin";
const DEFAULT_MAX_ENDPOINTS = 64;
const MAX_PROCESS_OUTPUT = 1_000_000;
const PROBE_PAYLOAD_SECONDS = 2;

export interface RtspSimulatorExecutableIdentity {
  path: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  version: string | null;
}

export interface ProbeRtspSimulatorOptions {
  ffmpegPath: string | null;
  ffprobePath: string | null;
  simulatorExecutable: RtspSimulatorExecutableIdentity;
  workloadProfile?: CalibrationWorkloadProfile;
  cancelled?: () => boolean;
  ports?: number[];
  connectTimeoutMs?: number;
  processTimeoutMs?: number;
  hostPlatform?: NodeJS.Platform;
  isPortOpen?: (port: number, timeoutMs: number) => Promise<boolean>;
  probeEndpoint?: (port: number) => Promise<RtspStreamProbe>;
}

interface ProcessCapture {
  stdoutText: string;
  stderrText: string;
  stdoutBytes: number;
  durationMs: number;
}

interface StreamMetadata {
  codec: "h264" | "h265";
  width: number;
  height: number;
  fps: number;
}

function bounded(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  return next.length > MAX_PROCESS_OUTPUT ? next.slice(-MAX_PROCESS_OUTPUT) : next;
}

export function rtspSimulatorCandidatePorts(maxEndpoints = DEFAULT_MAX_ENDPOINTS): number[] {
  const boundedCount = Math.max(1, Math.min(DEFAULT_MAX_ENDPOINTS, Math.floor(maxEndpoints)));
  return [554, ...Array.from({ length: boundedCount - 1 }, (_, index) => 5_541 + index)];
}

export function redactedRtspSimulatorOrigin(port: number): string {
  return `rtsp://${RTSP_HOST}:${port}/${RTSP_PATH}`;
}

export function authenticatedRtspSimulatorOrigin(port: number): string {
  return `rtsp://${RTSP_USER}:${RTSP_PASSWORD}@${RTSP_HOST}:${port}/${RTSP_PATH}`;
}

export function sanitizeRtspDiagnostic(value: string): string {
  return value
    .replaceAll(`${RTSP_USER}:${RTSP_PASSWORD}@`, "[credentials-redacted]@")
    .replace(/rtsp:\/\/[^@\s/]+@/gi, "rtsp://[credentials-redacted]@")
    .slice(-2_000);
}

async function terminate(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    await currentHostPlatform.terminateProcessTree(child.pid, false);
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The probe may finish between the liveness check and termination.
    }
  }
}

async function runProcess(
  executable: string,
  argumentsList: string[],
  options: {
    timeoutMs: number;
    cancelled: () => boolean;
    captureStdoutText?: boolean;
  },
): Promise<ProcessCapture> {
  return await new Promise<ProcessCapture>((resolveRun, rejectRun) => {
    const started = performance.now();
    const child = spawn(executable, argumentsList, {
      shell: false,
      windowsHide: true,
      detached: currentHostPlatform.detachedProcessGroups,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutText = "";
    let stderrText = "";
    let stdoutBytes = 0;
    let settled = false;
    let stopping = false;
    let timeout: NodeJS.Timeout | undefined;
    let cancelPoll: NodeJS.Timeout | undefined;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (cancelPoll) clearInterval(cancelPoll);
      if (error) rejectRun(error);
      else resolveRun({
        stdoutText,
        stderrText,
        stdoutBytes,
        durationMs: performance.now() - started,
      });
    };
    const stop = (error: Error): void => {
      if (stopping || settled) return;
      stopping = true;
      void terminate(child).finally(() => finish(error));
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (options.captureStdoutText) stdoutText = bounded(stdoutText, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrText = bounded(stderrText, chunk);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
      if (stopping) return;
      if (code === 0) finish();
      else finish(new Error(sanitizeRtspDiagnostic(
        `rtsp_probe_process_failed:${code ?? signal}:${stderrText.slice(-800)}`,
      )));
    });
    timeout = setTimeout(() => stop(new Error("rtsp_probe_process_timeout")), options.timeoutMs);
    cancelPoll = setInterval(() => {
      if (options.cancelled()) stop(new Error("calibration_cancelled"));
    }, 50);
    cancelPoll.unref();
  });
}

async function tcpPortOpen(port: number, timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolveOpen) => {
    const socket = createConnection({ host: RTSP_HOST, port });
    let settled = false;
    const finish = (open: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveOpen(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function rational(value: unknown): number {
  if (typeof value !== "string") return 0;
  const [numeratorRaw, denominatorRaw = "1"] = value.split("/");
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? numerator / denominator
    : 0;
}

export function parseRtspStreamMetadata(value: string): StreamMetadata {
  const parsed = JSON.parse(value) as {
    streams?: Array<{
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      avg_frame_rate?: string;
    }>;
  };
  const stream = parsed.streams?.[0];
  const codec = stream?.codec_name === "hevc" || stream?.codec_name === "h265"
    ? "h265"
    : stream?.codec_name === "h264"
      ? "h264"
      : null;
  const fps = rational(stream?.avg_frame_rate) || rational(stream?.r_frame_rate);
  if (!stream || !codec || !Number.isInteger(stream.width) || !Number.isInteger(stream.height) ||
      (stream.width ?? 0) < 1 || (stream.height ?? 0) < 1 || !Number.isFinite(fps) || fps <= 0) {
    throw new Error("rtsp_stream_metadata_invalid");
  }
  return { codec, width: stream.width!, height: stream.height!, fps };
}

export function compatibleRtspGroupIndexes(
  stream: Pick<RtspStreamProbe, "codec" | "width" | "height" | "fps" | "payloadMbps">,
  workloadProfile: CalibrationWorkloadProfile | undefined,
): { indexes: number[]; warnings: string[] } {
  if (!workloadProfile) return { indexes: [], warnings: [] };
  const indexes: number[] = [];
  const warnings: string[] = [];
  for (const [index, group] of workloadProfile.cameraGroups.entries()) {
    const reasons = [
      ...(stream.codec !== group.codec ? [`codec:${stream.codec}->${group.codec}`] : []),
      ...(stream.width !== group.width || stream.height !== group.height
        ? [`resolution:${stream.width}x${stream.height}->${group.width}x${group.height}`] : []),
      ...(stream.fps + 0.5 < group.sourceFps ? [`fps:${stream.fps.toFixed(3)}->${group.sourceFps}`] : []),
      ...(stream.payloadMbps < group.bitrateMbps * 0.9
        ? [`payload_mbps:${stream.payloadMbps.toFixed(3)}->${group.bitrateMbps}`] : []),
    ];
    if (reasons.length === 0) indexes.push(index);
    else warnings.push(`group_${index}_incompatible:${reasons.join(",")}`);
  }
  return { indexes, warnings };
}

function decodedFrames(progress: string): number {
  const matches = [...progress.matchAll(/^frame=(\d+)$/gm)];
  return Number(matches.at(-1)?.[1] ?? 0);
}

async function probeEndpoint(
  port: number,
  options: {
    ffmpegPath: string;
    ffprobePath: string;
    cancelled: () => boolean;
    processTimeoutMs: number;
    workloadProfile?: CalibrationWorkloadProfile;
  },
): Promise<RtspStreamProbe> {
  const authenticatedOrigin = authenticatedRtspSimulatorOrigin(port);
  const ffprobeStarted = performance.now();
  const metadataResult = await runProcess(options.ffprobePath, [
    "-v", "error",
    "-rtsp_transport", RTSP_TRANSPORT,
    "-timeout", "3000000",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate,avg_frame_rate",
    "-of", "json",
    authenticatedOrigin,
  ], {
    timeoutMs: options.processTimeoutMs,
    cancelled: options.cancelled,
    captureStdoutText: true,
  });
  const metadata = parseRtspStreamMetadata(metadataResult.stdoutText);
  const decode = await runProcess(options.ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-rtsp_transport", RTSP_TRANSPORT,
    "-timeout", "3000000",
    "-i", authenticatedOrigin,
    "-frames:v", "3", "-an", "-f", "null", "-",
    "-progress", "pipe:1", "-nostats",
  ], {
    timeoutMs: options.processTimeoutMs,
    cancelled: options.cancelled,
    captureStdoutText: true,
  });
  const frames = decodedFrames(decode.stdoutText);
  if (frames < 3) throw new Error(`rtsp_probe_frame_count_below_contract:${frames}`);
  const payload = await runProcess(options.ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-rtsp_transport", RTSP_TRANSPORT,
    "-timeout", "3000000",
    "-i", authenticatedOrigin,
    "-map", "0:v:0",
    "-t", String(PROBE_PAYLOAD_SECONDS),
    "-an", "-c:v", "copy", "-f", metadata.codec === "h265" ? "hevc" : "h264", "pipe:1",
  ], {
    timeoutMs: options.processTimeoutMs,
    cancelled: options.cancelled,
  });
  // FFmpeg's wall time includes RTSP authentication and startup. Payload rate
  // is the media bytes emitted during the explicit -t window; open latency is
  // measured independently by the metadata request above.
  const payloadDurationSeconds = PROBE_PAYLOAD_SECONDS;
  const payloadMbps = payload.stdoutBytes * 8 / payloadDurationSeconds / 1_000_000;
  if (payload.stdoutBytes <= 0 || payloadMbps <= 0) throw new Error("rtsp_probe_payload_empty");
  const compatibility = compatibleRtspGroupIndexes({
    ...metadata,
    payloadMbps,
  }, options.workloadProfile);
  return {
    redactedOrigin: redactedRtspSimulatorOrigin(port),
    port,
    path: RTSP_PATH,
    transport: RTSP_TRANSPORT,
    ...metadata,
    decodedFrames: frames,
    openLatencyMs: metadataResult.durationMs || performance.now() - ffprobeStarted,
    payloadBytes: payload.stdoutBytes,
    payloadDurationSeconds,
    payloadMbps,
    compatibleGroupIndexes: compatibility.indexes,
    warnings: compatibility.warnings,
  };
}

function allWorkloadGroupsCovered(
  endpoints: RtspStreamProbe[],
  workloadProfile: CalibrationWorkloadProfile | undefined,
): boolean {
  if (!workloadProfile) return endpoints.length > 0;
  return workloadProfile.cameraGroups.every((_, index) =>
    endpoints.some((endpoint) => endpoint.compatibleGroupIndexes.includes(index)));
}

export async function probeRtspSimulator(
  options: ProbeRtspSimulatorOptions,
): Promise<RtspSimulatorProbeResult> {
  const base = {
    schemaVersion: RTSP_SIMULATOR_PROBE_VERSION,
    detectedAt: new Date().toISOString(),
    host: RTSP_HOST,
    simulatorExecutable: options.simulatorExecutable,
    credentialsPersisted: false as const,
    externalRequestCount: 0 as const,
  };
  if ((options.hostPlatform ?? platform()) !== "win32") {
    return {
      ...base,
      status: "unsupported",
      endpoints: [],
      errors: [],
      warnings: ["rtsp_simulator_is_windows_only"],
    };
  }
  if (!options.ffmpegPath || !options.ffprobePath) {
    return {
      ...base,
      status: "incompatible",
      endpoints: [],
      errors: ["ffmpeg_and_ffprobe_required_for_rtsp_probe"],
      warnings: [],
    };
  }
  const cancelled = options.cancelled ?? (() => false);
  const ports = [...new Set(options.ports ?? rtspSimulatorCandidatePorts())]
    .filter((port) => Number.isInteger(port) && port >= 1 && port <= 65_535)
    .slice(0, DEFAULT_MAX_ENDPOINTS);
  const portCheck = options.isPortOpen ?? tcpPortOpen;
  const open = (await Promise.all(ports.map(async (port) => ({
    port,
    open: await portCheck(port, options.connectTimeoutMs ?? 150),
  })))).filter((item) => item.open).map((item) => item.port);
  if (cancelled()) throw new Error("calibration_cancelled");
  if (open.length === 0) {
    return {
      ...base,
      status: "not_running",
      endpoints: [],
      errors: [],
      warnings: ["no_rtsp_simulator_endpoint_listening"],
    };
  }
  const endpoints: RtspStreamProbe[] = [];
  const errors: string[] = [];
  for (const port of open) {
    if (cancelled()) throw new Error("calibration_cancelled");
    let lastError: unknown = new Error("rtsp_probe_not_executed");
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        endpoints.push(options.probeEndpoint
          ? await options.probeEndpoint(port)
          : await probeEndpoint(port, {
            ffmpegPath: options.ffmpegPath,
            ffprobePath: options.ffprobePath,
            cancelled,
            processTimeoutMs: options.processTimeoutMs ?? 12_000,
            ...(options.workloadProfile ? { workloadProfile: options.workloadProfile } : {}),
          }));
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolveWait) => setTimeout(resolveWait, 500));
      }
    }
    if (lastError) {
      errors.push(`port_${port}:${sanitizeRtspDiagnostic(
        lastError instanceof Error ? lastError.message : String(lastError),
      )}`);
    }
  }
  const covered = allWorkloadGroupsCovered(endpoints, options.workloadProfile);
  return {
    ...base,
    status: endpoints.length === 0 ? "failed" : covered ? "passed" : "incompatible",
    endpoints,
    errors: errors.slice(0, DEFAULT_MAX_ENDPOINTS),
    warnings: [
      ...endpoints.flatMap((endpoint) => endpoint.warnings),
      ...(!covered && endpoints.length > 0 ? ["rtsp_stream_does_not_cover_every_workload_group"] : []),
      ...(endpoints.length > 0 ? ["loopback_does_not_measure_physical_network_link"] : []),
    ].slice(0, 200),
  };
}

async function readableFile(candidate: string): Promise<string | null> {
  try {
    await access(candidate);
    const information = await stat(candidate);
    return information.isFile() ? await realpath(candidate) : null;
  } catch {
    return null;
  }
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

async function windowsProductVersion(path: string): Promise<string | null> {
  if (platform() !== "win32") return null;
  try {
    const command = "& { param([string]$p) (Get-Item -LiteralPath $p).VersionInfo.ProductVersion }";
    const result = await runProcess("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command", command, path,
    ], {
      timeoutMs: 5_000,
      cancelled: () => false,
      captureStdoutText: true,
    });
    return result.stdoutText.trim().slice(0, 240) || null;
  } catch {
    return null;
  }
}

export async function discoverRtspSimulatorExecutable(
  selectedPath?: string | null,
): Promise<RtspSimulatorExecutableIdentity> {
  if (platform() !== "win32") {
    return { path: null, sha256: null, sizeBytes: null, version: null };
  }
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const candidates = [
    selectedPath ? resolve(selectedPath) : "",
    process.env.QUAL_HARDWARE_RTSP_SIMULATOR_PATH
      ? resolve(process.env.QUAL_HARDWARE_RTSP_SIMULATOR_PATH) : "",
    localAppData ? join(localAppData, "Programs", "Simulador de RTSP", "SimuladorRtsp.exe") : "",
  ].filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    const path = await readableFile(candidate);
    if (!path) continue;
    const information = await stat(path);
    return {
      path,
      sha256: await sha256File(path),
      sizeBytes: information.size,
      version: await windowsProductVersion(path),
    };
  }
  return { path: null, sha256: null, sizeBytes: null, version: null };
}

export function simulatorBundledFfmpegPath(executablePath: string | null): string | null {
  return executablePath ? join(dirname(executablePath), "tools", "ffmpeg.exe") : null;
}
