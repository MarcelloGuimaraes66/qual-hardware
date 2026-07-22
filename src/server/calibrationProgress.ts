import { performance } from "node:perf_hooks";
import {
  CALIBRATION_PROGRESS_VERSION,
  type CalibrationPlan,
  type CalibrationSessionProgress,
} from "../shared/types.js";

export interface CalibrationDurationEstimate {
  minimumSeconds: number;
  expectedSeconds: number;
  maximumSeconds: number;
}

const REQUIRED_COMPUTE_MODE_COUNT = 2;

export function estimateCalibrationDuration(plan: CalibrationPlan): CalibrationDurationEstimate {
  const phaseSeconds = plan.phases.reduce((sum, phase) => sum + phase.durationSeconds, 0) * REQUIRED_COMPUTE_MODE_COUNT;
  const discoveryPerTier = (plan.discovery.stabilizationSeconds + plan.discovery.sampleSeconds) * REQUIRED_COMPUTE_MODE_COUNT;
  const discoveryMinimum = discoveryPerTier;
  const discoveryMaximum = discoveryPerTier * plan.cameraTiers.length;
  if (plan.mode === "quick") {
    const expectedSeconds = discoveryMinimum + phaseSeconds;
    return {
      minimumSeconds: Math.max(1, Math.floor(expectedSeconds * 0.9)),
      expectedSeconds,
      maximumSeconds: Math.ceil(expectedSeconds * 1.25),
    };
  }
  const qualification = phaseSeconds * plan.qualification.repetitions +
    plan.qualification.cooldownSeconds * (plan.qualification.repetitions - 1);
  const expectedSeconds = discoveryMaximum * 0.6 + qualification;
  const worstQualificationRetries = qualification * plan.cameraTiers.length;
  return {
    minimumSeconds: Math.max(1, Math.floor(discoveryMinimum + qualification)),
    expectedSeconds: Math.max(1, Math.ceil(expectedSeconds)),
    maximumSeconds: Math.max(1, Math.ceil(discoveryMaximum + worstQualificationRetries)),
  };
}

function finite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class CalibrationProgressTracker {
  private readonly startedEpochMs: number;
  private readonly startedMonotonicMs: number;
  private phaseStartedEpochMs: number;
  private phaseStartedMonotonicMs: number;
  private currentPhase = "preflight";
  private overallPercent = 0;
  private previousEstimatedRemaining: number | null = null;
  private lastRaw: CalibrationSessionProgress = { percent: 0, updatedAt: new Date().toISOString() };
  private readonly duration: CalibrationDurationEstimate;

  constructor(
    private readonly plan: CalibrationPlan,
    options: { epochMs?: number; monotonicMs?: number } = {},
  ) {
    this.startedEpochMs = options.epochMs ?? Date.now();
    this.startedMonotonicMs = options.monotonicMs ?? performance.now();
    this.phaseStartedEpochMs = this.startedEpochMs;
    this.phaseStartedMonotonicMs = this.startedMonotonicMs;
    this.duration = estimateCalibrationDuration(plan);
  }

  update(raw: CalibrationSessionProgress, options: {
    epochMs?: number;
    monotonicMs?: number;
    terminalCleanupCompleted?: boolean;
  } = {}): CalibrationSessionProgress {
    const epochMs = options.epochMs ?? Date.now();
    const monotonicMs = options.monotonicMs ?? performance.now();
    const phase = raw.phase ?? raw.stage ?? this.currentPhase;
    const phaseChanged = phase !== this.currentPhase || raw.tier !== this.lastRaw.tier ||
      raw.repetition !== this.lastRaw.repetition || raw.computeMode !== this.lastRaw.computeMode;
    if (phaseChanged) {
      this.currentPhase = phase;
      this.phaseStartedEpochMs = epochMs;
      this.phaseStartedMonotonicMs = monotonicMs;
    }
    this.lastRaw = { ...this.lastRaw, ...raw };
    const elapsedSeconds = Math.max(0, (monotonicMs - this.startedMonotonicMs) / 1_000);
    const phaseElapsedSeconds = Math.max(0, (monotonicMs - this.phaseStartedMonotonicMs) / 1_000);
    const phaseDurationSeconds = this.phaseDuration(phase);
    const phasePercent = options.terminalCleanupCompleted
      ? 100
      : Math.min(99, Math.max(finite(raw.phasePercent, 0), phaseElapsedSeconds / Math.max(1, phaseDurationSeconds) * 100));
    const rawOverall = finite(raw.overallPercent ?? raw.percent, this.overallPercent);
    const segmentBudget = this.segmentBudget(phase);
    const liveOverall = rawOverall + segmentBudget * phasePercent / 100;
    const maximumBeforeCleanup = options.terminalCleanupCompleted ? 100 : 99;
    this.overallPercent = Math.min(maximumBeforeCleanup, Math.max(this.overallPercent, liveOverall));
    if (!options.terminalCleanupCompleted && this.overallPercent >= 99) this.overallPercent = 98;

    const linearRemaining = this.overallPercent > 0
      ? elapsedSeconds * (100 - this.overallPercent) / this.overallPercent
      : this.duration.expectedSeconds;
    const expectedRemaining = options.terminalCleanupCompleted ? 0 : Math.max(0,
      Math.min(this.duration.maximumSeconds - elapsedSeconds,
        Math.max(phaseDurationSeconds - phaseElapsedSeconds, linearRemaining)));
    const estimatedRemainingSeconds = Number.isFinite(expectedRemaining) ? expectedRemaining : null;
    const estimateAdjusted = this.previousEstimatedRemaining !== null && estimatedRemainingSeconds !== null &&
      Math.abs(estimatedRemainingSeconds - this.previousEstimatedRemaining) > Math.max(30, this.previousEstimatedRemaining * 0.1);
    this.previousEstimatedRemaining = estimatedRemainingSeconds;
    const estimatedCompletionAt = estimatedRemainingSeconds === null
      ? null : new Date(epochMs + estimatedRemainingSeconds * 1_000).toISOString();
    const bytesTemporary = Math.max(0, Math.floor(finite(raw.bytesTemporary, this.lastRaw.bytesTemporary ?? 0)));
    const bytesRemoved = Math.max(0, Math.floor(finite(raw.bytesRemoved, this.lastRaw.bytesRemoved ?? 0)));

    return {
      schemaVersion: CALIBRATION_PROGRESS_VERSION,
      phase,
      stage: raw.stage ?? phase,
      percent: this.overallPercent,
      overallPercent: this.overallPercent,
      phasePercent,
      ...(raw.message ? { message: raw.message.slice(0, 1_000) } : {}),
      ...(raw.tier ? { tier: raw.tier } : {}),
      ...(raw.repetition ? { repetition: raw.repetition } : {}),
      ...(raw.attempt ? { attempt: raw.attempt } : {}),
      ...(raw.computeMode ? { computeMode: raw.computeMode } : {}),
      sessionStartedAt: new Date(this.startedEpochMs).toISOString(),
      phaseStartedAt: new Date(this.phaseStartedEpochMs).toISOString(),
      elapsedSeconds,
      estimatedRemainingSeconds,
      estimatedCompletionAt,
      minimumDurationSeconds: this.duration.minimumSeconds,
      maximumDurationSeconds: this.duration.maximumSeconds,
      estimateConfidence: this.plan.mode === "qualification" && this.overallPercent < 30 ? "low" : this.overallPercent < 70 ? "medium" : "high",
      estimateAdjusted,
      bytesTemporary,
      bytesRemoved,
      bytesProjected: Math.max(bytesTemporary, Math.floor(finite(raw.bytesProjected, this.lastRaw.bytesProjected ?? 0))),
      diskFreeBytes: Math.max(0, Math.floor(finite(raw.diskFreeBytes, this.lastRaw.diskFreeBytes ?? 0))),
      diskReserveBytes: Math.max(0, Math.floor(finite(raw.diskReserveBytes, this.lastRaw.diskReserveBytes ?? 0))),
      updatedAt: new Date(epochMs).toISOString(),
    };
  }

  heartbeat(): CalibrationSessionProgress {
    return this.update(this.lastRaw);
  }

  private phaseDuration(phase: string): number {
    if (phase === "discovery") return this.plan.discovery.stabilizationSeconds + this.plan.discovery.sampleSeconds;
    return this.plan.phases.find((item) => item.name === phase)?.durationSeconds ??
      (phase === "preflight" || phase === "cleanup" ? 15 : 60);
  }

  private segmentBudget(phase: string): number {
    if (phase === "discovery") return 28 / Math.max(1, this.plan.cameraTiers.length * REQUIRED_COMPUTE_MODE_COUNT);
    if (["warmup", "ramp", "sustained", "surge"].includes(phase)) {
      return 65 / Math.max(1, this.plan.phases.length * this.plan.qualification.repetitions * REQUIRED_COMPUTE_MODE_COUNT);
    }
    return phase === "preflight" ? 1 : 0;
  }
}
