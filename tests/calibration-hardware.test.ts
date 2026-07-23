import { describe, expect, it } from "vitest";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import {
  calibrationProcessorGroups,
  calibrationHardwareMatchesTemplate,
  detectCalibrationHardware,
} from "../src/server/calibrationHardware.js";

describe("calibration hardware preflight", () => {
  it.each([
    { logicalProcessors: 24, groupSizes: [24] },
    { logicalProcessors: 96, groupSizes: [64, 32] },
    { logicalProcessors: 192, groupSizes: [64, 64, 64] },
    { logicalProcessors: 384, groupSizes: [64, 64, 64, 64, 64, 64] },
  ])("models every Windows processor group for $logicalProcessors logical processors", ({ logicalProcessors, groupSizes }) => {
    const groups = calibrationProcessorGroups(logicalProcessors);
    expect(groups.map((group) => group.logicalProcessorCount)).toEqual(groupSizes);
    expect(groups.reduce((sum, group) => sum + group.logicalProcessorCount, 0)).toBe(logicalProcessors);
  });

  it("detects the local machine without exposing its hostname or credentials", async () => {
    const detected = await detectCalibrationHardware();
    expect(detected.schemaVersion).toBe("qual-hardware-calibration-hardware/2.0.0");
    expect(detected.cpuModel.length).toBeGreaterThan(0);
    expect(detected.logicalCores).toBeGreaterThan(0);
    expect(detected.physicalCores).toBeGreaterThan(0);
    expect(detected.ramBytes).toBeGreaterThan(0);
    expect(detected.cpuPackages?.length).toBeGreaterThan(0);
    expect(detected.processorGroups?.length).toBeGreaterThan(0);
    expect(detected.numaNodes?.length).toBeGreaterThan(0);
    expect(detected.cpuPackages?.reduce((sum, item) => sum + item.physicalCores, 0)).toBe(detected.physicalCores);
    for (const device of detected.gpuDevices ?? []) {
      expect(device.id.length).toBeGreaterThan(0);
      expect(["compute", "media_only", "display_only", "unavailable"]).toContain(device.classification);
    }
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

  it("maps this Windows laboratory laptop to its exact qualification anchor", () => {
    const target = HARDWARE_CATALOG.find((item) => item.id === "asus-g835lx-ultra9-275hx-rtx5090l")!;
    expect(calibrationHardwareMatchesTemplate({
      cpuModel: "Intel(R) Core(TM) Ultra 9 275HX",
      physicalCores: 24,
      gpuModel: "NVIDIA GeForce RTX 5090 Laptop GPU",
      gpuCount: 1,
      ramBytes: 33_673_297_920,
      operatingSystem: "windows",
      formFactor: "laptop",
    }, target)).toBe(true);
  });
});
