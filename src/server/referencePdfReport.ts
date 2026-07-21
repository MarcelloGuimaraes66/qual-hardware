import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type {
  CapacityRecommendation,
  HardwareNodeTemplate,
  OperatingSystemFamily,
  RecommendationAlternative,
  RecommendationPolicy,
  ScenarioRecord,
} from "../shared/types.js";

export interface ReferencePdfReportContext {
  scenario: ScenarioRecord;
  recommendations: CapacityRecommendation[];
}

export const REFERENCE_PDF_STRUCTURE = Object.freeze({
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
} as const);

export const REFERENCE_PDF_TYPOGRAPHY = Object.freeze({
  justifiedSections: ["executive_narrative", "executive_cautions", "proposal_assumptions"],
  maximumWordGapMultiplier: 2.2,
} as const);

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

function buildReferenceNarrative(context: ReferencePdfReportContext) {
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
  const recommendation = `Para equilibrar segurança operacional, custo e possibilidade de crescimento, a escolha principal é ${selected.nodeCount} unidade(s) de ${selected.hardware.name}, com ${selected.hardware.cpuModel}, ${selected.hardware.gpuCount} × ${selected.hardware.gpuModel}, ${selected.hardware.ramGb} GB de memória por nó e ${selected.headroomPercent}% de folga planejada.`;
  return {
    title: REFERENCE_PDF_STRUCTURE.narrative,
    paragraphs: [
      `Analisamos o trabalho completo de ${scenario.totalCameras} câmera(s): recebimento RTSP, decodificação, processamento de imagem, criação e leitura de clipes, gravação em disco, tráfego de rede e inferência no AiQ/Qwen local. O FPS de leitura RTSP (${sourceFps.join("/ ")} por câmera) foi tratado separadamente do FPS efetivamente enviado ao modelo (${inferenceFps.join("/ ")}), porque esses dois momentos consomem recursos diferentes.`,
      `${recommendation} O limitante calculado desta proposta é ${selected.bottleneck}; por isso a recomendação considera o conjunto CPU, GPU, VRAM, RAM, SSD, rede e sustentação térmica, e não apenas a marca ou um score genérico.`,
      `Sobre a força da evidência: ${evidenceText}. ${priceText}`,
      `A opção mínima, ${minimum!.primary.hardware.name}, reduz o investimento inicial, mas trabalha com menos reserva para picos e crescimento. A opção recomendada oferece o melhor equilíbrio para operação contínua. A opção N+1, ${resilient!.primary.hardware.name}, custa mais porque mantém redundância e continuidade quando um nó estiver indisponível.`,
    ],
    cautions: [
      ...(selected.price.staleQuoteCount > 0 ? [`${selected.price.staleQuoteCount} cotação(ões) vencida(s) foram excluídas do cálculo.`] : []),
      ...(evidence?.status === "validated_local" || evidence?.status === "extrapolated_high" ? [] : ["Não trate esta estimativa como validação física; execute a calibração completa do Perceptrum antes de fechar a compra."]),
      "Driver, perfil de energia, refrigeração, versão do Perceptrum, modelo AiQ e workload devem permanecer iguais aos registrados na evidência.",
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
  writer.page.drawText(pdfSafe(`${recommendation.confidence.toUpperCase()} - ${design.nodeCount} no(s) - ${hardware.name}`), {
    x: 48, y: 754, size: 9, font: writer.regular, color: rgb(0.65, 0.73, 0.76),
  });
  writer.y = 720;

  writer.heading(REFERENCE_PDF_STRUCTURE.proposalSections[0]);
  writer.line(`Nos: ${design.nodeCount}; ativos: ${design.activeNodeCount}; reserva: ${design.nodeCount - design.activeNodeCount}.`);
  writer.line(`Folga-alvo: ${design.headroomPercent}%; gargalo dominante: ${design.bottleneck}; capacidade estimada neste perfil: ${design.maximumAdditionalCameras + design.allocations.filter((node) => node.role === "active").reduce((sum, node) => sum + node.cameraGroups.reduce((cameraSum, group) => cameraSum + group.cameras, 0), 0)} cameras (${design.maximumAdditionalCameras} adicionais).`);
  writer.line(`Preco do projeto: ${formatPrice(design)}`);

  writer.heading(REFERENCE_PDF_STRUCTURE.proposalSections[1]);
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

  writer.heading(REFERENCE_PDF_STRUCTURE.proposalSections[2]);
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

  writer.heading(REFERENCE_PDF_STRUCTURE.proposalSections[3]);
  for (const node of design.allocations) {
    const cameraCount = node.cameraGroups.reduce((sum, group) => sum + group.cameras, 0);
    writer.line(`No ${node.nodeIndex} - ${node.role} - ${cameraCount} camera(s) - ${node.cameraGroups.map((group) => `${group.groupName}: ${group.cameras}`).join(", ") || "reserva sem cameras"}.`, 9.5, true);
    writer.line(`CPU ${Math.round(node.utilization.cpuCores * 100)}%; RAM ${Math.round(node.utilization.ramGb * 100)}%; VRAM ${Math.round(node.utilization.gpuVramGb * 100)}%; NVDEC ${Math.round(node.utilization.gpuDecode1080p30Streams * 100)}%; LAN ${Math.round(node.utilization.lanGbps * 100)}%; Internet ${Math.round(node.utilization.internetUploadMbps * 100)}%.`, 9, false, 10);
  }

  writer.heading(REFERENCE_PDF_STRUCTURE.proposalSections[4]);
  for (const [resource, demand] of Object.entries(design.aggregateDemand)) {
    writer.line(`${resource}: ${Math.round(demand * 1000) / 1000}${resource === design.bottleneck ? " - GARGALO" : ""}.`);
  }

  writer.heading(REFERENCE_PDF_STRUCTURE.proposalSections[5]);
  for (const source of hardware.sources) writer.line(`Fonte tecnica: ${source.title} - ${source.url}`);
  for (const source of design.price.sourceUrls) writer.line(`Fonte de preco: ${source}`);
  for (const warning of design.warnings) writer.line(`AVISO: ${warning}`);
  for (const assumption of recommendation.assumptions) writer.paragraph(`Premissa: ${assumption}`);
  for (const evidence of recommendation.evidence) writer.line(`Evidencia: ${evidence}`);
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
  writer.line(`${scenario.scenario.projectName} - ${scenario.scenario.totalCameras} câmeras`, 13, true);
  writer.line(`Cliente: ${scenario.scenario.customerName || "não informado"}; mercado: ${scenario.scenario.market}; moeda: ${scenario.scenario.currency}.`);
  writer.line(`Revisão ${scenario.revision}; build ${scenario.scenario.perceptrumBuildHash}; contrato ${recommendations[0]!.contractVersion}.`);
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
    writer.line(`${POLICY_LABELS[recommendation.policy]}: ${design.nodeCount} nó(s), ${design.activeNodeCount} ativo(s), ${design.hardware.name}, ${operatingSystemFor(design.hardware)}.`, 11, true);
    writer.line(`CPU ${design.hardware.cpuModel}; RAM ${design.hardware.ramGb} GB/nó (${design.hardware.memoryArchitecture}); GPU ${design.hardware.gpuCount} x ${design.hardware.gpuModel}; ${gpuMemoryDescription(design.hardware)}; folga ${design.headroomPercent}%; preço ${formatPrice(design)}.`, 9, false, 10);
  }

  writer.newPage();
  writer.heading(REFERENCE_PDF_STRUCTURE.alternatives);
  for (const [index, option] of qualifiedOptions(recommendations).entries()) {
    writer.line(`${index + 1}. ${option.hardware.name} - ${option.hardware.cpuModel} - ${option.hardware.gpuModel} - ${formatPrice(option)} - evidencia ${option.calibration?.status ?? "estimada"}.`, 9.5);
  }

  writer.heading(REFERENCE_PDF_STRUCTURE.workload);
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
