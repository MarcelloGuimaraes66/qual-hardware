import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";
import type { CapacityRecommendation, ScenarioRecord } from "../shared/types.js";

export interface ReportContext {
  scenario: ScenarioRecord;
  recommendation: CapacityRecommendation;
}

export function jsonReport(context: ReportContext): Buffer {
  return Buffer.from(JSON.stringify({
    schemaVersion: "capacity-recommendation-export/1.0.0",
    generatedAt: new Date().toISOString(),
    scenario: context.scenario,
    recommendation: context.recommendation,
  }, null, 2));
}

type ReportRow = Record<string, string | number | boolean | null>;

function appendSheet(workbook: ExcelJS.Workbook, name: string, inputRows: ReportRow[]): void {
  const rows = inputRows.length ? inputRows : [{ status: "No data" }];
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
  sheet.columns = headers.map((header) => {
    const longestValue = Math.max(header.length, ...rows.map((row) => String(row[header] ?? "").length));
    const containsLongText = longestValue > 48;
    return {
      header,
      key: header,
      width: containsLongText ? 60 : Math.min(32, Math.max(14, longestValue + 3)),
    };
  });
  sheet.addRows(rows);
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FF071014" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC8FF3D" } };
  header.alignment = { vertical: "middle" };
  header.height = 24;
  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.alignment = { vertical: "top", wrapText: true };
    const longestValue = Math.max(...headers.map((_header, columnIndex) =>
      String(row.getCell(columnIndex + 1).value ?? "").length));
    row.height = Math.min(90, Math.max(19, Math.ceil(longestValue / 75) * 15));
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

export async function xlsxReport({ scenario, recommendation }: ReportContext): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Aiquimist Qual Hardware";
  workbook.created = new Date();
  const design = recommendation.primary;
  appendSheet(workbook, "Scenario", [{
    project: scenario.scenario.projectName, customer: scenario.scenario.customerName,
    market: scenario.scenario.market, currency: scenario.scenario.currency,
    cameras: scenario.scenario.totalCameras, revision: scenario.revision,
    build: scenario.scenario.perceptrumBuildHash, contract: recommendation.contractVersion,
    inputContract: scenario.scenario.workloadContractVersion,
  }]);
  appendSheet(workbook, "BOM", [{
    nodes: design.nodeCount, activeNodes: design.activeNodeCount, model: design.hardware.name,
    cpu: design.hardware.cpuModel, ramGb: design.hardware.ramGb, ecc: design.hardware.ecc,
    gpu: design.hardware.gpuModel, gpuCount: design.hardware.gpuCount, vramGb: design.hardware.gpuVramGbTotal,
    operationalNvme: design.hardware.storageModel, workspaceUsableTb: design.hardware.usableStorageTb,
    storageIsSizingConstraint: false,
    nicGbps: design.hardware.nicGbps, chassis: design.hardware.chassis,
    operatingSystem: design.hardware.windowsEdition,
  }]);
  appendSheet(workbook, "Nodes", design.allocations.map((node) => ({
    node: node.nodeIndex, role: node.role,
    cameras: node.cameraGroups.reduce((sum, group) => sum + group.cameras, 0),
    groups: node.cameraGroups.map((group) => `${group.groupName}:${group.cameras}`).join("; "),
    cpuPercent: Math.round(node.utilization.cpuCores * 100), ramPercent: Math.round(node.utilization.ramGb * 100),
    vramPercent: Math.round(node.utilization.gpuVramGb * 100), decoderPercent: Math.round(node.utilization.gpuDecode1080p30Streams * 100),
    lanPercent: Math.round(node.utilization.lanGbps * 100),
  })));
  appendSheet(workbook, "Distribution", scenario.scenario.cameraGroups.map((group) => ({
    group: group.name, cameras: group.count, codec: group.source.codec,
    resolution: `${group.source.width}x${group.source.height}`, fps: group.source.sourceFps,
    bitrateMbps: group.source.bitrateMbps, decode: group.decodeMode,
    agents: group.agents.map((agent) => [
      agent.name, agent.model, agent.inputType, agent.packaging,
      `${agent.modelFps}fps`, `${agent.runEverySeconds}s`,
      `motionOnly=${agent.features.onlyCaptureOnMotion}`,
      `regions=${agent.features.regions}`,
      `crop=${agent.features.croppedFrame}`,
      `faces=${agent.features.faceReferences}`,
      `negativeRefs=${agent.features.negativeReferences}`,
      `temporal=${agent.features.temporal}`,
    ].join("/")).join("; "),
  })));
  appendSheet(workbook, "Calculations", Object.entries(design.aggregateDemand).map(([resource, demand]) => ({
    resource, aggregateDemand: demand,
    usedForSizing: resource !== "diskCapacityTb" && resource !== "diskWriteMbps",
    bottleneck: resource === design.bottleneck,
  })));
  appendSheet(workbook, "Quotes", design.price.sourceUrls.map((url) => ({
    currency: design.price.currency, minimum: design.price.minimum, median: design.price.median,
    maximum: design.price.maximum, observedSource: url, staleQuotes: design.price.staleQuoteCount,
  })));
  appendSheet(workbook, "Assumptions", [
    ...recommendation.assumptions.map((text) => ({ type: "assumption", text })),
    ...design.warnings.map((text) => ({ type: "warning", text })),
    ...recommendation.evidence.map((text) => ({ type: "evidence", text })),
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function wrap(text: string, width = 92): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > width) { if (line) lines.push(line); line = word; }
    else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines;
}

function pdfSafe(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("→", "->")
    .replaceAll("×", "x")
    .replaceAll("·", "-")
    .replaceAll("•", "-")
    .replace(/[^\x20-\x7E]/g, "?");
}

export async function pdfReport({ scenario, recommendation }: ReportContext): Promise<Buffer> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([595, 842]);
  let y = 790;
  const newPage = (): void => { page = document.addPage([595, 842]); y = 790; };
  const ensureSpace = (height: number): void => { if (y < height) newPage(); };
  const addLine = (text: string, size = 10, isBold = false): void => {
    for (const line of wrap(pdfSafe(text), size >= 18 ? 52 : 92)) {
      if (y < 55) newPage();
      page.drawText(line, { x: 48, y, size, font: isBold ? bold : regular, color: rgb(0.08, 0.12, 0.18) });
      y -= size + 5;
    }
  };
  addLine("AIQUIMIST · QUAL HARDWARE", 12, true);
  addLine("Especificação técnica de hardware", 22, true);
  y -= 8;
  addLine(`${scenario.scenario.projectName} · ${scenario.scenario.totalCameras} câmeras`, 13, true);
  addLine(`Projeto ${recommendation.policy} · ${recommendation.confidence.toUpperCase()} · Revisão ${scenario.revision}`);
  addLine(`Build ${scenario.scenario.perceptrumBuildHash} · Contrato ${recommendation.contractVersion}`);
  y -= 12;
  addLine("Configuração principal", 15, true);
  const design = recommendation.primary;
  addLine(`${design.nodeCount} nó(s), ${design.activeNodeCount} ativo(s): ${design.hardware.name}`);
  addLine(`CPU: ${design.hardware.cpuModel} (${design.hardware.physicalCores} núcleos por nó)`);
  addLine(`RAM: ${design.hardware.ramGb} GB${design.hardware.ecc ? " ECC" : ""} por nó`);
  addLine(`GPU: ${design.hardware.gpuCount} × ${design.hardware.gpuModel}; ${design.hardware.gpuVramGbTotal} GB VRAM por nó`);
  addLine(`Sistema operacional: ${design.hardware.windowsEdition}`);
  addLine(`NVMe operacional: ${design.hardware.storageModel}; destinado ao sistema operacional e a arquivos temporários, sem participar do dimensionamento de nós.`);
  addLine(`Rede: ${design.hardware.nicGbps} GbE; PSU: ${design.hardware.powerSupply}; chassi: ${design.hardware.chassis}`);
  addLine(`Gargalo dominante: ${design.bottleneck}; folga-alvo: ${design.headroomPercent}%; câmeras adicionais estimadas: ${design.maximumAdditionalCameras}`);
  addLine(design.price.quotationRequired ? "Preço: cotação necessária; nenhuma estimativa sem evidência foi inventada." :
    `Preço ${design.price.currency}: ${design.price.minimum} / ${design.price.median} / ${design.price.maximum} (mín./mediano/máx.)`);
  y -= 12;
  addLine("Distribuição por nó", 15, true);
  for (const node of design.allocations) addLine(
    `Nó ${node.nodeIndex} (${node.role}): ${node.cameraGroups.map((group) => `${group.groupName} ${group.cameras}`).join(", ") || "reserva"}. CPU ${Math.round(node.utilization.cpuCores * 100)}%, RAM ${Math.round(node.utilization.ramGb * 100)}%, VRAM ${Math.round(node.utilization.gpuVramGb * 100)}%.`);
  y -= 12;
  addLine("Carga de cameras e Agents", 15, true);
  for (const group of scenario.scenario.cameraGroups) {
    addLine(`${group.count} camera(s) - ${group.name}: ${group.source.codec.toUpperCase()} ${group.source.width}x${group.source.height}, ${group.source.sourceFps} FPS RTSP, ${group.source.bitrateMbps} Mbps, decode ${group.decodeMode}.`, 10, true);
    for (const agent of group.agents) {
      const media = agent.inputType === "video"
        ? `video, ${agent.packaging}, ${agent.modelFps} FPS`
        : "image, 1 frame";
      addLine(`- ${agent.name}: ${agent.model}, ${media}, a cada ${agent.runEverySeconds}s, movimento=${agent.features.onlyCaptureOnMotion}, regioes=${agent.features.regions}, recorte=${agent.features.croppedFrame}, faces=${agent.features.faceReferences}, negativas=${agent.features.negativeReferences}, temporal=${agent.features.temporal}.`);
    }
  }
  y -= 12;
  addLine("Premissas e avisos", 15, true);
  for (const item of [...recommendation.assumptions, ...design.warnings]) addLine(`- ${item}`);
  y -= 12;
  ensureSpace(125);
  addLine("Evidências", 15, true);
  for (const item of recommendation.evidence) addLine(item);
  const pages = document.getPages();
  pages.forEach((reportPage, index) => reportPage.drawText(
    pdfSafe(`Qual Hardware | pagina ${index + 1} de ${pages.length}`),
    { x: 48, y: 24, size: 8, font: regular, color: rgb(0.35, 0.4, 0.45) },
  ));
  const bytes = await document.save();
  return Buffer.from(bytes);
}
