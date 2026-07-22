import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  AUTONOMOUS_LOCAL_CALIBRATION_VERSION,
  CALIBRATION_HANDOFF_VERSION,
  CALIBRATION_KERNEL_VERSION,
  CALIBRATION_PROGRESS_VERSION,
  PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT,
  type CalibrationPlan,
  type CalibrationRuntimeStatus,
  type CalibrationSession,
  type CalibrationSessionProgress,
  type CalibrationSessionRecord,
  type LocalCalibrationRun,
} from "../shared/types.js";

const execFileAsync = promisify(execFile);
const SESSION_LIFETIME_MS = 2 * 60 * 60 * 1_000;
const MAX_RESULT_BYTES = 10 * 1024 * 1024;

export function assertAutonomousCalibrationSessionContract(
  run: LocalCalibrationRun,
  session: CalibrationSessionRecord,
  runtimeStatus: CalibrationRuntimeStatus,
): void {
  if (run.schemaVersion !== AUTONOMOUS_LOCAL_CALIBRATION_VERSION) return;
  if (run.mode !== session.mode || run.workloadProfileId !== session.plan.workloadProfile.id ||
      run.workloadProfileSignature !== session.plan.workloadProfile.signature) {
    throw new Error("calibration_workload_profile_mismatch");
  }
  if (session.plan.targetHardwareTemplateId &&
      run.fingerprint.hardwareTemplateId !== session.plan.targetHardwareTemplateId) {
    throw new Error("calibration_hardware_fingerprint_mismatch");
  }
  if (run.kernelVersion !== CALIBRATION_KERNEL_VERSION || run.kernelVersion !== runtimeStatus.kernelVersion ||
      run.runtimeManifestHash !== runtimeStatus.manifestHash) {
    throw new Error("calibration_runtime_manifest_mismatch");
  }
  if (run.compatiblePerceptrumCommit !== PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT ||
      run.fingerprint.perceptrumBuildHash !== session.plan.workloadProfile.targetBuildHash ||
      (run.qualityGate?.eligibleForCapacityExtrapolation &&
        run.fingerprint.perceptrumBuildHash !== PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT)) {
    throw new Error("calibration_perceptrum_build_mismatch");
  }
  if (run.qualityGate?.eligibleForCapacityExtrapolation &&
      (!run.computeEvidence?.cpu.measured || !run.computeEvidence.gpu.inferenceMeasured ||
        !run.computeEvidence.gpu.mediaMeasured || !run.computeEvidence.gpu.utilizationMeasured ||
        !run.computeEvidence.combined.measured)) {
    throw new Error("calibration_cpu_gpu_evidence_incomplete");
  }
  if (run.qualityGate?.eligibleForCapacityExtrapolation &&
      (!runtimeStatus.manifestApproved || run.runtimeProvenance?.manifestApproved !== true)) {
    throw new Error("calibration_runtime_manifest_not_approved_for_purchase_evidence");
  }
}

export interface DesktopCalibrationBridge {
  openPerceptrumCalibration(uri: string): Promise<void>;
  openPath?(path: string): Promise<void>;
}

export function tokenSha256(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function calibrationPayloadSha256(result: LocalCalibrationRun): string {
  const payload = structuredClone(result);
  delete payload.artifact;
  return createHash("sha256").update(JSON.stringify(canonicalJson(payload))).digest("hex");
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => [key, canonicalJson(record[key])]));
  }
  return value;
}

export function legacyCalibrationPayloadSha256(result: LocalCalibrationRun): string {
  const payload = structuredClone(result);
  delete payload.artifact;
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function loopbackOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" || !parsed.hostname.startsWith("127.") || parsed.username || parsed.password) {
    throw new Error("calibration_callback_must_use_loopback");
  }
  return parsed.origin;
}

export function createCalibrationSession(input: {
  plan: CalibrationPlan;
  recommendationId: string;
  scenarioId: string;
  advancedTelemetry: boolean;
  callbackOrigin: string;
  now?: Date;
}): { record: CalibrationSessionRecord; token: string; uri: string } {
  const createdAt = (input.now ?? new Date()).toISOString();
  const expiresAt = new Date(Date.parse(createdAt) + SESSION_LIFETIME_MS).toISOString();
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const record: CalibrationSessionRecord = {
    id,
    planId: input.plan.id,
    recommendationId: input.recommendationId,
    scenarioId: input.scenarioId,
    mode: input.plan.mode,
    advancedTelemetry: input.advancedTelemetry,
    state: "pending",
    createdAt,
    expiresAt,
    launchedAt: null,
    completedAt: null,
    progress: null,
    result: null,
    error: null,
    tokenHash: tokenSha256(token),
    plan: structuredClone(input.plan),
  };
  const uri = new URL("perceptrum://calibration/run");
  uri.searchParams.set("session", id);
  uri.searchParams.set("origin", loopbackOrigin(input.callbackOrigin));
  uri.searchParams.set("token", token);
  uri.searchParams.set("expires", expiresAt);
  uri.searchParams.set("plan", input.plan.id);
  return { record, token, uri: uri.toString() };
}

export function createInternalCalibrationSession(input: {
  plan: CalibrationPlan;
  recommendationId: string;
  scenarioId: string;
  advancedTelemetry: boolean;
  now?: Date;
}): CalibrationSessionRecord {
  const createdAt = (input.now ?? new Date()).toISOString();
  return {
    id: randomUUID(),
    planId: input.plan.id,
    recommendationId: input.recommendationId,
    scenarioId: input.scenarioId,
    mode: input.plan.mode,
    advancedTelemetry: input.advancedTelemetry,
    state: "pending",
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + SESSION_LIFETIME_MS).toISOString(),
    launchedAt: null,
    completedAt: null,
    progress: null,
    result: null,
    cleanup: {
      schemaVersion: "qual-hardware-calibration-cleanup/1.0.0",
      state: "not_started",
      bytesTemporary: 0,
      bytesRemoved: 0,
      attempts: 0,
      remainingBytes: 0,
      updatedAt: createdAt,
      error: null,
    },
    error: null,
    tokenHash: "internal",
    plan: structuredClone(input.plan),
  };
}

export function publicCalibrationSession(record: CalibrationSessionRecord): CalibrationSession {
  const { tokenHash: _tokenHash, plan: _plan, ...session } = record;
  return structuredClone({ ...session, progress: session.progress ? normalizeCalibrationProgress(session.progress) : null });
}

export function authorizeCalibrationSession(
  session: CalibrationSessionRecord,
  authorization: string | undefined,
  now = Date.now(),
): void {
  if (Date.parse(session.expiresAt) <= now) throw new Error("calibration_session_expired");
  if (session.state === "completed" || session.state === "cancelled") throw new Error("calibration_session_already_completed");
  const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1] ?? "";
  const actual = Buffer.from(tokenSha256(token), "hex");
  const expected = Buffer.from(session.tokenHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("invalid_calibration_session_token");
  }
}

export function normalizeCalibrationProgress(input: unknown): CalibrationSessionProgress {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const percent = Number(value.percent);
  const normalizedPercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const number = (key: string, fallback = 0): number => {
    const candidate = Number(value[key]);
    return Number.isFinite(candidate) ? Math.max(0, candidate) : fallback;
  };
  const iso = (key: string, fallback: string): string => {
    const candidate = value[key];
    return typeof candidate === "string" && Number.isFinite(Date.parse(candidate)) ? new Date(candidate).toISOString() : fallback;
  };
  const timestamp = new Date().toISOString();
  const sessionStartedAt = iso("sessionStartedAt", iso("updatedAt", timestamp));
  const phaseStartedAt = iso("phaseStartedAt", sessionStartedAt);
  const estimatedRemainingSeconds = value.estimatedRemainingSeconds === null
    ? null : number("estimatedRemainingSeconds", 0);
  const estimatedCompletionAt = value.estimatedCompletionAt === null
    ? null : iso("estimatedCompletionAt", new Date(Date.parse(timestamp) + (estimatedRemainingSeconds ?? 0) * 1_000).toISOString());
  return {
    schemaVersion: CALIBRATION_PROGRESS_VERSION,
    ...(typeof value.phase === "string" ? { phase: value.phase.slice(0, 120) } : {}),
    ...(typeof value.stage === "string" ? { stage: value.stage.slice(0, 120) } : {}),
    percent: normalizedPercent,
    overallPercent: Math.min(100, number("overallPercent", normalizedPercent)),
    phasePercent: Math.min(100, number("phasePercent", 0)),
    ...(typeof value.message === "string" ? { message: value.message.slice(0, 1_000) } : {}),
    ...(Number.isInteger(Number(value.tier)) ? { tier: Math.max(1, Math.min(4_096, Number(value.tier))) } : {}),
    ...(Number.isInteger(Number(value.repetition)) ? { repetition: Math.max(1, Math.min(3, Number(value.repetition))) } : {}),
    ...(Number.isInteger(Number(value.attempt)) ? { attempt: Math.max(1, Math.min(10_000, Number(value.attempt))) } : {}),
    ...(value.computeMode === "cpu_only" || value.computeMode === "gpu_accelerated"
      ? { computeMode: value.computeMode } : {}),
    sessionStartedAt,
    phaseStartedAt,
    elapsedSeconds: number("elapsedSeconds", Math.max(0, (Date.parse(timestamp) - Date.parse(sessionStartedAt)) / 1_000)),
    estimatedRemainingSeconds,
    estimatedCompletionAt,
    minimumDurationSeconds: number("minimumDurationSeconds"),
    maximumDurationSeconds: number("maximumDurationSeconds"),
    estimateConfidence: value.estimateConfidence === "high" || value.estimateConfidence === "medium" ? value.estimateConfidence : "low",
    estimateAdjusted: value.estimateAdjusted === true,
    bytesTemporary: number("bytesTemporary"),
    bytesRemoved: number("bytesRemoved"),
    bytesProjected: number("bytesProjected"),
    diskFreeBytes: number("diskFreeBytes"),
    diskReserveBytes: number("diskReserveBytes"),
    updatedAt: timestamp,
  };
}

export async function deliverCalibrationSession(
  uri: string,
  advancedTelemetry: boolean,
  bridge?: DesktopCalibrationBridge,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<"running_instance" | "protocol_launch"> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  timeout.unref?.();
  try {
    const response = await fetchImpl("http://127.0.0.1:4000/api/runtime/calibration/handoff", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ uri, advancedTelemetry }),
      redirect: "error",
      signal: controller.signal,
    });
    if (response.ok) return "running_instance";
  } catch {
    // A closed Perceptrum instance is the expected reason to use the native protocol.
  } finally {
    clearTimeout(timeout);
  }
  if (!bridge) throw new Error("perceptrum_desktop_bridge_unavailable");
  await bridge.openPerceptrumCalibration(uri);
  return "protocol_launch";
}

export async function cancelDeliveredCalibrationSession(
  sessionId: string,
  token: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  timeout.unref?.();
  try {
    const response = await fetchImpl("http://127.0.0.1:4000/api/runtime/calibration/cancel", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sessionId }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? `perceptrum_cancel_failed_http_${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function windowsDocuments(home: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('MyDocuments')",
    ], { encoding: "utf8", windowsHide: true, timeout: 8_000 });
    return String(stdout).trim() || join(home, "Documents");
  } catch {
    return join(home, "Documents");
  }
}

async function linuxDocuments(home: string, env: NodeJS.ProcessEnv): Promise<string> {
  const configured = env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
  const content = await readFile(join(configured, "user-dirs.dirs"), "utf8").catch(() => "");
  const match = content.match(/^XDG_DOCUMENTS_DIR=(?:"([^"]*)"|'([^']*)'|(.*))$/m);
  const value = String(match?.[1] || match?.[2] || match?.[3] || "").trim();
  return value ? value.replace(/^\$HOME(?=\/|$)/, home) : join(home, "Documents");
}

export async function resolveCalibrationDirectory(options: {
  documentsDirectory?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
} = {}): Promise<string> {
  if (options.documentsDirectory) return resolve(options.documentsDirectory, "Qual Hardware", "Calibracoes");
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const override = env.QUAL_HARDWARE_CALIBRATION_DOCUMENTS_DIR?.trim();
  if (override) return resolve(override, "Qual Hardware", "Calibracoes");
  const documents = platform === "win32" ? (options.home === undefined ? await windowsDocuments(home) : join(home, "Documents"))
    : platform === "linux" ? await linuxDocuments(home, env)
    : join(home, "Documents");
  return resolve(documents, "Qual Hardware", "Calibracoes");
}

export async function findPersistedCalibration(
  planId: string,
  options: Parameters<typeof resolveCalibrationDirectory>[0] = {},
): Promise<{ result: unknown; filePath: string } | null> {
  const directory = await resolveCalibrationDirectory(options);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const candidates = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".qhcal.json"));
  for (const entry of candidates) {
    const filePath = join(directory, entry.name);
    try {
      const raw = await readFile(filePath);
      if (raw.byteLength > MAX_RESULT_BYTES) continue;
      const result = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
      if (result.planId === planId) return { result, filePath };
    } catch {
      // Foreign, partial and invalid files are preserved and ignored.
    }
  }
  return null;
}

export function validatePerceptrumProtocolUri(candidate: string): string | null {
  if (candidate.length > 4_096) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "perceptrum:" || parsed.hostname !== "calibration" || parsed.pathname !== "/run" || parsed.username || parsed.password || parsed.hash) return null;
    const required = ["session", "origin", "token", "expires", "plan"];
    if (required.some((key) => !parsed.searchParams.get(key))) return null;
    loopbackOrigin(parsed.searchParams.get("origin")!);
    return parsed.toString();
  } catch {
    return null;
  }
}
