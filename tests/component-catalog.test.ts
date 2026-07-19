import { describe, expect, it } from "vitest";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import { buildHistoricalComponentBuilds, deriveComponentCatalog, validateBuildCompatibility } from "../src/engine/componentCatalog.js";
import { isPublicObservationEligible } from "../src/engine/evidence.js";
import { createApp } from "../src/server/app.js";
import { MemoryPlannerStore } from "../src/server/store.js";
import type { PublicBenchmarkObservation } from "../src/shared/types.js";

function observation(name: string, stage: PublicBenchmarkObservation["stage"]): PublicBenchmarkObservation {
  return {
    schemaVersion: "qual-hardware-benchmark-observation/2.0.0",
    id: `${name}:${stage}`,
    hardwareTemplateId: HARDWARE_CATALOG[0]!.id,
    stage,
    profileId: `${name}-profile`,
    benchmarkName: name,
    benchmarkVersion: "1.0",
    score: 100,
    unit: "items/s",
    higherIsBetter: true,
    sourceTier: 1,
    sourceUrl: "https://example.com/evidence",
    observedAt: "2026-07-19T00:00:00.000Z",
    operatingSystem: "any",
    configuration: "Exact public configuration with driver, power, memory and sustained cooling disclosed.",
    benchmarkSuiteId: `${name}-suite`,
    metricName: "throughput",
    aggregation: "rate",
    evidenceLocator: "fixture:row:1",
    rawArtifactSha256: "a".repeat(64),
    licensePolicy: "Fixture derived from redistributable public metadata.",
    reproducible: true,
  };
}

describe("component catalog v7", () => {
  it("derives a complete BOM inventory from every preserved historical machine", () => {
    const derived = deriveComponentCatalog(HARDWARE_CATALOG);
    expect(derived.components.length).toBeGreaterThan(100);
    expect(new Set(derived.components.map((item) => item.id)).size).toBe(derived.components.length);
    for (const kind of ["cpu", "gpu", "motherboard", "memory_kit", "storage_os", "storage_retention", "nic", "psu", "cooling", "chassis", "oem_system"]) {
      expect(derived.components.some((item) => item.kind === kind)).toBe(true);
    }
    expect(derived.components.every((item) => item.inventoryState === "discovered_inventory")).toBe(true);
  });

  it("keeps Blender secondary and only accepts comparable AiQ/Qwen inference evidence", () => {
    expect(isPublicObservationEligible(observation("Blender Open Data", "local_inference"))).toBe(false);
    expect(isPublicObservationEligible(observation("MLPerf Qwen AiQ inference", "local_inference"))).toBe(true);
  });

  it("builds auditable but purchase-blocked BOMs without three physical anchors", () => {
    const derived = deriveComponentCatalog(HARDWARE_CATALOG);
    const builds = buildHistoricalComponentBuilds(HARDWARE_CATALOG, derived.components, [], [])
      .map((build) => validateBuildCompatibility(build, derived.components));
    expect(builds).toHaveLength(HARDWARE_CATALOG.length);
    expect(builds.every((build) => build.items.length >= 11)).toBe(true);
    expect(builds.every((build) => build.compatibility.some((decision) => decision.code === "socket_evidence_missing"))).toBe(true);
    expect(builds.every((build) => build.compatibility.some((decision) => decision.compatible === false))).toBe(true);
    expect(builds.every((build) => build.procurementGate.eligibility === "blocked")).toBe(true);
    expect(builds.every((build) => build.coverage.coveredStageCount === 0)).toBe(true);
  });

  it("exposes component inventory, builds and coverage through additive APIs", async () => {
    const store = new MemoryPlannerStore();
    const app = createApp(store);
    const components = await (await app.request("/api/catalog/components")).json() as unknown[];
    expect(components.length).toBeGreaterThan(100);
    const builds = await (await app.request("/api/catalog/builds")).json() as Array<{ id: string }>;
    expect(builds).toHaveLength(HARDWARE_CATALOG.length);
    const build = await app.request(`/api/catalog/builds/${encodeURIComponent(builds[0]!.id)}`);
    expect(build.status).toBe(200);
    const coverage = await (await app.request("/api/evidence/coverage")).json() as { procurementEligibleBuildCount: number; buildCount: number };
    expect(coverage.buildCount).toBe(HARDWARE_CATALOG.length);
    expect(coverage.procurementEligibleBuildCount).toBe(0);
  });
});
