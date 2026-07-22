import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix, resolve, win32 } from "node:path";
import { promisify } from "node:util";
import {
  CALIBRATION_HANDOFF_VERSION,
  type CalibrationClaimCapabilities,
  type CalibrationPlan,
  type CalibrationSession,
  type CalibrationSessionProgress,
  type CalibrationSessionRecord,
  type LocalCalibrationRun,
} from "../shared/types.js";

const execFileAsync = promisify(execFile);
const SESSION_LIFETIME_MS = 2 * 60 * 60 * 1_000;
const CLAIM_LIFETIME_MS = 60 * 1_000;
const MAX_RESULT_BYTES = 10 * 1024 * 1024;

export interface DesktopCalibrationBridge {
  openPerceptrumCalibration(uri: string): Promise<void>;
  openPath?(path: string): Promise<void>;
  getPerceptrumStatus?(): Promise<{ registered: boolean; handlerName: string | null }>;
  quitApplication?(): Promise<void>;
}

export function tokenSha256(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const nonceSha256 = tokenSha256;

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
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
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
}): { record: CalibrationSessionRecord; token: string; nonce: string; uri: string } {
  const createdAt = (input.now ?? new Date()).toISOString();
  const claimExpiresAt = new Date(Date.parse(createdAt) + CLAIM_LIFETIME_MS).toISOString();
  const expiresAt = new Date(Date.parse(createdAt) + SESSION_LIFETIME_MS).toISOString();
  const token = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
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
    claimExpiresAt,
    expiresAt,
    launchedAt: null,
    claimedAt: null,
    completedAt: null,
    callbackOrigin: loopbackOrigin(input.callbackOrigin),
    claimOrigin: null,
    runtimeOrigin: null,
    claimCapabilities: null,
    progress: null,
    result: null,
    error: null,
    tokenHash: tokenSha256(token),
    nonceHash: nonceSha256(nonce),
    plan: structuredClone(input.plan),
  };
  const uri = new URL("perceptrum://calibration/run");
  uri.searchParams.set("version", CALIBRATION_HANDOFF_VERSION);
  uri.searchParams.set("session", id);
  uri.searchParams.set("qualOrigin", record.callbackOrigin);
  uri.searchParams.set("nonce", nonce);
  uri.searchParams.set("expires", claimExpiresAt);
  return { record, token, nonce, uri: uri.toString() };
}

export function publicCalibrationSession(record: CalibrationSessionRecord): CalibrationSession {
  const { tokenHash: _tokenHash, nonceHash: _nonceHash, plan: _plan, ...session } = record;
  return structuredClone(session);
}

export function authorizeCalibrationSession(
  session: CalibrationSessionRecord,
  authorization: string | undefined,
  now = Date.now(),
): void {
  if (Date.parse(session.expiresAt) <= now) throw new Error("calibration_session_expired");
  if (["completed", "cancelled", "failed", "expired"].includes(session.state)) {
    throw new Error("calibration_session_not_active");
  }
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
  return {
    ...(typeof value.phase === "string" ? { phase: value.phase.slice(0, 120) } : {}),
    ...(typeof value.stage === "string" ? { stage: value.stage.slice(0, 120) } : {}),
    ...(Number.isFinite(percent) ? { percent: Math.max(0, Math.min(100, percent)) } : {}),
    ...(typeof value.message === "string" ? { message: value.message.slice(0, 1_000) } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export async function deliverCalibrationSession(
  uri: string,
  bridge?: DesktopCalibrationBridge,
): Promise<"protocol_launch"> {
  if (!bridge) throw new Error("perceptrum_desktop_bridge_unavailable");
  await bridge.openPerceptrumCalibration(uri);
  return "protocol_launch";
}

export async function cancelDeliveredCalibrationSession(
  runtimeOrigin: string,
  sessionId: string,
  token: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  const origin = loopbackOrigin(runtimeOrigin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  timeout.unref?.();
  try {
    const response = await fetchImpl(`${origin}/api/runtime/calibration/cancel`, {
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
    return String(stdout).trim() || win32.join(home, "Documents");
  } catch {
    return win32.join(home, "Documents");
  }
}

export function authorizeCalibrationClaim(
  session: CalibrationSessionRecord,
  input: {
    origin: string;
    runtimeOrigin: string;
    nonce: string;
    capabilities?: CalibrationClaimCapabilities | null | undefined;
  },
  now = Date.now(),
): { origin: string; runtimeOrigin: string; capabilities: CalibrationClaimCapabilities | null } {
  if (Date.parse(session.claimExpiresAt) <= now) throw new Error("calibration_claim_expired");
  if (session.claimedAt) throw new Error("calibration_claim_already_used");
  if (!["pending", "launching"].includes(session.state)) throw new Error("calibration_session_not_claimable");
  const origin = loopbackOrigin(input.origin);
  if (origin !== session.callbackOrigin) throw new Error("calibration_claim_origin_mismatch");
  const runtimeOrigin = loopbackOrigin(input.runtimeOrigin);
  const actual = Buffer.from(nonceSha256(input.nonce), "hex");
  const expected = Buffer.from(session.nonceHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("invalid_calibration_session_nonce");
  }
  return { origin, runtimeOrigin, capabilities: input.capabilities ?? null };
}

async function linuxDocuments(home: string, env: NodeJS.ProcessEnv): Promise<string> {
  const configured = env.XDG_CONFIG_HOME?.trim() || posix.join(home, ".config");
  const content = await readFile(posix.join(configured, "user-dirs.dirs"), "utf8").catch(() => "");
  const match = content.match(/^XDG_DOCUMENTS_DIR=(?:"([^"]*)"|'([^']*)'|(.*))$/m);
  const value = String(match?.[1] || match?.[2] || match?.[3] || "").trim();
  return value ? value.replace(/^\$HOME(?=\/|$)/, home) : posix.join(home, "Documents");
}

export async function resolveCalibrationDirectory(options: {
  documentsDirectory?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
} = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  const pathApi = platform === "win32" ? win32 : posix;
  if (options.documentsDirectory) return pathApi.resolve(options.documentsDirectory, "Qual Hardware", "Calibracoes");
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const override = env.QUAL_HARDWARE_CALIBRATION_DOCUMENTS_DIR?.trim();
  if (override) return pathApi.resolve(override, "Qual Hardware", "Calibracoes");
  const documents = platform === "win32" ? (options.home ? win32.join(home, "Documents") : await windowsDocuments(home))
    : platform === "linux" ? await linuxDocuments(home, env)
    : posix.join(home, "Documents");
  return pathApi.resolve(documents, "Qual Hardware", "Calibracoes");
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
  if (!candidate || candidate.length > 4_096) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "perceptrum:" || parsed.hostname !== "calibration" || parsed.pathname !== "/run" || parsed.username || parsed.password || parsed.hash) return null;
    const required = ["version", "session", "qualOrigin", "nonce", "expires"];
    const allowed = new Set(required);
    if (
      required.some((key) => parsed.searchParams.getAll(key).length !== 1 || !parsed.searchParams.get(key)) ||
      [...parsed.searchParams.keys()].some((key) => !allowed.has(key))
    ) return null;
    if (parsed.searchParams.get("version") !== CALIBRATION_HANDOFF_VERSION) return null;
    loopbackOrigin(parsed.searchParams.get("qualOrigin")!);
    return parsed.toString();
  } catch {
    return null;
  }
}
