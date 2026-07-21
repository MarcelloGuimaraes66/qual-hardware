import { describe, expect, it } from "vitest";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import { deriveComponentCatalog } from "../src/engine/componentCatalog.js";
import { componentTechnicalSpecificationFromObservations, fieldDefinitionsForKind, specificationCoverage, withTechnicalSpecification } from "../src/engine/technicalSpecifications.js";
import { createDefaultScenario, componentTechnicalSpecificationSchema, procurementNeutralSpecificationSchema } from "../src/shared/schemas.js";
import { MANUFACTURER_SPECIFICATION_OBSERVATION_VERSION } from "../src/shared/types.js";
import type { HardwareComponent, ManufacturerSpecificationObservation, ScenarioRecord } from "../src/shared/types.js";
import { createApp } from "../src/server/app.js";
import { extractManufacturerSpecificationObservations } from "../src/server/manufacturerSpecificationParsers.js";
import { MemoryPlannerStore } from "../src/server/store.js";
import { BUNDLED_SOURCE_REGISTRY } from "../src/engine/sourceRegistry.js";

describe("technical component specifications v9", () => {
  it("normalizes every derived component without inventing missing manufacturer facts", () => {
    const components = deriveComponentCatalog(HARDWARE_CATALOG).components;
    expect(components.length).toBeGreaterThan(200);
    expect(components.every((component) => component.technicalSpecification?.schemaVersion === "qual-hardware-component-technical-specification/2.0.0")).toBe(true);
    expect(components.every((component) => component.technicalSpecification!.fields.every((field) => field.value !== 0 || field.status !== "not_published"))).toBe(true);
    const coverage = specificationCoverage(components);
    expect(coverage.componentCount).toBe(components.length);
    expect(coverage.procurementReadyCount).toBe(3);
    const ready = components.filter((component) => component.technicalSpecification?.completeness.procurementReady).map((component) => component.canonicalMpn);
    expect(ready).toEqual(expect.arrayContaining(["Intel Core Ultra 9 285K (24 cores / 24 threads)", "AMD Ryzen 9 9950X", "NVIDIA GeForce RTX 5090 32 GB"]));
    expect(coverage.byKind.some((entry) => entry.missingFieldCodes.length > 0)).toBe(true);
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
    const generatedAt = "2026-07-21T00:00:00.000Z";
    const observations: ManufacturerSpecificationObservation[] = definitions.map((definition, index) => ({
      schemaVersion: MANUFACTURER_SPECIFICATION_OBSERVATION_VERSION,
      id: `official-${definition.code}`,
      componentId: component.id,
      manufacturer: component.manufacturer,
      canonicalMpn: component.canonicalMpn!,
      scope: "sku",
      subject: component.canonicalMpn!,
      fieldCode: definition.code,
      sectionCode: "fixture",
      sectionLabelPt: "Especificações oficiais",
      displayOrder: index,
      valueType: definition.valueType,
      originalLabel: definition.labelPt,
      originalValue: specifications[definition.code]!,
      originalUnit: definition.unit,
      normalizedValue: specifications[definition.code]!,
      normalizedUnit: definition.unit,
      authority: "official_sku",
      sourceId: "fixture-official",
      sourceUrl: "https://manufacturer.example/specs/official-64",
      retrievedAt: generatedAt,
      evidenceLocator: `fixture:${definition.code}`,
      rawArtifactSha256: "a".repeat(64),
      parserId: "fixture-parser",
      parserVersion: "1.0.0",
      licensePolicy: "Fixture metadata",
    }));
    const specification = componentTechnicalSpecificationFromObservations(component, observations, generatedAt);
    expect(specification.completeness.complete).toBe(true);
    expect(specification.completeness.procurementReady).toBe(true);
    expect(componentTechnicalSpecificationSchema.parse(specification)).toBeTruthy();
  });

  it("parses official Intel ARK rows deterministically at field level", () => {
    const source = BUNDLED_SOURCE_REGISTRY.sources.find((item) => item.id === "spec-intel-ark")!;
    const html = `<div class="row tech-section-row"><div class="col-6 tech-label"><span>Total Cores</span></div><div class="col-6 tech-data"><span>24</span></div></div>
      <div class="row tech-section-row"><div class="col-6 tech-label"><span>Max Turbo Frequency</span></div><div class="col-6 tech-data"><span>5.70 GHz</span></div></div>
      <div class="row tech-section-row"><div class="col-6 tech-label"><span>Max Memory Size (dependent on memory type)</span></div><div class="col-6 tech-data"><span>256 GB</span></div></div>`;
    const observations = extractManufacturerSpecificationObservations(source, source.primaryUrl, "text/html", html, "2026-07-21T00:00:00.000Z");
    expect(observations.map((item) => [item.payload.fieldCode, item.payload.normalizedValue])).toEqual([
      ["physical_cores", 24], ["max_clock_ghz", 5.7], ["maximum_memory_gb", 256],
    ]);
  });

  it("parses the official AMD 9950X definition list without approximating the SKU", () => {
    const source = BUNDLED_SOURCE_REGISTRY.sources.find((item) => item.id === "spec-amd-products")!;
    const html = `<dl><dt>Processor Architecture</dt><dd>Zen 5</dd>
      <dt># of CPU Cores</dt><dd>16</dd><dt># of Threads</dt><dd>32</dd>
      <dt>System Memory Type</dt><dd>DDR5</dd><dt>ECC Support</dt><dd>Yes</dd>
      <dt>PCI Express® Version</dt><dd>PCIe® 5.0</dd></dl>`;
    const observations = extractManufacturerSpecificationObservations(source, source.primaryUrl, "text/html", html, "2026-07-21T00:00:00.000Z");
    expect(observations.map((item) => [item.payload.fieldCode, item.payload.normalizedValue])).toEqual([
      ["architecture", "Zen 5"], ["physical_cores", 16], ["threads", 32], ["memory_type", "DDR5"], ["ecc_support", true], ["pcie_generation", 5],
    ]);
  });

  it("extracts NVIDIA codec and operating-system support only from explicit official text", () => {
    const source = BUNDLED_SOURCE_REGISTRY.sources.find((item) => item.id === "spec-nvidia-products")!;
    const url = "https://developer.nvidia.com/video-codec-sdk";
    const html = `<p id="ii4h1">NVENC provides video encoding for H.264, HEVC (H.265) and AV1 codecs.</p>
      <p id="inzs5x">NVDEC supports hardware-accelerated decoding on Windows and Linux platforms: MPEG-2, VC-1, H.264, H.265 (HEVC), VP8, VP9, and AV1.</p>`;
    const observations = extractManufacturerSpecificationObservations(source, url, "text/html", html, "2026-07-21T00:00:00.000Z");
    expect(observations.map((item) => [item.payload.fieldCode, item.payload.normalizedValue])).toEqual(expect.arrayContaining([
      ["video_encode", "H.264; H.265 (HEVC); AV1"],
      ["video_decode", "MPEG-2; VC-1; H.264; H.265 (HEVC); VP8; VP9; AV1"],
      ["supported_operating_systems", "Windows; Linux"],
    ]));
  });

  it("preserves same-authority disagreements as conflicts instead of choosing a value", () => {
    const component = deriveComponentCatalog(HARDWARE_CATALOG).components.find((item) => item.canonicalMpn?.includes("285K"))!;
    const base: ManufacturerSpecificationObservation = {
      schemaVersion: MANUFACTURER_SPECIFICATION_OBSERVATION_VERSION,
      id: "memory-a", componentId: component.id, manufacturer: "Intel", canonicalMpn: "Intel Core Ultra 9 285K",
      scope: "sku", subject: "Intel Core Ultra 9 285K", fieldCode: "maximum_memory_gb", sectionCode: "memory",
      sectionLabelPt: "Memória", displayOrder: 1, valueType: "number", originalLabel: "Max Memory Size", originalValue: "256 GB",
      originalUnit: null, normalizedValue: 256, normalizedUnit: "GB", authority: "official_sku", sourceId: "intel-page-a",
      sourceUrl: "https://intel.example/a", retrievedAt: "2026-07-21T00:00:00.000Z", evidenceLocator: "table:a",
      rawArtifactSha256: "a".repeat(64), parserId: "fixture", parserVersion: "1", licensePolicy: "fixture",
    };
    const specification = componentTechnicalSpecificationFromObservations(component, [base, {
      ...base, id: "memory-b", sourceId: "intel-page-b", sourceUrl: "https://intel.example/b", normalizedValue: 192,
      originalValue: "192 GB", rawArtifactSha256: "b".repeat(64),
    }]);
    const field = specification.fields.find((item) => item.code === "maximum_memory_gb")!;
    expect(field.status).toBe("conflicting");
    expect(field.value).toBeNull();
    expect(specification.completeness.procurementReady).toBe(false);
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
    expect(coverage.procurementReadyCount).toBe(3);
  });
});
