import { describe, expect, it } from "vitest";
import { createCalibrationPlan } from "../src/engine/calibration.js";
import { createDefaultScenario } from "../src/shared/schemas.js";
import { CalibrationProgressTracker, estimateCalibrationDuration } from "../src/server/calibrationProgress.js";

describe("calibration progress v2", () => {
  it("uses monotonic elapsed time, never regresses and withholds 100% until cleanup", () => {
    const plan = createCalibrationPlan(createDefaultScenario(4), "full", "hp-z2-g1i-ultra9-rtx4500ada");
    const tracker = new CalibrationProgressTracker(plan, { epochMs: 1_000_000, monotonicMs: 100 });
    const first = tracker.update({ phase: "discovery", percent: 30, updatedAt: new Date().toISOString() },
      { epochMs: 1_010_000, monotonicMs: 10_100 });
    const clockMovedBack = tracker.update({ phase: "discovery", percent: 10, updatedAt: new Date().toISOString() },
      { epochMs: 900_000, monotonicMs: 20_100 });
    const beforeCleanup = tracker.update({ phase: "finalizing", percent: 100, updatedAt: new Date().toISOString() },
      { epochMs: 1_030_000, monotonicMs: 30_100 });
    const completed = tracker.update({ phase: "completed", percent: 100, updatedAt: new Date().toISOString() },
      { epochMs: 1_040_000, monotonicMs: 40_100, terminalCleanupCompleted: true });
    expect(first.elapsedSeconds).toBe(10);
    expect(clockMovedBack.elapsedSeconds).toBe(20);
    expect(clockMovedBack.overallPercent).toBeGreaterThanOrEqual(first.overallPercent!);
    expect(beforeCleanup.overallPercent).toBe(98);
    expect(completed.overallPercent).toBe(100);
    expect(completed.estimatedRemainingSeconds).toBe(0);
  });

  it("publishes honest minimum, expected and worst-case estimates", () => {
    const quickPlan = createCalibrationPlan(createDefaultScenario(4), "quick");
    const fullPlan = createCalibrationPlan(createDefaultScenario(4), "full");
    const quick = estimateCalibrationDuration(quickPlan);
    const full = estimateCalibrationDuration(fullPlan);
    const singleComputeQuickSeconds = quickPlan.discovery.stabilizationSeconds + quickPlan.discovery.sampleSeconds +
      quickPlan.phases.reduce((sum, phase) => sum + phase.durationSeconds, 0);
    expect(quick.minimumSeconds).toBeLessThanOrEqual(quick.expectedSeconds);
    expect(quick.expectedSeconds).toBe(singleComputeQuickSeconds * 2);
    expect(quick.expectedSeconds).toBeLessThanOrEqual(quick.maximumSeconds);
    expect(full.maximumSeconds).toBeGreaterThan(full.expectedSeconds);
    expect(full.expectedSeconds).toBeGreaterThan(quick.expectedSeconds);
  });

  it("tracks CPU and GPU as separate progress segments", () => {
    const plan = createCalibrationPlan(createDefaultScenario(4), "quick");
    const tracker = new CalibrationProgressTracker(plan, { epochMs: 1_000_000, monotonicMs: 100 });
    const cpu = tracker.update({ phase: "discovery", computeMode: "cpu_only", percent: 2, updatedAt: new Date().toISOString() },
      { epochMs: 1_010_000, monotonicMs: 10_100 });
    const gpu = tracker.update({ phase: "discovery", computeMode: "gpu_accelerated", percent: 16, updatedAt: new Date().toISOString() },
      { epochMs: 1_020_000, monotonicMs: 20_100 });
    expect(cpu.computeMode).toBe("cpu_only");
    expect(gpu.computeMode).toBe("gpu_accelerated");
    expect(gpu.phaseStartedAt).toBe(new Date(1_020_000).toISOString());
    expect(gpu.overallPercent).toBeGreaterThanOrEqual(cpu.overallPercent!);
  });
});
