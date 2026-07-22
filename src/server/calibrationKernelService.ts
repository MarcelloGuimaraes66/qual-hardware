import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { canonicalSha256 } from "../engine/calibrationProfile.js";
import type {
  CalibrationCleanupStatus,
  CalibrationCheckpoint,
  CalibrationDiagnosticArtifact,
  CalibrationPlan,
  CalibrationRuntimeStatus,
  CalibrationSessionProgress,
  HardwareNodeTemplate,
  LocalCalibrationRun,
} from "../shared/types.js";
import { CalibrationProgressTracker } from "./calibrationProgress.js";
import { inspectCalibrationRuntime } from "./calibrationRuntime.js";
import {
  calibrationWorkspaceBytes,
  cleanupCalibrationWorkspace,
  refreshRegisteredCalibrationTemporaryFiles,
  remainingCalibrationWorkspaceBytes,
} from "./calibrationTemporaryFiles.js";
import type {
  CalibrationKernelWorkerInput,
  CalibrationKernelDiagnosticPayload,
  CalibrationKernelWorkerMessage,
} from "./calibrationKernelProtocol.js";

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

export interface CalibrationKernelHandlers {
  onProgress(progress: CalibrationSessionProgress): Promise<void>;
  onCheckpoint?(checkpoint: CalibrationCheckpoint): Promise<void>;
  onResult(result: LocalCalibrationRun, bytesTemporary: number): Promise<void>;
  onCleanupStarted?(): Promise<void>;
  onCompleted(cleanup: CalibrationCleanupStatus): Promise<void>;
  onCancelled(cleanup: CalibrationCleanupStatus, diagnostic?: CalibrationDiagnosticArtifact): Promise<void>;
  onFailed(error: string, cleanup: CalibrationCleanupStatus, diagnostic?: CalibrationDiagnosticArtifact): Promise<void>;
}

export interface CalibrationKernelStartInput {
  sessionId: string;
  plan: CalibrationPlan;
  targetHardware: HardwareNodeTemplate | null;
  advancedTelemetry: boolean;
  resumeCheckpoint?: CalibrationCheckpoint;
}

export interface CalibrationKernelPort {
  runtimeStatus(): Promise<CalibrationRuntimeStatus>;
  start(input: CalibrationKernelStartInput, handlers: CalibrationKernelHandlers): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  retryCleanup(sessionId: string, interruptedRecovery?: boolean, previouslyRemovedBytes?: number): Promise<CalibrationCleanupStatus>;
  isActive(sessionId: string): boolean;
  hasActiveSession(): boolean;
  close(): Promise<void>;
}

function cleanupStatus(input: Partial<CalibrationCleanupStatus> = {}): CalibrationCleanupStatus {
  return {
    schemaVersion: "qual-hardware-calibration-cleanup/1.0.0",
    state: "not_started",
    bytesTemporary: 0,
    bytesRemoved: 0,
    attempts: 0,
    remainingBytes: 0,
    updatedAt: new Date().toISOString(),
    error: null,
    ...input,
  };
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));
}

export class CalibrationKernelService implements CalibrationKernelPort {
  private readonly active = new Map<string, Worker>();
  private readonly handlersBySession = new Map<string, CalibrationKernelHandlers>();
  private readonly completionBySession = new Map<string, Promise<void>>();
  private readonly resolveCompletionBySession = new Map<string, () => void>();
  private readonly closingSessions = new Set<string>();
  private readonly cancellationRequested = new Set<string>();
  private readonly cancelEscalationBySession = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly childProcessesBySession = new Map<string, Map<number, "ffmpeg" | "ffprobe" | "mediamtx" | "llama-server">>();
  private readonly fallbackDiagnosticBySession = new Map<string, (status: "failed" | "interrupted" | "cancelled", error: string) => CalibrationKernelDiagnosticPayload>();
  private readonly lastProgressBySession = new Map<string, CalibrationSessionProgress>();
  private statusPromise: Promise<CalibrationRuntimeStatus> | null = null;

  constructor(private readonly options: {
    temporaryRoot: string;
    evidenceDirectory: string;
    resourceRoot: string;
    appVersion: string;
    timeScale?: number;
    featureMode?: "disabled" | "diagnostic" | "full";
  }) {}

  runtimeStatus(): Promise<CalibrationRuntimeStatus> {
    this.statusPromise ??= inspectCalibrationRuntime({
      resourceRoot: this.options.resourceRoot,
      ...(this.options.featureMode ? { featureMode: this.options.featureMode } : {}),
    });
    return this.statusPromise;
  }

  async start(input: CalibrationKernelStartInput, handlers: CalibrationKernelHandlers): Promise<void> {
    if (this.active.size > 0) throw new Error("calibration_kernel_already_running");
    const runtimeStatus = await this.runtimeStatus();
    if (!runtimeStatus.readyForQuickTest) throw new Error("calibration_feature_disabled");
    if (input.plan.mode === "full" && !runtimeStatus.readyForFullQualification) {
      throw new Error(`calibration_runtime_not_ready_for_full:${runtimeStatus.reasons.join(",")}`);
    }
    const runId = randomUUID();
    const timeScale = this.options.timeScale ?? Number(process.env.QUAL_HARDWARE_CALIBRATION_TIME_SCALE ?? "1");
    const workerInput: CalibrationKernelWorkerInput = {
      sessionId: input.sessionId,
      runId,
      appVersion: this.options.appVersion,
      temporaryRoot: this.options.temporaryRoot,
      plan: input.plan,
      targetHardware: input.targetHardware,
      runtimeStatus,
      advancedTelemetry: input.advancedTelemetry,
      timeScale: Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1,
      ...(input.resumeCheckpoint ? { resumeCheckpoint: input.resumeCheckpoint } : {}),
    };
    const worker = new Worker(new URL("./calibrationKernelWorker.js", import.meta.url), {
      workerData: workerInput,
      execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type")),
    });
    this.active.set(input.sessionId, worker);
    this.childProcessesBySession.set(input.sessionId, new Map());
    this.handlersBySession.set(input.sessionId, handlers);
    let resolveCompletion = (): void => undefined;
    const completion = new Promise<void>((resolveTerminal) => { resolveCompletion = resolveTerminal; });
    this.completionBySession.set(input.sessionId, completion);
    this.resolveCompletionBySession.set(input.sessionId, resolveCompletion);
    let lifecycleFinished = false;
    let lastProgress: CalibrationSessionProgress | null = null;
    const progressTracker = new CalibrationProgressTracker(input.plan);
    let heartbeatBusy = false;
    const heartbeat = setInterval(() => {
      if (heartbeatBusy || lifecycleFinished) return;
      heartbeatBusy = true;
      const progress = progressTracker.heartbeat();
      void handlers.onProgress(progress).then(() => {
        lastProgress = progress;
        this.lastProgressBySession.set(input.sessionId, progress);
      }).catch(() => undefined)
        .finally(() => { heartbeatBusy = false; });
    }, 15_000);
    heartbeat.unref?.();
    const finishLifecycle = (): void => {
      if (lifecycleFinished) return;
      lifecycleFinished = true;
      clearInterval(heartbeat);
      this.active.delete(input.sessionId);
      this.handlersBySession.delete(input.sessionId);
      this.completionBySession.delete(input.sessionId);
      this.resolveCompletionBySession.delete(input.sessionId);
      this.closingSessions.delete(input.sessionId);
      this.cancellationRequested.delete(input.sessionId);
      const cancelEscalation = this.cancelEscalationBySession.get(input.sessionId);
      if (cancelEscalation) clearTimeout(cancelEscalation);
      this.cancelEscalationBySession.delete(input.sessionId);
      this.childProcessesBySession.delete(input.sessionId);
      this.fallbackDiagnosticBySession.delete(input.sessionId);
      this.lastProgressBySession.delete(input.sessionId);
      resolveCompletion();
    };
    let settled = false;
    const finishCleanup = async (interruptedRecovery = false): Promise<CalibrationCleanupStatus> => {
      await handlers.onCleanupStarted?.().catch(() => undefined);
      return this.cleanupWithRetry(input.sessionId, interruptedRecovery, lastProgress?.bytesRemoved ?? 0);
    };
    const fallbackDiagnostic = (status: "failed" | "interrupted" | "cancelled", error: string): CalibrationKernelDiagnosticPayload => ({
      schemaVersion: "qual-hardware-calibration-diagnostic/1.0.0",
      sessionId: input.sessionId,
      runId,
      planId: input.plan.id,
      createdAt: input.plan.createdAt,
      completedAt: new Date().toISOString(),
      status,
      error: error.slice(0, 2_000),
      kernelVersion: runtimeStatus.kernelVersion,
      runtimeManifestHash: runtimeStatus.manifestHash,
      workloadProfileId: input.plan.workloadProfile.id,
      workloadProfileSignature: input.plan.workloadProfile.signature,
      compatiblePerceptrumCommit: runtimeStatus.authorityCommit,
      lastProgress,
      fingerprint: null,
      runtimeSummary: null,
      tierResults: [],
      repetitions: [],
      measurements: [],
    });
    this.fallbackDiagnosticBySession.set(input.sessionId, fallbackDiagnostic);
    // Worker messages can arrive faster than persistence callbacks complete.
    // Serializing them prevents an older progress write from racing a terminal
    // cancellation/result and resurrecting the session as running.
    let messageQueue = Promise.resolve();
    worker.on("message", (message: CalibrationKernelWorkerMessage) => {
      if (message.type === "child_process") {
        const children = this.childProcessesBySession.get(input.sessionId);
        if (message.action === "started") {
          children?.set(message.pid, message.kind);
          if (this.closingSessions.has(input.sessionId)) {
            try { process.kill(message.pid, "SIGTERM"); } catch { /* It exited before shutdown reached it. */ }
          }
        }
        else children?.delete(message.pid);
        return;
      }
      if (this.closingSessions.has(input.sessionId)) return;
      messageQueue = messageQueue.then(async () => {
        if (settled) return;
        if (message.type === "progress") {
          const progress = progressTracker.update(message.progress);
          lastProgress = progress;
          this.lastProgressBySession.set(input.sessionId, progress);
          await handlers.onProgress(progress);
          return;
        }
        if (message.type === "checkpoint") {
          if (!handlers.onCheckpoint) {
            worker.postMessage({ type: "checkpoint_failed", checkpointId: message.checkpoint.id, error: "checkpoint_persistence_unavailable" });
            return;
          }
          try {
            await handlers.onCheckpoint(message.checkpoint);
            worker.postMessage({ type: "checkpoint_committed", checkpointId: message.checkpoint.id });
          } catch (error) {
            worker.postMessage({
              type: "checkpoint_failed",
              checkpointId: message.checkpoint.id,
              error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
            });
          }
          return;
        }
        const cancellationRequested = this.cancellationRequested.has(input.sessionId);
        if (message.type === "result" && cancellationRequested) {
          settled = true;
          await worker.terminate();
          await this.stopReportedChildProcesses(input.sessionId);
          const diagnostic = await this.persistDiagnostic(
            fallbackDiagnostic("cancelled", "calibration_cancelled_before_result_commit"),
          ).catch(() => undefined);
          await handlers.onCancelled(await finishCleanup(), diagnostic);
          finishLifecycle();
          return;
        }
        settled = true;
        await worker.terminate();
        await this.stopReportedChildProcesses(input.sessionId);
        if (message.type === "result") {
          const result = await this.persistEvidence(message.result);
          const bytesTemporary = await remainingCalibrationWorkspaceBytes(this.options.temporaryRoot, input.sessionId);
          await handlers.onResult(result, bytesTemporary);
          await handlers.onCompleted(await finishCleanup());
          finishLifecycle();
          return;
        }
        const diagnosticPayload = cancellationRequested && message.type === "failed"
          ? {
            ...message.diagnostic,
            status: "cancelled" as const,
            error: `calibration_cancelled:${message.error}`.slice(0, 2_000),
          }
          : message.diagnostic;
        const diagnostic = await this.persistDiagnostic(diagnosticPayload).catch(() => undefined);
        const cleanup = await finishCleanup();
        if (message.type === "cancelled" || cancellationRequested) await handlers.onCancelled(cleanup, diagnostic);
        else await handlers.onFailed(message.error, cleanup, diagnostic);
        finishLifecycle();
      }).catch(async (error: unknown) => {
        settled = true;
        await worker.terminate().catch(() => undefined);
        await this.stopReportedChildProcesses(input.sessionId);
        const detail = error instanceof Error ? error.message : String(error);
        const diagnostic = await this.persistDiagnostic(fallbackDiagnostic("failed", detail)).catch(() => undefined);
        await handlers.onFailed(detail, await finishCleanup(), diagnostic);
        finishLifecycle();
      });
    });
    worker.on("error", (error) => {
      if (settled || this.closingSessions.has(input.sessionId)) return;
      settled = true;
      void this.stopReportedChildProcesses(input.sessionId).then(async () => {
        const cancelled = this.cancellationRequested.has(input.sessionId);
        const diagnostic = await this.persistDiagnostic(fallbackDiagnostic(cancelled ? "cancelled" : "failed", error.message)).catch(() => undefined);
        const cleanup = await finishCleanup(true);
        if (cancelled) await handlers.onCancelled(cleanup, diagnostic);
        else await handlers.onFailed(error.message, cleanup, diagnostic);
      }).finally(finishLifecycle);
    });
    worker.on("exit", (code) => {
      if (settled || this.closingSessions.has(input.sessionId)) return;
      settled = true;
      const detail = code === 0 ? "calibration_worker_exit_without_result" : `calibration_worker_exit_${code}`;
      void this.stopReportedChildProcesses(input.sessionId).then(async () => {
        const cancelled = this.cancellationRequested.has(input.sessionId);
        const diagnostic = await this.persistDiagnostic(fallbackDiagnostic(cancelled ? "cancelled" : "interrupted", detail)).catch(() => undefined);
        const cleanup = await finishCleanup(true);
        if (cancelled) await handlers.onCancelled(cleanup, diagnostic);
        else await handlers.onFailed(detail, cleanup, diagnostic);
      }).finally(finishLifecycle);
    });
  }

  async cancel(sessionId: string): Promise<void> {
    const worker = this.active.get(sessionId);
    if (!worker) return;
    if (this.cancellationRequested.has(sessionId)) return;
    this.cancellationRequested.add(sessionId);
    worker.postMessage({ type: "cancel" });
    const childStop = setTimeout(() => {
      if (this.active.get(sessionId) !== worker) return;
      void this.stopReportedChildProcesses(sessionId);
    }, 500);
    childStop.unref?.();
    const escalation = setTimeout(() => {
      if (this.active.get(sessionId) !== worker) return;
      void worker.terminate().catch(() => undefined);
    }, 10_000);
    escalation.unref?.();
    this.cancelEscalationBySession.set(sessionId, escalation);
  }

  retryCleanup(sessionId: string, interruptedRecovery = false, previouslyRemovedBytes = 0): Promise<CalibrationCleanupStatus> {
    return this.cleanupWithRetry(sessionId, interruptedRecovery, previouslyRemovedBytes);
  }

  isActive(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  hasActiveSession(): boolean {
    return this.active.size > 0;
  }

  async close(): Promise<void> {
    const completions = [...this.completionBySession.values()];
    for (const worker of this.active.values()) worker.postMessage({ type: "cancel" });
    if (completions.length) {
      await Promise.race([
        Promise.allSettled(completions),
        wait(5_000),
      ]);
    }
    for (const [sessionId, worker] of [...this.active.entries()]) {
      this.closingSessions.add(sessionId);
      await worker.terminate();
      await this.stopReportedChildProcesses(sessionId);
      const handlers = this.handlersBySession.get(sessionId);
      const payload = this.fallbackDiagnosticBySession.get(sessionId)?.(
        "interrupted", "calibration_service_closed_before_worker_completed",
      );
      const diagnostic = payload ? await this.persistDiagnostic(payload).catch(() => undefined) : undefined;
      await handlers?.onCleanupStarted?.().catch(() => undefined);
      const cleanup = await this.cleanupWithRetry(sessionId, true,
        this.lastProgressBySession.get(sessionId)?.bytesRemoved ?? 0);
      if (handlers) {
        await handlers.onCancelled(cleanup, diagnostic);
      }
      this.active.delete(sessionId);
      this.handlersBySession.delete(sessionId);
      this.completionBySession.delete(sessionId);
      this.resolveCompletionBySession.get(sessionId)?.();
      this.resolveCompletionBySession.delete(sessionId);
      this.childProcessesBySession.delete(sessionId);
      this.fallbackDiagnosticBySession.delete(sessionId);
      this.lastProgressBySession.delete(sessionId);
      this.closingSessions.delete(sessionId);
      this.cancellationRequested.delete(sessionId);
      const escalation = this.cancelEscalationBySession.get(sessionId);
      if (escalation) clearTimeout(escalation);
      this.cancelEscalationBySession.delete(sessionId);
    }
  }

  private async stopReportedChildProcesses(sessionId: string): Promise<void> {
    const children = [...(this.childProcessesBySession.get(sessionId)?.keys() ?? [])];
    for (const pid of children) {
      try { process.kill(pid, "SIGTERM"); } catch { /* The calibration child already exited. */ }
    }
    if (children.length > 0) await wait(250);
    for (const pid of children) {
      try { process.kill(pid, 0); process.kill(pid, "SIGKILL"); } catch { /* The calibration child exited after SIGTERM. */ }
    }
    this.childProcessesBySession.get(sessionId)?.clear();
  }

  private async persistEvidence(result: LocalCalibrationRun): Promise<LocalCalibrationRun> {
    await mkdir(this.options.evidenceDirectory, { recursive: true });
    const payloadSha256 = canonicalSha256(result);
    const fileName = `${result.id}.qhcal.json.gz`;
    const compressed = gzipSync(Buffer.from(JSON.stringify({
      schemaVersion: "qual-hardware-calibration-evidence/1.0.0",
      run: result,
      payloadSha256,
    }), "utf8"), { level: 9 });
    if (compressed.byteLength > MAX_EVIDENCE_BYTES) throw new Error("calibration_evidence_exceeds_10mb");
    await writeFile(join(this.options.evidenceDirectory, fileName), compressed, { flag: "wx" });
    return {
      ...result,
      artifact: {
        fileName,
        payloadSha256,
        persistedAt: new Date().toISOString(),
        storage: "application_data_append_only",
      },
    };
  }

  private async persistDiagnostic(payload: CalibrationKernelDiagnosticPayload): Promise<CalibrationDiagnosticArtifact> {
    await mkdir(this.options.evidenceDirectory, { recursive: true });
    const payloadSha256 = canonicalSha256(payload);
    const fileName = `${payload.runId}.${payload.status}.qhcal-diagnostic.json.gz`;
    const compressed = gzipSync(Buffer.from(JSON.stringify({
      schemaVersion: "qual-hardware-calibration-diagnostic-envelope/1.0.0",
      diagnostic: payload,
      payloadSha256,
    }), "utf8"), { level: 9 });
    if (compressed.byteLength > MAX_EVIDENCE_BYTES) throw new Error("calibration_diagnostic_exceeds_10mb");
    await writeFile(join(this.options.evidenceDirectory, fileName), compressed, { flag: "wx" });
    return {
      schemaVersion: "qual-hardware-calibration-diagnostic-artifact/1.0.0",
      fileName,
      payloadSha256,
      persistedAt: new Date().toISOString(),
      status: payload.status,
      completedMeasurementCount: payload.measurements.length,
    };
  }

  private async cleanupWithRetry(
    sessionId: string,
    interruptedRecovery = false,
    previouslyRemovedBytes = 0,
  ): Promise<CalibrationCleanupStatus> {
    const previouslyRemoved = Math.max(0, Math.floor(previouslyRemovedBytes));
    let remainingAtStart = 0;
    try { remainingAtStart = await calibrationWorkspaceBytes(this.options.temporaryRoot, sessionId); } catch { /* The worker may have failed before creating its workspace. */ }
    const bytesTemporary = previouslyRemoved + remainingAtStart;
    let lastError: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        if (interruptedRecovery) await refreshRegisteredCalibrationTemporaryFiles(this.options.temporaryRoot, sessionId);
        const { bytesRemoved } = await cleanupCalibrationWorkspace(this.options.temporaryRoot, sessionId);
        return cleanupStatus({ state: "completed", bytesTemporary, bytesRemoved: previouslyRemoved + bytesRemoved, attempts: attempt, remainingBytes: 0 });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (isNotFound(error) && SESSION_UUID.test(sessionId)) {
          const workspaceExists = await lstat(join(this.options.temporaryRoot, sessionId))
            .then(() => true).catch((workspaceError: unknown) => isNotFound(workspaceError) ? false : Promise.reject(workspaceError));
          if (!workspaceExists) {
            return cleanupStatus({ state: "completed", bytesTemporary, bytesRemoved: bytesTemporary, attempts: attempt, remainingBytes: 0 });
          }
        }
        if (attempt < 3) await wait([100, 500, 1_000][attempt - 1] ?? 1_000);
      }
    }
    const remainingBytes = await remainingCalibrationWorkspaceBytes(this.options.temporaryRoot, sessionId);
    return cleanupStatus({ state: "failed", bytesTemporary,
      bytesRemoved: previouslyRemoved + Math.max(0, remainingAtStart - remainingBytes),
      attempts: 3, remainingBytes, error: lastError });
  }
}
