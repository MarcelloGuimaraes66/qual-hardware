import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import ExcelJS from "exceljs";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { CalibrationDiagnosticReportModel } from "../shared/types.js";
import { calibrationOperatorFinding } from "./calibrationOutcome.js";

export type CalibrationDiagnosticReportFormat = "pdf" | "txt" | "xlsx" | "json";

const require = createRequire(import.meta.url);
const REGULAR_FONT_PATH = require.resolve("notosans-fontface/fonts/NotoSans-Regular.ttf");
const BOLD_FONT_PATH = require.resolve("notosans-fontface/fonts/NotoSans-Bold.ttf");
const BLUE = rgb(0.07, 0.25, 0.42);
const TEAL = rgb(0.03, 0.47, 0.47);
const DARK = rgb(0.12, 0.15, 0.18);
const MUTED = rgb(0.35, 0.4, 0.45);
const LIGHT = rgb(0.94, 0.96, 0.97);

function cameraWord(value: number | null): string {
  return value === null ? "não determinada" : `${value.toLocaleString("pt-BR")} ${value === 1 ? "câmera" : "câmeras"}`;
}

function requestedCameraQuestion(value: number): string {
  return value === 1 ? "A 1 câmera solicitada funciona?" : `As ${value.toLocaleString("pt-BR")} câmeras solicitadas funcionam?`;
}

function quantity(value: number, singular: string, plural: string): string {
  return `${value.toLocaleString("pt-BR")} ${value === 1 ? singular : plural}`;
}

function fleetStatusLabel(value: CalibrationDiagnosticReportModel["fleetPlan"]["status"]): string {
  return value === "measured" ? "medido nesta máquina"
    : value === "planning_only" ? "planejamento pendente de validação do conjunto"
      : "bloqueado por falta de capacidade válida";
}

function evidenceLevelLabel(value: CalibrationDiagnosticReportModel["technicalEvidence"]["environmentEvidenceLevel"]): string {
  return value === "exact_perceptrum" ? "pipeline local compatível e isolado"
    : value === "compatible_local_stack" ? "componentes locais compatíveis"
      : value === "generic_native" ? "benchmark nativo genérico"
        : "somente inventário";
}

function validityLabel(value: CalibrationDiagnosticReportModel["validity"]): string {
  return value === "commercial" ? "homologação comercial"
    : value === "engineering" ? "engenharia — não libera compra"
      : "diagnóstico rápido — não libera compra";
}

function measurementKindLabel(value: CalibrationDiagnosticReportModel["technicalEvidence"]["measurementKind"]): string {
  return value === "real" ? "medição real"
    : value === "estimated" ? "capacidade estimada"
      : "somente inventário";
}

function severityLabel(value: CalibrationDiagnosticReportModel["findings"][number]["severity"]): string {
  return value === "error" ? "ERRO"
    : value === "warning" ? "ATENÇÃO"
      : "INFORMAÇÃO";
}

function searchPhaseLabel(value: string): string {
  return ({
    seed: "carga informada",
    expand: "expansão",
    reduce: "redução",
    binary: "refinamento",
    confirm: "confirmação",
  } as Record<string, string>)[value] ?? value.replaceAll("_", " ");
}

function operatingSystemLabel(value: string): string {
  const trimmed = value.trim();
  if (/^win(?:32|dows)?\b/i.test(trimmed)) {
    return `Windows${trimmed.replace(/^win(?:32|dows)?/i, "").trim() ? ` (${trimmed.replace(/^win(?:32|dows)?/i, "").trim()})` : ""}`;
  }
  if (/^darwin\b/i.test(trimmed)) return `macOS${trimmed.slice(6).trim() ? ` (${trimmed.slice(6).trim()})` : ""}`;
  if (/^linux\b/i.test(trimmed)) return `Linux${trimmed.slice(5).trim() ? ` (${trimmed.slice(5).trim()})` : ""}`;
  return trimmed;
}

function capacityBoundLabel(model: CalibrationDiagnosticReportModel): string {
  if (model.capacity.bound === "at_least") {
    const value = model.capacity.highestPassingCameras;
    return `Pelo menos ${cameraWord(value)} ${value === 1 ? "foi aprovada" : "foram aprovadas"}; o teste não alcançou o máximo da máquina.`;
  }
  if (model.capacity.bound === "exact") {
    const passing = model.capacity.highestPassingCameras;
    const failing = model.capacity.firstFailingCameras;
    return `Limite adjacente confirmado: ${cameraWord(passing)} ${passing === 1 ? "aprovada" : "aprovadas"} e ${cameraWord(failing)} ${failing === 1 ? "reprovada" : "reprovadas"}.`;
  }
  if (model.capacity.bound === "inconclusive") {
    return "O ensaio ficou inconclusivo e não definiu um limite de câmeras.";
  }
  return `O limite está entre ${cameraWord(model.capacity.highestPassingCameras)} aprovadas e ${cameraWord(model.capacity.firstFailingCameras)} reprovadas.`;
}

function gpuClassificationLabel(value: string): string {
  return ({
    compute: "processamento",
    media_only: "somente mídia",
    display_only: "somente exibição",
    unavailable: "indisponível",
  } as Record<string, string>)[value] ?? value.replaceAll("_", " ");
}

function duplexLabel(value: string): string {
  return ({ full: "full-duplex", half: "half-duplex", unknown: "duplex não verificado" } as Record<string, string>)[value]
    ?? value.replaceAll("_", " ");
}

function evidenceStatusLabel(value: string): string {
  return ({
    measured: "medida",
    unavailable: "não disponível",
    failed: "falhou",
    legacy: "histórica",
  } as Record<string, string>)[value] ?? value.replaceAll("_", " ");
}

function failureCodeLabel(value: string | null): string {
  return value ? calibrationOperatorFinding(value).titlePt : "";
}

function storageLabel(value: string): string {
  return value
    .replace(/calibration temporary volume/gi, "volume temporário da calibração")
    .replace(/\bntfs\b/gi, "NTFS")
    .replace(/\bapfs\b/gi, "APFS");
}

function bytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${units[index]}`;
}

function conclusionLabel(value: CalibrationDiagnosticReportModel["conclusion"]): string {
  return value === "approved" ? "APROVADO" : value === "not_approved" ? "NÃO APROVADO" : "INCONCLUSIVO";
}

function outcomeLabel(value: string): string {
  const labels: Record<string, string> = {
    pass: "Aprovada",
    capacity_fail: "Reprovada por capacidade",
    infrastructure_error: "Erro de infraestrutura — não conta como limite",
    cancelled: "Cancelada",
    not_tested: "Não testada",
  };
  return labels[value] ?? value;
}

function compositionGroupLabel(item: CalibrationDiagnosticReportModel["requested"]["composition"][number]): string {
  const withoutEnteredQuantity = item.groupName
    .replace(/^\s*\d[\d.\s]*\s+câmeras?\s*[—–:=-]\s*/iu, "")
    .trim();
  if (withoutEnteredQuantity) return withoutEnteredQuantity;
  if (item.videoCameras > 0 && item.frameCameras === 0) return "VÍDEO FULL";
  if (item.frameCameras > 0 && item.videoCameras === 0) return "FRAME";
  return "Carga mista";
}

export function calibrationDiagnosticText(model: CalibrationDiagnosticReportModel): string {
  const composition = (items: typeof model.requested.composition) => items.length
    ? items.map((item) => `${compositionGroupLabel(item)}: ${cameraWord(item.cameras)} (${
      item.videoCameras} VÍDEO FULL; ${item.frameCameras} FRAME)`).join("; ")
    : "composição não registrada";
  const lines = [
    model.title.toUpperCase(),
    "=".repeat(72),
    `Execução: ${model.runId}`,
    `Gerado em: ${new Date(model.generatedAt).toLocaleString("pt-BR")}`,
    `Conclusão: ${conclusionLabel(model.conclusion)}`,
    `Validade: ${validityLabel(model.validity)}`,
    `Método usado: ${model.technicalEvidence.methodLabelPt}.`,
    `Natureza do resultado: ${measurementKindLabel(model.technicalEvidence.measurementKind)}.`,
    "",
    "RESPOSTAS PRINCIPAIS",
    `${requestedCameraQuestion(model.requested.cameras)} ${model.requested.operationallyApproved === null ? "Inconclusivo" : model.requested.operationallyApproved ? "Sim" : "Não"}.`,
    `Resultado da carga informada: ${outcomeLabel(model.requested.rawTrialOutcome)}.`,
    `Capacidade operacional segura: ${cameraWord(model.capacity.safeCameras)}.`,
    `Maior carga aprovada: ${cameraWord(model.capacity.highestPassingCameras)}.`,
    `Primeira carga reprovada: ${cameraWord(model.capacity.firstFailingCameras)}.`,
    `Interpretação do limite: ${capacityBoundLabel(model)}`,
    `Maior carga efetivamente tentada: ${cameraWord(model.capacity.maximumAttemptedCameras)}.`,
    `O teste avançou acima da carga informada? ${model.capacity.testedAboveRequested ? "Sim" : "Não"}.`,
    `Gargalo: ${model.bottleneck.labelPt}. ${model.bottleneck.explanationPt}`,
    "",
    "COMPOSIÇÃO DA CARGA",
    `Carga informada: ${composition(model.requested.composition)}.`,
    `Capacidade segura: ${composition(model.capacity.safeComposition)}.`,
    "",
    "MÁQUINA MEDIDA",
    `Sistema operacional: ${operatingSystemLabel(model.hardware.operatingSystem)}`,
    `CPU: ${model.hardware.cpu}`,
    `Topologia: ${quantity(model.hardware.sockets, "processador físico", "processadores físicos")}, ${quantity(model.hardware.physicalCores, "núcleo", "núcleos")} e ${quantity(model.hardware.logicalCores, "thread", "threads")}`,
    `Memória: ${bytes(model.hardware.ramBytes)}`,
    `GPUs: ${model.hardware.gpus.length ? model.hardware.gpus.map((gpu) =>
      `${gpu.name} (${gpuClassificationLabel(gpu.classification)}; carga ${gpu.receivedLoad ? "comprovada" : "não comprovada"}; telemetria ${gpu.telemetryMeasured ? "comprovada" : "ausente"})`).join("; ") : "nenhuma GPU individual registrada"}`,
    `Armazenamento: ${storageLabel(model.hardware.storage)}`,
    `Rede: ${model.hardware.networkLinks.length ? model.hardware.networkLinks.map((link) =>
      `${link.name}: ${link.speedMbps ?? "velocidade não medida"} Mbps, ${duplexLabel(link.duplex)}`).join("; ") : "enlace físico não registrado"}`,
    "",
    "PLANO DE SERVIDORES PARA A CARGA INFORMADA",
    `Estado: ${fleetStatusLabel(model.fleetPlan.status)}.`,
    `Câmeras seguras por servidor: ${cameraWord(model.fleetPlan.safeCamerasPerServer)}.`,
    `Servidores ativos: ${model.fleetPlan.activeServers ?? "não determinado"}.`,
    `Servidores de reserva: ${model.fleetPlan.reserveServers ?? "não determinado"}.`,
    `Total de servidores: ${model.fleetPlan.totalServers ?? "não determinado"}.`,
    `Por servidor: ${model.fleetPlan.cpuDescription}; ${quantity(model.fleetPlan.gpusPerServer, "GPU", "GPUs")}; ${bytes(model.fleetPlan.ramBytesPerServer)} de RAM.`,
    model.fleetPlan.explanationPt,
    "",
    "BUSCA DINÂMICA DO LIMITE",
    ...model.searchTrace.map((item) =>
      `Tentativa ${item.attempt}: ${item.cameraCount.toLocaleString("pt-BR")} câmeras — ${outcomeLabel(item.outcome)}${item.failureCode ? ` — ${failureCodeLabel(item.failureCode)}` : ""}.`),
    "",
    "FALHAS E ORIENTAÇÕES",
    ...model.findings.flatMap((finding) => [
      `${severityLabel(finding.severity)}: ${finding.titlePt}`,
      `Consequência: ${finding.consequencePt}`,
      `O que fazer: ${finding.actionPt}`,
    ]),
    "",
    "METODOLOGIA E VALIDADE",
    ...model.methodology.map((item, index) => `${index + 1}. ${item}`),
    "",
    "EVIDÊNCIA TÉCNICA",
    `Ambiente: ${model.technicalEvidence.environmentSignature ?? "não registrado"}`,
    `Nível de evidência: ${evidenceLevelLabel(model.technicalEvidence.environmentEvidenceLevel)}`,
    `Componentes encontrados: ${model.technicalEvidence.componentsFound.join("; ") || "nenhum registrado"}`,
    `Componentes ausentes ou incompatíveis: ${model.technicalEvidence.componentsMissing.join("; ") || "nenhum"}`,
    `Perfil: ${model.technicalEvidence.workloadProfileId ?? "não registrado"}`,
    `Assinatura da carga: ${model.technicalEvidence.workloadSignature ?? "não registrada"}`,
    "",
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

function printableText(text: unknown): string {
  if (typeof text === "string" && text.trim()) return text;
  if (typeof text === "number" || typeof text === "boolean") return String(text);
  return "Não informado";
}

function wrap(text: unknown, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of printableText(text).split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(""); continue; }
    let line = words[0]!;
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

function drawJustifiedLine(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  x: number,
  y: number,
  width: number,
  color: ReturnType<typeof rgb>,
  justify: boolean,
): void {
  const words = text.split(/\s+/);
  const glyphWidth = words.reduce((sum, word) => sum + font.widthOfTextAtSize(word, size), 0);
  const gap = words.length > 1 ? (width - glyphWidth) / (words.length - 1) : 0;
  if (!justify || words.length < 4 || gap <= 0 || gap > size * 1.5) {
    page.drawText(text, { x, y, font, size, color });
    return;
  }
  let cursor = x;
  for (const word of words) {
    page.drawText(word, { x: cursor, y, font, size, color });
    cursor += font.widthOfTextAtSize(word, size) + gap;
  }
}

export async function calibrationDiagnosticPdf(model: CalibrationDiagnosticReportModel): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([readFile(REGULAR_FONT_PATH), readFile(BOLD_FONT_PATH)]);
  const regular = await document.embedFont(regularBytes, { subset: false });
  const bold = await document.embedFont(boldBytes, { subset: false });
  const width = 595.28;
  const height = 841.89;
  const margin = 48;
  let page: PDFPage;
  let y: number;
  let pageNumber = 0;
  const newPage = (): void => {
    page = document.addPage([width, height]);
    pageNumber += 1;
    y = height - margin;
    if (pageNumber === 1) {
      const headerRight = `Execução ${model.runId.slice(0, 12)}...`;
      page.drawText(model.title, { x: margin, y, font: bold, size: 9, color: BLUE });
      page.drawText(headerRight, {
        x: width - margin - regular.widthOfTextAtSize(headerRight, 7.5),
        y,
        font: regular,
        size: 7.5,
        color: MUTED,
      });
    } else {
      page.drawLine({
        start: { x: margin, y: y + 2 },
        end: { x: width - margin, y: y + 2 },
        thickness: 0.7,
        color: LIGHT,
      });
      page.drawText(String(pageNumber), {
        x: width - margin - regular.widthOfTextAtSize(String(pageNumber), 7.5),
        y,
        font: regular,
        size: 7.5,
        color: MUTED,
      });
    }
    y -= 22;
  };
  const ensure = (needed: number): void => { if (y - needed < margin + 20) newPage(); };
  const heading = (text: string): void => {
    ensure(36);
    y -= 8;
    page.drawRectangle({ x: margin, y: y - 17, width: width - margin * 2, height: 24, color: BLUE });
    page.drawText(text, { x: margin + 9, y: y - 10, font: bold, size: 10, color: rgb(1, 1, 1) });
    y -= 30;
  };
  const paragraph = (text: string, options: { bold?: boolean; color?: ReturnType<typeof rgb>; size?: number; compact?: boolean } = {}): void => {
    const usedFont = options.bold ? bold : regular;
    const size = options.size ?? 9.2;
    const lineHeight = options.compact ? size + 2.2 : 13;
    const trailingSpace = options.compact ? 1 : 3;
    const lines = wrap(text, usedFont, size, width - margin * 2);
    ensure(lines.length * lineHeight + trailingSpace + 3);
    for (const [index, line] of lines.entries()) {
      if (line) drawJustifiedLine(
        page, line, usedFont, size, margin, y, width - margin * 2,
        options.color ?? DARK, !options.bold && index < lines.length - 1,
      );
      y -= lineHeight;
    }
    y -= trailingSpace;
  };
  const row = (label: unknown, value: unknown, shade = false): void => {
    const rowHeight = Math.max(25, Math.max(
      wrap(label, bold, 8.5, 158).length,
      wrap(value, regular, 8.5, width - margin * 2 - 178).length,
    ) * 11 + 10);
    ensure(rowHeight);
    if (shade) page.drawRectangle({ x: margin, y: y - rowHeight + 6, width: width - margin * 2, height: rowHeight, color: LIGHT });
    let labelY = y - 9;
    for (const line of wrap(label, bold, 8.5, 158)) {
      page.drawText(line, { x: margin + 7, y: labelY, font: bold, size: 8.5, color: BLUE }); labelY -= 11;
    }
    let valueY = y - 9;
    for (const line of wrap(value, regular, 8.5, width - margin * 2 - 178)) {
      page.drawText(line, { x: margin + 176, y: valueY, font: regular, size: 8.5, color: DARK }); valueY -= 11;
    }
    y -= rowHeight;
  };

  newPage();
  paragraph(model.title, { bold: true, size: 20, color: BLUE });
  paragraph(`Conclusão: ${conclusionLabel(model.conclusion)}`, {
    bold: true, size: 14, color: model.conclusion === "approved" ? TEAL : rgb(0.72, 0.18, 0.14),
  });
  paragraph(`Este documento responde à carga informada, registra a busca dinâmica do limite e separa claramente a capacidade segura do limite bruto observado.`);
  heading("1. Respostas principais");
  row("Método usado", model.technicalEvidence.methodLabelPt);
  row("Natureza do resultado", model.technicalEvidence.measurementKind === "real" ? "Medição real"
    : model.technicalEvidence.measurementKind === "estimated" ? "Capacidade estimada — não homologa compra"
      : "Somente inventário", true);
  row(requestedCameraQuestion(model.requested.cameras),
    model.requested.operationallyApproved === null ? "INCONCLUSIVO" : model.requested.operationallyApproved ? "SIM" : "NÃO");
  row("Capacidade operacional segura", cameraWord(model.capacity.safeCameras), true);
  row("Maior carga aprovada", cameraWord(model.capacity.highestPassingCameras));
  row("Primeira carga reprovada", cameraWord(model.capacity.firstFailingCameras), true);
  row("Interpretação do limite", capacityBoundLabel(model));
  row("Testou acima da carga informada?", model.capacity.testedAboveRequested
    ? `Sim, até ${cameraWord(model.capacity.maximumAttemptedCameras)}.` : "Não.", true);
  row("Gargalo", `${model.bottleneck.labelPt}. ${model.bottleneck.explanationPt}`, true);
  row("Validade", validityLabel(model.validity));

  heading("2. Carga VÍDEO FULL e FRAME");
  paragraph("VÍDEO FULL mantém a recepção e decodificação contínuas para retirar frames do stream. FRAME representa a captura periódica de imagens e, por isso, tem carga muito menor. A capacidade só pode ser comparada quando essa composição é idêntica.");
  for (const item of model.requested.composition) {
    row(`Carga informada · ${compositionGroupLabel(item)}`,
      `${cameraWord(item.cameras)}: ${item.videoCameras} VÍDEO FULL e ${item.frameCameras} FRAME.`);
  }
  for (const item of model.capacity.safeComposition) {
    row(`Capacidade segura · ${compositionGroupLabel(item)}`,
      `${cameraWord(item.cameras)}: ${item.videoCameras} VÍDEO FULL e ${item.frameCameras} FRAME.`, true);
  }

  heading("3. Máquina medida");
  row("CPU", `${model.hardware.cpu}; ${quantity(model.hardware.sockets, "processador físico", "processadores físicos")}; ${quantity(model.hardware.physicalCores, "núcleo", "núcleos")}; ${quantity(model.hardware.logicalCores, "thread", "threads")}.`);
  row("RAM", bytes(model.hardware.ramBytes), true);
  row("GPUs", model.hardware.gpus.length ? model.hardware.gpus.map((gpu) =>
    `${gpu.name} — ${gpuClassificationLabel(gpu.classification)}; carga ${gpu.receivedLoad ? "comprovada" : "não comprovada"}; telemetria ${gpu.telemetryMeasured ? "comprovada" : "ausente"}`).join(" | ") : "Nenhuma GPU individual registrada.");
  row("Rede", model.hardware.networkLinks.length ? model.hardware.networkLinks.map((link) =>
    `${link.name}: ${link.speedMbps ?? "velocidade não medida"} Mbps, ${duplexLabel(link.duplex)}`).join(" | ") : "Enlace físico não registrado.", true);
  row("Sistema e disco", `${operatingSystemLabel(model.hardware.operatingSystem)}; ${storageLabel(model.hardware.storage)}.`);

  heading("4. Configuração recomendada para a carga");
  row("Capacidade por servidor", cameraWord(model.fleetPlan.safeCamerasPerServer));
  row("Servidores", model.fleetPlan.totalServers === null ? "Não determinado"
    : `${quantity(model.fleetPlan.activeServers ?? 0, "servidor ativo", "servidores ativos")} + ${quantity(model.fleetPlan.reserveServers ?? 0, "servidor de reserva", "servidores de reserva")} = ${quantity(model.fleetPlan.totalServers, "servidor", "servidores")} no total.`, true);
  row("CPU / GPU / RAM por servidor", `${model.fleetPlan.cpuDescription}; ${quantity(model.fleetPlan.gpusPerServer, "GPU", "GPUs")}; ${bytes(model.fleetPlan.ramBytesPerServer)} de RAM.`);
  paragraph(model.fleetPlan.explanationPt);

  heading("5. Busca dinâmica do limite");
  if (model.searchTrace.length === 0) paragraph("Nenhuma tentativa de fronteira foi registrada.");
  for (const item of model.searchTrace) {
    row(`Tentativa ${item.attempt} · ${item.cameraCount.toLocaleString("pt-BR")} câmeras`,
      `${outcomeLabel(item.outcome)}${item.failureCode ? ` · ${failureCodeLabel(item.failureCode)}` : ""}`, item.attempt % 2 === 0);
  }

  heading("6. Etapas, falhas e orientações");
  for (const stage of model.stages) {
    row(stage.labelPt, `${evidenceStatusLabel(stage.evidence)}; capacidade ${cameraWord(stage.safeCameraCapacity)}; utilização ${
      stage.utilizationPercent === null ? "não medida" : `${stage.utilizationPercent.toFixed(1)}%`}. ${stage.explanationPt}`);
  }
  for (const finding of model.findings) {
    paragraph(finding.titlePt, { bold: true, color: finding.severity === "error" ? rgb(0.72, 0.18, 0.14) : BLUE, size: 8.7, compact: true });
    paragraph(`Consequência: ${finding.consequencePt}`, { size: 8.5, compact: true });
    paragraph(`O que fazer: ${finding.actionPt}`, { size: 8.5, compact: true });
  }

  heading("7. Metodologia e rastreabilidade");
  model.methodology.forEach((item, index) => paragraph(`${index + 1}. ${item}`, { size: 8.4, compact: true }));
  paragraph(`Método: ${model.technicalEvidence.methodLabelPt}. Natureza: ${model.technicalEvidence.measurementKind === "real" ? "medição real" : model.technicalEvidence.measurementKind === "estimated" ? "capacidade estimada" : "somente inventário"}. Identificação do ambiente: ${model.technicalEvidence.environmentSignature ?? "não registrada"}. Nível de evidência: ${evidenceLevelLabel(model.technicalEvidence.environmentEvidenceLevel)}. Perfil de carga: ${model.technicalEvidence.workloadProfileId ?? "não registrado"}.`, { size: 7.8, compact: true });
  return document.save();
}

function styleSheet(sheet: ExcelJS.Worksheet): void {
  sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + Math.min(26, sheet.columnCount))}1` };
  sheet.columns.forEach((column) => { column.width = Math.min(60, Math.max(14, column.width ?? 14)); });
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123F6B" } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 28;
  sheet.eachRow((row, number) => {
    row.alignment = { vertical: "top", wrapText: true };
    if (number > 1 && number % 2 === 0) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F5F7" } };
    }
    if (number > 1) {
      let lines = 1;
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        const width = Math.max(10, sheet.getColumn(columnNumber).width ?? 14);
        const text = String(cell.value ?? "");
        lines = Math.max(lines, text.split(/\r?\n/).reduce((sum, part) =>
          sum + Math.max(1, Math.ceil(part.length / Math.max(10, width - 2))), 0));
        cell.border = {
          right: { style: "thin", color: { argb: "FFD9E2E8" } },
          bottom: { style: "thin", color: { argb: "FFD9E2E8" } },
        };
      });
      row.height = Math.min(240, Math.max(20, lines * 17));
    }
  });
}

export async function calibrationDiagnosticXlsx(model: CalibrationDiagnosticReportModel): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Qual Hardware";
  workbook.created = new Date(model.generatedAt);
  const add = (name: string, columns: Array<{ header: string; key: string; width?: number }>, rows: Record<string, unknown>[]): ExcelJS.Worksheet => {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = columns;
    sheet.addRows(rows);
    styleSheet(sheet);
    return sheet;
  };
  add("Resumo", [{ header: "Informação", key: "label", width: 34 }, { header: "Resultado", key: "value", width: 72 }], [
    { label: "Conclusão", value: conclusionLabel(model.conclusion) },
    { label: "As câmeras solicitadas funcionam?", value: model.requested.operationallyApproved === null ? "Inconclusivo" : model.requested.operationallyApproved ? "Sim" : "Não" },
    { label: "Câmeras solicitadas", value: model.requested.cameras },
    { label: "Capacidade operacional segura", value: model.capacity.safeCameras ?? "Não determinada" },
    { label: "Maior carga aprovada", value: model.capacity.highestPassingCameras ?? "Não determinada" },
    { label: "Primeira carga reprovada", value: model.capacity.firstFailingCameras ?? "Não determinada" },
    { label: "Interpretação do limite", value: capacityBoundLabel(model) },
    { label: "Gargalo", value: `${model.bottleneck.labelPt}. ${model.bottleneck.explanationPt}` },
    { label: "Validade", value: validityLabel(model.validity) },
  ]);
  add("Carga testada", [
    { header: "Escopo", key: "scope", width: 22 }, { header: "Grupo", key: "group", width: 28 },
    { header: "Total", key: "total", width: 14 },
    { header: "VÍDEO FULL", key: "video", width: 16 }, { header: "FRAME", key: "frame", width: 16 },
  ], [
    ...model.requested.composition.map((item) => ({
      scope: "Carga informada", group: compositionGroupLabel(item), total: item.cameras,
      video: item.videoCameras, frame: item.frameCameras,
    })),
    ...model.capacity.safeComposition.map((item) => ({
      scope: "Capacidade segura", group: compositionGroupLabel(item), total: item.cameras,
      video: item.videoCameras, frame: item.frameCameras,
    })),
  ]);
  const limitSheet = add("Busca do limite", [
    { header: "Tentativa", key: "attempt", width: 12 }, { header: "Fase", key: "phase", width: 16 },
    { header: "Câmeras", key: "cameras", width: 16 }, { header: "Resultado", key: "outcome", width: 38 },
    { header: "Falha", key: "failure", width: 60 },
  ], model.searchTrace.map((item) => ({ attempt: item.attempt, phase: searchPhaseLabel(item.phase), cameras: item.cameraCount,
    outcome: outcomeLabel(item.outcome), failure: item.failureCode ? failureCodeLabel(item.failureCode) : "Nenhuma" })));
  limitSheet.getColumn("attempt").alignment = { horizontal: "center", vertical: "top", wrapText: true };
  limitSheet.getColumn("cameras").alignment = { horizontal: "center", vertical: "top", wrapText: true };
  add("CPU e GPU", [{ header: "Recurso", key: "resource", width: 26 }, { header: "Especificação / evidência", key: "detail", width: 88 }], [
    { resource: "CPU", detail: `${model.hardware.cpu}; ${quantity(model.hardware.sockets, "processador físico", "processadores físicos")}; ${model.hardware.physicalCores}C/${model.hardware.logicalCores}T` },
    { resource: "RAM", detail: bytes(model.hardware.ramBytes) },
    ...model.hardware.gpus.map((gpu, index) => ({ resource: `GPU ${index + 1}`, detail: `${gpu.name}; identificador ${gpu.id}; ${gpuClassificationLabel(gpu.classification)}; carga ${gpu.receivedLoad ? "sim" : "não"}; telemetria ${gpu.telemetryMeasured ? "sim" : "não"}` })),
  ]);
  const bottleneckSheet = add("Gargalos", [
    { header: "Etapa", key: "stage", width: 34 }, { header: "Evidência", key: "evidence", width: 18 },
    { header: "Capacidade segura", key: "capacity", width: 20 }, { header: "Utilização", key: "utilization", width: 18 },
    { header: "Explicação", key: "explanation", width: 70 },
  ], model.stages.map((stage) => ({ stage: stage.labelPt, evidence: evidenceStatusLabel(stage.evidence),
    capacity: stage.safeCameraCapacity ?? "Não determinada",
    utilization: stage.utilizationPercent === null ? "Não medida" : `${stage.utilizationPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
    explanation: stage.explanationPt })));
  bottleneckSheet.getColumn("capacity").alignment = { horizontal: "center", vertical: "top", wrapText: true };
  bottleneckSheet.getColumn("utilization").alignment = { horizontal: "center", vertical: "top", wrapText: true };
  add("Plano de servidores", [{ header: "Item", key: "item", width: 36 }, { header: "Valor", key: "value", width: 80 }], [
    { item: "Câmeras do projeto", value: model.fleetPlan.projectCameras },
    { item: "Câmeras seguras por servidor", value: model.fleetPlan.safeCamerasPerServer ?? "Não determinado" },
    { item: "Servidores ativos", value: model.fleetPlan.activeServers ?? "Não determinado" },
    { item: "Servidores reserva", value: model.fleetPlan.reserveServers ?? "Não determinado" },
    { item: "Total de servidores", value: model.fleetPlan.totalServers ?? "Não determinado" },
    { item: "CPU por servidor", value: model.fleetPlan.cpuDescription },
    { item: "GPUs por servidor", value: model.fleetPlan.gpusPerServer },
    { item: "RAM por servidor", value: bytes(model.fleetPlan.ramBytesPerServer) },
    { item: "Observação", value: model.fleetPlan.explanationPt },
  ]);
  add("Falhas e orientações", [
    { header: "Severidade", key: "severity", width: 16 },
    { header: "O que ocorreu", key: "title", width: 58 }, { header: "Consequência", key: "consequence", width: 68 },
    { header: "O que fazer", key: "action", width: 76 },
    { header: "Código técnico (suporte)", key: "code", width: 38 },
  ], model.findings.map((item) => ({ severity: severityLabel(item.severity), code: item.code, title: item.titlePt,
    consequence: item.consequencePt, action: item.actionPt })));
  add("Evidência técnica", [{ header: "Campo", key: "field", width: 34 }, { header: "Valor", key: "value", width: 90 }], [
    { field: "Execução", value: model.runId },
    { field: "Perfil de carga", value: model.technicalEvidence.workloadProfileId ?? "" },
    { field: "Assinatura da carga", value: model.technicalEvidence.workloadSignature ?? "" },
    { field: "Método usado", value: model.technicalEvidence.methodLabelPt },
    { field: "Natureza do resultado", value: measurementKindLabel(model.technicalEvidence.measurementKind) },
    { field: "Assinatura do ambiente", value: model.technicalEvidence.environmentSignature ?? "" },
    { field: "Nível de evidência", value: evidenceLevelLabel(model.technicalEvidence.environmentEvidenceLevel) },
    { field: "Componentes encontrados", value: model.technicalEvidence.componentsFound.join("; ") },
    { field: "Componentes ausentes/incompatíveis", value: model.technicalEvidence.componentsMissing.join("; ") },
    ...model.methodology.map((value, index) => ({ field: `Metodologia ${index + 1}`, value })),
  ]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function renderCalibrationDiagnosticReport(
  model: CalibrationDiagnosticReportModel,
  format: CalibrationDiagnosticReportFormat,
): Promise<Uint8Array> {
  if (format === "pdf") return calibrationDiagnosticPdf(model);
  if (format === "xlsx") return calibrationDiagnosticXlsx(model);
  if (format === "json") return new TextEncoder().encode(`\uFEFF${JSON.stringify(model, null, 2)}\n`);
  return new TextEncoder().encode(calibrationDiagnosticText(model));
}
