import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { calibrationHandoffSchema, calibrationPlanSchema, localCalibrationRunSchema } from "../src/shared/schemas.js";
import { calibrationPayloadSha256 } from "../src/server/calibrationSessions.js";
import type { LocalCalibrationRun } from "../src/shared/types.js";

async function jsonFixture<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as T;
}

describe("calibration contract artifacts", () => {
  it("keeps golden fixtures readable by the runtime validators", async () => {
    const [handoff, plan, full, partial] = await Promise.all([
      jsonFixture("../tests/fixtures/calibration-handoff-v1.json"),
      jsonFixture("../tests/fixtures/calibration-plan-v1.json"),
      jsonFixture("../tests/fixtures/local-calibration-v2.json"),
      jsonFixture("../tests/fixtures/local-calibration-partial-v2.json"),
    ]);
    expect(calibrationHandoffSchema.parse(handoff).schemaVersion).toBe("qual-hardware-calibration-handoff/1.0.0");
    expect(calibrationPlanSchema.parse(plan).schemaVersion).toBe("qual-hardware-calibration-plan/1.0.0");
    const fullRun = localCalibrationRunSchema.parse(full) as LocalCalibrationRun;
    expect(fullRun.schemaVersion).toBe("qual-hardware-local-calibration/2.0.0");
    expect(calibrationPayloadSha256(fullRun)).toBe(fullRun.artifact?.payloadSha256);
    const partialRun = localCalibrationRunSchema.parse(partial) as LocalCalibrationRun;
    expect(calibrationPayloadSha256(partialRun)).toBe(partialRun.artifact?.payloadSha256);
    expect(partialRun.qualityGate?.eligibleForCapacityExtrapolation).toBe(false);
    expect(partialRun.qualityGate?.validationStatus).toBe("diagnostic");
    expect(partialRun.artifact?.fileName).toContain("partial");
  });
});
