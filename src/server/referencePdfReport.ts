import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type {
  CapacityRecommendation,
  HardwareNodeTemplate,
  OperatingSystemFamily,
  RecommendationAlternative,
  RecommendationPolicy,
  ScenarioRecord,
} from "../shared/types.js";
import { marketLabelPt, scenarioMarkets } from "../shared/markets.js";

export interface ReferencePdfReportContext {
  scenario: ScenarioRecord;
  recommendations: CapacityRecommendation[];
}

export const REFERENCE_PDF_STRUCTURE = Object.freeze({
  title: "Relatório comparativo de infraestrutura",
  narrative: "Nossa leitura e recomendação em linguagem direta",
  configurations: "As três configurações sugeridas",
  alternatives: "Outras máquinas avaliadas em ordem crescente de custo",
  workload: "Carga de câmeras e agentes usada no cálculo",
  proposalSections: [
    "Resumo de capacidade",
    "Especificação técnica por servidor",
    "Custo por componente e total do projeto",
    "Distribuição das câmeras e utilização",
    "Demanda agregada calculada",
    "Fontes, premissas e avisos",
  ],
} as const);

export const REFERENCE_PDF_TYPOGRAPHY = Object.freeze({
  justifiedSections: ["executive_narrative", "executive_cautions", "proposal_assumptions"],
  maximumWordGapMultiplier: 2.2,
} as const);

const POLICY_ORDER: RecommendationPolicy[] = ["minimum", "recommended", "n_plus_one"];
const POLICY_LABELS: Record<RecommendationPolicy, string> = {
  minimum: "1. Opção econômica",
  recommended: "2. Recomendado",
  n_plus_one: "3. N+1 resiliente",
};

function orderedRecommendations(recommendations: CapacityRecommendation[]): CapacityRecommendation[] {
  const byPolicy = new Map(recommendations.map((item) => [item.policy, item]));
  const ordered = POLICY_ORDER.map((policy) => byPolicy.get(policy)).filter((item): item is CapacityRecommendation => Boolean(item));
  if (ordered.length !== POLICY_ORDER.length) throw new Error("recommendation_set_incomplete");
  return ordered;
}

function formatMoney(value: number | null): string {
  if (value === null) return "-";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

function formatPrice(design: RecommendationAlternative): string {
  const price = design.price;
  if (price.median === null) return "Cotação necessária - nenhum valor de referência compatível foi encontrado.";
  const range = `${price.currency} ${formatMoney(price.minimum)} / ${formatMoney(price.median)} / ${formatMoney(price.maximum)}`;
  if (price.basis === "reference_estimate") return `${range} (faixa estimada; cotação de compra necessária)`;
  return `${range} (mínimo / mediano / máximo de mercado)`;
}

function formatCoverPrice(design: RecommendationAlternative): string {
  const price = design.price;
  if (price.median === null) return "cotação necessária";
  return `${price.currency} ${formatMoney(price.median)}${price.quotationRequired ? "; cotação obrigatória" : ""}`;
}

function formatReportDate(value: string | null | undefined): string {
  if (!value) return "não disponível";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function quantity(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

const RESOURCE_LABELS: Record<string, string> = {
  cpuCores: "núcleos de CPU",
  ramGb: "memória RAM",
  gpuVramGb: "memória de vídeo (VRAM)",
  localAiqSlots: "inferências locais simultâneas",
  gpuDecode1080p30Streams: "decodificação de vídeo pela GPU",
  diskCapacityTb: "capacidade de armazenamento",
  diskWriteMbps: "gravação em disco",
  diskReadMbps: "leitura em disco",
  memoryBandwidthGbps: "largura de banda da memória",
  lanGbps: "rede local",
  internetUploadMbps: "envio pela internet",
  processThreads: "threads de processamento",
  ffmpegProcessesPerSecond: "processos de vídeo por segundo",
  inferenceRequestsPerSecond: "requisições de inferência por segundo",
  rtsp_ingest: "recepção RTSP",
  video_decode: "decodificação de vídeo",
  bgr_processing: "processamento de imagem",
  video_encode: "codificação de vídeo",
  disk_write: "gravação em disco",
  disk_read: "leitura em disco",
  frame_extraction: "extração de quadros",
  local_inference: "inferência local",
  memory_bandwidth: "largura de banda da memória",
  network_ingest: "recepção pela rede",
  job_scheduler: "agendamento de tarefas",
  intelligence_scheduler: "agendamento de análises",
  database_persistence: "persistência dos resultados",
  dashboard_queries: "consultas do painel",
  thermal_sustain: "sustentação térmica",
};

const STATUS_LABELS: Record<string, string> = {
  active: "ativo",
  reserve: "reserva",
  planning_only: "planejamento pendente de validação física",
  single_node_validated: "validado em servidor único",
  eligible: "apto para aquisição",
  blocked: "bloqueado",
  validated_local: "medido localmente",
  extrapolated_high: "extrapolado com confiança alta",
  extrapolated_medium: "extrapolado com confiança moderada",
  reference_only: "somente referência",
  historical_template: "modelo histórico",
  no_coverage: "sem cobertura",
  current: "geração atual",
  previous: "geração anterior",
  two_generations_back: "duas gerações anteriores",
  high: "alta",
  medium: "moderada",
  low: "baixa",
};

function reportLabel(value: string | null | undefined): string {
  if (!value) return "não informado";
  const normalized = value.replaceAll(" ", "_");
  return STATUS_LABELS[value] ?? RESOURCE_LABELS[value] ?? STATUS_LABELS[normalized] ?? RESOURCE_LABELS[normalized] ?? value.replaceAll("_", " ");
}

function operatingSystemLabel(value: OperatingSystemFamily): string {
  return ({ windows: "Windows", ubuntu: "Ubuntu", macos: "macOS", linux: "Linux" } as Record<string, string>)[value] ?? value;
}

function hardwareKindLabel(value: string): string {
  return ({
    workstation: "estação de trabalho",
    desktop: "computador de mesa",
    laptop: "notebook",
    mini_pc: "minicomputador",
    rack_server: "servidor em rack",
    server: "servidor",
  } as Record<string, string>)[value] ?? value.replaceAll("_", " ");
}

function memoryArchitectureLabel(value: string): string {
  return ({ dedicated: "dedicada", unified: "unificada", shared: "compartilhada" } as Record<string, string>)[value] ?? value;
}

function redundancyLabel(value: string): string {
  return ({
    n_plus_one: "N+1",
    automatic_n_plus_one: "N+1 automático",
    automatic_ten_percent: "10% de reserva automática",
    none: "sem reserva",
  } as Record<string, string>)[value] ?? reportLabel(value);
}

function manufacturerLabel(value: string): string {
  return ({ amd: "AMD", intel: "Intel", nvidia: "NVIDIA", apple: "Apple" } as Record<string, string>)[value.toLowerCase()] ?? value;
}

function exclusionLabel(value: string): string {
  return ({
    taxes: "tributos",
    shipping: "frete",
    licenses: "licenças",
    energy: "energia",
    support: "suporte",
    TCO: "custo total de propriedade",
  } as Record<string, string>)[value] ?? value;
}

function technicalTextPt(value: string): string {
  return value
    .replace(/\bworkstation-class CPU loop and dual-slot blower GPU\b/gi, "circuito de refrigeração da CPU para estação de trabalho e GPU com ventilação de dois slots")
    .replace(/\bE-ATX workstation tower\b/gi, "torre E-ATX para estação de trabalho")
    .replace(/\bHigh-airflow full tower\b/gi, "torre completa com alto fluxo de ar")
    .replace(/\bFull tower workstation\b/gi, "torre completa para estação de trabalho")
    .replace(/\bFull tower\b/gi, "torre completa")
    .replace(/\benterprise NVMe\b/gi, "NVMe corporativo")
    .replace(/\bdesktop specifications\b/gi, "para estações de trabalho - especificações")
    .replace(/\bspecifications\b/gi, "especificações")
    .replace(/\bwith ECC and seven PCIe 5\.0 slots\b/gi, "com ECC e sete slots PCIe 5.0")
    .replace(/\b8-channel ECC DDR4\b/gi, "DDR4 ECC de 8 canais")
    .replace(/\bredundant-capable workstation PSU\b/gi, "fonte para estação de trabalho preparada para redundância")
    .replace(/\bHigh-airflow tower with workstation CPU cooling\b/gi, "torre de alto fluxo de ar com refrigeração da CPU")
    .replace(/\bworkstation board\b/gi, "placa-mãe para estação de trabalho")
    .replace(/\bserver board\b/gi, "placa-mãe para servidor")
    .replace(/\bfor OS and temporary inference workspace\b/gi, "para o sistema operacional e a área temporária de análise")
    .replace(/\bmirrored OS\/temp workspace\b/gi, "sistema e área temporária espelhados")
    .replace(/\bCPU liquid cooling\b/gi, "refrigeração líquida da CPU")
    .replace(/\bdedicated GPU intake\b/gi, "entrada de ar dedicada para a GPU")
    .replace(/\bair cooling\b/gi, "refrigeração a ar")
    .replace(/\brack server\b/gi, "servidor em rack")
    .replace(/\bworkstation\b/gi, "estação de trabalho");
}

function cameraGroupLabel(value: string): string {
  const withoutCount = value.replace(/^\s*\d+\s*câmeras?\s*[-—:]\s*/i, "").trim();
  return withoutCount || "Grupo de câmeras";
}

function fleetCapacity(design: RecommendationAlternative): number {
  if (design.fleetPlan) return design.fleetPlan.safeCamerasPerServer * design.fleetPlan.activeServers;
  return design.maximumAdditionalCameras + design.allocations
    .filter((node) => node.role === "active")
    .reduce((sum, node) => sum + node.cameraGroups.reduce((cameraSum, group) => cameraSum + group.cameras, 0), 0);
}

function projectTitle(scenario: ScenarioRecord["scenario"]): string {
  const cameras = `${scenario.totalCameras} câmeras`;
  return scenario.projectName.toLocaleLowerCase("pt-BR").includes(cameras.toLocaleLowerCase("pt-BR"))
    ? scenario.projectName
    : `${scenario.projectName} - ${cameras}`;
}

function warningLabel(value: string): string {
  const exact: Record<string, string> = {
    reference_price_estimate_purchase_quote_required: "Os preços são estimativas; obtenha uma cotação itemizada antes da aquisição.",
    non_ecc_memory: "A configuração utiliza memória sem correção de erros (ECC).",
    physical_calibration_or_comparable_public_evidence_required: "É necessária calibração física ou evidência pública diretamente comparável.",
    procurement_neutral_specification_blocked: "A especificação técnica ainda não pode ser usada para aquisição.",
    multi_node_design_is_planning_only_until_cluster_validation: "O projeto com vários servidores exige um piloto físico do conjunto.",
    planning_only_not_approved_for_hardware_acquisition: "A configuração serve para planejamento, mas ainda não está aprovada para aquisição.",
    cpu_rtsp_decode_selected_no_current_perceptrum_gpu_acceleration: "A decodificação de vídeo foi atribuída à CPU porque a aceleração por GPU ainda não foi comprovada.",
    ubuntu_target_requires_matching_perceptrum_build_and_benchmark: "A configuração Ubuntu exige compilação compatível e benchmark sustentado.",
    automatic_n_plus_one_reserve: "Foi incluído um servidor de reserva pela política N+1.",
    "not eligible for hardware acquisition": "A configuração ainda não está apta para aquisição.",
    "Estado de evidência 'reference only' não libera aquisição.": "A evidência disponível serve apenas como referência e não autoriza a aquisição.",
    "Estado de evidência 'reference_only' não libera aquisição.": "A evidência disponível serve apenas como referência e não autoriza a aquisição.",
    "State of evidence 'reference only' does not release acquisition.": "A evidência disponível serve apenas como referência e não autoriza a aquisição.",
    "State of evidence 'reference_only' does not release acquisition.": "A evidência disponível serve apenas como referência e não autoriza a aquisição.",
    "Socket da CPU e da plataforma precisa de especificação oficial exata.": "O soquete da CPU e da plataforma precisa de especificação oficial exata.",
    "Geração, lanes, slots e dimensões PCIe precisam estar comprovados para todas as GPUs.": "A geração, as pistas, os conectores e as dimensões PCIe precisam estar comprovados para todas as GPUs.",
    "SSD precisa declarar gravação sustentada, latência/IOPS e endurance para o papel atribuído.": "O SSD precisa informar gravação sustentada, latência/IOPS e resistência compatíveis com o uso previsto.",
  };
  return exact[value] ?? value
    .replace(/^([^:]+): São necessárias \d+ configurações físicas distintas; existem \d+\.?$/i, (_match, stage) => `${reportLabel(String(stage))}: ainda não possui as três calibrações físicas comparáveis exigidas.`)
    .replace(/^([^:]+): Não existe benchmark público elegível e comparável para este estágio\.?$/i, (_match, stage) => `${reportLabel(String(stage))}: ainda não possui benchmark público diretamente comparável.`)
    .replace(/Estado de evidência 'reference[ _]only' não libera aquisição\.?/gi, "A evidência disponível serve somente como referência e não libera aquisição.")
    .replace(/\breference[ _]only\b/gi, "somente referência")
    .replace(/\bplanning only\b/gi, "planejamento pendente de validação física")
    .replace(/perceptrum/gi, "pipeline local")
    .replaceAll("_", " ");
}

function summarizedWarnings(values: string[]): string[] {
  const stages = new Set<string>();
  const remaining: string[] = [];
  for (const value of values) {
    const stageMatch = value.match(/^([^:]+): (?:São necessárias|Não existe benchmark público)/i);
    if (stageMatch) {
      stages.add(reportLabel(stageMatch[1]!.trim()));
      continue;
    }
    remaining.push(warningLabel(value));
  }
  if (stages.size > 0) {
    remaining.push(`Etapas que ainda exigem evidência física ou benchmark diretamente comparável: ${[...stages].join(", ")}.`);
  }
  return [...new Set(remaining)];
}

function assumptionLabel(value: string): string {
  const exact: Record<string, string> = {
    "Continuous RTSP decode remains charged at source codec, resolution and FPS.": "A decodificação RTSP contínua é dimensionada com o codec, a resolução e o FPS da fonte.",
    "BGR buffer capacity is estimated as two seconds at the configured source FPS.": "A capacidade do buffer de imagens corresponde a dois segundos no FPS configurado para a fonte.",
    "Video frame extraction includes one FFmpeg process per sampled frame, capped at 300 frames per request.": "A extração considera um processo de vídeo por quadro amostrado, limitada a 300 quadros por requisição.",
    "AiQ/Qwen Core uses one effective inference frame per second in 60-second execution cycles; RTSP receive/decode FPS remains independent.": "O modelo Core usa um quadro efetivo de inferência por segundo em ciclos de 60 segundos; o FPS de recepção e decodificação RTSP permanece independente.",
    "Disk write throughput and at least one day of rolling temporary source clips participate in sizing; configured retention and RAID factor increase capacity demand.": "A taxa de gravação e pelo menos um dia de clipes temporários entram no dimensionamento; a retenção e o fator RAID configurados aumentam a capacidade exigida.",
    "The final safe camera count is the minimum across RTSP ingest, decode, BGR, encode, frame extraction, AiQ, memory bandwidth, SSD read/write, network, Jobs, Steps, Agents, Intelligence, database, dashboard and sustained thermal evidence.": "A quantidade final segura é o menor limite entre recepção RTSP, decodificação, processamento de imagem, codificação, extração de quadros, inferência, memória, SSD, rede, tarefas, análises, banco de dados, painel e sustentação térmica.",
    "This design is shown for planning or diagnosis only and is not approved for hardware acquisition until every required stage has comparable evidence.": "Esta configuração é apresentada para planejamento ou diagnóstico e não está aprovada para aquisição enquanto os estágios obrigatórios não possuírem evidência comparável.",
    "This design is shown for planning or diagnosis only, and is not approved for hardware acquisition until every required stage has comparable evidence.": "Esta configuração é apresentada para planejamento ou diagnóstico e não está aprovada para aquisição enquanto os estágios obrigatórios não possuírem evidência comparável.",
    "Built-in component costs are dated planning references converted with official FX snapshots; current compatible market quotes take precedence when available.": "Os custos embarcados são referências datadas de planejamento, convertidas por câmbio oficial; cotações atuais e compatíveis prevalecem quando disponíveis.",
    "Reference estimates exclude taxes, shipping, licenses, energy, support and TCO and still require a purchase quotation.": "As estimativas excluem tributos, frete, licenças, energia, suporte e custo total de propriedade, e ainda exigem cotação de compra.",
    "Windows is the current packaged workstation target; the exact CPU, GPU, driver and workload still require a matching sustained benchmark before validation.": "O Windows é a plataforma indicada para esta estação; CPU, GPU, driver e carga exatos ainda exigem benchmark sustentado compatível.",
    "The full active catalog competes on compatible capacity and price; laptops and mini PCs are considered for small loads instead of starting at workstation class.": "Todo o catálogo ativo concorre por capacidade e preço; notebooks e minicomputadores são considerados para cargas pequenas antes de se adotar uma estação de trabalho.",
  };
  return exact[value] ?? warningLabel(value);
}

function evidenceLabel(value: string): string {
  const prefixes: Array<[RegExp, string]> = [
    [/^perceptrum-build:/i, "Perfil de software: "],
    [/^workload-contract:/i, "Contrato da carga: "],
    [/^catalog-version:/i, "Versão do catálogo: "],
    [/^operating-system:/i, "Sistema operacional: "],
    [/^procurement-eligibility:/i, "Elegibilidade para aquisição: "],
  ];
  for (const [pattern, label] of prefixes) {
    if (pattern.test(value)) return `${label}${reportLabel(value.replace(pattern, "").replace(/perceptrum/gi, "qual-hardware"))}`;
  }
  return value.replace(/perceptrum/gi, "pipeline local");
}

function buildReferenceNarrative(context: ReferencePdfReportContext) {
  const recommendations = orderedRecommendations(context.recommendations);
  const [minimum, recommended, resilient] = recommendations;
  const scenario = context.scenario.scenario;
  const sourceFps = [...new Set(scenario.cameraGroups.map((group) => group.source.sourceFps))].sort((left, right) => left - right);
  const inferenceFps = [...new Set(scenario.cameraGroups.flatMap((group) => group.agents.map((agent) => Math.min(5, agent.modelFps))))].sort((left, right) => left - right);
  const selected = recommended!.primary;
  const evidence = selected.calibration;
  const fullVideoCameras = scenario.cameraGroups
    .filter((group) => group.agents.some((agent) => agent.inputType === "video"))
    .reduce((sum, group) => sum + group.count, 0);
  const frameCameras = scenario.totalCameras - fullVideoCameras;
  const safeProjectCapacity = selected.fleetPlan
    ? selected.fleetPlan.safeCamerasPerServer * selected.fleetPlan.activeServers
    : scenario.totalCameras + selected.maximumAdditionalCameras;
  const evidenceText = evidence?.status === "validated_local"
    ? "esta configuração foi medida fisicamente com a carga e o pipeline local registrados"
    : evidence?.status === "extrapolated_high"
      ? `a capacidade foi extrapolada com confiança alta, margem de ${evidence.reservePercent}% e gargalo ${reportLabel(evidence.bottleneck)}`
      : "a capacidade ainda depende de estimativas conservadoras e deve ser confirmada por calibração local antes da compra";
  const priceText = selected.price.median === null
    ? "O preço precisa de cotação comercial itemizada."
    : `O valor central é ${selected.price.currency} ${formatMoney(selected.price.median)} para o projeto; ${selected.price.quotationRequired ? "ele é uma referência e exige cotação antes da compra" : "ele usa cotações válidas do snapshot ativo"}.`;
  const recommendation = `Para equilibrar segurança operacional, custo e possibilidade de crescimento, a principal referência de planejamento utiliza ${quantity(selected.nodeCount, "servidor", "servidores")} do modelo ${selected.hardware.name}. Cada servidor possui ${selected.hardware.cpuModel}, ${quantity(selected.hardware.gpuCount, "GPU", "GPUs")}, ${selected.hardware.gpuModel}, ${selected.hardware.ramGb} GB de memória RAM e ${selected.headroomPercent}% de folga planejada.`;
  const topology = selected.fleetPlan
    ? `Para esta carga, cada servidor ativo precisa de ${quantity(selected.fleetPlan.perServer.cpuSockets, "CPU", "CPUs")} e ${quantity(selected.fleetPlan.perServer.gpuCount, "GPU", "GPUs")}. O sistema só indicará mais processadores ou GPUs por servidor quando a carga e as evidências demonstrarem essa necessidade; assim, evita-se superdimensionamento.`
    : "";
  return {
    title: REFERENCE_PDF_STRUCTURE.narrative,
    paragraphs: [
      `A carga informada contém ${quantity(scenario.totalCameras, "câmera", "câmeras")}: ${quantity(fullVideoCameras, "câmera em VÍDEO FULL", "câmeras em VÍDEO FULL")} e ${quantity(frameCameras, "câmera em FRAME", "câmeras em FRAME")}. Foram considerados o recebimento RTSP, a decodificação, o processamento de imagens, os clipes, o disco, a rede e a inferência local. O FPS da fonte (${sourceFps.join(" / ")} por câmera) foi tratado separadamente do FPS enviado ao modelo (${inferenceFps.join(" / ")}), pois essas etapas consomem recursos diferentes.`,
      `Resultado do dimensionamento: a carga solicitada cabe na referência apresentada, cuja capacidade estimada é de ${quantity(safeProjectCapacity, "câmera", "câmeras")} no conjunto de servidores ativos, com a margem operacional já aplicada. ${recommendation} O gargalo calculado é ${reportLabel(selected.bottleneck)}; por isso a análise considera CPU, GPU, VRAM, RAM, SSD, rede e sustentação térmica em conjunto.`,
      `Sobre a força da evidência: ${evidenceText}. ${priceText}`,
      `${topology} A opção econômica, ${minimum!.primary.hardware.name}, prioriza componentes de menor custo por servidor e pode exigir mais servidores. A opção recomendada oferece o melhor equilíbrio para operação contínua. A opção N+1, ${resilient!.primary.hardware.name}, custa mais porque mantém redundância e continuidade quando um servidor estiver indisponível.`,
    ],
    cautions: [
      ...(selected.price.staleQuoteCount > 0 ? [`${quantity(selected.price.staleQuoteCount, "cotação vencida foi excluída", "cotações vencidas foram excluídas")} do cálculo.`] : []),
      ...(evidence?.status === "validated_local" || evidence?.status === "extrapolated_high" ? [] : ["Não trate esta estimativa como validação física. Execute a calibração completa da carga antes de fechar a compra."]),
      "Driver, perfil de energia, refrigeração, versão do aplicativo, modelo de análise e carga devem permanecer iguais aos registrados na evidência.",
    ],
  };
}

function qualifiedOptions(recommendations: CapacityRecommendation[]): RecommendationAlternative[] {
  const byHardware = new Map<string, RecommendationAlternative>();
  for (const recommendation of recommendations) {
    for (const option of [recommendation.primary, ...recommendation.alternatives]) {
      const current = byHardware.get(option.hardware.id);
      const cost = option.price.median ?? Number.POSITIVE_INFINITY;
      const currentCost = current?.price.median ?? Number.POSITIVE_INFINITY;
      if (!current || cost < currentCost) byHardware.set(option.hardware.id, option);
    }
  }
  return [...byHardware.values()].sort((left, right) =>
    (left.price.median ?? Number.POSITIVE_INFINITY) - (right.price.median ?? Number.POSITIVE_INFINITY) ||
    left.hardware.name.localeCompare(right.hardware.name));
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
  if (hardware.memoryArchitecture === "shared") return "memória do sistema compartilhada; sem VRAM dedicada";
  return `${hardware.gpuVramGbTotal} GB de VRAM dedicada por servidor`;
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
  paragraph: (text: string, size?: number, isBold?: boolean, indent?: number) => void;
  heading: (text: string) => void;
}

function wrapByRenderedWidth(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = pdfSafe(text).trim().split(/\s+/).filter(Boolean).flatMap((word) => {
    if (font.widthOfTextAtSize(word, size) <= width) return [word];
    const parts: string[] = [];
    let part = "";
    for (const character of word) {
      const candidate = part + character;
      if (part && font.widthOfTextAtSize(candidate, size) > width) {
        parts.push(part);
        part = character;
      } else part = candidate;
    }
    if (part) parts.push(part);
    return parts;
  });
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawParagraphLine(page: PDFPage, line: string, x: number, y: number, width: number, size: number, font: PDFFont, justify: boolean): void {
  const words = line.split(/\s+/).filter(Boolean);
  if (!justify || words.length < 3) {
    page.drawText(line, { x, y, size, font, color: rgb(0.08, 0.12, 0.18) });
    return;
  }
  const wordsWidth = words.reduce((sum, word) => sum + font.widthOfTextAtSize(word, size), 0);
  const wordGap = (width - wordsWidth) / (words.length - 1);
  const naturalGap = font.widthOfTextAtSize(" ", size);
  if (wordGap > naturalGap * REFERENCE_PDF_TYPOGRAPHY.maximumWordGapMultiplier) {
    page.drawText(line, { x, y, size, font, color: rgb(0.08, 0.12, 0.18) });
    return;
  }
  let cursor = x;
  for (const word of words) {
    page.drawText(word, { x: cursor, y, size, font, color: rgb(0.08, 0.12, 0.18) });
    cursor += font.widthOfTextAtSize(word, size) + wordGap;
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
    const width = size >= 18 ? 52 : Math.max(50, 92 - indent * 2);
    const lines = wrap(pdfSafe(text), width);
    const lineHeight = size + 4.5;
    const requiredHeight = lines.length * lineHeight;
    if (lines.length > 1 && requiredHeight <= 735 && writer.y - requiredHeight < 55) writer.newPage();
    for (const line of lines) {
      if (writer.y < 55) writer.newPage();
      writer.page.drawText(line, {
        x: 48 + indent,
        y: writer.y,
        size,
        font: isBold ? bold : regular,
        color: rgb(0.08, 0.12, 0.18),
      });
      writer.y -= lineHeight;
    }
  };
  writer.paragraph = (text: string, size = 9.5, isBold = false, indent = 0): void => {
    const font = isBold ? bold : regular;
    const x = 48 + indent;
    const width = 499 - indent;
    const lines = wrapByRenderedWidth(text, font, size, width);
    const lineHeight = size + 4.5;
    if (lines.length > 1 && writer.y < 55 + lineHeight * 2) writer.newPage();
    for (const [lineIndex, line] of lines.entries()) {
      if (writer.y < 55) writer.newPage();
      drawParagraphLine(writer.page, line, x, writer.y, width, size, font, lineIndex < lines.length - 1);
      writer.y -= lineHeight;
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

function addConfiguration(writer: PdfWriter, recommendation: CapacityRecommendation, index: number): void {
  writer.newPage();
  const design = recommendation.primary;
  const hardware = design.hardware;
  writer.page.drawRectangle({ x: 0, y: 744, width: 595, height: 98, color: rgb(0.04, 0.09, 0.11) });
  writer.page.drawText(pdfSafe(`PROPOSTA ${index} DE 3`), { x: 48, y: 805, size: 9, font: writer.bold, color: rgb(0.78, 1, 0.24) });
  writer.page.drawText(pdfSafe(POLICY_LABELS[recommendation.policy]), { x: 48, y: 774, size: 22, font: writer.bold, color: rgb(0.94, 0.97, 0.98) });
  writer.page.drawText(pdfSafe(`${reportLabel(recommendation.confidence).toUpperCase()} - ${quantity(design.nodeCount, "SERVIDOR", "SERVIDORES")} - ${hardware.name}`), {
    x: 48, y: 754, size: 9, font: writer.regular, color: rgb(0.65, 0.73, 0.76),
  });
  writer.y = 720;

  writer.heading(REFERENCE_PDF_STRUCTURE.proposalSections[0]);
  writer.line(`Servidores: ${design.nodeCount}; ativos: ${design.activeNodeCount}; reserva: ${design.nodeCount - design.activeNodeCount}.`);
  const assignedCameraCount = design.allocations
    .filter((node) => node.role === "active")
    .reduce((sum, node) => sum + node.cameraGroups.reduce((cameraSum, group) => cameraSum + group.cameras, 0), 0);
  const reportedCapacity = fleetCapacity(design);
  writer.line(`Folga-alvo: ${design.headroomPercent}%; gargalo dominante: ${reportLabel(design.bottleneck)}; capacidade estimada neste perfil: ${reportedCapacity} câmeras (${Math.max(0, reportedCapacity - assignedCameraCount)} adicionais).`);
  if (design.fleetPlan) {
    const fleet = design.fleetPlan;
    writer.line(`CAPACIDADE ESTIMADA COM MARGEM: ${fleet.safeCamerasPerServer} câmeras por servidor ativo. Frota: ${fleet.activeServers} ativos + ${fleet.reserveServers} de reserva = ${fleet.totalServers} servidores; política ${redundancyLabel(fleet.redundancyPolicy)}.`, 10, true);
    writer.line(`Por servidor: ${quantity(fleet.perServer.cpuSockets, "CPU", "CPUs")}, ${fleet.perServer.physicalCores} núcleos físicos, ${fleet.perServer.logicalCores} threads, ${quantity(fleet.perServer.gpuCount, "GPU", "GPUs")}, ${Math.ceil(fleet.perServer.ramBytes / 1024 ** 3)} GB de RAM e ${fleet.perServer.networkGbps} Gbps.`);
    writer.line(`Totais da frota: ${quantity(fleet.totals.cpuSockets, "CPU", "CPUs")}, ${fleet.totals.physicalCores} núcleos físicos, ${quantity(fleet.totals.gpuCount, "GPU", "GPUs")}, ${Math.ceil(fleet.totals.ramBytes / 1024 ** 3)} GB de RAM e ${fleet.totals.networkGbps.toFixed(1)} Gbps. Estado: ${reportLabel(fleet.status)}.`);
    if (fleet.status === "planning_only") writer.line("PENDÊNCIA PARA AQUISIÇÃO: o plano com vários servidores exige piloto físico com balanceamento, falha de servidor, rede, armazenamento e recuperação.", 9.5, true);
  }
  writer.line(`Preço do projeto: ${formatPrice(design)}`);

  writer.heading(REFERENCE_PDF_STRUCTURE.proposalSections[1]);
  writer.line(`Sistema: ${hardware.name}; formato: ${hardwareKindLabel(hardware.kind)}; plataforma: ${operatingSystemLabel(operatingSystemFor(hardware))}; geração: ${reportLabel(hardware.generation)}.`, 10, true);
  writer.line(`CPU: ${hardware.cpuModel}; fabricante ${manufacturerLabel(hardware.cpuVendor)}; ${hardware.physicalCores} núcleos físicos; fator conservador sustentado de ${Math.round((hardware.sustainedComputeFactor ?? 1) * 100)}%.`);
  writer.line(`Placa-mãe ou plataforma: ${technicalTextPt(hardware.motherboard)}.`);
  writer.line(`RAM: ${hardware.ramGb} GB por servidor; ECC: ${hardware.ecc ? "sim" : "não"}; arquitetura: ${memoryArchitectureLabel(hardware.memoryArchitecture)}.`);
  writer.line(`GPU: ${hardware.gpuCount} x ${hardware.gpuModel} (${manufacturerLabel(hardware.gpuVendor)}); ${gpuMemoryDescription(hardware)}.`);
  writer.line(`Análise local: ${quantity(hardware.localAiqSlots, "instância simultânea", "instâncias simultâneas")} por servidor; decodificação por GPU: ${hardware.supportsPerceptrumGpuDecode ? "compatível" : "não comprovada"}; capacidade nominal de referência: ${hardware.gpuDecode1080p30Streams} fluxos 1080p30.`);
  writer.line(`NVMe operacional: ${technicalTextPt(hardware.storageModel)}; ${hardware.usableStorageTb} TB úteis; escrita, clipes temporários, retenção e RAID participam do dimensionamento.`);
  if (design.calibration) {
    const calibration = design.calibration;
    writer.line(`Evidência de capacidade: ${reportLabel(calibration.status)}; confiança ${reportLabel(calibration.confidenceClass)}; intervalo seguro ${calibration.safeCameraMinimum ?? "não determinado"} a ${calibration.safeCameraMaximum ?? "não determinado"} câmeras; reserva ${calibration.reservePercent}%; gargalo ${reportLabel(calibration.bottleneck)}.`);
    for (const stage of calibration.stagePredictions) {
      writer.line(`Extrapolação em ${reportLabel(stage.stage)}: ${stage.safeCameraCapacity} câmeras com margem, ${stage.reservePercent}% de reserva e ${quantity(stage.anchorHardwareIds.length, "âncora física", "âncoras físicas")}.`);
    }
  }
  writer.line(`Rede: ${hardware.nicGbps} GbE; fonte: ${technicalTextPt(hardware.powerSupply)}; refrigeração: ${technicalTextPt(hardware.cooling)}.`);
  writer.line(`Chassi: ${technicalTextPt(hardware.chassis)}; sistema operacional: ${hardware.windowsEdition}; índice de expansão: ${hardware.expansionScore}.`);

  writer.heading(REFERENCE_PDF_STRUCTURE.proposalSections[2]);
  if (design.price.componentEstimates?.length) {
    for (const component of design.price.componentEstimates) {
      writer.line(`${component.component}: ${component.quantityPerNode} por servidor; ${design.price.currency} ${formatMoney(component.perNodeAmount)} por servidor; ${design.price.currency} ${formatMoney(component.projectAmount)} no projeto.`);
    }
    const perNodeTotal = design.price.median === null ? null : design.price.median / design.nodeCount;
    writer.line(`TOTAL POR SERVIDOR: ${design.price.currency} ${formatMoney(perNodeTotal)}.`, 10, true);
    writer.line(`QUANTIDADE DE SERVIDORES: ${design.nodeCount}. TOTAL DO PROJETO: ${design.price.currency} ${formatMoney(design.price.median)}.`, 10, true);
    writer.line(`Faixa do projeto: ${formatPrice(design)}.`);
    writer.line(`Base: ${priceBasisPt(design)}; referência: ${formatReportDate(design.price.observedAt)}; exclui ${(design.price.exclusions ?? []).map(exclusionLabel).join(", ")}.`);
  } else writer.line("Sem estimativa compatível; obtenha cotação itemizada antes da proposta comercial.");

  writer.heading(REFERENCE_PDF_STRUCTURE.proposalSections[3]);
  for (const node of design.allocations) {
    const cameraCount = node.cameraGroups.reduce((sum, group) => sum + group.cameras, 0);
    writer.line(`Servidor ${node.nodeIndex}${(node.representedNodeCount ?? 1) > 1 ? ` (representa ${node.representedNodeCount} servidores idênticos)` : ""} - ${reportLabel(node.role)} - ${quantity(cameraCount, "câmera", "câmeras")} - ${node.cameraGroups.map((group) => `${cameraGroupLabel(group.groupName)}: ${group.cameras}`).join(", ") || "reserva sem câmeras"}.`, 9.5, true);
    writer.line(`CPU ${Math.round(node.utilization.cpuCores * 100)}%; RAM ${Math.round(node.utilization.ramGb * 100)}%; VRAM ${Math.round(node.utilization.gpuVramGb * 100)}%; NVDEC ${Math.round(node.utilization.gpuDecode1080p30Streams * 100)}%; LAN ${Math.round(node.utilization.lanGbps * 100)}%; Internet ${Math.round(node.utilization.internetUploadMbps * 100)}%.`, 9, false, 10);
  }

  writer.heading(REFERENCE_PDF_STRUCTURE.proposalSections[4]);
  for (const [resource, demand] of Object.entries(design.aggregateDemand)) {
    writer.line(`${reportLabel(resource)}: ${Math.round(demand * 1000) / 1000}${resource === design.bottleneck ? " - GARGALO" : ""}.`);
  }

  writer.heading(REFERENCE_PDF_STRUCTURE.proposalSections[5]);
  for (const source of hardware.sources) writer.line(`Fonte técnica: ${technicalTextPt(source.title)} - ${source.url}`);
  for (const source of design.price.sourceUrls) writer.line(`Fonte de preço: ${source}`);
  for (const warning of summarizedWarnings(design.warnings)) writer.paragraph(`AVISO: ${warning}`);
  for (const assumption of recommendation.assumptions) writer.paragraph(`Premissa: ${assumptionLabel(assumption)}`);
  for (const evidence of recommendation.evidence) writer.line(`Evidência: ${evidenceLabel(evidence)}`);
}

export async function referencePdfReport({ scenario, recommendations: input }: ReferencePdfReportContext): Promise<Buffer> {
  const recommendations = orderedRecommendations(input);
  const narrative = buildReferenceNarrative({ scenario, recommendations });
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const writer = createPdfWriter(document, regular, bold);

  writer.line("AIQUIMIST - QUAL HARDWARE", 12, true);
  writer.line(REFERENCE_PDF_STRUCTURE.title, 22, true);
  writer.y -= 8;
  writer.line(projectTitle(scenario.scenario), 13, true);
  writer.line(`Cliente: ${scenario.scenario.customerName || "não informado"}; mercados pesquisados: ${marketLabelPt(scenarioMarkets(scenario.scenario))}; moeda do relatório: ${scenario.scenario.currency}.`);
  writer.line(`Revisão ${scenario.revision}; perfil de software ${scenario.scenario.perceptrumBuildHash}; contrato ${recommendations[0]!.contractVersion.replace(/perceptrum/gi, "qual-hardware")}.`);
  writer.y -= 10;
  writer.heading(narrative.title);
  for (const paragraph of narrative.paragraphs) {
    writer.paragraph(paragraph, 10);
    writer.y -= 4;
  }
  for (const caution of narrative.cautions) writer.paragraph(`ATENÇÃO: ${caution}`, 9.5, true);

  writer.heading(REFERENCE_PDF_STRUCTURE.configurations);
  for (const recommendation of recommendations) {
    const design = recommendation.primary;
    writer.line(`${POLICY_LABELS[recommendation.policy]}: ${quantity(design.nodeCount, "servidor", "servidores")}, ${quantity(design.activeNodeCount, "ativo", "ativos")}, ${design.hardware.name}, ${operatingSystemLabel(operatingSystemFor(design.hardware))}.`, 11, true);
    writer.line(`Por servidor: ${design.hardware.cpuModel}; ${design.hardware.ramGb} GB de RAM; ${design.hardware.gpuCount} x ${design.hardware.gpuModel}; ${gpuMemoryDescription(design.hardware)}. Folga: ${design.headroomPercent}%. Preço central do projeto: ${formatCoverPrice(design)}.`, 8.4, false, 10);
  }

  if (document.getPageCount() === 1 || writer.y < 500) writer.newPage();
  writer.heading(REFERENCE_PDF_STRUCTURE.alternatives);
  for (const [index, option] of qualifiedOptions(recommendations).entries()) {
    const perServer = option.fleetPlan?.perServer;
    writer.line(`${index + 1}. ${option.hardware.name} - ${quantity(option.nodeCount, "servidor", "servidores")} (${option.activeNodeCount} ativos) - ${perServer?.cpuSockets ?? 1} CPU por servidor - ${option.hardware.gpuCount} GPU por servidor - ${option.hardware.cpuModel} - ${option.hardware.gpuModel} - ${formatPrice(option)} - evidência ${reportLabel(option.calibration?.status ?? "estimada")}.`, 9.5);
  }

  writer.heading(REFERENCE_PDF_STRUCTURE.workload);
  for (const group of scenario.scenario.cameraGroups) {
    writer.line(`${quantity(group.count, "câmera", "câmeras")} - ${cameraGroupLabel(group.name)}: ${group.source.codec.toUpperCase()} ${group.source.width}x${group.source.height}, ${group.source.sourceFps} FPS RTSP, ${group.source.bitrateMbps} Mbps, decodificação ${group.decodeMode === "gpu" ? "pela GPU" : "pela CPU"}.`, 9.5, true);
    for (const agent of group.agents) {
      const media = agent.inputType === "video"
        ? `VÍDEO FULL, ${agent.packaging === "mosaic_2x2" ? "mosaico 2x2" : "sequência de quadros"}, ${agent.modelFps} FPS`
        : "FRAME, uma imagem por execução";
      writer.line(`- ${agent.name}: modelo ${agent.model}, ${media}, execução a cada ${agent.runEverySeconds} segundos; somente com movimento: ${agent.features.onlyCaptureOnMotion ? "sim" : "não"}; regiões: ${agent.features.regions ? "sim" : "não"}; recorte: ${agent.features.croppedFrame ? "sim" : "não"}; referências faciais: ${agent.features.faceReferences ? "sim" : "não"}; análise temporal: ${agent.features.temporal ? "sim" : "não"}.`, 9, false, 10);
    }
  }

  recommendations.forEach((recommendation, index) => addConfiguration(writer, recommendation, index + 1));

  const pages = document.getPages();
  pages.forEach((reportPage, index) => reportPage.drawText(
    pdfSafe(`Qual Hardware | página ${index + 1} de ${pages.length}`),
    { x: 48, y: 24, size: 8, font: regular, color: rgb(0.35, 0.4, 0.45) },
  ));
  return Buffer.from(await document.save());
}
