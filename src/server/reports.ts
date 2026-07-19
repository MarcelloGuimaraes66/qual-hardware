import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import ExcelJS from "exceljs";
import type {
  CapacityRecommendation,
  HardwareNodeTemplate,
  OperatingSystemFamily,
  RecommendationAlternative,
  RecommendationPolicy,
  ScenarioRecord,
} from "../shared/types.js";
import { CAPACITY_RECOMMENDATION_EXPORT_VERSION } from "../shared/types.js";

export interface ReportContext {
  scenario: ScenarioRecord;
  recommendations: CapacityRecommendation[];
}

const POLICY_ORDER: RecommendationPolicy[] = ["minimum", "recommended", "n_plus_one"];
const POLICY_LABELS: Record<RecommendationPolicy, string> = {
  minimum: "1. Mínimo técnico",
  recommended: "2. Recomendado",
  n_plus_one: "3. N+1 resiliente",
};

function orderedRecommendations(recommendations: CapacityRecommendation[]): CapacityRecommendation[] {
  const byPolicy = new Map(recommendations.map((item) => [item.policy, item]));
  const ordered = POLICY_ORDER.map((policy) => byPolicy.get(policy)).filter((item): item is CapacityRecommendation => Boolean(item));
  if (ordered.length !== POLICY_ORDER.length) throw new Error("recommendation_set_incomplete");
  return ordered;
}

export interface ExecutiveNarrative {
  title: string;
  paragraphs: string[];
  recommendation: string;
  cautions: string[];
}

export function buildExecutiveNarrative(context: ReportContext): ExecutiveNarrative {
  const recommendations = orderedRecommendations(context.recommendations);
  const [minimum, recommended, resilient] = recommendations;
  const scenario = context.scenario.scenario;
  const sourceFps = [...new Set(scenario.cameraGroups.map((group) => group.source.sourceFps))].sort((left, right) => left - right);
  const inferenceFps = [...new Set(scenario.cameraGroups.flatMap((group) => group.agents.map((agent) => Math.min(5, agent.modelFps))))].sort((left, right) => left - right);
  const selected = recommended!.primary;
  const evidence = selected.calibration;
  const evidenceText = evidence?.status === "validated_local"
    ? "esta configuração foi medida fisicamente com o pipeline local do Perceptrum"
    : evidence?.status === "extrapolated_high"
      ? `a capacidade foi extrapolada com confiança alta, margem de ${evidence.reservePercent}% e gargalo ${evidence.bottleneck ?? "não identificado"}`
      : "a capacidade ainda depende de estimativas conservadoras e deve ser confirmada por calibração local antes da compra";
  const priceText = selected.price.median === null
    ? "O preço precisa de cotação comercial itemizada."
    : `O valor central é ${selected.price.currency} ${formatMoney(selected.price.median)} para o projeto; ${selected.price.quotationRequired ? "ele é uma referência e exige cotação antes da compra" : "ele usa cotações válidas do snapshot ativo"}.`;
  const commerciallyEligible = selected.procurementEligibility === "eligible";
  const recommendation = commerciallyEligible
    ? `Para equilibrar segurança operacional, custo e possibilidade de crescimento, a escolha principal apta para aquisição é ${selected.nodeCount} unidade(s) de ${selected.hardware.name}, com ${selected.hardware.cpuModel}, ${selected.hardware.gpuCount} × ${selected.hardware.gpuModel}, ${selected.hardware.ramGb} GB de memória por nó e ${selected.headroomPercent}% de folga planejada.`
    : `Ainda não há evidência suficiente para aprovar uma compra. A configuração ${selected.hardware.name}, com ${selected.nodeCount} unidade(s), aparece somente como referência de planejamento para orientar as calibrações que faltam; ela não deve ser adquirida com base neste relatório.`;
  return {
    title: "Nossa leitura e recomendação em linguagem direta",
    paragraphs: [
      `Analisamos o trabalho completo de ${scenario.totalCameras} câmera(s): recebimento RTSP, decodificação, processamento de imagem, criação e leitura de clipes, gravação em disco, tráfego de rede e inferência no AiQ/Qwen local. O FPS de leitura RTSP (${sourceFps.join("/ ")} por câmera) foi tratado separadamente do FPS efetivamente enviado ao modelo (${inferenceFps.join("/ ")}), porque esses dois momentos consomem recursos diferentes.`,
      `${recommendation} O limitante calculado desta proposta é ${selected.bottleneck}; por isso a recomendação considera o conjunto CPU, GPU, VRAM, RAM, SSD, rede e sustentação térmica, e não apenas a marca ou um score genérico.`,
      `Sobre a força da evidência: ${evidenceText}. ${priceText}`,
      `A opção mínima, ${minimum!.primary.hardware.name}, é sempre informativa e trabalha com menos reserva para picos. A opção recomendada busca o melhor equilíbrio para operação contínua e, a partir de 64 câmeras, já inclui N+1. A opção N+1, ${resilient!.primary.hardware.name}, mantém redundância para a indisponibilidade de um nó. ${commerciallyEligible ? "As opções aptas passaram pelo gate de evidências de todos os estágios." : "Neste momento todas continuam bloqueadas para aquisição até a cobertura ficar completa."}`,
    ],
    recommendation,
    cautions: [
      ...(selected.price.staleQuoteCount > 0 ? [`${selected.price.staleQuoteCount} cotação(ões) vencida(s) foram excluídas do cálculo.`] : []),
      ...(evidence?.status === "validated_local" || evidence?.status === "extrapolated_high" ? [] : ["Não trate esta estimativa como validação física; execute a calibração completa do Perceptrum antes de fechar a compra."]),
      ...(!commerciallyEligible ? ["VEREDITO COMERCIAL: relatório não apto para compra; capacidade segura não comprovada para todos os estágios."] : []),
      "Driver, perfil de energia, refrigeração, versão do Perceptrum, modelo AiQ e workload devem permanecer iguais aos registrados na evidência.",
    ],
  };
}

function qualifiedOptions(recommendations: CapacityRecommendation[]): RecommendationAlternative[] {
  const byHardware = new Map<string, RecommendationAlternative>();
  for (const recommendation of recommendations) {
    for (const option of [recommendation.primary, ...recommendation.alternatives]) {
      if (option.procurementEligibility !== "eligible") continue;
      const current = byHardware.get(option.hardware.id);
      const cost = option.price.median ?? Number.POSITIVE_INFINITY;
      const currentCost = current?.price.median ?? Number.POSITIVE_INFINITY;
      if (!current || cost < currentCost) byHardware.set(option.hardware.id, option);
    }
  }
  return [...byHardware.values()].sort((left, right) =>
    (left.price.median ?? Number.POSITIVE_INFINITY) - (right.price.median ?? Number.POSITIVE_INFINITY) ||
    left.hardware.name.localeCompare(right.hardware.name),
  );
}

function planningOptions(recommendations: CapacityRecommendation[]): RecommendationAlternative[] {
  const byHardware = new Map<string, RecommendationAlternative>();
  for (const recommendation of recommendations) {
    for (const option of [recommendation.primary, ...recommendation.alternatives]) {
      if (option.procurementEligibility === "eligible") continue;
      const current = byHardware.get(option.hardware.id);
      if (!current || (option.price.median ?? Number.POSITIVE_INFINITY) < (current.price.median ?? Number.POSITIVE_INFINITY)) {
        byHardware.set(option.hardware.id, option);
      }
    }
  }
  return [...byHardware.values()].sort((left, right) =>
    (left.price.median ?? Number.POSITIVE_INFINITY) - (right.price.median ?? Number.POSITIVE_INFINITY) ||
    left.hardware.name.localeCompare(right.hardware.name));
}

export function jsonReport(context: ReportContext): Buffer {
  const recommendations = orderedRecommendations(context.recommendations);
  return Buffer.from(JSON.stringify({
    schemaVersion: CAPACITY_RECOMMENDATION_EXPORT_VERSION,
    generatedAt: new Date().toISOString(),
    scenario: context.scenario,
    executiveNarrative: buildExecutiveNarrative(context),
    qualifiedOptions: qualifiedOptions(recommendations),
    planningOptions: planningOptions(recommendations),
    recommendations,
  }, null, 2));
}

type ReportRow = Record<string, string | number | boolean | null>;

const POLICY_ROW_COLORS: Record<string, string> = {
  minimum: "FFE8F4FF",
  recommended: "FFE8F8DA",
  n_plus_one: "FFFFF1D6",
};

function appendSheet(workbook: ExcelJS.Workbook, name: string, inputRows: ReportRow[]): void {
  const rows = inputRows.length ? inputRows : [{ status: "No data" }];
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = headers.map((header) => {
    const longestValue = Math.max(header.length, ...rows.map((row) => String(row[header] ?? "").length));
    const containsLongText = longestValue > 48;
    return { header, key: header, width: containsLongText ? 60 : Math.min(34, Math.max(14, longestValue + 3)) };
  });
  const monetaryHeaders = new Set([
    "minimumProjectCost", "medianProjectCost", "maximumProjectCost",
    "unitCost", "perNodeCost", "projectCost", "minimum", "median", "maximum",
  ]);
  for (const headerName of headers) {
    if (monetaryHeaders.has(headerName)) sheet.getColumn(headerName).numFmt = "#,##0.00";
  }
  sheet.addRows(rows);
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FF071014" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC8FF3D" } };
  header.alignment = { vertical: "middle" };
  header.height = 26;
  const policyColumnIndex = headers.indexOf("policy");
  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.alignment = { vertical: "top", wrapText: true };
    const policy = policyColumnIndex >= 0 ? String(row.getCell(policyColumnIndex + 1).value ?? "") : "";
    if (POLICY_ROW_COLORS[policy]) {
      row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: POLICY_ROW_COLORS[policy] } };
      row.getCell(1).font = { bold: true, color: { argb: "FF071014" } };
    }
    const longestValue = Math.max(...headers.map((_header, columnIndex) => String(row.getCell(columnIndex + 1).value ?? "").length));
    row.height = Math.min(105, Math.max(20, Math.ceil(longestValue / 72) * 15));
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

function priceValue(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function priceBasisLabel(design: RecommendationAlternative): string {
  if (design.price.basis === "market_quotes") return "Market quotes";
  if (design.price.basis === "reference_estimate") return "Dated reference estimate";
  return "Quotation required";
}

function priceBasisPt(design: RecommendationAlternative): string {
  if (design.price.basis === "market_quotes") return "cotacoes de mercado";
  if (design.price.basis === "reference_estimate") return "estimativa de referencia datada";
  return "cotacao necessaria";
}

function operatingSystemFor(hardware: HardwareNodeTemplate): OperatingSystemFamily {
  if (hardware.operatingSystemFamily) return hardware.operatingSystemFamily;
  if (hardware.cpuVendor === "apple") return "macos";
  return hardware.windowsEdition.toLowerCase().includes("ubuntu") ? "ubuntu" : "windows";
}

function gpuMemoryDescription(hardware: HardwareNodeTemplate): string {
  if (hardware.memoryArchitecture === "unified") return `${hardware.ramGb} GB unified memory shared by CPU/GPU; no dedicated VRAM`;
  if (hardware.memoryArchitecture === "shared") return "Uses shared system memory; no dedicated VRAM";
  return `${hardware.gpuVramGbTotal} GB dedicated VRAM total per node`;
}

function componentCost(design: RecommendationAlternative, componentId: string) {
  return design.price.componentEstimates?.find((component) => component.componentId === componentId);
}

export async function xlsxReport({ scenario, recommendations: input }: ReportContext): Promise<Buffer> {
  const recommendations = orderedRecommendations(input);
  const narrative = buildExecutiveNarrative({ scenario, recommendations });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Aiquimist Qual Hardware";
  workbook.created = new Date();
  const first = recommendations[0]!;

  appendSheet(workbook, "Executive Summary", narrative.paragraphs.map((paragraph, index) => ({
    section: index === 0 ? narrative.title : `Explicação ${index + 1}`,
    text: paragraph,
  })).concat(narrative.cautions.map((text) => ({ section: "Atenção", text }))));

  appendSheet(workbook, "Scenario", [{
    project: scenario.scenario.projectName,
    customer: scenario.scenario.customerName,
    market: scenario.scenario.market,
    currency: scenario.scenario.currency,
    cameras: scenario.scenario.totalCameras,
    revision: scenario.revision,
    build: scenario.scenario.perceptrumBuildHash,
    contract: first.contractVersion,
    inputContract: scenario.scenario.workloadContractVersion,
    generatedConfigurations: recommendations.length,
    targetOperatingSystem: scenario.scenario.constraints.operatingSystem ?? "auto",
    selectedExistingHardware: scenario.scenario.constraints.requiredHardwareTemplateId ?? null,
  }]);

  appendSheet(workbook, "3 Configurations", recommendations.map((recommendation) => {
    const design = recommendation.primary;
    return {
      policy: recommendation.policy,
      proposal: POLICY_LABELS[recommendation.policy],
      confidence: recommendation.confidence,
      procurementEligibility: design.procurementEligibility,
      nodePlan: `${design.nodeCount} total / ${design.activeNodeCount} active / ${design.nodeCount - design.activeNodeCount} reserve`,
      hardware: design.hardware.name,
      formFactor: design.hardware.kind,
      operatingSystem: operatingSystemFor(design.hardware),
      targetHeadroomPercent: design.headroomPercent,
      maximumAdditionalCameras: design.maximumAdditionalCameras,
      dominantBottleneck: design.bottleneck,
      priceBasis: priceBasisLabel(design),
      currency: design.price.currency,
      minimumProjectCost: priceValue(design.price.minimum),
      medianProjectCost: priceValue(design.price.median),
      maximumProjectCost: priceValue(design.price.maximum),
      purchaseQuotationRequired: design.price.quotationRequired,
    };
  }));

  appendSheet(workbook, "Qualified Options", qualifiedOptions(recommendations).map((design, index) => ({
    costOrder: index + 1,
    hardware: design.hardware.name,
    cpu: design.hardware.cpuModel,
    gpu: `${design.hardware.gpuCount} x ${design.hardware.gpuModel}`,
    operatingSystem: operatingSystemFor(design.hardware),
    nodes: design.nodeCount,
    bottleneck: design.bottleneck,
    evidence: design.calibration?.status ?? "estimated",
    procurementEligibility: design.procurementEligibility,
    confidence: design.calibration?.confidenceClass ?? "none",
    reservePercent: design.calibration?.reservePercent ?? null,
    medianProjectCost: priceValue(design.price.median),
    quotationRequired: design.price.quotationRequired,
  })));

  appendSheet(workbook, "Planning Only", planningOptions(recommendations).map((design, index) => ({
    costOrder: index + 1,
    hardware: design.hardware.name,
    cpu: design.hardware.cpuModel,
    gpu: `${design.hardware.gpuCount} x ${design.hardware.gpuModel}`,
    operatingSystem: operatingSystemFor(design.hardware),
    evidence: design.calibration?.status ?? "reference_only",
    procurementEligibility: design.procurementEligibility,
    reason: "Evidence coverage is incomplete; do not use as purchase approval.",
    medianProjectCost: priceValue(design.price.median),
  })));

  appendSheet(workbook, "BOM", recommendations.flatMap((recommendation) => {
    const design = recommendation.primary;
    const hardware = design.hardware;
    const base = { policy: recommendation.policy, proposal: POLICY_LABELS[recommendation.policy], nodes: design.nodeCount, currency: design.price.currency, priceBasis: priceBasisLabel(design) };
    const priced = (componentId: string) => {
      const cost = componentCost(design, componentId);
      return {
        quantityPerNode: cost?.quantityPerNode ?? null,
        unitCost: priceValue(cost?.unitAmount ?? null),
        perNodeCost: priceValue(cost?.perNodeAmount ?? null),
        projectCost: priceValue(cost?.projectAmount ?? null),
      };
    };
    const systemPerNode = design.price.median === null ? null : design.price.median / design.nodeCount;
    return [
      { ...base, component: "SYSTEM TOTAL", specification: hardware.name, details: `${hardware.kind}; ${operatingSystemFor(hardware)}; ${hardware.generation} generation`, quantityPerNode: 1, unitCost: priceValue(systemPerNode), perNodeCost: priceValue(systemPerNode), projectCost: priceValue(design.price.median) },
      { ...base, component: "CPU", specification: hardware.cpuModel, details: `${hardware.cpuVendor}; ${hardware.physicalCores} physical cores per node; ${Math.round((hardware.sustainedComputeFactor ?? 1) * 100)}% conservative sustained sizing factor`, ...priced("cpu") },
      { ...base, component: "Motherboard / platform", specification: hardware.motherboard, details: "Platform compatibility per hardware template", ...priced("motherboard") },
      { ...base, component: "RAM", specification: `${hardware.ramGb} GB per node`, details: `ECC: ${hardware.ecc ? "yes" : "no"}; architecture: ${hardware.memoryArchitecture ?? "dedicated"}`, ...priced("ram") },
      { ...base, component: "GPU", specification: `${hardware.gpuCount} x ${hardware.gpuModel}`, details: `${hardware.gpuVendor}; ${gpuMemoryDescription(hardware)}`, ...priced("gpu") },
      { ...base, component: "AiQ / video decode", specification: `${hardware.localAiqSlots} local AiQ slots; ${hardware.gpuDecode1080p30Streams} reference 1080p30 streams`, details: `Perceptrum GPU decode: ${hardware.supportsPerceptrumGpuDecode ? "supported" : "not supported"}`, quantityPerNode: null, unitCost: null, perNodeCost: null, projectCost: null },
      { ...base, component: "Operational NVMe", specification: hardware.storageModel, details: `${hardware.usableStorageTb} TB usable; rolling clips, configured retention, write throughput and RAID participate in sizing`, ...priced("storage") },
      { ...base, component: "Network", specification: `${hardware.nicGbps} GbE per node`, details: "LAN and RTSP stream capacity", ...priced("network") },
      { ...base, component: "Power / cooling / chassis", specification: `${hardware.powerSupply}; ${hardware.cooling}; ${hardware.chassis}`, details: `Expansion score: ${hardware.expansionScore}`, ...priced("power_cooling_chassis") },
      { ...base, component: "Operating system", specification: hardware.windowsEdition, details: `${operatingSystemFor(hardware)} target; matching Perceptrum build and benchmark required`, quantityPerNode: null, unitCost: null, perNodeCost: null, projectCost: null },
      { ...base, component: "Assembly / integration", specification: "Hardware assembly, firmware baseline and burn-in allowance", details: "Planning allowance; excludes licenses and support", ...priced("integration") },
    ];
  }));

  appendSheet(workbook, "Component Evidence", recommendations.flatMap((recommendation): ReportRow[] => {
    const design = recommendation.primary;
    const build = design.bom;
    if (!build) return [{ policy: recommendation.policy, status: "Legacy recommendation without component BOM" }];
    return build.items.map((item) => ({
      policy: recommendation.policy,
      buildId: build.id,
      buildKind: build.kind,
      componentId: item.componentId,
      componentKind: item.kind,
      role: item.role,
      quantity: item.quantity,
      required: item.required,
      compatibility: build.compatibility.every((decision) => decision.compatible),
      procurementEligibility: build.procurementGate.eligibility,
      physicalAnchors: build.coverage.physicalAnchorCount,
      coveragePercent: build.coverage.percent,
      sourceUrls: build.sourceUrls.join("; "),
    }));
  }));

  appendSheet(workbook, "Stage Evidence", recommendations.flatMap((recommendation): ReportRow[] => {
    const design = recommendation.primary;
    return (design.coverage?.stages ?? []).map((stage) => ({
      policy: recommendation.policy,
      hardware: design.hardware.name,
      stage: stage.stage,
      covered: stage.covered,
      componentIds: stage.componentIds.join("; "),
      eligibleBenchmarks: stage.eligibleObservationIds.join("; "),
      referenceBenchmarks: stage.referenceObservationIds.join("; "),
      physicalAnchors: stage.physicalAnchorRunIds.join("; "),
      reasons: stage.reasons.join("; "),
    }));
  }));

  appendSheet(workbook, "Nodes", recommendations.flatMap((recommendation) => recommendation.primary.allocations.map((node) => ({
    policy: recommendation.policy,
    proposal: POLICY_LABELS[recommendation.policy],
    node: node.nodeIndex,
    role: node.role,
    cameras: node.cameraGroups.reduce((sum, group) => sum + group.cameras, 0),
    groups: node.cameraGroups.map((group) => `${group.groupName}:${group.cameras}`).join("; "),
    cpuPercent: Math.round(node.utilization.cpuCores * 100),
    ramPercent: Math.round(node.utilization.ramGb * 100),
    vramPercent: Math.round(node.utilization.gpuVramGb * 100),
    decoderPercent: Math.round(node.utilization.gpuDecode1080p30Streams * 100),
    lanPercent: Math.round(node.utilization.lanGbps * 100),
    internetPercent: Math.round(node.utilization.internetUploadMbps * 100),
  }))));

  appendSheet(workbook, "Workload", scenario.scenario.cameraGroups.map((group) => ({
    group: group.name,
    cameras: group.count,
    codec: group.source.codec,
    resolution: `${group.source.width}x${group.source.height}`,
    sourceFps: group.source.sourceFps,
    bitrateMbps: group.source.bitrateMbps,
    decode: group.decodeMode,
    motionPercent: group.motionPercent,
    agents: group.agents.map((agent) => [
      agent.name,
      agent.model,
      agent.inputType,
      agent.packaging,
      `${agent.modelFps}fps`,
      `${agent.runEverySeconds}s`,
      `motionOnly=${agent.features.onlyCaptureOnMotion}`,
      `regions=${agent.features.regions}`,
      `crop=${agent.features.croppedFrame}`,
      `faces=${agent.features.faceReferences}`,
      `negativeRefs=${agent.features.negativeReferences}`,
      `temporal=${agent.features.temporal}`,
    ].join("/")).join("; "),
  })));

  appendSheet(workbook, "Calculations", recommendations.flatMap((recommendation) => Object.entries(recommendation.primary.aggregateDemand).map(([resource, demand]) => ({
    policy: recommendation.policy,
    proposal: POLICY_LABELS[recommendation.policy],
    resource,
    aggregateDemand: demand,
    usedForSizing: true,
    bottleneck: resource === recommendation.primary.bottleneck,
  }))));

  appendSheet(workbook, "Quotes", recommendations.flatMap((recommendation) => {
    const design = recommendation.primary;
    const urls = design.price.sourceUrls.length ? design.price.sourceUrls : [null];
    return urls.map((url) => ({
      policy: recommendation.policy,
      proposal: POLICY_LABELS[recommendation.policy],
      hardware: design.hardware.name,
      currency: design.price.currency,
      priceBasis: priceBasisLabel(design),
      observedAt: design.price.observedAt,
      minimum: priceValue(design.price.minimum),
      median: priceValue(design.price.median),
      maximum: priceValue(design.price.maximum),
      quotationRequired: design.price.quotationRequired,
      quoteCount: design.price.quoteCount,
      staleQuotes: design.price.staleQuoteCount,
      exclusions: (design.price.exclusions ?? []).join(", "),
      sourceUrl: url,
    }));
  }));

  appendSheet(workbook, "Assumptions", recommendations.flatMap((recommendation) => [
    ...recommendation.assumptions.map((text) => ({ policy: recommendation.policy, type: "assumption", text })),
    ...recommendation.primary.warnings.map((text) => ({ policy: recommendation.policy, type: "warning", text })),
    ...recommendation.evidence.map((text) => ({ policy: recommendation.policy, type: "evidence", text })),
  ]));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function wrap(text: string, width = 92): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const originalWord of words) {
    let word = originalWord;
    if (word.length > width) {
      if (line) { lines.push(line); line = ""; }
      while (word.length > width) {
        lines.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (!word) continue;
    }
    if (`${line} ${word}`.trim().length > width) {
      if (line) lines.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines;
}

function pdfSafe(text: string): string {
  return text
    .replaceAll("→", "->")
    .replaceAll("×", "x")
    .replaceAll("·", "-")
    .replaceAll("•", "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, "?");
}

interface PdfWriter {
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  newPage: () => void;
  ensureSpace: (height: number) => void;
  line: (text: string, size?: number, isBold?: boolean, indent?: number) => void;
  heading: (text: string) => void;
}

function createPdfWriter(document: PDFDocument, regular: PDFFont, bold: PDFFont): PdfWriter {
  const writer = {} as PdfWriter;
  writer.regular = regular;
  writer.bold = bold;
  writer.page = document.addPage([595, 842]);
  writer.y = 790;
  writer.newPage = (): void => {
    writer.page = document.addPage([595, 842]);
    writer.y = 790;
  };
  writer.ensureSpace = (height: number): void => {
    if (writer.y < height) writer.newPage();
  };
  writer.line = (text: string, size = 9.5, isBold = false, indent = 0): void => {
    const width = size >= 18 ? 52 : Math.max(50, 92 - indent * 2);
    for (const line of wrap(pdfSafe(text), width)) {
      if (writer.y < 55) writer.newPage();
      writer.page.drawText(line, {
        x: 48 + indent,
        y: writer.y,
        size,
        font: isBold ? bold : regular,
        color: rgb(0.08, 0.12, 0.18),
      });
      writer.y -= size + 4.5;
    }
  };
  writer.heading = (text: string): void => {
    writer.ensureSpace(95);
    writer.y -= 5;
    writer.page.drawRectangle({ x: 48, y: writer.y - 4, width: 4, height: 17, color: rgb(0.56, 0.75, 0.12) });
    writer.line(text, 14, true, 12);
    writer.y -= 5;
  };
  return writer;
}

function formatPrice(design: RecommendationAlternative): string {
  const price = design.price;
  if (price.median === null) return "Cotação necessária - nenhum valor de referência compatível foi encontrado.";
  const range = `${price.currency} ${formatMoney(price.minimum)} / ${formatMoney(price.median)} / ${formatMoney(price.maximum)}`;
  if (price.basis === "reference_estimate") return `${range} (faixa estimada; cotação de compra necessária)`;
  return `${range} (mínimo / mediano / máximo de mercado)`;
}

function formatMoney(value: number | null): string {
  if (value === null) return "-";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

function addConfiguration(writer: PdfWriter, recommendation: CapacityRecommendation, index: number): void {
  writer.newPage();
  const design = recommendation.primary;
  const hardware = design.hardware;
  writer.page.drawRectangle({ x: 0, y: 744, width: 595, height: 98, color: rgb(0.04, 0.09, 0.11) });
  writer.page.drawText(pdfSafe(`PROPOSTA ${index} DE 3`), { x: 48, y: 805, size: 9, font: writer.bold, color: rgb(0.78, 1, 0.24) });
  writer.page.drawText(pdfSafe(POLICY_LABELS[recommendation.policy]), { x: 48, y: 774, size: 22, font: writer.bold, color: rgb(0.94, 0.97, 0.98) });
  writer.page.drawText(pdfSafe(`${recommendation.confidence.toUpperCase()} - ${design.nodeCount} no(s) - ${hardware.name}`), {
    x: 48, y: 754, size: 9, font: writer.regular, color: rgb(0.65, 0.73, 0.76),
  });
  writer.y = 720;

  writer.heading("Resumo de capacidade");
  writer.line(`Nos: ${design.nodeCount}; ativos: ${design.activeNodeCount}; reserva: ${design.nodeCount - design.activeNodeCount}.`);
  writer.line(`Folga-alvo: ${design.headroomPercent}%; gargalo dominante: ${design.bottleneck}; capacidade estimada neste perfil: ${recommendation.primary.maximumAdditionalCameras + recommendation.primary.allocations.filter((node) => node.role === "active").reduce((sum, node) => sum + node.cameraGroups.reduce((cameraSum, group) => cameraSum + group.cameras, 0), 0)} cameras (${design.maximumAdditionalCameras} adicionais).`);
  writer.line(`Preco do projeto: ${formatPrice(design)}`);

  writer.heading("Especificacao tecnica por no");
  writer.line(`Sistema: ${hardware.name}; formato: ${hardware.kind}; plataforma: ${operatingSystemFor(hardware)}; geracao: ${hardware.generation}.`, 10, true);
  writer.line(`CPU: ${hardware.cpuModel}; fabricante ${hardware.cpuVendor}; ${hardware.physicalCores} nucleos fisicos; fator conservador sustentado ${Math.round((hardware.sustainedComputeFactor ?? 1) * 100)}%.`);
  writer.line(`Placa-mae/plataforma: ${hardware.motherboard}.`);
  writer.line(`RAM: ${hardware.ramGb} GB por no; ECC: ${hardware.ecc ? "sim" : "nao"}; arquitetura: ${hardware.memoryArchitecture}.`);
  writer.line(`GPU: ${hardware.gpuCount} x ${hardware.gpuModel} (${hardware.gpuVendor}); ${gpuMemoryDescription(hardware)}.`);
  writer.line(`AiQ local: ${hardware.localAiqSlots} instancia(s) por no; decode Perceptrum GPU: ${hardware.supportsPerceptrumGpuDecode ? "compativel" : "nao compativel"}; capacidade de referencia: ${hardware.gpuDecode1080p30Streams} streams 1080p30.`);
  writer.line(`NVMe operacional: ${hardware.storageModel}; ${hardware.usableStorageTb} TB uteis; escrita, clips temporarios, retencao e RAID participam do dimensionamento.`);
  if (design.calibration) {
    const calibration = design.calibration;
    writer.line(`Evidencia de capacidade: ${calibration.status}; confianca ${calibration.confidenceClass}; intervalo seguro ${calibration.safeCameraMinimum ?? "n/d"}-${calibration.safeCameraMaximum ?? "n/d"} cameras; reserva ${calibration.reservePercent}%; gargalo ${calibration.bottleneck ?? "sem cobertura"}.`);
    for (const stage of calibration.stagePredictions) {
      writer.line(`Extrapolacao ${stage.stage}: ${stage.safeCameraCapacity} cameras seguras, ${stage.reservePercent}% de reserva, ancoras ${stage.anchorHardwareIds.join(", ") || "nenhuma"}.`);
    }
  }
  writer.line(`Rede: ${hardware.nicGbps} GbE; fonte: ${hardware.powerSupply}; refrigeracao: ${hardware.cooling}.`);
  writer.line(`Chassi: ${hardware.chassis}; sistema operacional: ${hardware.windowsEdition}; indice de expansao: ${hardware.expansionScore}.`);

  if (design.bom) {
    writer.heading("BOM auditavel, compatibilidade e cobertura");
    writer.line(`Build ${design.bom.id}; classe ${design.bom.kind}; gate ${design.bom.procurementGate.status}; cobertura ${design.bom.coverage.coveredStageCount}/${design.bom.coverage.requiredStageCount} estagios (${design.bom.coverage.percent}%); ancoras fisicas ${design.bom.coverage.physicalAnchorCount}/3.`, 9.5, true);
    for (const item of design.bom.items) writer.line(`${item.role}: ${item.quantity} x ${item.componentId} (${item.kind})${item.required ? " - obrigatorio" : ""}.`);
    for (const decision of design.bom.compatibility) writer.line(`${decision.compatible ? "COMPATIVEL" : "INCOMPATIVEL"} ${decision.code}: ${decision.message}`);
    for (const stage of design.bom.coverage.stages) {
      writer.line(`${stage.covered ? "COBERTO" : "BLOQUEADO"} ${stage.stage}: benchmarks ${stage.eligibleObservationIds.length}; ancoras ${stage.physicalAnchorRunIds.length}; ${stage.reasons.join(" ") || "evidencia completa"}.`);
    }
  }

  writer.heading("Custo por componente e total do projeto");
  if (design.price.componentEstimates?.length) {
    for (const component of design.price.componentEstimates) {
      writer.line(`${component.component}: ${component.quantityPerNode} por no; ${design.price.currency} ${formatMoney(component.perNodeAmount)} por no; ${design.price.currency} ${formatMoney(component.projectAmount)} no projeto.`);
    }
    const perNodeTotal = design.price.median === null ? null : design.price.median / design.nodeCount;
    writer.line(`TOTAL POR NO: ${design.price.currency} ${formatMoney(perNodeTotal)}.`, 10, true);
    writer.line(`QUANTIDADE DE NOS: ${design.nodeCount}. TOTAL DO PROJETO: ${design.price.currency} ${formatMoney(design.price.median)}.`, 10, true);
    writer.line(`Faixa do projeto: ${formatPrice(design)}.`);
    writer.line(`Base: ${priceBasisPt(design)}; referencia: ${design.price.observedAt ?? "nao disponivel"}; exclui ${(design.price.exclusions ?? []).join(", ")}.`);
  } else writer.line("Sem estimativa compativel; obter cotacao itemizada antes da proposta comercial.");

  writer.heading("Distribuicao das cameras e utilizacao");
  for (const node of design.allocations) {
    const cameraCount = node.cameraGroups.reduce((sum, group) => sum + group.cameras, 0);
    writer.line(`No ${node.nodeIndex} - ${node.role} - ${cameraCount} camera(s) - ${node.cameraGroups.map((group) => `${group.groupName}: ${group.cameras}`).join(", ") || "reserva sem cameras"}.`, 9.5, true);
    writer.line(`CPU ${Math.round(node.utilization.cpuCores * 100)}%; RAM ${Math.round(node.utilization.ramGb * 100)}%; VRAM ${Math.round(node.utilization.gpuVramGb * 100)}%; NVDEC ${Math.round(node.utilization.gpuDecode1080p30Streams * 100)}%; LAN ${Math.round(node.utilization.lanGbps * 100)}%; Internet ${Math.round(node.utilization.internetUploadMbps * 100)}%.`, 9, false, 10);
  }

  writer.heading("Demanda agregada calculada");
  for (const [resource, demand] of Object.entries(design.aggregateDemand)) {
    const sizing = true;
    writer.line(`${resource}: ${Math.round(demand * 1000) / 1000}${resource === design.bottleneck ? " - GARGALO" : ""}${sizing ? "" : " - observacional"}.`);
  }

  writer.heading("Fontes, premissas e avisos");
  for (const source of hardware.sources) writer.line(`Fonte tecnica: ${source.title} - ${source.url}`);
  for (const source of design.price.sourceUrls) writer.line(`Fonte de preco: ${source}`);
  for (const warning of design.warnings) writer.line(`AVISO: ${warning}`);
  for (const assumption of recommendation.assumptions) writer.line(`Premissa: ${assumption}`);
  for (const evidence of recommendation.evidence) writer.line(`Evidencia: ${evidence}`);
}

export async function pdfReport({ scenario, recommendations: input }: ReportContext): Promise<Buffer> {
  const recommendations = orderedRecommendations(input);
  const narrative = buildExecutiveNarrative({ scenario, recommendations });
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const writer = createPdfWriter(document, regular, bold);

  writer.line("AIQUIMIST - QUAL HARDWARE", 12, true);
  writer.line("Relatório comparativo de infraestrutura", 22, true);
  writer.y -= 8;
  writer.line(`${scenario.scenario.projectName} - ${scenario.scenario.totalCameras} câmeras`, 13, true);
  writer.line(`Cliente: ${scenario.scenario.customerName || "não informado"}; mercado: ${scenario.scenario.market}; moeda: ${scenario.scenario.currency}.`);
  writer.line(`Revisão ${scenario.revision}; build ${scenario.scenario.perceptrumBuildHash}; contrato ${recommendations[0]!.contractVersion}.`);
  writer.y -= 10;
  writer.heading(narrative.title);
  for (const paragraph of narrative.paragraphs) {
    writer.line(paragraph, 10);
    writer.y -= 4;
  }
  for (const caution of narrative.cautions) writer.line(`ATENÇÃO: ${caution}`, 9.5, true);

  writer.heading("As três configurações sugeridas");
  for (const recommendation of recommendations) {
    const design = recommendation.primary;
    writer.line(`${POLICY_LABELS[recommendation.policy]}: ${design.nodeCount} nó(s), ${design.activeNodeCount} ativo(s), ${design.hardware.name}, ${operatingSystemFor(design.hardware)}.`, 11, true);
    writer.line(`CPU ${design.hardware.cpuModel}; RAM ${design.hardware.ramGb} GB/nó (${design.hardware.memoryArchitecture}); GPU ${design.hardware.gpuCount} x ${design.hardware.gpuModel}; ${gpuMemoryDescription(design.hardware)}; folga ${design.headroomPercent}%; preço ${formatPrice(design)}.`, 9, false, 10);
  }

  const qualified = qualifiedOptions(recommendations);
  writer.heading("Maquinas aptas para aquisicao em ordem crescente de custo");
  if (!qualified.length) writer.line("Nenhuma maquina esta apta para aquisicao: faltam evidencias numericas e calibracoes fisicas completas para todos os estagios.", 9.5, true);
  for (const [index, option] of qualified.entries()) {
    writer.line(`${index + 1}. ${option.hardware.name} - ${option.hardware.cpuModel} - ${option.hardware.gpuModel} - ${formatPrice(option)} - evidencia ${option.calibration?.status ?? "estimada"}.`, 9.5);
  }
  writer.heading("Referencias de planejamento bloqueadas para compra");
  for (const [index, option] of planningOptions(recommendations).entries()) {
    writer.line(`${index + 1}. ${option.hardware.name} - ${formatPrice(option)} - ${option.calibration?.status ?? "reference_only"}; nao comprar sem completar as evidencias.`, 9.5);
  }

  writer.heading("Carga de cameras e Agents usada no calculo");
  for (const group of scenario.scenario.cameraGroups) {
    writer.line(`${group.count} camera(s) - ${group.name}: ${group.source.codec.toUpperCase()} ${group.source.width}x${group.source.height}, ${group.source.sourceFps} FPS RTSP, ${group.source.bitrateMbps} Mbps, decode ${group.decodeMode}.`, 9.5, true);
    for (const agent of group.agents) {
      const media = agent.inputType === "video" ? `video, ${agent.packaging}, ${agent.modelFps} FPS` : "imagem, 1 frame";
      writer.line(`- ${agent.name}: ${agent.model}, ${media}, a cada ${agent.runEverySeconds}s, movimento=${agent.features.onlyCaptureOnMotion}, regioes=${agent.features.regions}, recorte=${agent.features.croppedFrame}, faces=${agent.features.faceReferences}, negativas=${agent.features.negativeReferences}, temporal=${agent.features.temporal}.`, 9, false, 10);
    }
  }

  recommendations.forEach((recommendation, index) => addConfiguration(writer, recommendation, index + 1));

  const pages = document.getPages();
  pages.forEach((reportPage, index) => reportPage.drawText(
    pdfSafe(`Qual Hardware | pagina ${index + 1} de ${pages.length}`),
    { x: 48, y: 24, size: 8, font: regular, color: rgb(0.35, 0.4, 0.45) },
  ));
  return Buffer.from(await document.save());
}
