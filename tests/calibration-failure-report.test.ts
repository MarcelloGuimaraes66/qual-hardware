import { describe, expect, it } from "vitest";
import { createCalibrationPlan } from "../src/engine/calibration.js";
import { buildFailedCalibrationDiagnosticReport } from "../src/engine/calibrationDiagnostic.js";
import { createDefaultScenario } from "../src/shared/schemas.js";
import type { CalibrationKernelDiagnosticPayload } from "../src/server/calibrationKernelProtocol.js";

describe("failed calibration report", () => {
  it("produces a readable inconclusive result without inventing a capacity limit", () => {
    const plan = createCalibrationPlan(createDefaultScenario(12), "quick");
    const payload: CalibrationKernelDiagnosticPayload = {
      schemaVersion: "qual-hardware-calibration-diagnostic/1.0.0",
      sessionId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      planId: plan.id,
      createdAt: plan.createdAt,
      completedAt: new Date(Date.parse(plan.createdAt) + 150_000).toISOString(),
      status: "failed",
      error: "calibration_process_timeout:qual-hardware-native-bench.exe",
      kernelVersion: plan.kernelVersion,
      runtimeManifestHash: "a".repeat(64),
      workloadProfileId: plan.workloadProfile.id,
      workloadProfileSignature: plan.workloadProfile.signature,
      compatiblePerceptrumCommit: plan.workloadProfile.targetBuildHash,
      lastProgress: {
        phase: "discovery",
        stage: "discovering",
        tier: 12,
        attempt: 2,
        percent: 2,
        updatedAt: new Date().toISOString(),
      },
      fingerprint: null,
      runtimeSummary: {
        mediaAvailable: true,
        rtspAvailable: true,
        localInferenceAvailable: true,
        unavailableReasons: [],
      },
      tierResults: [],
      repetitions: [],
      measurements: [],
    };

    const report = buildFailedCalibrationDiagnosticReport(payload, plan);

    expect(report.conclusion).toBe("inconclusive");
    expect(report.requested.cameras).toBe(12);
    expect(report.requested.operationallyApproved).toBeNull();
    expect(report.capacity.safeCameras).toBeNull();
    expect(report.capacity.highestPassingCameras).toBeNull();
    expect(report.capacity.firstFailingCameras).toBeNull();
    expect(report.searchTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cameraCount: 12,
        outcome: "infrastructure_error",
        failureCode: payload.error,
      }),
    ]));
    expect(report.findings[0]?.consequencePt).toContain("não representa o limite");
    expect(report.fleetPlan.status).toBe("blocked");
  });
});
