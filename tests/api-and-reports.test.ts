import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createDefaultScenario } from "../src/shared/schemas.js";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import type { BenchmarkManifest, CapacityRecommendation, HardwareNodeTemplate, ScenarioRecord } from "../src/shared/types.js";
import { WORKLOAD_CONTRACT_VERSION } from "../src/shared/types.js";
import { createApp } from "../src/server/app.js";
import { MemoryPlannerStore } from "../src/server/store.js";

describe("Qual Hardware API and reports", () => {
  it("creates, revises, calculates and exports a scenario", async () => {
    const store = new MemoryPlannerStore();
    const app = createApp(store);
    const health = await app.request("/api/health");
    expect(await health.json()).toEqual({ status: "ok", storage: "memory" });
    const catalogStatus = await app.request("/api/catalog/status");
    expect(catalogStatus.status).toBe(200);
    expect((await catalogStatus.json() as { catalogVersion: string }).catalogVersion).toMatch(/^hardware-reference\//);
    const hardwareCatalog = await (await app.request("/api/catalog/hardware")).json() as HardwareNodeTemplate[];
    expect(hardwareCatalog).toHaveLength(HARDWARE_CATALOG.length);
    expect(hardwareCatalog.some((item) => item.id === "laptop-vivobook-s16-285h-32gb-user")).toBe(true);
    expect(hardwareCatalog.filter((item) => item.operatingSystemFamily === "macos")).toHaveLength(5);
    expect(hardwareCatalog.filter((item) => item.cpuVendor === "intel").length).toBeGreaterThanOrEqual(10);
    const scenario = createDefaultScenario(16);
    const createdResponse = await app.request("/api/scenarios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario }) });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as ScenarioRecord;

    const conflict = await app.request(`/api/scenarios/${created.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 99, scenario }) });
    expect(conflict.status).toBe(409);

    const calculated = await app.request(`/api/scenarios/${created.id}/recommendations`, { method: "POST" });
    expect(calculated.status).toBe(201);
    const recommendations = await calculated.json() as CapacityRecommendation[];
    expect(recommendations).toHaveLength(3);
    expect(recommendations.every((item) => item.evidence.some((entry) => entry.startsWith("catalog-version:")))).toBe(true);
    expect(new Set(recommendations.map((item) => item.primary.hardware.id)).size).toBe(3);
    expect(recommendations.every((item) => item.primary.price.median !== null && item.primary.price.componentEstimates.length > 0)).toBe(true);

    const duplicateResponse = await app.request(`/api/scenarios/${created.id}/duplicate`, { method: "POST" });
    const duplicate = await duplicateResponse.json() as ScenarioRecord;
    const comparison = await app.request("/api/scenarios/compare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenarioIds: [created.id, duplicate.id] }) });
    expect(comparison.status).toBe(200);
    expect((await comparison.json() as { comparisons: unknown[] }).comparisons).toHaveLength(2);

    const recommendation = recommendations[1]!;
    const json = await app.request(`/api/recommendations/${recommendation.id}/export/json`);
    expect(json.status).toBe(200);
    expect(json.headers.get("content-type")).toContain("application/json");
    expect(json.headers.get("content-disposition")).toBe('attachment; filename="qual-hardware-3-configuracoes.json"');
    const jsonReport = await json.json() as { schemaVersion: string; recommendations: CapacityRecommendation[]; executiveNarrative: { paragraphs: string[] }; qualifiedOptions: unknown[] };
    expect(jsonReport.schemaVersion).toBe("capacity-recommendation-export/2.3.0");
    expect(jsonReport.recommendations.map((item) => item.policy)).toEqual(["minimum", "recommended", "n_plus_one"]);
    expect(jsonReport.executiveNarrative.paragraphs.join(" ")).toContain("FPS de leitura RTSP");
    expect(jsonReport.executiveNarrative.paragraphs.join(" ")).toContain("AiQ/Qwen local");
    expect(jsonReport.qualifiedOptions.length).toBeGreaterThanOrEqual(6);

    const pdf = await app.request(`/api/recommendations/${recommendation.id}/export/pdf`);
    const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe("%PDF-");
    expect((await PDFDocument.load(pdfBytes)).getPageCount()).toBeGreaterThanOrEqual(4);

    const spreadsheet = await app.request(`/api/recommendations/${recommendation.id}/export/xlsx`);
    expect(spreadsheet.status).toBe(200);
    expect(spreadsheet.headers.get("content-type")).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const spreadsheetBytes = new Uint8Array(await spreadsheet.arrayBuffer());
    expect(Array.from(spreadsheetBytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(spreadsheetBytes.buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Executive Summary", "Scenario", "3 Configurations", "Qualified Options", "BOM", "Nodes", "Workload", "Calculations", "Quotes", "Assumptions"]);
    expect(workbook.getWorksheet("Executive Summary")!.getCell("B2").value).toContain("RTSP");
    const configurations = workbook.getWorksheet("3 Configurations")!;
    expect(configurations.rowCount).toBe(4);
    expect([2, 3, 4].map((row) => configurations.getRow(row).getCell(1).value)).toEqual(["minimum", "recommended", "n_plus_one"]);
    const bom = workbook.getWorksheet("BOM")!;
    expect(bom.rowCount).toBe(34);
    expect(new Set(bom.getColumn(1).values.slice(2).map(String))).toEqual(new Set(["minimum", "recommended", "n_plus_one"]));
    const bomHeaders = (bom.getRow(1).values as unknown[]).map(String);
    expect(bomHeaders).toEqual(expect.arrayContaining(["currency", "unitCost", "perNodeCost", "projectCost", "priceBasis"]));
    expect(bom.getColumn(bomHeaders.indexOf("projectCost")).values.slice(2).some((value) => typeof value === "number" && value > 0)).toBe(true);
    const nodePolicies = new Set(workbook.getWorksheet("Nodes")!.getColumn(1).values.slice(2).map(String));
    expect(nodePolicies).toEqual(new Set(["minimum", "recommended", "n_plus_one"]));

    const manifestResponse = await app.request("/api/benchmarks/manifests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recommendationId: recommendation.id, gpuDriver: "test-driver", slaInferenceLatencyMs: 10000 }) });
    const manifest = await manifestResponse.json() as BenchmarkManifest;
    const metrics = {
      cpuModel: recommendation.primary.hardware.cpuModel, gpuModel: recommendation.primary.hardware.gpuModel, gpuDriver: "test-driver",
      perceptrumBuildHash: manifest.perceptrumBuildHash, workloadContractVersion: manifest.workloadContractVersion,
      startedAt: "2026-07-17T10:00:00.000Z", completedAt: "2026-07-17T11:30:00.000Z",
      p95InferenceLatencyMs: 1000, p99InferenceLatencyMs: 2000, peakCpuPercent: 50, peakRamBytes: 1000,
      peakGpuPercent: 50, peakVramBytes: 1000, peakDecoderPercent: 30, gpuTelemetryAvailable: true,
      peakHandleCount: 100, peakThreadCount: 50, peakProcessCount: 2, peakDiskWriteBytesPerSecond: 1000,
      peakNetworkReceiveBytesPerSecond: 1000, captureReadP95Ms: 2, decodeP95Ms: 3, maxQueueDepth: 2,
      queueGrowthPerMinute: 0, inferenceSuccessRate: 1, outOfMemoryCount: 0, mediaFieldCount: 0, credentialFieldCount: 0,
      phases: manifest.phases.map((phase) => ({ ...phase, p95InferenceLatencyMs: 1000, maxQueueDepth: 2, queueGrowthPerMinute: 0, outOfMemoryCount: 0 })),
    };
    const firstUpload = await app.request(manifest.uploadUrl, { method: "POST", headers: { "content-type": "application/json", "x-benchmark-nonce": manifest.nonce }, body: JSON.stringify(metrics) });
    expect(firstUpload.status).toBe(201);
    const reusedChallenge = await app.request(manifest.uploadUrl, { method: "POST", headers: { "content-type": "application/json", "x-benchmark-nonce": manifest.nonce }, body: JSON.stringify(metrics) });
    expect(reusedChallenge.status).toBe(409);
  });

  it("exports a valid PDF when runtime normalization warnings contain Unicode arrows", async () => {
    const store = new MemoryPlannerStore();
    const app = createApp(store);
    const scenario = createDefaultScenario(4);
    const agent = scenario.cameraGroups[0]!.agents[0]!;
    agent.model = "aiq-3.7";
    agent.inputType = "image";
    agent.packaging = "mosaic_3x3";
    agent.runEverySeconds = 600;
    const created = await (await app.request("/api/scenarios", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario }),
    })).json() as ScenarioRecord;
    const recommendations = await (await app.request(`/api/scenarios/${created.id}/recommendations`, { method: "POST" })).json() as CapacityRecommendation[];
    const pdf = await app.request(`/api/recommendations/${recommendations[1]!.id}/export/pdf`);
    expect(pdf.status).toBe(200);
    expect((await PDFDocument.load(await pdf.arrayBuffer())).getPageCount()).toBeGreaterThan(0);
  });

  it("reads a legacy storage scenario and emits the current workload contract", async () => {
    const store = new MemoryPlannerStore();
    const app = createApp(store);
    const scenario = createDefaultScenario(8);
    scenario.workloadContractVersion = "perceptrum-workload/1.0.0";
    scenario.cameraGroups[0]!.storage = { storeVideo: true, retentionDays: 90, raidFactor: 2 };

    const createdResponse = await app.request("/api/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as ScenarioRecord;
    const calculated = await app.request(`/api/scenarios/${created.id}/recommendations`, { method: "POST" });
    expect(calculated.status).toBe(201);
    const recommendations = await calculated.json() as CapacityRecommendation[];
    expect(recommendations.every((item) => item.contractVersion === WORKLOAD_CONTRACT_VERSION)).toBe(true);
    expect(recommendations.every((item) => !item.primary.bottleneck.startsWith("disk"))).toBe(true);
  });
});
