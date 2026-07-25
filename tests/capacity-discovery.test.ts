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

  it("returns an honest preliminary lower bound when a quick-test probe budget is exhausted", async () => {
    const result = await discoverCapacityBoundary({
      seedCameraCount: 12,
      generatorCameraLimit: 1_000_000,
      maximumEvaluations: 4,
      evaluate: async () => true,
    });

    expect(result.searchTrace).toHaveLength(4);
    expect(result.highestPassingCameraCount).toBe(96);
    expect(result.firstFailingCameraCount).toBeNull();
    expect(result.operationalSafeCameraCount).toBe(76);
    expect(result.bound).toBe("at_least");
    expect(result.adjacentBoundaryConfirmed).toBe(false);
  });

  it("does not start another tier when the observed duration cannot fit the wall-clock budget", async () => {
    const result = await discoverCapacityBoundary({
      seedCameraCount: 12,
      generatorCameraLimit: 1_000_000,
      maximumDurationMs: 20,
      evaluate: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return true;
      },
    });

    expect(result.searchTrace).toHaveLength(1);
    expect(result.highestPassingCameraCount).toBe(12);
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
    expect(result.bound).toBe("interval");
  });

  it("retries a transient infrastructure failure without using it as capacity evidence", async () => {
    let first = true;
    const result = await discoverCapacityBoundary({
      seedCameraCount: 8,
      generatorCameraLimit: 32,
      evaluate: async (cameras) => {
        if (cameras === 8 && first) {
          first = false;
          return { outcome: "infrastructure_error", failureCode: "ffmpeg_preflight_failed" };
        }
        return { outcome: cameras <= 12 ? "pass" : "capacity_fail" };
      },
    });
    expect(result.bound).toBe("exact");
    expect(result.highestPassingCameraCount).toBe(12);
    expect(result.searchTrace[0]?.passed).toBeNull();
    expect(result.searchTrace[0]?.outcome).toBe("infrastructure_error");
  });

  it("returns inconclusive with no false 1/2 boundary after a persistent infrastructure failure", async () => {
    const result = await discoverCapacityBoundary({
      seedCameraCount: 25,
      generatorCameraLimit: 1_000,
      evaluate: async () => ({
        outcome: "infrastructure_error",
        failureCode: "qwen_server_start_timeout",
      }),
    });
    expect(result.bound).toBe("inconclusive");
    expect(result.highestPassingCameraCount).toBeNull();
    expect(result.firstFailingCameraCount).toBeNull();
    expect(result.operationalSafeCameraCount).toBeNull();
    expect(result.searchTrace).toHaveLength(2);
  });
});
