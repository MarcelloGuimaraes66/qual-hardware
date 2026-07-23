import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import ExcelJS from "exceljs";
import type {
  CapacityRecommendation,
  HardwareComponent,
  HardwareNodeTemplate,
  OperatingSystemFamily,
  ComponentBuild,
  PublicBenchmarkObservation,
  RecommendationAlternative,
  RecommendationPolicy,
  ScenarioRecord,
} from "../shared/types.js";
import { CAPACITY_RECOMMENDATION_EXPORT_VERSION } from "../shared/types.js";
import { procurementReportOptions, uniqueRecommendationOptions } from "../engine/procurementSpecifications.js";
import { marketLabelPt, scenarioMarkets } from "../shared/markets.js";
import { referencePdfReport } from "./referencePdfReport.js";

export interface ReportContext {
  scenario: ScenarioRecord;
  recommendations: CapacityRecommendation[];
  components?: HardwareComponent[];
  builds?: ComponentBuild[];
  benchmarkObservations?: PublicBenchmarkObservation[];
}

const POLICY_ORDER: RecommendationPolicy[] = ["minimum", "recommended", "n_plus_one"];
const POLICY_LABELS: Record<RecommendationPolicy, string> = {
  minimum: "1. Mínimo técnico",
  recommended: "2. Recomendado",
  n_plus_one: "3. N+1 resiliente",
};

export const PDF_REPORT_OUTLINE = Object.freeze({
  title: "Relatório comparativo de infraestrutura",
  executiveNarrative: "Nossa leitura e recomendação em linguagem direta",
  configurations: "As três configurações sugeridas",
  qualifiedMachines: "Outras máquinas qualificadas em ordem crescente de custo",
  workload: "Carga de câmeras e Agents usada no cálculo",
  proposalSections: [
    "Resumo de capacidade",
    "Especificação técnica por nó",
    "Custo por componente e total do projeto",
    "Distribuição das câmeras e utilização",
    "Demanda agregada calculada",
    "Fontes, premissas e avisos",
  ],
  detailedSpecifications: "Parte II - Especificações técnicas detalhadas por máquina",
} as const);

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
      `${recommendation} O limitante calculado desta proposta é ${reportLabel(selected.bottleneck)}; por isso a recomendação considera o conjunto CPU, GPU, VRAM, RAM, SSD, rede e sustentação térmica, e não apenas a marca ou um índice genérico.`,
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

function detailedPdfOptions(recommendations: CapacityRecommendation[]): RecommendationAlternative[] {
  const selected = new Map<string, RecommendationAlternative>();
  for (const option of [...qualifiedOptions(recommendations), ...planningOptions(recommendations)]) {
    selected.set(`${option.hardware.id}:${option.nodeCount}:${option.activeNodeCount}`, option);
  }
  return [...selected.values()].sort((left, right) =>
    (left.price.median ?? Number.POSITIVE_INFINITY) - (right.price.median ?? Number.POSITIVE_INFINITY) ||
    left.hardware.name.localeCompare(right.hardware.name));
}

export function jsonReport(context: ReportContext): Buffer {
  const recommendations = orderedRecommendations(context.recommendations);
  const commercialAndNeutralOptions = procurementReportOptions(recommendations);
  const usedComponentIds = new Set(uniqueRecommendationOptions(recommendations).flatMap((option) => option.bom?.items.map((item) => item.componentId) ?? []));
  const componentTechnicalSpecifications = (context.components ?? [])
    .filter((component) => usedComponentIds.has(component.id))
    .map((component) => ({
      componentId: component.id,
      manufacturer: component.manufacturer,
      canonicalMpn: component.canonicalMpn ?? component.sku,
      technicalSpecification: component.technicalSpecification ?? null,
    }));
  return Buffer.from(JSON.stringify({
    schemaVersion: CAPACITY_RECOMMENDATION_EXPORT_VERSION,
    generatedAt: new Date().toISOString(),
    scenario: context.scenario,
    executiveNarrative: buildExecutiveNarrative(context),
    qualifiedOptions: qualifiedOptions(recommendations),
    planningOptions: planningOptions(recommendations),
    commercialAndNeutralOptions,
    componentTechnicalSpecifications,
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
  if (design.price.basis === "market_quotes") return "cotações de mercado";
  if (design.price.basis === "reference_estimate") return "estimativa de referência datada";
  return "cotação necessária";
}

function operatingSystemFor(hardware: HardwareNodeTemplate): OperatingSystemFamily {
  if (hardware.operatingSystemFamily) return hardware.operatingSystemFamily;
  if (hardware.cpuVendor === "apple") return "macos";
  return hardware.windowsEdition.toLowerCase().includes("ubuntu") ? "ubuntu" : "windows";
}

function gpuMemoryDescription(hardware: HardwareNodeTemplate): string {
  if (hardware.memoryArchitecture === "unified") return `${hardware.ramGb} GB de memória unificada compartilhada entre CPU e GPU; sem VRAM dedicada`;
  if (hardware.memoryArchitecture === "shared") return "usa memória do sistema compartilhada; sem VRAM dedicada";
  return `${hardware.gpuVramGbTotal} GB de VRAM dedicada por nó`;
}

function componentCost(design: RecommendationAlternative, componentId: string) {
  return design.price.componentEstimates?.find((component) => component.componentId === componentId);
}

export async function xlsxReport({ scenario, recommendations: input, components = [] }: ReportContext): Promise<Buffer> {
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
    searchedMarkets: marketLabelPt(scenarioMarkets(scenario.scenario)),
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

  appendSheet(workbook, "Fleet Plan", recommendations.map((recommendation) => {
    const design = recommendation.primary;
    const fleet = design.fleetPlan;
    return {
      policy: recommendation.policy,
      status: fleet?.status ?? "legacy_unavailable",
      workloadSignature: fleet?.workloadSignature ?? null,
      projectCameras: fleet?.projectCameraCount ?? scenario.scenario.totalCameras,
      safeCamerasPerServer: fleet?.safeCamerasPerServer ?? null,
      activeServers: fleet?.activeServers ?? design.activeNodeCount,
      reserveServers: fleet?.reserveServers ?? design.nodeCount - design.activeNodeCount,
      totalServers: fleet?.totalServers ?? design.nodeCount,
      redundancyPolicy: fleet?.redundancyPolicy ?? null,
      cpuSocketsPerServer: fleet?.perServer.cpuSockets ?? design.hardware.cpuSocketCount ?? 1,
      physicalCoresPerServer: fleet?.perServer.physicalCores ?? design.hardware.physicalCores,
      logicalCoresPerServer: fleet?.perServer.logicalCores ?? design.hardware.physicalCores,
      gpuPerServer: fleet?.perServer.gpuCount ?? design.hardware.gpuCount,
      ramGbPerServer: fleet ? Math.ceil(fleet.perServer.ramBytes / 1024 ** 3) : design.hardware.ramGb,
      networkGbpsPerServer: fleet?.perServer.networkGbps ?? design.hardware.nicGbps,
      totalCpuSockets: fleet?.totals.cpuSockets ?? null,
      totalPhysicalCores: fleet?.totals.physicalCores ?? null,
      totalGpu: fleet?.totals.gpuCount ?? null,
      totalRamGb: fleet ? Math.ceil(fleet.totals.ramBytes / 1024 ** 3) : null,
      totalNetworkGbps: fleet?.totals.networkGbps ?? null,
      degradedSafeCamerasPerServer: fleet?.degradedSafeCamerasPerServer ?? null,
      maximumAdditionalCameras: fleet?.maximumAdditionalCameras ?? design.maximumAdditionalCameras,
      bottleneck: fleet?.bottleneck ?? design.bottleneck,
      clusterPilotRequired: fleet?.status === "planning_only",
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

  const reportOptions = uniqueRecommendationOptions(recommendations);
  appendSheet(workbook, "Commercial Reference", reportOptions.flatMap((design, optionIndex): ReportRow[] => {
    const reference = design.commercialReference;
    if (!reference) return [{ option: optionIndex + 1, status: "Commercial reference unavailable in legacy recommendation" }];
    return reference.components.map((component) => ({
      option: optionIndex + 1,
      hardware: reference.hardwareName,
      nodes: reference.nodeCount,
      activeNodes: reference.activeNodeCount,
      operatingSystem: reference.operatingSystem,
      componentKind: component.kind,
      componentRole: component.role,
      quantityPerNode: component.quantityPerNode,
      manufacturer: component.manufacturer,
      model: component.model,
      canonicalMpn: component.canonicalMpn,
      specificationCompletenessPercent: component.specificationCompletenessPercent,
      projectPrice: priceValue(reference.projectPrice),
      currency: reference.currency,
      priceBasis: reference.priceBasis,
      sourceUrls: component.sourceUrls.join("; "),
    }));
  }));

  const componentById = new Map(components.map((component) => [component.id, component]));
  appendSheet(workbook, "Detailed Specifications", reportOptions.flatMap((design, optionIndex): ReportRow[] =>
    (design.commercialReference?.components ?? []).flatMap((reference) => {
      const specification = componentById.get(reference.componentId)?.technicalSpecification;
      if (!specification?.fields.length) return [{
        option: optionIndex + 1, hardware: design.hardware.name, componentKind: reference.kind,
        manufacturer: reference.manufacturer, model: reference.model, fieldStatus: "not_published",
        field: "Especificação oficial por campo indisponível",
      }];
      return specification.fields.map((field) => ({
        option: optionIndex + 1,
        hardware: design.hardware.name,
        componentKind: reference.kind,
        componentRole: reference.role,
        quantityPerNode: reference.quantityPerNode,
        manufacturer: reference.manufacturer,
        model: reference.model,
        canonicalMpn: reference.canonicalMpn,
        section: field.sectionLabelPt ?? null,
        field: field.labelPt,
        normalizedValue: field.value,
        unit: field.unit,
        originalLabel: field.originalLabel,
        originalValue: field.originalValue,
        fieldStatus: field.status,
        confidence: field.confidence,
        sourceIds: field.sourceEvidence.map((item) => item.sourceId).join("; "),
        sourceUrls: field.sourceEvidence.map((item) => item.url).join("; "),
        evidenceLocations: field.sourceEvidence.map((item) => item.evidenceLocator).join("; "),
        resolution: field.resolution?.rationale ?? null,
      }));
    }),
  ));

  appendSheet(workbook, "Neutral TR Specification", reportOptions.flatMap((design, optionIndex): ReportRow[] => {
    const specification = design.procurementNeutralSpecification;
    if (!specification) return [{ option: optionIndex + 1, status: "Neutral specification unavailable in legacy recommendation" }];
    return specification.requirements.map((item) => ({
      option: optionIndex + 1,
      specificationStatus: specification.status,
      componentKind: item.componentKind,
      componentRole: item.componentRole,
      characteristic: item.characteristic,
      comparator: item.comparator,
      value: item.value,
      maximumValue: item.maximumValue ?? null,
      unit: item.unit,
      mandatory: item.mandatory,
      quantityPerNode: item.quantityPerNode,
      projectQuantity: item.projectQuantity,
      rationale: item.rationale,
      acceptanceCriterion: item.acceptanceCriterion,
    }));
  }));

  appendSheet(workbook, "TR Compliance Matrix", reportOptions.flatMap((design, optionIndex): ReportRow[] =>
    (design.procurementNeutralSpecification?.requirements ?? []).map((item) => ({
      option: optionIndex + 1,
      requirementId: item.id,
      characteristic: item.characteristic,
      mandatory: item.mandatory,
      sourceStage: item.sourceStage,
      proofMethod: item.proofMethod,
      acceptanceCriterion: item.acceptanceCriterion,
      matchingProducts: item.matchingComponentIds.length,
      evidenceGate: design.procurementEligibility,
    })),
  ));

  appendSheet(workbook, "Market Competition", reportOptions.map((design, optionIndex) => {
    const assessment = design.marketCompetitionAssessment;
    return {
      option: optionIndex + 1,
      neutralSpecificationStatus: design.procurementNeutralSpecification?.status ?? "unavailable",
      assessment: assessment?.status ?? "no_coverage",
      matchingProductsAtLimitingRequirement: assessment?.matchingProductCount ?? 0,
      distinctManufacturers: assessment?.distinctManufacturerCount ?? 0,
      safeForPublication: assessment?.safeForPublication ?? false,
      reasons: assessment?.reasons.join("; ") ?? "No assessment",
      forbiddenIdentifierFindings: design.procurementNeutralSpecification?.forbiddenIdentifierFindings.join("; ") ?? "",
    };
  }));

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
  const bomSheet = workbook.getWorksheet("BOM")!;
  const bomHeaders = (bomSheet.getRow(1).values as unknown[]).map((value) => String(value ?? ""));
  const column = (name: string): number => bomHeaders.indexOf(name);
  const componentRows = Array.from({ length: bomSheet.rowCount - 1 }, (_unused, index) => index + 2);
  const systemRows = componentRows.filter((row) => bomSheet.getRow(row).getCell(column("component")).value === "SYSTEM TOTAL");
  for (const row of componentRows) {
    if (systemRows.includes(row)) continue;
    const quantity = bomSheet.getRow(row).getCell(column("quantityPerNode")).value;
    const unitCost = bomSheet.getRow(row).getCell(column("unitCost")).value;
    if (typeof quantity !== "number" || typeof unitCost !== "number") continue;
    const perNodeCell = bomSheet.getRow(row).getCell(column("perNodeCost"));
    const projectCell = bomSheet.getRow(row).getCell(column("projectCost"));
    const perNodeResult = typeof perNodeCell.value === "number" ? perNodeCell.value : quantity * unitCost;
    const projectResult = typeof projectCell.value === "number" ? projectCell.value : perNodeResult * Number(bomSheet.getRow(row).getCell(column("nodes")).value ?? 0);
    perNodeCell.value = { formula: `${bomSheet.getRow(row).getCell(column("quantityPerNode")).address}*${bomSheet.getRow(row).getCell(column("unitCost")).address}`, result: perNodeResult };
    projectCell.value = { formula: `${perNodeCell.address}*${bomSheet.getRow(row).getCell(column("nodes")).address}`, result: projectResult };
  }
  for (const [index, row] of systemRows.entries()) {
    const lastRow = (systemRows[index + 1] ?? bomSheet.rowCount + 1) - 1;
    const projectCell = bomSheet.getRow(row).getCell(column("projectCost"));
    const projectResult = typeof projectCell.value === "number" ? projectCell.value : 0;
    projectCell.value = { formula: `SUM(${bomSheet.getRow(row + 1).getCell(column("projectCost")).address}:${bomSheet.getRow(lastRow).getCell(column("projectCost")).address})`, result: projectResult };
    const perNodeCell = bomSheet.getRow(row).getCell(column("perNodeCost"));
    const perNodeResult = typeof perNodeCell.value === "number" ? perNodeCell.value : projectResult / Number(bomSheet.getRow(row).getCell(column("nodes")).value ?? 1);
    perNodeCell.value = { formula: `${projectCell.address}/${bomSheet.getRow(row).getCell(column("nodes")).address}`, result: perNodeResult };
    const unitCell = bomSheet.getRow(row).getCell(column("unitCost"));
    unitCell.value = { formula: perNodeCell.address, result: perNodeResult };
  }

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
    representedNodes: node.representedNodeCount ?? 1,
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

interface PdfWriter {
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  newPage: () => void;
  ensureSpace: (height: number) => void;
  line: (text: string, size?: number, isBold?: boolean, indent?: number) => void;
  paragraph: (text: string, size?: number, indent?: number) => void;
  heading: (text: string) => void;
  subheading: (text: string) => void;
}

function wrappedLines(text: string, font: PDFFont, size: number, width: number): string[] {
  const rawWords = pdfText(text).trim().split(/\s+/).filter(Boolean);
  const words = rawWords.flatMap((word) => {
    if (font.widthOfTextAtSize(word, size) <= width) return [word];
    const parts: string[] = [];
    let current = "";
    for (const character of word) {
      const candidate = current + character;
      if (current && font.widthOfTextAtSize(candidate, size) > width) {
        parts.push(current);
        current = character;
      } else current = candidate;
    }
    if (current) parts.push(current);
    return parts;
  });
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function pdfText(value: string): string {
  const normalized = value.normalize("NFC")
    .replaceAll("→", " para ")
    .replaceAll("×", "x")
    .replaceAll("≥", ">=")
    .replaceAll("≤", "<=")
    .replaceAll("−", "-")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2000-\u200B\u202F\u205F\u3000]/g, " ");
  const winAnsiExtras = new Set([0x0152, 0x0153, 0x0160, 0x0161, 0x0178, 0x017D, 0x017E, 0x0192, 0x02C6, 0x02DC, 0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203A, 0x20AC, 0x2122]);
  return [...normalized].map((character) => {
    const code = character.codePointAt(0)!;
    return (code >= 0x20 && code <= 0xFF) || winAnsiExtras.has(code) ? character : "?";
  }).join("");
}

function drawJustifiedLine(page: PDFPage, line: string, x: number, y: number, width: number, size: number, font: PDFFont, justify: boolean): void {
  const words = line.split(/\s+/).filter(Boolean);
  if (!justify || words.length < 2) {
    page.drawText(line, { x, y, size, font, color: rgb(0.08, 0.12, 0.18) });
    return;
  }
  const wordsWidth = words.reduce((sum, word) => sum + font.widthOfTextAtSize(word, size), 0);
  const gap = (width - wordsWidth) / (words.length - 1);
  let cursor = x;
  for (const word of words) {
    page.drawText(word, { x: cursor, y, size, font, color: rgb(0.08, 0.12, 0.18) });
    cursor += font.widthOfTextAtSize(word, size) + gap;
  }
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
    const font = isBold ? bold : regular;
    const x = 48 + indent;
    const width = 499 - indent;
    const lines = wrappedLines(text, font, size, width);
    for (const line of lines) {
      if (writer.y < 55) writer.newPage();
      drawJustifiedLine(writer.page, line, x, writer.y, width, size, font, false);
      writer.y -= size + 4.5;
    }
  };
  writer.paragraph = (text: string, size = 9.5, indent = 0): void => {
    const x = 48 + indent;
    const width = 499 - indent;
    const lines = wrappedLines(text, regular, size, width);
    for (const [lineIndex, line] of lines.entries()) {
      if (writer.y < 55) writer.newPage();
      drawJustifiedLine(writer.page, line, x, writer.y, width, size, regular, lineIndex < lines.length - 1);
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
  writer.subheading = (text: string): void => {
    writer.ensureSpace(55);
    writer.y -= 2;
    writer.line(text, 11, true, 4);
    writer.y -= 2;
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

const RESOURCE_LABELS: Record<string, string> = {
  cpuCores: "núcleos de CPU",
  ramGb: "memória RAM",
  gpuVramGb: "memória de vídeo (VRAM)",
  localAiqSlots: "inferências locais simultâneas no AiQ",
  gpuDecode1080p30Streams: "decodificação de vídeo pela GPU",
  diskCapacityTb: "capacidade de armazenamento",
  diskWriteMbps: "taxa de gravação em disco",
  diskReadMbps: "taxa de leitura em disco",
  memoryBandwidthGbps: "largura de banda da memória",
  lanGbps: "rede local",
  internetUploadMbps: "envio pela internet",
  processThreads: "threads de processo",
  ffmpegProcessesPerSecond: "processos FFmpeg por segundo",
  inferenceRequestsPerSecond: "requisições de inferência por segundo",
  rtsp_ingest: "recepção RTSP",
  video_decode: "decodificação de vídeo",
  bgr_processing: "processamento BGR/OpenCV",
  video_encode: "codificação de vídeo",
  disk_write: "gravação em disco",
  disk_read: "leitura de disco",
  frame_extraction: "extração de quadros",
  local_inference: "inferência local AiQ/Qwen",
  memory_bandwidth: "largura de banda da memória",
  network_ingest: "recepção pela rede",
  job_scheduler: "agendador de Jobs, Steps e Agents",
  intelligence_scheduler: "agendador de Intelligence",
  database_persistence: "persistência no banco de dados",
  dashboard_queries: "consultas do painel",
  thermal_sustain: "sustentação térmica",
};

const STATUS_LABELS: Record<string, string> = {
  validated_local: "validada localmente",
  extrapolated_high: "extrapolada com confiança alta",
  extrapolated_medium: "extrapolada com confiança moderada",
  reference_only: "somente referência",
  incompatible: "incompatível",
  eligible: "apta para aquisição",
  blocked: "bloqueada",
  active: "ativo",
  reserve: "reserva",
  current: "geração atual",
  previous: "geração anterior",
  two_generations_back: "duas gerações anteriores",
  dedicated: "memória dedicada",
  unified: "memória unificada",
};

function reportLabel(value: string | null | undefined): string {
  if (!value) return "não informado";
  return STATUS_LABELS[value] ?? RESOURCE_LABELS[value] ?? value.replaceAll("_", " ");
}

function reportOperatingSystem(value: string): string {
  return ({ windows: "Windows", macos: "macOS", ubuntu: "Ubuntu", linux: "Linux" } as Record<string, string>)[value.toLowerCase()] ?? value;
}

function reportHardwareKind(value: string): string {
  return ({ workstation: "estação de trabalho", desktop: "computador de mesa", laptop: "notebook", mini_pc: "minicomputador", rack_server: "servidor em rack", server: "servidor" } as Record<string, string>)[value] ?? value.replaceAll("_", " ");
}

function reportExclusion(value: string): string {
  return ({ taxes: "tributos", shipping: "frete", licenses: "licenças", energy: "energia", support: "suporte", TCO: "custo total de propriedade" } as Record<string, string>)[value] ?? value;
}

function reportComponentCostName(value: string): string {
  return ({
    "Placa-mae / plataforma": "Placa-mãe / plataforma",
    "Memoria RAM": "Memória RAM",
    "Fonte, refrigeracao e chassi": "Fonte, refrigeração e chassi",
    "Montagem e integracao": "Montagem e integração",
  } as Record<string, string>)[value] ?? value;
}

function reportCameraGroupName(value: string): string {
  return value === "Main camera group" ? "Grupo principal de câmeras" : value;
}

function reportAgentName(value: string): string {
  return value === "Continuous video analysis" ? "Análise contínua de vídeo" : value;
}

function reportWarning(value: string): string {
  const exact: Record<string, string> = {
    reference_price_estimate_purchase_quote_required: "Os preços são estimativas de referência; obtenha cotação itemizada antes da aquisição.",
    non_ecc_memory: "A configuração usa memória sem correção de erros (ECC).",
    physical_calibration_or_comparable_public_evidence_required: "É obrigatória uma calibração física completa ou evidência pública diretamente comparável.",
    procurement_neutral_specification_blocked: "A especificação técnica neutra ainda não pode ser usada em aquisição.",
    "not eligible for hardware acquisition": "A configuração não está apta para aquisição.",
    "conservative unbenchmarked compute derating 90 percent": "Foi aplicado um redutor conservador de 10% por falta de benchmark diretamente comparável.",
  };
  return exact[value] ?? value
    .replace("inputType:image->video", "entrada ajustada de imagem para vídeo")
    .replace(/State of evidence 'reference only' does not release acquisition\.?/i, "O estado de evidência 'somente referência' não libera a aquisição.")
    .replace(/^(\w[\w ]+): (\d+) comparable physical calibrations are required; (\d+) exist\.?$/i, (_match, stage, required, current) => `${reportLabel(String(stage).replaceAll(" ", "_"))}: são necessárias ${required} calibrações físicas comparáveis; existem ${current}.`)
    .replace(/^(\w[\w ]+): There is no eligible and comparable public benchmark for this stage\.?$/i, (_match, stage) => `${reportLabel(String(stage).replaceAll(" ", "_"))}: não existe benchmark público elegível e comparável para este estágio.`)
    .replaceAll("_", " ");
}

function reportAssumption(value: string): string {
  const exact: Record<string, string> = {
    "Continuous RTSP decode remains charged at source codec, resolution and FPS.": "A decodificação RTSP contínua é dimensionada com o codec, a resolução e o FPS da fonte.",
    "BGR buffer capacity is estimated as two seconds at the configured source FPS.": "A capacidade do buffer BGR corresponde a dois segundos no FPS configurado para a fonte.",
    "Video frame extraction includes one FFmpeg process per sampled frame, capped at 300 frames per request.": "A extração de quadros considera um processo FFmpeg por quadro amostrado, limitada a 300 quadros por requisição.",
    "AiQ/Qwen Core uses one effective inference frame per second in 60-second execution cycles; RTSP receive/decode FPS remains independent.": "O AiQ/Qwen Core usa um quadro efetivo de inferência por segundo em ciclos de 60 segundos; o FPS de recepção e decodificação RTSP permanece independente.",
    "Disk write throughput and at least one day of rolling temporary source clips participate in sizing; configured retention and RAID factor increase capacity demand.": "A taxa de gravação em disco e pelo menos um dia de clipes temporários entram no dimensionamento; a retenção e o fator RAID configurados aumentam a capacidade necessária.",
    "The final safe camera count is the minimum across receive, decode, BGR processing, encode, local inference, RAM/VRAM, disk, network and sustained thermal evidence.": "A quantidade final segura de câmeras é o menor limite entre recepção, decodificação, processamento BGR, codificação, inferência local, RAM/VRAM, disco, rede e sustentação térmica.",
    "Built-in component costs are dated planning references converted with official FX snapshots; current compatible market quotes take precedence when available.": "Os custos embarcados são referências de planejamento datadas e convertidas por câmbio oficial; cotações atuais e compatíveis prevalecem quando disponíveis.",
    "Reference estimates exclude taxes, shipping, licenses, energy, support and TCO and still require a purchase quotation.": "As estimativas excluem tributos, frete, licenças, energia, suporte e custo total de propriedade, e ainda exigem cotação de compra.",
    "Windows is the current packaged workstation target; the exact CPU, GPU, driver and workload still require a matching sustained benchmark before validation.": "O Windows é a plataforma indicada para esta estação; CPU, GPU, driver e carga exatos ainda exigem benchmark sustentado compatível antes da validação.",
    "The full active catalog competes on compatible capacity and price; laptops and mini PCs are considered for small loads instead of starting at workstation class.": "Todo o catálogo ativo concorre por capacidade e preço compatíveis; notebooks e minicomputadores são considerados para cargas pequenas antes de se adotar uma estação de trabalho.",
    "The final safe camera count is the minimum across RTSP ingest, decode, BGR, encode, frame extraction, AiQ, memory bandwidth, SSD read/write, network, Jobs, Steps, Agents, Intelligence, database, dashboard and sustained thermal evidence.": "A quantidade final segura de câmeras é o menor limite entre recepção RTSP, decodificação, BGR, codificação, extração de quadros, AiQ, largura de banda da memória, leitura e gravação no SSD, rede, Jobs, Steps, Agents, Intelligence, banco de dados, painel e sustentação térmica.",
    "This design is shown for planning or diagnosis only, and is not approved for hardware acquisition until every required stage has comparable evidence.": "Esta configuração é apresentada somente para planejamento ou diagnóstico e não está aprovada para aquisição enquanto todos os estágios obrigatórios não possuírem evidência comparável.",
    "This design is shown for planning or diagnosis only and is not approved for hardware acquisition until every required stage has comparable evidence.": "Esta configuração é apresentada somente para planejamento ou diagnóstico e não está aprovada para aquisição enquanto todos os estágios obrigatórios não possuírem evidência comparável.",
  };
  return exact[value] ?? value;
}

function evidenceCoverageSummary(design: RecommendationAlternative, compact = false): string {
  if (!design.bom) return "BOM normalizada indisponível para esta recomendação legada.";
  const coverage = design.bom.coverage;
  const missing = coverage.stages.filter((stage) => !stage.covered).map((stage) => reportLabel(stage.stage));
  return `Cobertura de evidências: ${coverage.coveredStageCount} de ${coverage.requiredStageCount} estágios (${coverage.percent}%), com ${coverage.physicalAnchorCount} calibração(ões) física(s). ${missing.length ? compact ? "Os estágios ausentes e seus motivos estão detalhados no caderno técnico." : `Estágios ainda sem cobertura: ${missing.join(", ")}.` : "Todos os estágios obrigatórios estão cobertos."}`;
}

function coreWarnings(warnings: string[]): string[] {
  const important = warnings.filter((warning) =>
    ["reference_price_estimate_purchase_quote_required", "non_ecc_memory", "physical_calibration_or_comparable_public_evidence_required"].includes(warning)
    || /inputType:|unbenchmarked compute derating/i.test(warning));
  return [...new Set(important)];
}

function reportEvidence(value: string): string {
  const prefixes: Array<[string, string]> = [
    ["workload-contract:", "Contrato da carga: "],
    ["perceptrum-build:", "Build do Perceptrum: "],
    ["catalog-version:", "Versão do catálogo: "],
    ["operating-system:", "Sistema operacional: "],
    ["procurement-eligibility:", "Elegibilidade para aquisição: "],
  ];
  const prefix = prefixes.find(([candidate]) => value.startsWith(candidate));
  return prefix ? `${prefix[1]}${reportLabel(value.slice(prefix[0].length))}` : value;
}

function addConfiguration(writer: PdfWriter, recommendation: CapacityRecommendation, index: number): void {
  writer.newPage();
  const design = recommendation.primary;
  const hardware = design.hardware;
  writer.page.drawRectangle({ x: 0, y: 744, width: 595, height: 98, color: rgb(0.04, 0.09, 0.11) });
  writer.page.drawText(pdfText(`PROPOSTA ${index} DE 3`), { x: 48, y: 805, size: 9, font: writer.bold, color: rgb(0.78, 1, 0.24) });
  writer.page.drawText(pdfText(POLICY_LABELS[recommendation.policy]), { x: 48, y: 774, size: 22, font: writer.bold, color: rgb(0.94, 0.97, 0.98) });
  writer.page.drawText(pdfText(`${reportLabel(recommendation.confidence).toUpperCase()} — ${design.nodeCount} nó(s) — ${hardware.name}`), {
    x: 48, y: 754, size: 9, font: writer.regular, color: rgb(0.65, 0.73, 0.76),
  });
  writer.y = 720;

  writer.heading(PDF_REPORT_OUTLINE.proposalSections[0]);
  writer.paragraph(`Nós: ${design.nodeCount}; ativos: ${design.activeNodeCount}; reserva: ${design.nodeCount - design.activeNodeCount}.`);
  writer.paragraph(`Folga-alvo: ${design.headroomPercent}%; gargalo dominante: ${reportLabel(design.bottleneck)}; capacidade estimada neste perfil: ${recommendation.primary.maximumAdditionalCameras + recommendation.primary.allocations.filter((node) => node.role === "active").reduce((sum, node) => sum + node.cameraGroups.reduce((cameraSum, group) => cameraSum + group.cameras, 0), 0)} câmeras (${design.maximumAdditionalCameras} adicionais).`);
  writer.paragraph(`Preço do projeto: ${formatPrice(design)}.`);

  writer.heading(PDF_REPORT_OUTLINE.proposalSections[1]);
  writer.line(`Sistema: ${hardware.name}; formato: ${reportHardwareKind(hardware.kind)}; plataforma: ${reportOperatingSystem(operatingSystemFor(hardware))}; ${reportLabel(hardware.generation)}.`, 10, true);
  writer.paragraph(`CPU: ${hardware.cpuModel}; fabricante ${displayManufacturer(hardware.cpuVendor)}; ${hardware.physicalCores} núcleos físicos; fator conservador sustentado de ${Math.round((hardware.sustainedComputeFactor ?? 1) * 100)}%.`);
  writer.paragraph(`Placa-mãe ou plataforma: ${hardware.motherboard}.`);
  writer.paragraph(`Memória RAM: ${hardware.ramGb} GB por nó; ECC: ${hardware.ecc ? "sim" : "não"}; arquitetura: ${reportLabel(hardware.memoryArchitecture)}.`);
  writer.paragraph(`GPU: ${hardware.gpuCount} × ${hardware.gpuModel} (${displayManufacturer(hardware.gpuVendor)}); ${gpuMemoryDescription(hardware)}.`);
  writer.paragraph(`AiQ local: ${hardware.localAiqSlots} instância(s) por nó; decodificação do Perceptrum por GPU: ${hardware.supportsPerceptrumGpuDecode ? "compatível" : "não compatível"}; capacidade nominal de referência: ${hardware.gpuDecode1080p30Streams} fluxos 1080p30.`);
  writer.paragraph(`NVMe operacional: ${hardware.storageModel}; ${hardware.usableStorageTb} TB úteis. A escrita, os clipes temporários, a retenção e o fator RAID participam do dimensionamento.`);
  if (design.calibration) {
    const calibration = design.calibration;
    writer.paragraph(`Evidência de capacidade: ${reportLabel(calibration.status)}; confiança ${calibration.confidenceClass}; intervalo seguro ${calibration.safeCameraMinimum ?? "não determinado"} a ${calibration.safeCameraMaximum ?? "não determinado"} câmeras; reserva de ${calibration.reservePercent}%; gargalo ${reportLabel(calibration.bottleneck)}.`);
  }
  writer.paragraph(`Rede: ${hardware.nicGbps} GbE; fonte: ${hardware.powerSupply}; refrigeração: ${hardware.cooling}.`);
  writer.paragraph(`Chassi: ${hardware.chassis}; sistema operacional: ${hardware.windowsEdition}; índice de expansão: ${hardware.expansionScore}.`);

  writer.heading(PDF_REPORT_OUTLINE.proposalSections[2]);
  if (design.price.componentEstimates?.length) {
    for (const component of design.price.componentEstimates) {
      writer.paragraph(`${reportComponentCostName(component.component)}: ${component.quantityPerNode} por nó; ${design.price.currency} ${formatMoney(component.perNodeAmount)} por nó; ${design.price.currency} ${formatMoney(component.projectAmount)} no projeto.`);
    }
    const perNodeTotal = design.price.median === null ? null : design.price.median / design.nodeCount;
    writer.line(`TOTAL POR NÓ: ${design.price.currency} ${formatMoney(perNodeTotal)}.`, 10, true);
    writer.line(`QUANTIDADE DE NÓS: ${design.nodeCount}. TOTAL DO PROJETO: ${design.price.currency} ${formatMoney(design.price.median)}.`, 10, true);
    writer.line(`Faixa do projeto: ${formatPrice(design)}.`);
    writer.paragraph(`Base: ${priceBasisPt(design)}; referência: ${design.price.observedAt ?? "não disponível"}; exclui ${(design.price.exclusions ?? []).map(reportExclusion).join(", ")}.`);
  } else writer.line("Sem estimativa compatível; obter cotação itemizada antes da proposta comercial.");

  writer.heading(PDF_REPORT_OUTLINE.proposalSections[3]);
  for (const node of design.allocations) {
    const cameraCount = node.cameraGroups.reduce((sum, group) => sum + group.cameras, 0);
    writer.line(`Nó ${node.nodeIndex} — ${reportLabel(node.role)} — ${cameraCount} câmera(s) — ${node.cameraGroups.map((group) => `${reportCameraGroupName(group.groupName)}: ${group.cameras}`).join(", ") || "reserva sem câmeras"}.`, 9.5, true);
    writer.line(`CPU ${Math.round(node.utilization.cpuCores * 100)}%; RAM ${Math.round(node.utilization.ramGb * 100)}%; VRAM ${Math.round(node.utilization.gpuVramGb * 100)}%; NVDEC ${Math.round(node.utilization.gpuDecode1080p30Streams * 100)}%; LAN ${Math.round(node.utilization.lanGbps * 100)}%; Internet ${Math.round(node.utilization.internetUploadMbps * 100)}%.`, 9, false, 10);
  }

  writer.heading(PDF_REPORT_OUTLINE.proposalSections[4]);
  for (const [resource, demand] of Object.entries(design.aggregateDemand)) {
    const sizing = true;
    writer.line(`${reportLabel(resource)}: ${Math.round(demand * 1000) / 1000}${resource === design.bottleneck ? " — GARGALO" : ""}${sizing ? "" : " — observacional"}.`);
  }

  writer.heading(PDF_REPORT_OUTLINE.proposalSections[5]);
  for (const source of hardware.sources) writer.line(`Fonte técnica: ${source.title} — ${source.url}`, 8.5);
  for (const source of design.price.sourceUrls) writer.line(`Fonte de preço: ${source}`, 8.5);
  for (const warning of coreWarnings(design.warnings)) writer.paragraph(`AVISO: ${reportWarning(warning)}`, 9);
  for (const assumption of recommendation.assumptions) writer.paragraph(`Premissa: ${reportAssumption(assumption)}`, 9);
  for (const evidence of recommendation.evidence) writer.line(`Evidência: ${reportEvidence(evidence)}`);
}

const COMPONENT_LABELS: Partial<Record<HardwareComponent["kind"], string>> = {
  cpu: "Processador (CPU)", gpu: "Acelerador gráfico (GPU)", motherboard: "Placa-mãe / plataforma",
  memory_kit: "Memória RAM", storage_os: "Armazenamento operacional", storage_retention: "Armazenamento de retenção",
  nic: "Interface de rede", psu: "Fonte de alimentação", cooling: "Sistema de refrigeração", chassis: "Chassi",
  oem_system: "Sistema OEM", rack_configuration: "Configuração de rack",
};

function specificationValue(value: string | number | boolean | null, unit: string | null): string {
  if (value === null) return "não publicado";
  const formatted = typeof value === "boolean" ? (value ? "sim" : "não") : String(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function displayManufacturer(value: string): string {
  const known: Record<string, string> = { amd: "AMD", intel: "Intel", nvidia: "NVIDIA", apple: "Apple" };
  return known[value.toLowerCase()] ?? value;
}

function commercialComponentName(manufacturer: string, model: string): string {
  const display = displayManufacturer(manufacturer);
  return model.toLowerCase().startsWith(display.toLowerCase()) ? model : `${display} ${model}`;
}

function addDetailedCommercialComponents(writer: PdfWriter, design: RecommendationAlternative, components: HardwareComponent[], machineIndex: number): void {
  const byId = new Map(components.map((component) => [component.id, component]));
  const commercial = design.commercialReference;
  if (!commercial?.components.length) {
    writer.paragraph("A recomendação é legada e não possui uma BOM vinculada a componentes normalizados. A referência comercial foi preservada, mas o detalhamento oficial permanece indisponível.", 9.5);
    return;
  }
  for (const [componentIndex, reference] of commercial.components.entries()) {
    const number = `${machineIndex}.${componentIndex + 1}`;
    const label = COMPONENT_LABELS[reference.kind] ?? reference.kind;
    writer.subheading(`${number}. ${label} - especificação resumida`);
    writer.paragraph(`${reference.quantityPerNode} unidade(s) por nó. Referência comercial: ${commercialComponentName(reference.manufacturer, reference.model)}. Código canônico: ${reference.canonicalMpn}. Completude das especificações oficiais: ${reference.specificationCompletenessPercent}%.`, 9.5);
    const component = byId.get(reference.componentId);
    writer.subheading(`${number}.1. Especificação técnica detalhada do fabricante`);
    const published = component?.technicalSpecification?.fields.filter((field) => field.status === "published" && field.confidence === "official") ?? [];
    if (!published.length) {
      writer.paragraph("O coletor ainda não localizou campos oficiais vinculados ao SKU exato. O componente permanece como referência de planejamento e não pode ser tratado como especificação comprovada para aquisição.", 9.5);
    } else {
      const groups = new Map<string, typeof published>();
      for (const field of published) {
        const key = field.sectionLabelPt ?? "Informações adicionais do fabricante";
        groups.set(key, [...(groups.get(key) ?? []), field]);
      }
      let sectionIndex = 0;
      for (const [section, fields] of groups) {
        sectionIndex += 1;
        writer.line(`${number}.1.${sectionIndex}. ${section}`, 9.5, true, 8);
        for (const [fieldIndex, field] of fields.entries()) {
          const normalized = specificationValue(field.value, field.unit);
          const original = specificationValue(field.originalValue, null);
          const originalSuffix = original !== normalized && !normalized.startsWith(original)
            ? ` O fabricante publicou: ${original}.`
            : "";
          writer.paragraph(`${number}.1.${sectionIndex}.${fieldIndex + 1}. ${field.labelPt}: ${normalized}.${originalSuffix}`, 8.8, 16);
        }
      }
    }
    const missing = component?.technicalSpecification?.completeness.missingRequiredFieldCodes ?? [];
    const fieldLabels = new Map(component?.technicalSpecification?.fields.map((field) => [field.code, field.labelPt]) ?? []);
    if (missing.length) writer.paragraph(`Campos oficiais obrigatórios ainda ausentes: ${missing.map((code) => fieldLabels.get(code) ?? reportLabel(code)).join(", ")}. Enquanto houver ausência, conflito ou ambiguidade, o componente permanece bloqueado para aquisição.`, 8.8, 8);
    const urls = [...new Set(component?.technicalSpecification?.fields.flatMap((field) => field.sourceEvidence.map((evidence) => evidence.url)) ?? reference.sourceUrls)];
    for (const [sourceIndex, url] of urls.entries()) writer.line(`${number}.1.F${sourceIndex + 1}. Fonte oficial: ${url}`, 8, false, 8);
  }
}

function addDetailedMachineSpecification(writer: PdfWriter, design: RecommendationAlternative, index: number, total: number, components: HardwareComponent[]): void {
  writer.newPage();
  writer.page.drawRectangle({ x: 0, y: 744, width: 595, height: 98, color: rgb(0.04, 0.09, 0.11) });
  writer.page.drawText(pdfText(`MÁQUINA ${index} DE ${total} - ESPECIFICAÇÕES OFICIAIS`), { x: 48, y: 805, size: 9, font: writer.bold, color: rgb(0.78, 1, 0.24) });
  writer.page.drawText(pdfText(design.hardware.name), { x: 48, y: 774, size: 18, font: writer.bold, color: rgb(0.94, 0.97, 0.98) });
  writer.page.drawText(pdfText(`${design.nodeCount} nó(s) - ${formatPrice(design)}`), { x: 48, y: 754, size: 9, font: writer.regular, color: rgb(0.65, 0.73, 0.76) });
  writer.y = 720;

  writer.heading(`${index}. Configuração comercial e componentes`);
  const commercial = design.commercialReference;
  if (!commercial) writer.line("Referência comercial indisponível nesta recomendação legada.");
  else {
    writer.line(`${commercial.hardwareName}; ${commercial.nodeCount} nó(s), ${commercial.activeNodeCount} ativo(s); plataforma ${reportOperatingSystem(commercial.operatingSystem)}; preço do projeto ${commercial.currency} ${formatMoney(commercial.projectPrice)} (${priceBasisPt(design)}).`, 10, true);
    writer.paragraph(`CPU ${design.hardware.cpuModel}; memória RAM de ${design.hardware.ramGb} GB por nó; GPU ${design.hardware.gpuCount} × ${design.hardware.gpuModel}; ${gpuMemoryDescription(design.hardware)}; armazenamento operacional de ${design.hardware.usableStorageTb} TB úteis; rede de ${design.hardware.nicGbps} GbE.`, 9.5);
    addDetailedCommercialComponents(writer, design, components, index);
  }
  writer.heading(`${index}.${(commercial?.components.length ?? 0) + 1}. Situação das evidências`);
  writer.paragraph(evidenceCoverageSummary(design), 9.2);
  writer.paragraph("As especificações oficiais acima descrevem características e compatibilidade, mas não substituem benchmarks comparáveis nem a calibração física completa do Perceptrum. Enquanto a cobertura permanecer incompleta, esta máquina continua como referência de planejamento e não está liberada para aquisição.", 9.2);
}

export async function pdfReport({ scenario, recommendations: input, components = [] }: ReportContext): Promise<Buffer> {
  void components;
  return referencePdfReport({ scenario, recommendations: input });
}
