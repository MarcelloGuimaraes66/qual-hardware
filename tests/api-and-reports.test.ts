import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createDefaultScenario } from "../src/shared/schemas.js";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import type { CapacityRecommendation, HardwareNodeTemplate, ScenarioRecord } from "../src/shared/types.js";
import { WORKLOAD_CONTRACT_VERSION } from "../src/shared/types.js";
import { createApp } from "../src/server/app.js";
import { REFERENCE_PDF_STRUCTURE, REFERENCE_PDF_TYPOGRAPHY } from "../src/server/referencePdfReport.js";
import { buildTechnicalCadernoModel } from "../src/server/technicalCadernoPdf.js";
import { MemoryPlannerStore } from "../src/server/store.js";

describe("Qual Hardware API and reports", () => {
  it("creates, revises, calculates and exports a scenario", async () => {
    const store = new MemoryPlannerStore();
    const app = createApp(store);
    const health = await app.request("/api/health");
    expect(await health.json()).toMatchObject({ status: "ok", storage: "memory", processId: expect.any(Number) });
    expect(health.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(health.headers.get("referrer-policy")).toBe("no-referrer");
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
    expect(json.headers.get("content-disposition")).toBe('attachment; filename="qual-hardware-relatorio-comercial-e-neutro.json"');
    const jsonReport = await json.json() as { schemaVersion: string; recommendations: CapacityRecommendation[]; executiveNarrative: { paragraphs: string[]; cautions: string[] }; qualifiedOptions: unknown[]; planningOptions: unknown[]; commercialAndNeutralOptions: Array<{ commercialReference: unknown; procurementNeutralSpecification: { status: string; requirements: unknown[] } }> };
    expect(jsonReport.schemaVersion).toBe("capacity-recommendation-export/7.0.0");
    expect(jsonReport.recommendations.map((item) => item.policy)).toEqual(["minimum", "recommended", "n_plus_one"]);
    expect(jsonReport.executiveNarrative.paragraphs.join(" ")).toContain("FPS de leitura RTSP");
    expect(jsonReport.executiveNarrative.paragraphs.join(" ")).toContain("AiQ/Qwen local");
    expect(jsonReport.qualifiedOptions).toHaveLength(0);
    expect(jsonReport.planningOptions.length).toBeGreaterThanOrEqual(6);
    expect(jsonReport.executiveNarrative.cautions.join(" ")).toContain("não apto para compra");
    expect(jsonReport.commercialAndNeutralOptions.length).toBeGreaterThanOrEqual(6);
    expect(jsonReport.commercialAndNeutralOptions.every((item) => item.procurementNeutralSpecification.status === "blocked" && item.procurementNeutralSpecification.requirements.length >= 10)).toBe(true);

    const pdf = await app.request(`/api/recommendations/${recommendation.id}/export/pdf`);
    const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    expect(pdf.headers.get("content-disposition")).toBe('attachment; filename="qual-hardware-recomendacoes.pdf"');
    expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe("%PDF-");
    const pageCount = (await PDFDocument.load(pdfBytes)).getPageCount();
    expect(pageCount).toBeGreaterThanOrEqual(4);
    expect(pageCount).toBeLessThan(20);
    expect(REFERENCE_PDF_STRUCTURE).toEqual({
      title: "Relatório comparativo de infraestrutura",
      narrative: "Nossa leitura e recomendação em linguagem direta",
      configurations: "As três configurações sugeridas",
      alternatives: "Outras maquinas qualificadas em ordem crescente de custo",
      workload: "Carga de cameras e Agents usada no calculo",
      proposalSections: [
        "Resumo de capacidade",
        "Especificacao tecnica por no",
        "Custo por componente e total do projeto",
        "Distribuicao das cameras e utilizacao",
        "Demanda agregada calculada",
        "Fontes, premissas e avisos",
      ],
    });
    expect(REFERENCE_PDF_TYPOGRAPHY).toEqual({
      justifiedSections: ["executive_narrative", "executive_cautions", "proposal_assumptions"],
      maximumWordGapMultiplier: 2.2,
    });

    const technicalPdf = await app.request(`/api/recommendations/${recommendation.id}/export/technical-pdf`);
    const technicalPdfBytes = new Uint8Array(await technicalPdf.arrayBuffer());
    expect(technicalPdf.status).toBe(200);
    expect(technicalPdf.headers.get("content-type")).toContain("application/pdf");
    expect(technicalPdf.headers.get("content-disposition")).toBe('attachment; filename="qual-hardware-caderno-tecnico-detalhado.pdf"');
    expect(new TextDecoder().decode(technicalPdfBytes.slice(0, 5))).toBe("%PDF-");
    expect((await PDFDocument.load(technicalPdfBytes)).getPageCount()).toBeGreaterThanOrEqual(10);
    const technicalModel = buildTechnicalCadernoModel({
      scenario: created,
      recommendations,
      components: await store.listCatalogComponents(),
    });
    expect(technicalModel.evaluatedComponentCount).toBeGreaterThan(200);
    expect(technicalModel.rawOptionCount).toBeGreaterThan(technicalModel.configurations.length);
    expect(new Set(technicalModel.configurations.map((item) => item.key)).size).toBe(technicalModel.configurations.length);

    const technicalDocx = await app.request(`/api/recommendations/${recommendation.id}/export/technical-docx`);
    const technicalDocxBytes = new Uint8Array(await technicalDocx.arrayBuffer());
    expect(technicalDocx.status).toBe(200);
    expect(technicalDocx.headers.get("content-type")).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(technicalDocx.headers.get("content-disposition")).toBe('attachment; filename="qual-hardware-caderno-tecnico-detalhado.docx"');
    expect(Array.from(technicalDocxBytes.slice(0, 2))).toEqual([0x50, 0x4b]);

    const spreadsheet = await app.request(`/api/recommendations/${recommendation.id}/export/xlsx`);
    expect(spreadsheet.status).toBe(200);
    expect(spreadsheet.headers.get("content-type")).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const spreadsheetBytes = new Uint8Array(await spreadsheet.arrayBuffer());
    expect(Array.from(spreadsheetBytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(spreadsheetBytes.buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Executive Summary", "Scenario", "3 Configurations", "Fleet Plan", "Qualified Options", "Planning Only", "Commercial Reference", "Detailed Specifications", "Neutral TR Specification", "TR Compliance Matrix", "Market Competition", "BOM", "Component Evidence", "Stage Evidence", "Nodes", "Workload", "Calculations", "Quotes", "Assumptions"]);
    expect(workbook.getWorksheet("Executive Summary")!.getCell("B2").value).toContain("RTSP");
    const configurations = workbook.getWorksheet("3 Configurations")!;
    expect(configurations.rowCount).toBe(4);
    expect([2, 3, 4].map((row) => configurations.getRow(row).getCell(1).value)).toEqual(["minimum", "recommended", "n_plus_one"]);
    const bom = workbook.getWorksheet("BOM")!;
    expect(bom.rowCount).toBe(34);
    expect(new Set(bom.getColumn(1).values.slice(2).map(String))).toEqual(new Set(["minimum", "recommended", "n_plus_one"]));
    const bomHeaders = (bom.getRow(1).values as unknown[]).map(String);
    expect(bomHeaders).toEqual(expect.arrayContaining(["currency", "unitCost", "perNodeCost", "projectCost", "priceBasis"]));
    const projectValues = bom.getColumn(bomHeaders.indexOf("projectCost")).values.slice(2).map((value) =>
      typeof value === "object" && value && "result" in value ? (value as { result?: number }).result : value);
    expect(projectValues.some((value) => typeof value === "number" && value > 0)).toBe(true);
    expect(bom.getColumn(bomHeaders.indexOf("projectCost")).values.slice(2).some((value) => typeof value === "object" && value && "formula" in value)).toBe(true);
    const nodePolicies = new Set(workbook.getWorksheet("Nodes")!.getColumn(1).values.slice(2).map(String));
    expect(nodePolicies).toEqual(new Set(["minimum", "recommended", "n_plus_one"]));

    const annexJson = await app.request(`/api/recommendations/${recommendation.id}/export/tr-json`);
    expect(annexJson.status).toBe(200);
    expect(annexJson.headers.get("content-disposition")).toBe('attachment; filename="qual-hardware-anexo-tecnico-neutro.json"');
    const annex = await annexJson.json() as { schemaVersion: string; specifications: Array<{ status: string; requirements: Array<{ matchingComponentIds: string[] }>; marketCompetitionAssessment: { matchingComponentIds: string[]; manufacturerNames: string[] } }> };
    expect(annex.schemaVersion).toBe("qual-hardware-tr-technical-annex/1.0.0");
    expect(annex.specifications.length).toBeGreaterThanOrEqual(6);
    expect(annex.specifications.every((item) => item.status === "blocked" && item.requirements.length >= 10)).toBe(true);
    expect(annex.specifications.every((item) => item.requirements.every((requirement) => requirement.matchingComponentIds.length === 0))).toBe(true);
    expect(annex.specifications.every((item) => item.marketCompetitionAssessment.matchingComponentIds.length === 0 && item.marketCompetitionAssessment.manufacturerNames.length === 0)).toBe(true);

    const annexPdf = await app.request(`/api/recommendations/${recommendation.id}/export/tr-pdf`);
    expect(annexPdf.status).toBe(200);
    expect(new TextDecoder().decode(new Uint8Array((await annexPdf.arrayBuffer()).slice(0, 5)))).toBe("%PDF-");
    const annexDocx = await app.request(`/api/recommendations/${recommendation.id}/export/tr-docx`);
    expect(annexDocx.status).toBe(200);
    expect(Array.from(new Uint8Array((await annexDocx.arrayBuffer()).slice(0, 2)))).toEqual([0x50, 0x4b]);

    const removedExternalBenchmark = await app.request("/api/benchmarks/manifests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recommendationId: recommendation.id }),
    });
    expect(removedExternalBenchmark.status).toBe(404);
  }, 30_000);

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
