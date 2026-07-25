import { createHash } from "node:crypto";
import type {
  CapacityRecommendation,
  CapacityScenario,
  CommercialRecommendationReference,
  HardwareComponent,
  MarketCompetitionAssessment,
  NeutralProcurementRequirement,
  ProcurementNeutralSpecification,
  PublicBenchmarkObservation,
  RecommendationAlternative,
} from "../shared/types.js";
import { PROCUREMENT_NEUTRAL_SPECIFICATION_VERSION } from "../shared/types.js";
import { isPublicObservationEligible } from "./evidence.js";
import { withTechnicalSpecification } from "./technicalSpecifications.js";

const LEGAL_NOTICE = "Documento de apoio técnico. Não substitui estudo técnico preliminar, pesquisa de mercado, edital, parecer jurídico nem aprovação da autoridade competente.";

function hashId(...values: string[]): string {
  return createHash("sha256").update(values.join("\0")).digest("hex").slice(0, 24);
}

export function uniqueRecommendationOptions(recommendations: CapacityRecommendation[]): RecommendationAlternative[] {
  const options = new Map<string, RecommendationAlternative>();
  for (const recommendation of recommendations) {
    for (const option of [recommendation.primary, ...recommendation.alternatives]) {
      const key = `${option.hardware.id}:${option.nodeCount}:${option.activeNodeCount}`;
      const current = options.get(key);
      if (!current || (option.price.median ?? Number.POSITIVE_INFINITY) < (current.price.median ?? Number.POSITIVE_INFINITY)) options.set(key, option);
    }
  }
  return [...options.values()].sort((left, right) =>
    (left.price.median ?? Number.POSITIVE_INFINITY) - (right.price.median ?? Number.POSITIVE_INFINITY) ||
    left.hardware.name.localeCompare(right.hardware.name));
}

function commercialReference(
  option: RecommendationAlternative,
  componentById: ReadonlyMap<string, HardwareComponent>,
): CommercialRecommendationReference {
  return {
    hardwareTemplateId: option.hardware.id,
    hardwareName: option.hardware.name,
    nodeCount: option.nodeCount,
    activeNodeCount: option.activeNodeCount,
    operatingSystem: option.hardware.operatingSystemFamily,
    currency: option.price.currency,
    projectPrice: option.price.median,
    priceBasis: option.price.basis,
    components: (option.bom?.items ?? []).map((item) => {
      const component = componentById.get(item.componentId);
      return {
        componentId: item.componentId,
        kind: item.kind,
        role: item.role,
        quantityPerNode: item.quantity,
        manufacturer: component?.manufacturer ?? "Não identificado",
        model: component?.sku ?? item.componentId,
        canonicalMpn: component?.canonicalMpn ?? component?.sku ?? item.componentId,
        specificationCompletenessPercent: component?.technicalSpecification?.completeness.percent ?? 0,
        sourceUrls: component?.sourceUrls ?? [],
      };
    }),
  };
}

function maxNodeDemand(option: RecommendationAlternative, key: keyof RecommendationAlternative["aggregateDemand"]): number {
  return Math.max(0, ...option.allocations.filter((node) => node.role === "active").map((node) => Number(node.demand[key]) || 0));
}

function standardNetworkSpeed(required: number): number {
  return [1, 2.5, 5, 10, 25, 40, 100, 200, 400].find((value) => value >= required) ?? Math.ceil(required / 100) * 100;
}

function requirement(
  option: RecommendationAlternative,
  input: Omit<NeutralProcurementRequirement, "id" | "quantityPerNode" | "projectQuantity" | "matchingComponentIds"> & { quantityPerNode?: number },
): NeutralProcurementRequirement {
  const quantityPerNode = input.quantityPerNode ?? 1;
  return {
    ...input,
    id: `neutral-requirement:${hashId(option.id, input.componentRole, input.characteristicCode)}`,
    quantityPerNode,
    projectQuantity: quantityPerNode * option.nodeCount,
    matchingComponentIds: [],
  };
}

function baseRequirements(scenario: CapacityScenario, option: RecommendationAlternative): NeutralProcurementRequirement[] {
  const cpuCores = Math.max(1, Math.ceil(maxNodeDemand(option, "cpuCores") / 0.7));
  const ramGb = Math.max(8, Math.ceil(maxNodeDemand(option, "ramGb") / 0.75 / 8) * 8);
  const vramGb = Math.max(0, Math.ceil(maxNodeDemand(option, "gpuVramGb") / 0.75 / 4) * 4);
  const rawStorageGb = Math.ceil(maxNodeDemand(option, "diskCapacityTb") * 1_000 / 0.6 / 100) * 100;
  const storageGb = Math.max(256, rawStorageGb);
  const rawDiskWriteMbps = maxNodeDemand(option, "diskWriteMbps");
  const diskWriteMbps = Math.max(100, Math.ceil(rawDiskWriteMbps / 0.6));
  const enduranceTbw = Math.max(300, Math.ceil(rawDiskWriteMbps * 86_400 * 365 * 5 * 1.2 / 1_000_000));
  const nicGbps = standardNetworkSpeed(Math.max(1, maxNodeDemand(option, "lanGbps") / 0.6));
  const codecs = [...new Set(scenario.cameraGroups.map((group) => group.source.codec.toUpperCase()))].join(", ");
  const os = scenario.constraints.operatingSystem === "auto" || !scenario.constraints.operatingSystem
    ? option.hardware.operatingSystemFamily
    : scenario.constraints.operatingSystem;
  const commonProof = "Comprovar por ficha técnica oficial do fabricante vinculada ao código exato ofertado.";
  const requirements = [
    requirement(option, { componentKind: "cpu", componentRole: "compute", characteristicCode: "physical_cores", characteristic: "Núcleos físicos", comparator: "minimum", value: cpuCores, unit: "núcleos", mandatory: true, rationale: "Capacidade mínima para recepção RTSP, Jobs, Agents, Intelligence, banco e painel com reserva operacional.", proofMethod: "official_datasheet", acceptanceCriterion: `${commonProof} O processador deve possuir pelo menos ${cpuCores} núcleos físicos.`, sourceStage: "job_scheduler" }),
    requirement(option, { componentKind: "cpu", componentRole: "compute", characteristicCode: "supported_operating_systems", characteristic: "Compatibilidade com o sistema operacional", comparator: "supports", value: os, unit: null, mandatory: true, rationale: "O aplicativo e os drivers precisam operar no sistema selecionado sem alteração do código-fonte.", proofMethod: "technical_proposal", acceptanceCriterion: `Comprovar suporte oficial ao sistema ${os} e aos drivers exigidos pela carga de produção.`, sourceStage: "compatibility" }),
    requirement(option, { componentKind: "motherboard", componentRole: "platform", characteristicCode: "platform_compatibility", characteristic: "Compatibilidade integral da plataforma", comparator: "supports", value: "processador, memória, aceleradores, armazenamento, rede e sistema operacional ofertados", unit: null, mandatory: true, rationale: "Evita uma lista de materiais elétrica ou logicamente incompatível, mesmo quando cada peça isolada atende à sua ficha.", proofMethod: "technical_proposal", acceptanceCriterion: "Apresentar matriz de compatibilidade, versão de BIOS ou firmware, canais PCIe, slots, bifurcação e limites do fabricante para a configuração ofertada.", sourceStage: "compatibility" }),
    requirement(option, { componentKind: "memory_kit", componentRole: "memory", characteristicCode: "capacity_gb", characteristic: "Memória instalada", comparator: "minimum", value: ramGb, unit: "GB", mandatory: true, rationale: "Mantém quadros, mosaicos, filas, modelo local e banco dentro da reserva máxima de 75%.", proofMethod: "official_datasheet", acceptanceCriterion: `${commonProof} Capacidade instalada mínima de ${ramGb} GB por servidor.`, sourceStage: "memory_bandwidth" }),
    requirement(option, { componentKind: "memory_kit", componentRole: "memory", characteristicCode: "ecc", characteristic: "Correção de erros", comparator: scenario.constraints.requireEcc ? "equals" : "supports", value: scenario.constraints.requireEcc, unit: null, mandatory: scenario.constraints.requireEcc, rationale: "Reduz o risco de corrupção em operação contínua quando ECC foi exigido no projeto.", proofMethod: "official_datasheet", acceptanceCriterion: scenario.constraints.requireEcc ? "Memória e plataforma devem operar com ECC habilitado." : "Informar se a configuração suporta ECC.", sourceStage: "compatibility" }),
    requirement(option, { componentKind: "gpu", componentRole: "acceleration", characteristicCode: "vram_gb", characteristic: "Memória disponível para inferência", comparator: "minimum", value: Math.max(vramGb, option.hardware.memoryArchitecture === "unified" ? ramGb : 1), unit: "GB", mandatory: true, rationale: "Mantém modelo, quadros e inferências simultâneas abaixo de 75% da memória disponível.", proofMethod: "official_datasheet", acceptanceCriterion: `${commonProof} Demonstrar a memória utilizável pelo sistema de inferência.`, sourceStage: "local_inference", quantityPerNode: Math.max(1, option.hardware.gpuCount) }),
    requirement(option, { componentKind: "gpu", componentRole: "acceleration", characteristicCode: "video_decode", characteristic: "Decodificação de vídeo", comparator: "supports", value: codecs, unit: null, mandatory: scenario.cameraGroups.some((group) => group.decodeMode === "gpu"), rationale: "Os canais selecionados precisam ser decodificados simultaneamente no codec de origem.", proofMethod: "official_datasheet", acceptanceCriterion: `Comprovar suporte de decodificação aos codecs ${codecs} no sistema e driver ofertados.`, sourceStage: "video_decode", quantityPerNode: Math.max(1, option.hardware.gpuCount) }),
    requirement(option, { componentKind: "storage_os", componentRole: "operating_storage", characteristicCode: "capacity_gb", characteristic: "Capacidade útil de armazenamento", comparator: "minimum", value: storageGb, unit: "GB", mandatory: true, rationale: "Comporta sistema, aplicativo, clipes temporários e reserva de operação.", proofMethod: "official_datasheet", acceptanceCriterion: `${commonProof} Capacidade útil mínima de ${storageGb} GB por servidor.`, sourceStage: "capacity" }),
    requirement(option, { componentKind: "storage_os", componentRole: "operating_storage", characteristicCode: "sequential_write_mbps", characteristic: "Escrita sequencial sustentada", comparator: "minimum", value: diskWriteMbps, unit: "MB/s", mandatory: true, rationale: "Sustenta a gravação simultânea de clipes com utilização de até 60% da capacidade comprovada.", proofMethod: "independent_benchmark", acceptanceCriterion: `Apresentar resultado reproduzível de escrita sustentada igual ou superior a ${diskWriteMbps} MB/s no perfil definido no anexo.`, sourceStage: "disk_write" }),
    requirement(option, { componentKind: "storage_os", componentRole: "operating_storage", characteristicCode: "endurance_tbw", characteristic: "Durabilidade do SSD", comparator: "minimum", value: enduranceTbw, unit: "TBW", mandatory: true, rationale: "Dimensiona cinco anos de escrita calculada, acrescida de 20% de reserva, sem usar a taxa máxima do SSD como carga contínua.", proofMethod: "official_datasheet", acceptanceCriterion: "Comprovar durabilidade oficial igual ou superior ao valor solicitado e garantia válida para o regime de gravação.", sourceStage: "lifecycle" }),
    requirement(option, { componentKind: "nic", componentRole: "network", characteristicCode: "link_speed_gbps", characteristic: "Velocidade da interface de rede", comparator: "minimum", value: nicGbps, unit: "Gbps", mandatory: true, rationale: "Mantém recepção RTSP e tráfego operacional abaixo de 60% da capacidade nominal do enlace.", proofMethod: "official_datasheet", acceptanceCriterion: `${commonProof} Pelo menos uma interface de ${nicGbps} Gbps por servidor.`, sourceStage: "network_ingest" }),
    requirement(option, { componentKind: "psu", componentRole: "power", characteristicCode: "continuous_power_watts", characteristic: "Dimensionamento da fonte", comparator: "supports", value: "potência contínua da configuração acrescida de reserva mínima de 20%", unit: null, mandatory: true, rationale: "Evita instabilidade durante picos simultâneos de CPU, GPU e armazenamento.", proofMethod: "technical_proposal", acceptanceCriterion: "Apresentar memória de cálculo de potência, conectores e transientes para a configuração ofertada.", sourceStage: "compatibility" }),
    requirement(option, { componentKind: "cooling", componentRole: "cooling", characteristicCode: "cooling_capacity_watts", characteristic: "Capacidade de refrigeração", comparator: "supports", value: "carga térmica sustentada da configuração sem redução térmica de desempenho", unit: null, mandatory: true, rationale: "A capacidade comercial depende de desempenho sustentado e não apenas de pico.", proofMethod: "sample_or_poc", acceptanceCriterion: "Demonstrar operação sustentada no ensaio de aceite, sem redução térmica crítica nem filas crescentes.", sourceStage: "thermal_sustain" }),
    requirement(option, { componentKind: "chassis", componentRole: "chassis", characteristicCode: "component_clearance", characteristic: "Compatibilidade mecânica e fluxo de ar", comparator: "supports", value: "toda a configuração, expansão e fluxo de ar especificados", unit: null, mandatory: true, rationale: "Garante montagem, manutenção e refrigeração de todos os componentes.", proofMethod: "technical_proposal", acceptanceCriterion: "Apresentar desenho ou ficha técnica que comprove dimensões, slots, baias e fluxo de ar suficientes.", sourceStage: "compatibility" }),
    requirement(option, { componentKind: "oem_system", componentRole: "oem_system", characteristicCode: "perceptrum_sustained_camera_capacity", characteristic: "Capacidade sustentada do sistema completo", comparator: "minimum", value: Math.ceil(scenario.totalCameras / Math.max(1, option.activeNodeCount)), unit: "câmeras por servidor", mandatory: true, rationale: "Confirma conjuntamente Jobs, Steps, Agents, Intelligence, banco, painel, mídia, entrada e saída e sustentação térmica na carga definida.", proofMethod: "sample_or_poc", acceptanceCriterion: "Executar calibração completa de 60 minutos no pipeline de produção, sem fila crescente, perda acima do limite, falta de memória ou redução térmica sustentada.", sourceStage: "thermal_sustain" }),
  ];
  if (scenario.cameraGroups.some((group) => group.storage.storeVideo) && rawStorageGb > 0) {
    requirements.splice(9, 0,
      requirement(option, { componentKind: "storage_retention", componentRole: "retention_storage", characteristicCode: "capacity_gb", characteristic: "Capacidade util para retencao", comparator: "minimum", value: storageGb, unit: "GB", mandatory: true, rationale: "Armazena os clipes pelo prazo e redundancia definidos no cenario com reserva operacional.", proofMethod: "official_datasheet", acceptanceCriterion: `Comprovar pelo menos ${storageGb} GB uteis por no depois da redundancia prevista.`, sourceStage: "capacity" }),
      requirement(option, { componentKind: "storage_retention", componentRole: "retention_storage", characteristicCode: "sequential_write_mbps", characteristic: "Escrita sustentada da retencao", comparator: "minimum", value: diskWriteMbps, unit: "MB/s", mandatory: true, rationale: "Sustenta clipes simultaneos abaixo de 60% do resultado reproduzivel.", proofMethod: "independent_benchmark", acceptanceCriterion: `Apresentar fio ou teste equivalente reproduzivel com pelo menos ${diskWriteMbps} MB/s sustentados no perfil do anexo.`, sourceStage: "disk_write" }),
      requirement(option, { componentKind: "storage_retention", componentRole: "retention_storage", characteristicCode: "endurance_tbw", characteristic: "Endurance da retencao", comparator: "minimum", value: enduranceTbw, unit: "TBW", mandatory: true, rationale: "Cobre cinco anos de escrita calculada e reserva de 20%.", proofMethod: "official_datasheet", acceptanceCriterion: `Comprovar endurance minima de ${enduranceTbw} TBW e garantia compativel com a carga.`, sourceStage: "lifecycle" }),
    );
  }
  return requirements;
}

function valueMatches(candidate: string | number | boolean | null, requirement: NeutralProcurementRequirement): boolean {
  if (candidate === null) return false;
  if (requirement.comparator === "minimum") return typeof candidate === "number" && typeof requirement.value === "number" && candidate >= requirement.value;
  if (requirement.comparator === "maximum") return typeof candidate === "number" && typeof requirement.value === "number" && candidate <= requirement.value;
  if (requirement.comparator === "range") return typeof candidate === "number" && typeof requirement.value === "number" && candidate >= requirement.value && candidate <= (requirement.maximumValue ?? requirement.value);
  if (requirement.comparator === "equals") return String(candidate).toLowerCase() === String(requirement.value).toLowerCase();
  if (requirement.comparator === "prohibited") return !String(candidate).toLowerCase().includes(String(requirement.value).toLowerCase());
  return String(candidate).toLowerCase().includes(String(requirement.value).toLowerCase()) ||
    String(requirement.value).toLowerCase().split(/[,;]+/).every((part) => String(candidate).toLowerCase().includes(part.trim()));
}

function normalizedUnit(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, "").replace("bytes", "b");
}

function benchmarkMatches(item: NeutralProcurementRequirement, component: HardwareComponent, observations: PublicBenchmarkObservation[]): boolean {
  if (!item.sourceStage || !["rtsp_ingest", "video_decode", "bgr_processing", "video_encode", "disk_write", "disk_read", "frame_extraction", "local_inference", "memory_bandwidth", "network_ingest", "job_scheduler", "intelligence_scheduler", "database_persistence", "dashboard_queries", "thermal_sustain"].includes(item.sourceStage)) return false;
  return observations.some((observation) => {
    const componentIds = new Set([observation.componentId, ...(observation.componentIds ?? [])].filter((id): id is string => Boolean(id)));
    if (!componentIds.has(component.id) || observation.stage !== item.sourceStage || !isPublicObservationEligible(observation)) return false;
    if (item.unit && normalizedUnit(item.unit) !== normalizedUnit(observation.unit)) return false;
    const metric = `${observation.metricName ?? ""} ${observation.benchmarkName}`.toLowerCase();
    if (item.characteristicCode === "sequential_write_mbps" && !/write.*(throughput|bandwidth|mbps|mb\/s)|fio/.test(metric)) return false;
    return valueMatches(observation.score, item);
  });
}

function populateMatches(
  requirements: NeutralProcurementRequirement[],
  enrichedComponents: HardwareComponent[],
  observations: PublicBenchmarkObservation[],
): NeutralProcurementRequirement[] {
  return requirements.map((item) => ({
    ...item,
    matchingComponentIds: enrichedComponents.filter((component) => {
      if (component.kind !== item.componentKind) return false;
      if (item.proofMethod === "independent_benchmark") return benchmarkMatches(item, component, observations);
      if (!component.technicalSpecification?.completeness.procurementReady) return false;
      const candidate = component.technicalSpecification.fields.find((field) => field.code === item.characteristicCode && field.status === "published" && field.confidence === "official");
      return Boolean(candidate && valueMatches(candidate.value, item));
    }).map((component) => component.id),
  }));
}

function competition(requirements: NeutralProcurementRequirement[], components: HardwareComponent[]): MarketCompetitionAssessment {
  const byId = new Map(components.map((component) => [component.id, component]));
  const mandatory = requirements.filter((item) => item.mandatory && (item.proofMethod === "official_datasheet" || item.proofMethod === "independent_benchmark"));
  const groups = new Map<string, NeutralProcurementRequirement[]>();
  for (const item of mandatory) {
    const key = `${item.componentKind}:${item.componentRole}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const groupMatches = [...groups.values()].map((items) => {
    const [first, ...rest] = items;
    const intersection = new Set(first?.matchingComponentIds ?? []);
    for (const item of rest) for (const id of [...intersection]) if (!item.matchingComponentIds.includes(id)) intersection.delete(id);
    return [...intersection];
  });
  const limiting = groupMatches.length ? Math.min(...groupMatches.map((ids) => ids.length)) : 0;
  const ids = [...new Set(groupMatches.flat())];
  const manufacturers = [...new Set(ids.map((id) => byId.get(id)?.manufacturer).filter((value): value is string => Boolean(value)))].sort();
  const status = limiting >= 3 && manufacturers.length >= 2 ? "adequate"
    : limiting >= 2 && manufacturers.length >= 2 ? "limited"
      : limiting === 1 ? "restricted" : "no_coverage";
  return {
    status,
    matchingProductCount: limiting,
    distinctManufacturerCount: manufacturers.length,
    matchingComponentIds: ids,
    manufacturerNames: manufacturers,
    safeForPublication: status === "adequate",
    reasons: status === "adequate" ? ["Cada requisito obrigatorio possui pelo menos tres produtos e o conjunto cobre ao menos dois fabricantes."]
      : status === "limited" ? ["Ha apenas duas alternativas comprovadas para pelo menos um requisito; revisao da pesquisa de mercado obrigatoria."]
        : status === "restricted" ? ["Pelo menos um requisito obrigatorio identifica somente um produto ou fabricante; publicacao bloqueada sem justificativa excepcional."]
          : ["Nao ha especificacoes oficiais completas suficientes para comprovar concorrencia e equivalencia."],
  };
}

export function forbiddenNeutralIdentifiers(specification: Pick<ProcurementNeutralSpecification, "requirements">, components: HardwareComponent[]): string[] {
  const text = specification.requirements.map((item) => `${item.characteristic} ${item.value} ${item.rationale} ${item.acceptanceCriterion}`).join(" ").toLowerCase();
  const tokens = new Set(components.flatMap((component) => [component.manufacturer, component.sku, component.canonicalMpn ?? ""])
    .map((item) => item.trim()).filter((item) => item.length >= 4));
  return [...tokens].filter((token) => new RegExp(`(^|[^a-z0-9])${token.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text)).sort();
}

function procurementSpecificationPrepared(
  scenario: CapacityScenario,
  option: RecommendationAlternative,
  enrichedComponents: HardwareComponent[],
  observations: PublicBenchmarkObservation[],
  generatedAt: string,
): ProcurementNeutralSpecification {
  const matchedRequirements = populateMatches(baseRequirements(scenario, option), enrichedComponents, observations);
  const internalAssessment = competition(matchedRequirements, enrichedComponents);
  // A neutral public specification contains counts and conclusions, never
  // product identifiers or manufacturer names. Traceability remains in the
  // explicitly separate commercial-reference section.
  const requirements = matchedRequirements.map((requirement) => ({ ...requirement, matchingComponentIds: [] }));
  const marketCompetitionAssessment = { ...internalAssessment, matchingComponentIds: [], manufacturerNames: [] };
  const draft: ProcurementNeutralSpecification = {
    schemaVersion: PROCUREMENT_NEUTRAL_SPECIFICATION_VERSION,
    id: `neutral-spec:${hashId(option.id, generatedAt)}`,
    recommendationAlternativeId: option.id,
    generatedAt,
    nodeCount: option.nodeCount,
    activeNodeCount: option.activeNodeCount,
    status: "blocked",
    procurementEligibility: option.procurementEligibility,
    requirements,
    marketCompetitionAssessment,
    forbiddenIdentifierFindings: [],
    disclaimers: [
      LEGAL_NOTICE,
      "A referência comercial não deve ser copiada para o edital. Use somente requisitos neutros aprovados e revisados.",
      "Especificações oficiais comprovam características e compatibilidade, mas não substituem benchmarks nem calibrações físicas da carga de produção.",
    ],
  };
  draft.forbiddenIdentifierFindings = forbiddenNeutralIdentifiers(draft, enrichedComponents);
  const blocked = option.procurementEligibility !== "eligible" || ["restricted", "no_coverage"].includes(marketCompetitionAssessment.status) || draft.forbiddenIdentifierFindings.length > 0;
  draft.status = blocked ? "blocked" : marketCompetitionAssessment.status === "limited" ? "review_required" : "apt";
  return draft;
}

export function procurementSpecification(scenario: CapacityScenario, option: RecommendationAlternative, components: HardwareComponent[], observations: PublicBenchmarkObservation[] = [], generatedAt = new Date().toISOString()): ProcurementNeutralSpecification {
  return procurementSpecificationPrepared(
    scenario,
    option,
    components.map((component) => withTechnicalSpecification(component, generatedAt)),
    observations,
    generatedAt,
  );
}

export function withProcurementSpecifications(scenario: CapacityScenario, recommendations: CapacityRecommendation[], components: HardwareComponent[], observations: PublicBenchmarkObservation[] = [], generatedAt = new Date().toISOString()): CapacityRecommendation[] {
  // Technical specification normalization is the expensive part of this
  // operation. A report can contain dozens of alternatives, so normalizing
  // the full catalog once avoids repeating the same work for every option.
  const enrichedComponents = components.map((component) => withTechnicalSpecification(component, generatedAt));
  const componentById = new Map(enrichedComponents.map((component) => [component.id, component]));
  const decorate = (option: RecommendationAlternative): RecommendationAlternative => {
    const neutral = procurementSpecificationPrepared(
      scenario,
      option,
      enrichedComponents,
      observations,
      generatedAt,
    );
    return {
      ...option,
      commercialReference: commercialReference(option, componentById),
      procurementNeutralSpecification: neutral,
      marketCompetitionAssessment: neutral.marketCompetitionAssessment,
      warnings: [...new Set([...option.warnings, ...(neutral.status === "blocked" ? ["procurement_neutral_specification_blocked"] : [])])],
    };
  };
  return recommendations.map((recommendation) => ({
    ...recommendation,
    primary: decorate(recommendation.primary),
    alternatives: recommendation.alternatives.map(decorate),
  }));
}

export function procurementReportOptions(recommendations: CapacityRecommendation[]): Array<{
  commercialReference: CommercialRecommendationReference;
  procurementNeutralSpecification: ProcurementNeutralSpecification;
}> {
  return uniqueRecommendationOptions(recommendations).filter((option) => option.commercialReference && option.procurementNeutralSpecification).map((option) => ({
    commercialReference: option.commercialReference!,
    procurementNeutralSpecification: option.procurementNeutralSpecification!,
  }));
}
