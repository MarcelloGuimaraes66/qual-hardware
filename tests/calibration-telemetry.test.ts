import { describe, expect, it } from "vitest";
import {
  CALIBRATION_TELEMETRY_PROBE_SCHEMA_VERSION,
  parseApprovedTelemetryProbe,
  parseNvidiaTelemetryCsv,
  reconcileThermalThrottleCounter,
} from "../src/server/calibrationTelemetry.js";

function probePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: CALIBRATION_TELEMETRY_PROBE_SCHEMA_VERSION,
    probeVersion: "0.1.0",
    platform: process.platform === "win32" ? "windows" : process.platform,
    architecture: process.arch === "x64" ? "amd64" : process.arch,
    capturedAt: "2026-07-22T12:00:00.000Z",
    quality: {
      thermalThrottling: "measured",
      cpuThermal: "measured",
      gpuThermal: "measured",
      sources: ["fixture-thermal-policy"],
    },
    gpuUtilizationPercent: 42,
    thermalThrottlePercent: 0,
    warnings: [],
    ...overrides,
  };
}

describe("calibration hardware telemetry", () => {
  it("aggregates multiple NVIDIA devices and preserves thermal slowdown evidence", () => {
    const parsed = parseNvidiaTelemetryCsv([
      "25, 1024, 61, 75.5, Not Active, Not Active",
      "70, 2048, 73, 125.0, Active, Not Active",
    ].join("\n"));
    expect(parsed).toEqual({
      gpuUtilizationPercent: 70,
      gpuMemoryUsedBytes: 3_072 * 1024 ** 2,
      gpuTemperatureCelsius: 73,
      gpuPowerWatts: 200.5,
      thermalThrottlePercent: 100,
    });
  });

  it("accepts only the exact, bounded and locally compatible probe contract", () => {
    expect(parseApprovedTelemetryProbe("not-json")).toBeNull();
    expect(parseApprovedTelemetryProbe(JSON.stringify({ gpuUtilizationPercent: 42 }))).toBeNull();
    expect(parseApprovedTelemetryProbe(JSON.stringify(probePayload()))).toEqual({
      gpuUtilizationPercent: 42,
      thermalThrottlePercent: 0,
      probeThermalEvidence: "measured",
      approvedThermalEvidence: true,
    });
    expect(parseApprovedTelemetryProbe(JSON.stringify(probePayload({ gpuUtilizationPercent: 101 })))).toBeNull();
    expect(parseApprovedTelemetryProbe(JSON.stringify(probePayload({ platform: "windows" })))).toBe(
      process.platform === "win32" ? expect.any(Object) : null,
    );
  });

  it("keeps partial sensor coverage diagnostic and never upgrades it to approved evidence", () => {
    const partial = parseApprovedTelemetryProbe(JSON.stringify(probePayload({
      quality: {
        thermalThrottling: "partial",
        cpuThermal: "measured",
        gpuThermal: "partial",
        sources: ["cpu-counter-only"],
      },
    })));
    expect(partial).toMatchObject({ probeThermalEvidence: "partial", approvedThermalEvidence: false });
  });

  it("turns a monotonic throttle-counter increase into a guardrail event", () => {
    const baseline = reconcileThermalThrottleCounter({ thermalThrottleCounter: 10 }, null);
    expect(baseline.sample.thermalThrottlePercent).toBe(0);
    const unchanged = reconcileThermalThrottleCounter({ thermalThrottleCounter: 10 }, baseline.nextCounter);
    expect(unchanged.sample.thermalThrottlePercent).toBe(0);
    const increased = reconcileThermalThrottleCounter({ thermalThrottleCounter: 11 }, unchanged.nextCounter);
    expect(increased.sample.thermalThrottlePercent).toBe(100);
  });
});
