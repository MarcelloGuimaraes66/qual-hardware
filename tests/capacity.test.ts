import { describe, expect, it } from "vitest";
import { buildRecommendations, calculateScenarioDemand, CapacityError, normalizeAgent } from "../src/engine/capacity.js";
import { HARDWARE_CATALOG, SEED_PRICE_QUOTES } from "../src/engine/catalog.js";
import { buildCalibrationWorkloadProfile } from "../src/engine/calibrationProfile.js";
import { capacityScenarioSchema, createDefaultAgent, createDefaultScenario } from "../src/shared/schemas.js";
import { CAPACITY_PREDICTION_VERSION, type CapacityPrediction, type PriceQuote } from "../src/shared/types.js";

describe("capacity engine", () => {
  it("defaults platform fields that are absent from legacy saved scenarios", () => {
    const current = createDefaultScenario(8);
    const legacyConstraints = Object.fromEntries(Object.entries(current.constraints).filter(([key]) =>
      key !== "operatingSystem" && key !== "requiredHardwareTemplateId"));
    const legacy = { ...current, constraints: legacyConstraints };
    const parsed = capacityScenarioSchema.parse(legacy);
    expect(parsed.constraints.operatingSystem).toBe("auto");
    expect(parsed.constraints.requiredHardwareTemplateId).toBeNull();
  });

  it.each([4, 8, 16, 25, 32, 64, 65, 128, 256])("builds bounded golden designs for %i cameras", (cameras) => {
    const scenario = createDefaultScenario(cameras);
    const recommendations = buildRecommendations("00000000-0000-4000-8000-000000000001", 1, scenario, HARDWARE_CATALOG, SEED_PRICE_QUOTES);
    expect(recommendations.map((item) => item.policy)).toEqual(["minimum", "recommended", "n_plus_one"]);
    for (const recommendation of recommendations) {
      const limit = recommendation.policy === "minimum" ? 0.80 : 0.60;
      expect(recommendation.primary.allocations.filter((node) => node.role === "active").every((node) =>
        Object.values(node.utilization).every((value) => value <= limit + 1e-8))).toBe(true);
      expect(recommendation.primary.price.quotationRequired).toBe(true);
      expect(recommendation.primary.price.median).toBeGreaterThan(0);
      expect(recommendation.primary.price.componentEstimates).toHaveLength(8);
      expect(recommendation.confidence).toBe("reference_only");
    }
    const resilient = recommendations.find((item) => item.policy === "n_plus_one")!;
    expect(resilient.primary.nodeCount).toBe(resilient.primary.activeNodeCount + 1);
    expect(resilient.primary.allocations.filter((node) => node.role === "reserve")).toHaveLength(1);
    const recommended = recommendations.find((item) => item.policy === "recommended")!;
    expect(recommended.primary.allocations.filter((node) => node.role === "reserve")).toHaveLength(cameras >= 64 ? 1 : 0);
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

  it("preserves legacy storage semantics and enables full-pipeline disk sizing only in v2", () => {
    const baselineScenario = createDefaultScenario(65);
    const legacyStorageScenario = structuredClone(baselineScenario);
    baselineScenario.workloadContractVersion = "perceptrum-workload/1.1.0";
    legacyStorageScenario.workloadContractVersion = "perceptrum-workload/1.1.0";
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

    const current = createDefaultScenario(65);
    const retained = structuredClone(current);
    retained.cameraGroups[0]!.storage = { storeVideo: true, retentionDays: 30, raidFactor: 2 };
    expect(calculateScenarioDemand(current).aggregate.diskWriteMbps).toBeGreaterThan(0);
    expect(calculateScenarioDemand(retained).aggregate.diskCapacityTb)
      .toBeGreaterThan(calculateScenarioDemand(current).aggregate.diskCapacityTb);
  });

  it("normalizes legacy and effective local-model behavior", () => {
    const agent = createDefaultAgent();
    agent.model = "aiq-3.7"; agent.inputType = "image"; agent.packaging = "mosaic_3x3"; agent.runEverySeconds = 600;
    const normalized = normalizeAgent(agent);
    expect(normalized.inputType).toBe("video");
    expect(normalized.packaging).toBe("mosaic_2x2");
    expect(normalized.modelFps).toBe(1);
    expect(normalized.runEverySeconds).toBe(60);
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
    expect(recommendation.alternatives.every((item) => item.variant === "cost_ordered")).toBe(true);
    expect([recommendation.primary, ...recommendation.alternatives].length).toBeGreaterThanOrEqual(6);
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
    const stale = quote("00000000-0000-4000-8000-000000000010", "stale", 1);
    stale.observedAt = "2020-01-01T00:00:00.000Z";
    const quotes = [stale, quote("00000000-0000-4000-8000-000000000011", "one", 1000), quote("00000000-0000-4000-8000-000000000012", "two", 1100), quote("00000000-0000-4000-8000-000000000013", "three", 100000)];
    const recommendation = buildRecommendations("00000000-0000-4000-8000-000000000001", 1, scenario, HARDWARE_CATALOG, quotes)[0]!;
    expect(recommendation.primary.price.confidence).toBe("medium");
    expect(recommendation.primary.price.basis).toBe("market_quotes");
    expect(recommendation.primary.price.quotationRequired).toBe(false);
    expect(recommendation.primary.price.staleQuoteCount).toBe(1);
    expect(recommendation.primary.price.minimum).toBe(1000 * recommendation.primary.nodeCount);
    expect(recommendation.primary.price.maximum).toBe(1100 * recommendation.primary.nodeCount);
    expect(Math.round(recommendation.primary.price.componentEstimates.reduce((sum, component) =>
      sum + component.projectAmount, 0) * 100) / 100).toBe(recommendation.primary.price.median);
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
    expect(recommendations[0]!.primary.maximumAdditionalCameras).toBe(0);
    expect(recommendations[0]!.primary.procurementEligibility).toBe("blocked");
    expect(recommendations[0]!.primary.warnings).toEqual(expect.arrayContaining([
      "laptop_sustained_thermal_and_ac_power_benchmark_required",
      "wired_ethernet_adapter_required_for_production_rtsp",
    ]));
  });

  it("uses only the capacity prediction for the scenario's exact workload profile and build", () => {
    const scenario = createDefaultScenario(4);
    const baseline = buildRecommendations("00000000-0000-4000-8000-000000000051", 1, scenario, HARDWARE_CATALOG, [])[0]!;
    scenario.constraints.requiredHardwareTemplateId = baseline.primary.hardware.id;
    const profileId = buildCalibrationWorkloadProfile(scenario).id;
    const prediction = (id: string, workloadProfileId: string, safeCameraMaximum: number): CapacityPrediction => ({
      schemaVersion: CAPACITY_PREDICTION_VERSION,
      id,
      hardwareTemplateId: baseline.primary.hardware.id,
      workloadProfileId,
      targetBuildHash: scenario.perceptrumBuildHash,
      kernelVersion: "qual-hardware-calibration-kernel/1.0.0",
      runtimeManifestHash: "a".repeat(64),
      generatedAt: new Date().toISOString(),
      status: "validated_local",
      procurementEligibility: "eligible",
      confidenceClass: "A",
      safeCameraMinimum: safeCameraMaximum,
      safeCameraMaximum,
      bottleneck: "local_inference",
      reservePercent: 20,
      exactCalibrationRunId: "00000000-0000-4000-8000-000000000052",
      stagePredictions: [],
      leaveOneOutUnsafeOverestimateCount: 0,
      reasons: [],
    });
    const wrong = prediction("00000000-0000-4000-8000-000000000053", "workload:wrong", 1);
    const exact = prediction("00000000-0000-4000-8000-000000000054", profileId, 256);
    const recommendations = buildRecommendations("00000000-0000-4000-8000-000000000055", 1, scenario, HARDWARE_CATALOG, [], false, undefined, [wrong, exact]);
    expect(recommendations.every((item) => item.primary.calibration?.id === exact.id)).toBe(true);
  });

  it("prioritizes an exactly tested compatible machine over a cheaper extrapolated alternative", () => {
    const scenario = createDefaultScenario(4);
    const workloadProfileId = buildCalibrationWorkloadProfile(scenario).id;
    const prediction = (id: string, hardwareTemplateId: string, status: "validated_local" | "extrapolated_high"): CapacityPrediction => ({
      schemaVersion: CAPACITY_PREDICTION_VERSION,
      id, hardwareTemplateId, workloadProfileId, targetBuildHash: scenario.perceptrumBuildHash,
      kernelVersion: "qual-hardware-calibration-kernel/1.0.0", runtimeManifestHash: "a".repeat(64),
      generatedAt: new Date().toISOString(), status, procurementEligibility: "eligible", confidenceClass: "A",
      safeCameraMinimum: 4, safeCameraMaximum: 256, bottleneck: "local_inference", reservePercent: 20,
      exactCalibrationRunId: status === "validated_local" ? "00000000-0000-4000-8000-000000000070" : null,
      stagePredictions: [], leaveOneOutUnsafeOverestimateCount: 0, reasons: [],
    });
    const exactHardwareId = "hp-z8-g5-dualxeon-2xrtx6000ada";
    const cheaperHardwareId = "ws-rtx4070tis-7950x";
    const recommendations = buildRecommendations(
      "00000000-0000-4000-8000-000000000071", 1, scenario,
      HARDWARE_CATALOG.filter((item) => item.id === exactHardwareId || item.id === cheaperHardwareId),
      [], false, undefined, [
        prediction("00000000-0000-4000-8000-000000000072", exactHardwareId, "validated_local"),
        prediction("00000000-0000-4000-8000-000000000073", cheaperHardwareId, "extrapolated_high"),
      ],
    );
    expect(recommendations.every((item) => item.primary.hardware.id === exactHardwareId)).toBe(true);
    expect(recommendations.every((item) => item.primary.calibration?.status === "validated_local")).toBe(true);
  });

  it("does not multiply a per-machine calibration into commercial cluster approval", () => {
    const scenario = createDefaultScenario(64);
    const baseline = buildRecommendations("00000000-0000-4000-8000-000000000061", 1, scenario, HARDWARE_CATALOG, [])[0]!;
    scenario.constraints.requiredHardwareTemplateId = baseline.primary.hardware.id;
    const profileId = buildCalibrationWorkloadProfile(scenario).id;
    const exact: CapacityPrediction = {
      schemaVersion: CAPACITY_PREDICTION_VERSION,
      id: "00000000-0000-4000-8000-000000000062",
      hardwareTemplateId: baseline.primary.hardware.id,
      workloadProfileId: profileId,
      targetBuildHash: scenario.perceptrumBuildHash,
      kernelVersion: "qual-hardware-calibration-kernel/1.0.0",
      runtimeManifestHash: "a".repeat(64),
      generatedAt: new Date().toISOString(),
      status: "validated_local",
      procurementEligibility: "eligible",
      confidenceClass: "A",
      safeCameraMinimum: 64,
      safeCameraMaximum: 4_096,
      bottleneck: "local_inference",
      reservePercent: 20,
      exactCalibrationRunId: "00000000-0000-4000-8000-000000000063",
      stagePredictions: [],
      leaveOneOutUnsafeOverestimateCount: 0,
      reasons: [],
    };
    const recommendations = buildRecommendations(
      "00000000-0000-4000-8000-000000000064", 1, scenario, HARDWARE_CATALOG, [], false, undefined, [exact],
    );
    const multiNode = recommendations.flatMap((item) => [item.primary, ...item.alternatives])
      .filter((item) => item.nodeCount > 1);
    expect(multiNode.length).toBeGreaterThan(0);
    expect(multiNode.every((item) => item.procurementEligibility === "planning_only")).toBe(true);
    expect(multiNode.every((item) => item.warnings.includes("multi_node_design_is_planning_only_until_cluster_validation"))).toBe(true);
  });

  it("offers distinct Apple Silicon designs only when macOS is explicitly selected", () => {
    const scenario = createDefaultScenario(4);
    scenario.cameraGroups[0]!.decodeMode = "cpu";
    scenario.cameraGroups[0]!.agents[0]!.inputType = "image";
    scenario.constraints.operatingSystem = "macos";
    const recommendations = buildRecommendations("00000000-0000-4000-8000-000000000043", 1, scenario, HARDWARE_CATALOG, []);
    expect(recommendations.every((item) => item.primary.hardware.operatingSystemFamily === "macos")).toBe(true);
    expect(new Set(recommendations.map((item) => item.primary.hardware.id)).size).toBe(3);
    expect(recommendations.every((item) => item.primary.warnings.includes("macos_local_aiq_and_cpu_rtsp_path_require_matching_calibration"))).toBe(true);
  });
});
