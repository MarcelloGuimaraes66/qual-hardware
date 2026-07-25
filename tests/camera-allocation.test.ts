import { describe, expect, it } from "vitest";
import { createDefaultScenario } from "../src/shared/schemas.js";
import { withCameraGroupCount, withCameraTotal } from "../src/web/cameraAllocation.js";

function sumGroups(counts: Array<{ count: number }>): number {
  return counts.reduce((sum, group) => sum + group.count, 0);
}

describe("camera workload allocation", () => {
  it("keeps FULL VIDEO and FRAME profiles equal to the requested total", () => {
    const scenario = createDefaultScenario(12);
    scenario.cameraGroups[0]!.count = 11;
    scenario.cameraGroups.push({
      ...structuredClone(scenario.cameraGroups[0]!),
      id: crypto.randomUUID(),
      name: "FRAME",
      count: 1,
    });

    const adjusted = withCameraGroupCount(scenario, scenario.cameraGroups[0]!.id, 4);

    expect(adjusted.totalCameras).toBe(12);
    expect(adjusted.cameraGroups.map((group) => group.count)).toEqual([4, 8]);
    expect(sumGroups(adjusted.cameraGroups)).toBe(12);
  });

  it("rebalances every group when the project total is reduced", () => {
    const scenario = createDefaultScenario(25);
    scenario.cameraGroups[0]!.count = 10;
    scenario.cameraGroups.push({
      ...structuredClone(scenario.cameraGroups[0]!),
      id: crypto.randomUUID(),
      name: "FRAME",
      count: 15,
    });

    const adjusted = withCameraTotal(scenario, 12, (count) => ({
      ...structuredClone(scenario.cameraGroups[0]!),
      id: crypto.randomUUID(),
      count,
    }));

    expect(adjusted.totalCameras).toBe(12);
    expect(sumGroups(adjusted.cameraGroups)).toBe(12);
    expect(adjusted.cameraGroups.every((group) => group.count >= 1)).toBe(true);
  });

  it("does not allow a single profile to diverge from the project total", () => {
    const scenario = createDefaultScenario(12);
    const adjusted = withCameraGroupCount(scenario, scenario.cameraGroups[0]!.id, 11);

    expect(adjusted.totalCameras).toBe(12);
    expect(adjusted.cameraGroups[0]!.count).toBe(12);
  });
});
