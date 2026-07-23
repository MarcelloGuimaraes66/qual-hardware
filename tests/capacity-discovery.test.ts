import { describe, expect, it } from "vitest";
import { discoverCapacityBoundary } from "../src/engine/capacityDiscovery.js";

describe("adaptive maximum camera discovery", () => {
  it("finds the true adjacent boundary between a passing 8 and failing 16", async () => {
    const result = await discoverCapacityBoundary({
      seedCameraCount: 8,
      generatorCameraLimit: 1_000,
      confirmationRuns: 2,
      evaluate: async (cameras) => cameras <= 13,
    });

    expect(result.highestPassingCameraCount).toBe(13);
    expect(result.firstFailingCameraCount).toBe(14);
    expect(result.operationalSafeCameraCount).toBe(10);
    expect(result.bound).toBe("exact");
    expect(result.searchTrace.some((item) => item.phase === "binary")).toBe(true);
  });

  it("searches below a failing project seed", async () => {
    const result = await discoverCapacityBoundary({
      seedCameraCount: 64,
      generatorCameraLimit: 1_000,
      evaluate: async (cameras) => cameras <= 19,
    });

    expect(result.highestPassingCameraCount).toBe(19);
    expect(result.firstFailingCameraCount).toBe(20);
    expect(result.bound).toBe("exact");
  });

  it("reports at_least when the generator becomes the limit", async () => {
    const result = await discoverCapacityBoundary({
      seedCameraCount: 8,
      generatorCameraLimit: 64,
      evaluate: async () => true,
    });

    expect(result.highestPassingCameraCount).toBe(64);
    expect(result.firstFailingCameraCount).toBeNull();
    expect(result.bound).toBe("at_least");
  });

  it("does not claim an exact limit when repeated measurements flap", async () => {
    let thirteenRuns = 0;
    const result = await discoverCapacityBoundary({
      seedCameraCount: 8,
      generatorCameraLimit: 64,
      evaluate: async (cameras) => {
        if (cameras === 13) {
          thirteenRuns += 1;
          return thirteenRuns < 2;
        }
        return cameras <= 13;
      },
    });

    expect(result.nonMonotonic).toBe(true);
    expect(result.bound).toBe("uncertain");
  });
});
