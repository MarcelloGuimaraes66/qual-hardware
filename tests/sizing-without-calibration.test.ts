import { describe, expect, it } from "vitest";
import { createDefaultScenario } from "../src/shared/schemas.js";
import type { CapacityRecommendation, ScenarioRecord } from "../src/shared/types.js";
import { createApp } from "../src/server/app.js";
import { MemoryPlannerStore } from "../src/server/store.js";

describe("infrastructure sizing without calibration", () => {
  it("returns an explicit planning estimate for a mixed FULL VIDEO and FRAME workload", async () => {
    const store = new MemoryPlannerStore();
    const app = createApp(store);
    const scenario = createDefaultScenario(25);
    scenario.cameraGroups[0]!.name = "VÍDEO FULL";
    scenario.cameraGroups[0]!.count = 8;
    const frameGroup = structuredClone(scenario.cameraGroups[0]!);
    frameGroup.id = crypto.randomUUID();
    frameGroup.name = "FRAME";
    frameGroup.count = 17;
    frameGroup.agents[0]!.inputType = "image";
    frameGroup.agents[0]!.runEverySeconds = 60;
    scenario.cameraGroups.push(frameGroup);

    const before = await app.request("/api/calibrations/status");
    expect(await before.json()).toMatchObject({ calibrationRuns: 0 });

    const created = await (await app.request("/api/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario }),
    })).json() as ScenarioRecord;
    const response = await app.request(`/api/scenarios/${created.id}/recommendations`, { method: "POST" });
    const recommendations = await response.json() as CapacityRecommendation[];

    expect(response.status).toBe(201);
    expect(recommendations).toHaveLength(3);
    expect(recommendations.every((item) => item.confidence === "reference_only")).toBe(true);
    expect(recommendations.every((item) => item.primary.fleetPlan?.safeCamerasPerServer)).toBe(true);
    expect(recommendations.some((item) => item.primary.maximumAdditionalCameras > 0)).toBe(true);
    expect(recommendations.every((item) => item.primary.fleetPlan?.activeServers === item.primary.activeNodeCount)).toBe(true);
  });
});
