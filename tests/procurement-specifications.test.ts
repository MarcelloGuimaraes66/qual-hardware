import { describe, expect, it } from "vitest";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import { deriveComponentCatalog } from "../src/engine/componentCatalog.js";
import { fieldDefinitionsForKind, specificationCoverage, withTechnicalSpecification } from "../src/engine/technicalSpecifications.js";
import { createDefaultScenario, componentTechnicalSpecificationSchema, procurementNeutralSpecificationSchema } from "../src/shared/schemas.js";
import type { HardwareComponent, ScenarioRecord } from "../src/shared/types.js";
import { createApp } from "../src/server/app.js";
import { MemoryPlannerStore } from "../src/server/store.js";

describe("technical component specifications v8", () => {
  it("normalizes every derived component without inventing missing manufacturer facts", () => {
    const components = deriveComponentCatalog(HARDWARE_CATALOG).components;
    expect(components.length).toBeGreaterThan(200);
    expect(components.every((component) => component.technicalSpecification?.schemaVersion === "qual-hardware-component-technical-specification/1.0.0")).toBe(true);
    expect(components.every((component) => component.technicalSpecification!.fields.every((field) => field.value !== 0 || field.status !== "not_published"))).toBe(true);
    const coverage = specificationCoverage(components);
    expect(coverage.componentCount).toBe(components.length);
    expect(coverage.procurementReadyCount).toBe(0);
    expect(coverage.byKind.every((entry) => entry.missingFieldCodes.length > 0)).toBe(true);
  });

  it("qualifies a component only when every required field has official evidence", () => {
    const definitions = fieldDefinitionsForKind("cpu");
    const specifications = Object.fromEntries(definitions.map((definition) => [
      definition.code,
      definition.valueType === "number" ? 64 : definition.valueType === "boolean" ? true : "official-supported-value",
    ]));
    const component: HardwareComponent = {
      id: "cpu:fixture:official-64",
      kind: "cpu",
      manufacturer: "Fixture Manufacturer",
      sku: "OFFICIAL-64",
      canonicalMpn: "OFFICIAL-64",
      architecture: "official-supported-value",
      specifications,
      sourceUrls: ["https://manufacturer.example/specs/official-64"],
      specificationVersion: "fixture-1",
      evidence: [{
        sourceId: "fixture-official",
        url: "https://manufacturer.example/specs/official-64",
        retrievedAt: "2026-07-21T00:00:00.000Z",
        evidenceLocator: "fixture:table[0]",
        rawArtifactSha256: "a".repeat(64),
        licensePolicy: "Fixture metadata",
      }],
    };
    const enriched = withTechnicalSpecification(component, "2026-07-21T00:00:00.000Z");
    expect(enriched.technicalSpecification?.completeness.complete).toBe(true);
    expect(enriched.technicalSpecification?.completeness.procurementReady).toBe(true);
    expect(componentTechnicalSpecificationSchema.parse(enriched.technicalSpecification)).toBeTruthy();
  });

  it("rejects ambiguous numeric source text instead of concatenating separate values", () => {
    const component: HardwareComponent = {
      id: "cpu:fixture:ambiguous-number",
      kind: "cpu",
      manufacturer: "Fixture Manufacturer",
      sku: "AMBIGUOUS-NUMBER",
      architecture: "fixture",
      specifications: { physicalCores: "14 cores / 20 threads" },
      sourceUrls: ["https://manufacturer.example/specs/ambiguous-number"],
      evidence: [{
        sourceId: "fixture-official",
        url: "https://manufacturer.example/specs/ambiguous-number",
        retrievedAt: "2026-07-21T00:00:00.000Z",
        evidenceLocator: "fixture:table[0]",
        rawArtifactSha256: "b".repeat(64),
        licensePolicy: "Fixture metadata",
      }],
    };
    const specification = withTechnicalSpecification(component).technicalSpecification!;
    const cores = specification.fields.find((field) => field.code === "physical_cores")!;
    expect(cores.value).toBeNull();
    expect(cores.status).toBe("not_published");
    expect(specification.completeness.procurementReady).toBe(false);
  });

  it("generates neutral requirements for every unique option and keeps commercial identifiers out", async () => {
    const store = new MemoryPlannerStore();
    const app = createApp(store);
    const scenario = createDefaultScenario(16);
    const created = await (await app.request("/api/scenarios", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario }),
    })).json() as ScenarioRecord;
    const recommendations = await (await app.request(`/api/scenarios/${created.id}/recommendations`, { method: "POST" })).json() as Array<{
      primary: { procurementNeutralSpecification?: unknown };
      alternatives: Array<{ procurementNeutralSpecification?: unknown }>;
    }>;
    const specifications = recommendations.flatMap((recommendation) => [recommendation.primary, ...recommendation.alternatives])
      .map((option) => option.procurementNeutralSpecification).filter(Boolean)
      .map((value) => procurementNeutralSpecificationSchema.parse(value));
    expect(specifications.length).toBeGreaterThanOrEqual(18);
    expect(specifications.every((specification) => specification.status === "blocked")).toBe(true);
    expect(specifications.every((specification) => specification.forbiddenIdentifierFindings.length === 0)).toBe(true);
    const neutralText = JSON.stringify(specifications.map((specification) => specification.requirements)).toLowerCase();
    for (const forbidden of ["intel", "nvidia", "amd ryzen", "apple m4", "asus", "dell", "lenovo", "supermicro"]) {
      expect(new RegExp(`(^|[^a-z0-9])${forbidden.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(neutralText)).toBe(false);
    }
  });

  it("exposes field-level specifications and aggregate coverage through additive APIs", async () => {
    const store = new MemoryPlannerStore();
    const app = createApp(store);
    const components = await (await app.request("/api/catalog/components")).json() as HardwareComponent[];
    const detail = await app.request(`/api/catalog/components/${encodeURIComponent(components[0]!.id)}/specifications`);
    expect(detail.status).toBe(200);
    expect(componentTechnicalSpecificationSchema.parse(await detail.json()).componentId).toBe(components[0]!.id);
    const history = await app.request(`/api/catalog/components/${encodeURIComponent(components[0]!.id)}/specifications/history`);
    expect(history.status).toBe(200);
    expect((await history.json() as unknown[])).toHaveLength(1);
    const coverage = await (await app.request("/api/catalog/specifications/coverage")).json() as { componentCount: number; procurementReadyCount: number };
    expect(coverage.componentCount).toBe(components.length);
    expect(coverage.procurementReadyCount).toBe(0);
  });
});
