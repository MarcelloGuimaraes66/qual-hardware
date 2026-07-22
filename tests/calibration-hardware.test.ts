import { describe, expect, it } from "vitest";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import {
  calibrationHardwareMatchesTemplate,
  detectCalibrationHardware,
} from "../src/server/calibrationHardware.js";

describe("calibration hardware preflight", () => {
  it("detects the local machine without exposing its hostname or credentials", async () => {
    const detected = await detectCalibrationHardware();
    expect(detected.schemaVersion).toBe("qual-hardware-calibration-hardware/1.0.0");
    expect(detected.cpuModel.length).toBeGreaterThan(0);
    expect(detected.logicalCores).toBeGreaterThan(0);
    expect(detected.physicalCores).toBeGreaterThan(0);
    expect(detected.ramBytes).toBeGreaterThan(0);
    expect(["windows", "macos", "ubuntu"]).toContain(detected.operatingSystem);
    expect(JSON.stringify(detected)).not.toMatch(/hostname|credential|password/i);
    for (const link of detected.networkLinks) {
      expect(link.speedMbps === null || link.speedMbps > 0).toBe(true);
      expect(["full", "half", "unknown"]).toContain(link.duplex);
      expect(link.physicalLinkVerified).toBe(link.speedMbps !== null);
    }
  }, 30_000);

  it("matches trademark-heavy OS inventory to a catalog template without weakening physical checks", () => {
    const target = HARDWARE_CATALOG.find((item) => item.id === "hp-z2-g1i-ultra9-rtx4500ada")!;
    const detected = {
      cpuModel: "Intel(R) Core(TM) Ultra 9 285K Processor",
      physicalCores: 24,
      gpuModel: "NVIDIA RTX 4500 Ada Generation GPU",
      gpuCount: 1,
      ramBytes: 128 * 1024 ** 3,
      operatingSystem: "windows" as const,
      formFactor: "workstation" as const,
    };
    expect(calibrationHardwareMatchesTemplate(detected, target)).toBe(true);
    expect(calibrationHardwareMatchesTemplate({ ...detected, ramBytes: 96 * 1024 ** 3 }, target)).toBe(false);
    expect(calibrationHardwareMatchesTemplate({ ...detected, cpuModel: "Intel Core i7-14700K" }, target)).toBe(false);
    expect(calibrationHardwareMatchesTemplate({ ...detected, gpuCount: 2 }, target)).toBe(false);
    expect(calibrationHardwareMatchesTemplate({ ...detected, formFactor: "laptop" }, target)).toBe(false);
  });
});
