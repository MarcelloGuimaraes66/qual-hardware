import { describe, expect, it } from "vitest";
import { buildRecommendations, calculateScenarioDemand, CapacityError, normalizeAgent } from "../src/engine/capacity.js";
import { HARDWARE_CATALOG, SEED_PRICE_QUOTES } from "../src/engine/catalog.js";
import { createDefaultAgent, createDefaultScenario } from "../src/shared/schemas.js";
import type { PriceQuote } from "../src/shared/types.js";

describe("capacity engine", () => {
  it.each([4, 8, 16, 25, 32, 64, 65, 128, 256])("builds bounded golden designs for %i cameras", (cameras) => {
    const scenario = createDefaultScenario(cameras);
    const recommendations = buildRecommendations("00000000-0000-4000-8000-000000000001", 1, scenario, HARDWARE_CATALOG, SEED_PRICE_QUOTES);
    expect(recommendations.map((item) => item.policy)).toEqual(["minimum", "recommended", "n_plus_one"]);
    for (const recommendation of recommendations) {
      const limit = recommendation.policy === "minimum" ? 0.85 : 0.70;
      expect(recommendation.primary.allocations.filter((node) => node.role === "active").every((node) =>
        Object.values(node.utilization).every((value) => value <= limit + 1e-8))).toBe(true);
      expect(recommendation.primary.price.quotationRequired).toBe(true);
      expect(recommendation.primary.price.median).toBeGreaterThan(0);
      expect(recommendation.primary.price.componentEstimates).toHaveLength(8);
      expect(recommendation.confidence).toBe("estimated");
    }
    const resilient = recommendations.find((item) => item.policy === "n_plus_one")!;
    expect(resilient.primary.nodeCount).toBe(resilient.primary.activeNodeCount + 1);
    expect(resilient.primary.allocations.filter((node) => node.role === "reserve")).toHaveLength(1);
  });

  it("charges source decode and multiple agents independently", () => {
    const base = createDefaultScenario(8);
    const baseline = calculateScenarioDemand(base).aggregate;
    const extraAgent = createDefaultAgent();
    extraAgent.model = "aiq-3.7-max";
    const heavier = structuredClone(base);
    heavier.cameraGroups[0]!.source.width = 3840;
    heavier.cameraGroups[0]!.source.height = 2160;
    heavier.cameraGroups[0]!.source.sourceFps = 30;
    heavier.cameraGroups[0]!.agents.push(extraAgent);
    const demand = calculateScenarioDemand(heavier).aggregate;
    expect(demand.cpuCores).toBeGreaterThan(baseline.cpuCores);
    expect(demand.ramGb).toBeGreaterThan(baseline.ramGb);
    expect(demand.gpuVramGb).toBeGreaterThan(baseline.gpuVramGb);
    expect(demand.inferenceRequestsPerSecond).toBeGreaterThan(baseline.inferenceRequestsPerSecond);
  });

  it("produces three differentiated priced designs for the reported 24-camera AiQ workload", () => {
    const scenario = createDefaultScenario(24);
    scenario.cameraGroups[0]!.agents[0]!.model = "aiq-3.7";
    const recommendations = buildRecommendations("00000000-0000-4000-8000-000000000024", 1, scenario, HARDWARE_CATALOG, []);
    expect(new Set(recommendations.map((item) => item.primary.hardware.id)).size).toBe(3);
    for (const recommendation of recommendations) {
      const price = recommendation.primary.price;
      expect(price.basis).toBe("reference_estimate");
      expect(price.median).toBeGreaterThan(0);
      expect(price.componentEstimates).toHaveLength(8);
      expect(Math.round(price.componentEstimates.reduce((sum, component) => sum + component.projectAmount, 0) * 100) / 100).toBe(price.median);
      expect(price.sourceUrls.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("does not let legacy retention or RAID settings change compute sizing", () => {
    const baselineScenario = createDefaultScenario(65);
    const legacyStorageScenario = structuredClone(baselineScenario);
    legacyStorageScenario.cameraGroups[0]!.storage = {
      storeVideo: true,
      retentionDays: 3650,
      raidFactor: 3,
    };

    const baselineDemand = calculateScenarioDemand(baselineScenario).aggregate;
    const legacyDemand = calculateScenarioDemand(legacyStorageScenario).aggregate;
    expect(legacyDemand).toEqual(baselineDemand);
    expect(legacyDemand.diskCapacityTb).toBe(0);
    expect(legacyDemand.diskWriteMbps).toBe(0);

    const baseline = buildRecommendations("00000000-0000-4000-8000-000000000001", 1, baselineScenario, HARDWARE_CATALOG, []);
    const legacy = buildRecommendations("00000000-0000-4000-8000-000000000002", 1, legacyStorageScenario, HARDWARE_CATALOG, []);
    expect(legacy.map((item) => [item.primary.hardware.id, item.primary.activeNodeCount, item.primary.bottleneck]))
      .toEqual(baseline.map((item) => [item.primary.hardware.id, item.primary.activeNodeCount, item.primary.bottleneck]));
    expect(legacy.every((item) => !item.primary.bottleneck.startsWith("disk"))).toBe(true);
  });

  it("normalizes legacy and effective local-model behavior", () => {
    const agent = createDefaultAgent();
    agent.model = "aiq-3.7"; agent.inputType = "image"; agent.packaging = "mosaic_3x3"; agent.runEverySeconds = 600;
    const normalized = normalizeAgent(agent);
    expect(normalized.inputType).toBe("video");
    expect(normalized.packaging).toBe("mosaic_2x2");
    expect(normalized.runEverySeconds).toBe(10);
    expect(normalized.normalizedFields.some((field) => field.startsWith("inputType:"))).toBe(true);
    expect(normalized.normalizedFields.some((field) => field.startsWith("packaging:"))).toBe(true);
    expect(normalized.normalizedFields.some((field) => field.startsWith("runEverySeconds:"))).toBe(true);
  });

  it("rejects a vendor constraint that cannot perform requested GPU decode", () => {
    const scenario = createDefaultScenario(8);
    scenario.constraints.preferredGpuVendors = ["amd"];
    expect(() => buildRecommendations("00000000-0000-4000-8000-000000000001", 1, scenario, HARDWARE_CATALOG, [])).toThrow(CapacityError);
  });

  it("does not choose the largest server merely because prices are unavailable", () => {
    const scenario = createDefaultScenario(32);
    const recommendation = buildRecommendations("00000000-0000-4000-8000-000000000001", 1, scenario, HARDWARE_CATALOG, [])[1]!;
    expect(recommendation.primary.hardware.kind).toBe("workstation");
    expect(recommendation.primary.hardware.id).not.toBe("rack-4x-pro6000-dualxeon");
    expect(recommendation.alternatives.some((item) => item.variant === "expansion")).toBe(true);
  });

  it("uses workload rather than a fixed camera threshold to choose workstation or rack hardware", () => {
    const small = buildRecommendations("00000000-0000-4000-8000-000000000001", 1, createDefaultScenario(32), HARDWARE_CATALOG, [])[1]!;
    const heavyScenario = createDefaultScenario(128);
    heavyScenario.cameraGroups[0]!.source.width = 3840;
    heavyScenario.cameraGroups[0]!.source.height = 2160;
    heavyScenario.cameraGroups[0]!.source.sourceFps = 30;
    heavyScenario.cameraGroups[0]!.source.bitrateMbps = 16;
    heavyScenario.cameraGroups[0]!.agents[0]!.model = "aiq-3.7-max";
    heavyScenario.cameraGroups[0]!.agents[0]!.modelFps = 10;
    heavyScenario.cameraGroups[0]!.agents[0]!.packaging = "frame_sequence";
    const large = buildRecommendations("00000000-0000-4000-8000-000000000002", 1, heavyScenario, HARDWARE_CATALOG, [])[1]!;
    expect(small.primary.hardware.kind).toBe("workstation");
    expect(large.primary.hardware.kind).toBe("rack");
    expect(large.primary.hardware.windowsEdition).toContain("Ubuntu Server");
    expect(large.primary.warnings).toContain("ubuntu_target_requires_matching_perceptrum_build_and_benchmark");
  });

  it("removes gross price outliers and reports source confidence", () => {
    const scenario = createDefaultScenario(8);
    const quote = (id: string, seller: string, amount: number): PriceQuote => ({
      id, hardwareTemplateId: "ws-rtx4070tis-7950x", mpn: "EXACT-MPN", seller, market: "BR", currency: "BRL",
      condition: "new", inStock: true, taxIncluded: null, amount, originalAmount: amount, originalCurrency: "BRL",
      exchangeRate: 1, exchangeRateSource: null, url: `https://${seller}.example/product`, observedAt: new Date().toISOString(), sourceKind: "curated",
    });
    const quotes = [quote("00000000-0000-4000-8000-000000000011", "one", 1000), quote("00000000-0000-4000-8000-000000000012", "two", 1100), quote("00000000-0000-4000-8000-000000000013", "three", 100000)];
    const recommendation = buildRecommendations("00000000-0000-4000-8000-000000000001", 1, scenario, HARDWARE_CATALOG, quotes)[0]!;
    expect(recommendation.primary.price.confidence).toBe("medium");
    expect(recommendation.primary.price.basis).toBe("market_quotes");
    expect(recommendation.primary.price.quotationRequired).toBe(false);
    expect(recommendation.primary.price.maximum).toBe(1100);
  });

  it("contains current, previous, and two-generation-back reference designs", () => {
    expect(new Set(HARDWARE_CATALOG.map((item) => item.generation))).toEqual(new Set(["current", "previous", "two_generations_back"]));
  });

  it("considers low-cost laptops for CPU-decode remote-model scenarios", () => {
    const scenario = createDefaultScenario(4);
    scenario.cameraGroups[0]!.decodeMode = "cpu";
    scenario.cameraGroups[0]!.agents[0]!.inputType = "image";
    const recommendations = buildRecommendations("00000000-0000-4000-8000-000000000041", 1, scenario, HARDWARE_CATALOG, []);
    expect(recommendations[0]!.primary.hardware.kind).toBe("laptop");
    expect(recommendations[0]!.primary.price.median).toBeLessThan(recommendations[1]!.primary.price.median!);
  });

  it("sizes the exact user-tested ASUS instead of silently replacing it", () => {
    const scenario = createDefaultScenario(4);
    scenario.cameraGroups[0]!.decodeMode = "cpu";
    scenario.cameraGroups[0]!.agents[0]!.inputType = "image";
    scenario.constraints.operatingSystem = "ubuntu";
    scenario.constraints.infrastructureKind = "laptop";
    scenario.constraints.requiredHardwareTemplateId = "laptop-vivobook-s16-285h-32gb-user";
    const recommendations = buildRecommendations("00000000-0000-4000-8000-000000000042", 1, scenario, HARDWARE_CATALOG, []);
    expect(recommendations.every((item) => item.primary.hardware.id === "laptop-vivobook-s16-285h-32gb-user")).toBe(true);
    expect(recommendations[0]!.primary.maximumAdditionalCameras).toBeGreaterThan(0);
    expect(recommendations[0]!.primary.warnings).toEqual(expect.arrayContaining([
      "laptop_sustained_thermal_and_ac_power_benchmark_required",
      "wired_ethernet_adapter_required_for_production_rtsp",
    ]));
  });

  it("offers distinct Apple Silicon designs only when macOS is explicitly selected", () => {
    const scenario = createDefaultScenario(4);
    scenario.cameraGroups[0]!.decodeMode = "cpu";
    scenario.cameraGroups[0]!.agents[0]!.inputType = "image";
    scenario.constraints.operatingSystem = "macos";
    const recommendations = buildRecommendations("00000000-0000-4000-8000-000000000043", 1, scenario, HARDWARE_CATALOG, []);
    expect(recommendations.every((item) => item.primary.hardware.operatingSystemFamily === "macos")).toBe(true);
    expect(new Set(recommendations.map((item) => item.primary.hardware.id)).size).toBe(3);
    expect(recommendations.every((item) => item.primary.warnings.includes("macos_perceptrum_port_and_matching_benchmark_required"))).toBe(true);
  });
});
