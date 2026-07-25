import { describe, expect, it } from "vitest";
import {
  calibrationOperatorFinding,
  classifyCalibrationProbe,
  isCalibrationInfrastructureFailure,
} from "../src/server/calibrationOutcome.js";

describe("calibration outcome classification", () => {
  it("never turns an internal process timeout into a camera-capacity limit", () => {
    const code = "calibration_process_timeout:qual-hardware-native-bench.exe";
    expect(isCalibrationInfrastructureFailure(code)).toBe(true);
    expect(classifyCalibrationProbe([code])).toBe("infrastructure_error");
    expect(calibrationOperatorFinding(code).consequencePt).toContain("não representa o limite");
  });

  it("explica o encerramento do processo isolado sem publicar capacidade", () => {
    const finding = calibrationOperatorFinding("calibration_worker_exit_4294930435");
    expect(finding.titlePt).toContain("encerrado inesperadamente");
    expect(finding.consequencePt).toContain("não representa o limite");
  });

  it("keeps measured latency and queue saturation as capacity failures", () => {
    expect(classifyCalibrationProbe(["local_inference_latency_exceeded"])).toBe("capacity_fail");
    expect(classifyCalibrationProbe(["queue_growth_exceeded"])).toBe("capacity_fail");
  });

  it("treats exhausted concurrent media capacity as a measured boundary", () => {
    const code = "media_pipeline:media_concurrency_capacity_exhausted";
    expect(isCalibrationInfrastructureFailure(code)).toBe(false);
    expect(classifyCalibrationProbe([
      "exact_concurrent_camera_load_not_executed",
      code,
      "frame_delivery_below_99_5_percent",
    ])).toBe("capacity_fail");
    expect(calibrationOperatorFinding(code).titlePt).toContain("limite medido");
  });

  it("translates an incomplete exact-concurrency attempt for the operator", () => {
    const finding = calibrationOperatorFinding("exact_concurrent_camera_load_not_executed");
    expect(finding.titlePt).toBe("A carga simultânea não pôde ser concluída nesse nível.");
    expect(finding.actionPt).toContain("gargalo");
  });

  it("does not describe unavailable thermal telemetry as observed overheating", () => {
    const finding = calibrationOperatorFinding("approved_thermal_guardrail_unavailable");
    expect(finding.titlePt).toContain("não pôde ser comprovada");
    expect(finding.consequencePt).toContain("não significa");
  });

  it("does not describe an unverified link specification as insufficient bandwidth", () => {
    const finding = calibrationOperatorFinding("physical_network_link_specification_unavailable");
    expect(finding.titlePt).toContain("não foi comprovada");
    expect(finding.consequencePt).toContain("não prova");
  });
});
