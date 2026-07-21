import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type {
  CapacityRecommendation,
  ComponentBuild,
  HardwareComponent,
  HardwareComponentKind,
  ManufacturerSpecificationAuthority,
  PublicBenchmarkObservation,
  RecommendationAlternative,
  RecommendationPolicy,
  TechnicalSpecificationField,
} from "../shared/types.js";
import type { ReportContext } from "./reports.js";
import { marketLabelPt, scenarioMarkets } from "../shared/markets.js";

const require = createRequire(import.meta.url);
const REGULAR_FONT_PATH = require.resolve("notosans-fontface/fonts/NotoSans-Regular.ttf");
const BOLD_FONT_PATH = require.resolve("notosans-fontface/fonts/NotoSans-Bold.ttf");
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 44;
const RIGHT = 44;
const CONTENT_WIDTH = PAGE_WIDTH - LEFT - RIGHT;
const BOTTOM = 48;
export const MISSING_VALUE = "Não publicado ou não localizado nas fontes consultadas";

export const POLICY_LABEL: Record<RecommendationPolicy, string> = {
  minimum: "Mínimo técnico",
  recommended: "Recomendado",
  n_plus_one: "N+1 resiliente",
};

export const KIND_LABEL: Partial<Record<HardwareComponentKind, string>> = {
  cpu: "Processador (CPU)",
  gpu: "Acelerador gráfico (GPU)",
  motherboard: "Placa-mãe / plataforma",
  memory_kit: "Memória RAM",
  storage_os: "SSD operacional",
  storage_retention: "SSD de retenção",
  nic: "Interface de rede",
  psu: "Fonte de alimentação",
  cooling: "Sistema de refrigeração",
  chassis: "Chassi",
  oem_system: "Sistema OEM",
  rack_configuration: "Configuração de rack",
  memory: "Memória RAM (legado)",
  storage: "Armazenamento (legado)",
  network: "Rede (legado)",
  system: "Sistema (legado)",
};

export const ROLE_LABEL: Record<ComponentBuild["items"][number]["role"], string> = {
  compute: "Processamento",
  acceleration: "Aceleração",
  platform: "Plataforma",
  memory: "Memória",
  operating_storage: "Armazenamento operacional",
  retention_storage: "Armazenamento de retenção",
  network: "Rede",
  power: "Alimentação",
  cooling: "Refrigeração",
  chassis: "Chassi",
  oem_system: "Sistema OEM",
};

const AUTHORITY_RANK: Record<ManufacturerSpecificationAuthority, number> = {
  official_sku: 4,
  official_family: 3,
  official_matrix: 2,
  secondary_reference: 1,
};

export interface TechnicalCadernoUsage {
  policy: RecommendationPolicy;
  optionId: string;
  nodeCount: number;
  activeNodeCount: number;
  variant: RecommendationAlternative["variant"];
}

export interface TechnicalCadernoConfiguration {
  key: string;
  representative: RecommendationAlternative;
  usages: TechnicalCadernoUsage[];
}

export interface TechnicalCadernoModel {
  configurations: TechnicalCadernoConfiguration[];
  rawOptionCount: number;
  evaluatedComponentCount: number;
}

function optionPrice(option: RecommendationAlternative): number {
  return option.price.median ?? Number.POSITIVE_INFINITY;
}

function configurationKey(option: RecommendationAlternative): string {
  return option.bom?.id ?? `hardware:${option.hardware.id}`;
}

export function buildTechnicalCadernoModel(context: ReportContext): TechnicalCadernoModel {
  const grouped = new Map<string, TechnicalCadernoConfiguration>();
  let rawOptionCount = 0;
  for (const recommendation of context.recommendations) {
    for (const option of [recommendation.primary, ...recommendation.alternatives]) {
      rawOptionCount += 1;
      const key = configurationKey(option);
      const usage: TechnicalCadernoUsage = {
        policy: recommendation.policy,
        optionId: option.id,
        nodeCount: option.nodeCount,
        activeNodeCount: option.activeNodeCount,
        variant: option.variant,
      };
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, { key, representative: option, usages: [usage] });
        continue;
      }
      if (!current.usages.some((item) => item.policy === usage.policy && item.nodeCount === usage.nodeCount && item.activeNodeCount === usage.activeNodeCount)) {
        current.usages.push(usage);
      }
      if (optionPrice(option) < optionPrice(current.representative)) current.representative = option;
    }
  }
  const configurations = [...grouped.values()].sort((left, right) =>
    optionPrice(left.representative) - optionPrice(right.representative)
    || left.representative.hardware.name.localeCompare(right.representative.hardware.name, "pt-BR"));
  return { configurations, rawOptionCount, evaluatedComponentCount: context.components?.length ?? 0 };
}

export function money(value: number | null, currency: string): string {
  if (value === null) return "Cotação necessária";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

export function displayValue(field: TechnicalSpecificationField): string {
  if (field.status !== "published" || field.value === null) return MISSING_VALUE;
  const value = typeof field.value === "boolean" ? (field.value ? "Sim" : "Não") : String(field.value);
  return field.unit ? `${value} ${field.unit}` : value;
}

export function displayManufacturer(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("pt-BR");
  const known: Record<string, string> = {
    amd: "AMD", intel: "Intel", nvidia: "NVIDIA", apple: "Apple", asus: "ASUS", dell: "Dell",
    hp: "HP", hpe: "HPE", lenovo: "Lenovo", samsung: "Samsung", kingston: "Kingston",
    corsair: "Corsair", seasonic: "Seasonic", noctua: "Noctua", supermicro: "Supermicro",
  };
  return known[normalized] ?? value.trim();
}

export function operatingSystemLabel(value: string): string {
  if (value === "windows") return "Windows";
  if (value === "macos") return "macOS";
  if (value === "ubuntu") return "Ubuntu";
  return value;
}

export function fieldStatusLabel(field: TechnicalSpecificationField): string {
  if (field.status === "published") return field.confidence === "official" ? "Publicado oficialmente" : "Complementar / legado";
  if (field.status === "ambiguous") return "Ambíguo - exige confirmação";
  if (field.status === "conflicting") return "Conflitante - exige revisão";
  if (field.status === "not_applicable") return "Não aplicável";
  if (field.status === "rejected") return "Rejeitado";
  return MISSING_VALUE;
}

export function componentDisplayName(component: HardwareComponent | undefined, fallback: string): string {
  if (!component) return fallback;
  const manufacturer = displayManufacturer(component.manufacturer);
  const model = component.sku.trim();
  return model.toLocaleLowerCase("pt-BR").startsWith(manufacturer.toLocaleLowerCase("pt-BR")) ? model : `${manufacturer} ${model}`;
}

export function isResolvedExactSku(component: HardwareComponent | undefined): boolean {
  if (!component?.canonicalMpn || component.canonicalMpn === component.id) return false;
  return Boolean(component.technicalSpecification?.fields.some((field) => field.status === "published" && field.confidence === "official"));
}

export function authorityLabel(authority: ManufacturerSpecificationAuthority | null): string {
  if (authority === "official_sku") return "Fabricante - SKU exato";
  if (authority === "official_family") return "Fabricante - família";
  if (authority === "official_matrix") return "Fabricante - matriz oficial";
  if (authority === "secondary_reference") return "Fonte técnica complementar";
  return "Fonte cadastrada";
}

export interface SourceReference {
  number: number;
  url: string;
  authority: ManufacturerSpecificationAuthority | null;
  retrievedAt: string | null;
  locator: string | null;
}

export function componentSources(components: HardwareComponent[]): SourceReference[] {
  const byUrl = new Map<string, Omit<SourceReference, "number">>();
  for (const component of components) {
    for (const observation of component.technicalSpecification?.observations ?? []) {
      const current = byUrl.get(observation.sourceUrl);
      if (!current || AUTHORITY_RANK[observation.authority] > AUTHORITY_RANK[current.authority ?? "secondary_reference"]) {
        byUrl.set(observation.sourceUrl, {
          url: observation.sourceUrl,
          authority: observation.authority,
          retrievedAt: observation.retrievedAt,
          locator: observation.evidenceLocator,
        });
      }
    }
    for (const evidence of component.evidence ?? []) {
      if (!byUrl.has(evidence.url)) byUrl.set(evidence.url, {
        url: evidence.url,
        authority: null,
        retrievedAt: evidence.retrievedAt,
        locator: evidence.evidenceLocator,
      });
    }
    for (const url of component.sourceUrls) {
      if (!byUrl.has(url)) byUrl.set(url, { url, authority: null, retrievedAt: null, locator: null });
    }
  }
  return [...byUrl.values()].sort((left, right) =>
    (AUTHORITY_RANK[right.authority ?? "secondary_reference"] - AUTHORITY_RANK[left.authority ?? "secondary_reference"])
    || left.url.localeCompare(right.url)).map((source, index) => ({ ...source, number: index + 1 }));
}

export function sourceNumbers(field: TechnicalSpecificationField, sources: SourceReference[]): string {
  const numbers = field.sourceEvidence.map((evidence) => sources.find((source) => source.url === evidence.url)?.number).filter((value): value is number => value !== undefined);
  return [...new Set(numbers)].map((number) => `[F${number}]`).join(" ") || "-";
}

export function publishedFields(component: HardwareComponent): TechnicalSpecificationField[] {
  return [...(component.technicalSpecification?.fields ?? [])]
    .filter((field) => field.status !== "not_published" || field.required)
    .sort((left, right) =>
      (left.sectionLabelPt ?? "").localeCompare(right.sectionLabelPt ?? "", "pt-BR")
      || (left.displayOrder ?? 999) - (right.displayOrder ?? 999)
      || left.labelPt.localeCompare(right.labelPt, "pt-BR"));
}

function safeText(value: string): string {
  return value.replace(/[\u2010-\u2015]/g, "-").replaceAll("\u00a0", " ").replace(/[\u0000-\u001f\u007f]/g, " ");
}

function splitLongToken(token: string, font: PDFFont, size: number, width: number): string[] {
  if (font.widthOfTextAtSize(token, size) <= width) return [token];
  const parts: string[] = [];
  let part = "";
  for (const character of token) {
    if (part && font.widthOfTextAtSize(part + character, size) > width) {
      parts.push(part);
      part = character;
    } else part += character;
  }
  if (part) parts.push(part);
  return parts;
}

function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = safeText(text).trim().split(/\s+/).filter(Boolean).flatMap((token) => splitLongToken(token, font, size, width));
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawJustifiedLine(page: PDFPage, line: string, x: number, y: number, width: number, size: number, font: PDFFont, justify: boolean): void {
  const words = line.split(/\s+/).filter(Boolean);
  if (!justify || words.length < 3) {
    page.drawText(line, { x, y, size, font, color: rgb(0.08, 0.12, 0.16) });
    return;
  }
  const wordsWidth = words.reduce((sum, word) => sum + font.widthOfTextAtSize(word, size), 0);
  const gap = (width - wordsWidth) / (words.length - 1);
  const natural = font.widthOfTextAtSize(" ", size);
  if (gap > natural * 2.2) {
    page.drawText(line, { x, y, size, font, color: rgb(0.08, 0.12, 0.16) });
    return;
  }
  let cursor = x;
  for (const word of words) {
    page.drawText(word, { x: cursor, y, size, font, color: rgb(0.08, 0.12, 0.16) });
    cursor += font.widthOfTextAtSize(word, size) + gap;
  }
}

class CadernoWriter {
  page!: PDFPage;
  y = 0;
  readonly sectionPages: Array<{ title: string; page: number }> = [];

  constructor(readonly document: PDFDocument, readonly regular: PDFFont, readonly bold: PDFFont) {}

  newPage(sectionTitle?: string): void {
    this.page = this.document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = 782;
    if (sectionTitle) this.sectionPages.push({ title: sectionTitle, page: this.document.getPageCount() });
  }

  ensure(height: number): void {
    if (this.y - height < BOTTOM) this.newPage();
  }

  gap(points: number): void {
    this.y -= points;
  }

  line(text: string, size = 9.2, bold = false, indent = 0, color = rgb(0.08, 0.12, 0.16)): void {
    const font = bold ? this.bold : this.regular;
    const width = CONTENT_WIDTH - indent;
    const lines = wrapText(text, font, size, width);
    this.ensure(lines.length * (size + 4));
    for (const line of lines) {
      this.page.drawText(line, { x: LEFT + indent, y: this.y, size, font, color });
      this.y -= size + 4;
    }
  }

  paragraph(text: string, size = 9.2, bold = false, indent = 0): void {
    const font = bold ? this.bold : this.regular;
    const width = CONTENT_WIDTH - indent;
    const lines = wrapText(text, font, size, width);
    this.ensure(Math.min(lines.length, 3) * (size + 4));
    for (const [index, line] of lines.entries()) {
      if (this.y - (size + 4) < BOTTOM) this.newPage();
      drawJustifiedLine(this.page, line, LEFT + indent, this.y, width, size, font, index < lines.length - 1);
      this.y -= size + 4;
    }
    this.y -= 4;
  }

  heading(text: string, level: 1 | 2 | 3 = 1): void {
    const size = level === 1 ? 16 : level === 2 ? 12.5 : 10.5;
    this.ensure(level === 1 ? 72 : 52);
    this.y -= level === 1 ? 7 : 3;
    if (level === 1) this.page.drawRectangle({ x: LEFT, y: this.y - 4, width: 4, height: 20, color: rgb(0.55, 0.74, 0.12) });
    this.line(text, size, true, level === 1 ? 12 : 0, level === 1 ? rgb(0.04, 0.12, 0.15) : rgb(0.12, 0.25, 0.29));
    this.y -= level === 1 ? 5 : 2;
  }

  table(headers: string[], rows: string[][], widths: number[]): void {
    const row = (cells: string[], header: boolean): void => {
      const font = header ? this.bold : this.regular;
      const size = header ? 8.2 : 7.8;
      const padding = 5;
      const lineSets = cells.map((cell, index) => wrapText(cell, font, size, widths[index]! - padding * 2));
      const height = Math.max(...lineSets.map((lines) => lines.length)) * (size + 3) + padding * 2;
      if (this.y - height < BOTTOM) {
        this.newPage();
        if (!header) row(headers, true);
      }
      const bottom = this.y - height;
      this.page.drawRectangle({ x: LEFT, y: bottom, width: CONTENT_WIDTH, height, color: header ? rgb(0.08, 0.18, 0.21) : rgb(0.97, 0.98, 0.98) });
      let x = LEFT;
      for (const [index, lines] of lineSets.entries()) {
        if (index > 0) this.page.drawLine({ start: { x, y: bottom }, end: { x, y: this.y }, thickness: 0.4, color: rgb(0.78, 0.82, 0.83) });
        lines.forEach((line, lineIndex) => this.page.drawText(line, {
          x: x + padding,
          y: this.y - padding - size - lineIndex * (size + 3),
          size,
          font,
          color: header ? rgb(0.96, 0.98, 0.98) : rgb(0.08, 0.12, 0.16),
        }));
        x += widths[index]!;
      }
      this.page.drawRectangle({ x: LEFT, y: bottom, width: CONTENT_WIDTH, height, borderWidth: 0.45, borderColor: rgb(0.72, 0.77, 0.78) });
      this.y = bottom;
    };
    row(headers, true);
    rows.forEach((cells) => row(cells, false));
    this.y -= 8;
  }
}

export function usageText(configuration: TechnicalCadernoConfiguration): string {
  return configuration.usages
    .sort((left, right) => ["minimum", "recommended", "n_plus_one"].indexOf(left.policy) - ["minimum", "recommended", "n_plus_one"].indexOf(right.policy))
    .map((usage) => `${POLICY_LABEL[usage.policy]}: ${usage.nodeCount} nó(s), ${usage.activeNodeCount} ativo(s)`)
    .join("; ");
}

export function configurationComponents(configuration: TechnicalCadernoConfiguration, byId: Map<string, HardwareComponent>): HardwareComponent[] {
  return (configuration.representative.bom?.items ?? [])
    .map((item) => byId.get(item.componentId))
    .filter((item): item is HardwareComponent => Boolean(item));
}

export function fieldsBySection(component: HardwareComponent): Array<{ label: string; fields: TechnicalSpecificationField[] }> {
  const grouped = new Map<string, TechnicalSpecificationField[]>();
  for (const field of publishedFields(component)) {
    const label = field.sectionLabelPt ?? "Informações técnicas";
    grouped.set(label, [...(grouped.get(label) ?? []), field]);
  }
  return [...grouped].map(([label, fields]) => ({ label, fields }));
}

function renderCover(document: PDFDocument, regular: PDFFont, bold: PDFFont, context: ReportContext, model: TechnicalCadernoModel): PDFPage {
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: rgb(0.035, 0.08, 0.095) });
  page.drawRectangle({ x: 0, y: 0, width: 13, height: PAGE_HEIGHT, color: rgb(0.55, 0.74, 0.12) });
  page.drawText("AIQUIMIST.AI", { x: 54, y: 774, size: 12, font: bold, color: rgb(0.75, 0.98, 0.25) });
  const title = ["CADERNO TÉCNICO", "DETALHADO DAS CONFIGURAÇÕES", "RECOMENDADAS"];
  title.forEach((line, index) => page.drawText(line, { x: 54, y: 665 - index * 40, size: index === 0 ? 29 : 22, font: bold, color: rgb(0.95, 0.98, 0.99) }));
  const project = safeText(context.scenario.scenario.projectName || "Projeto sem nome");
  page.drawText(project, { x: 54, y: 500, size: 16, font: bold, color: rgb(0.95, 0.98, 0.99) });
  page.drawText(`${context.scenario.scenario.totalCameras} câmera(s) - ${model.configurations.length} BOM(s) únicas`, { x: 54, y: 473, size: 11, font: regular, color: rgb(0.7, 0.78, 0.8) });
  page.drawText(`Mercados pesquisados: ${marketLabelPt(scenarioMarkets(context.scenario.scenario))}`, { x: 54, y: 454, size: 10, font: regular, color: rgb(0.7, 0.78, 0.8) });
  page.drawText(`Catálogo avaliado: ${model.evaluatedComponentCount} componentes`, { x: 54, y: 436, size: 10, font: regular, color: rgb(0.7, 0.78, 0.8) });
  page.drawText(`Gerado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(new Date())}`, { x: 54, y: 92, size: 9, font: regular, color: rgb(0.58, 0.68, 0.7) });
  return page;
}

function renderConfiguration(
  writer: CadernoWriter,
  configuration: TechnicalCadernoConfiguration,
  index: number,
  total: number,
  componentById: Map<string, HardwareComponent>,
  benchmarks: PublicBenchmarkObservation[],
): void {
  const option = configuration.representative;
  const hardware = option.hardware;
  const components = configurationComponents(configuration, componentById);
  const sources = componentSources(components);
  writer.newPage(`Configuração ${index} - ${hardware.name}`);
  writer.page.drawRectangle({ x: 0, y: 730, width: PAGE_WIDTH, height: 112, color: rgb(0.04, 0.1, 0.12) });
  writer.page.drawText(`CONFIGURAÇÃO ${index} DE ${total}`, { x: LEFT, y: 808, size: 9, font: writer.bold, color: rgb(0.75, 0.98, 0.25) });
  const titleLines = wrapText(hardware.name, writer.bold, 19, CONTENT_WIDTH);
  titleLines.slice(0, 2).forEach((line, lineIndex) => writer.page.drawText(line, { x: LEFT, y: 778 - lineIndex * 23, size: 19, font: writer.bold, color: rgb(0.96, 0.98, 0.99) }));
  writer.page.drawText(`${operatingSystemLabel(hardware.operatingSystemFamily)} - ${configuration.usages.length} aplicação(ões) no conjunto de recomendações`, { x: LEFT, y: 740, size: 8.5, font: writer.regular, color: rgb(0.66, 0.74, 0.76) });
  writer.y = 707;

  writer.heading(`${index}. Configuração técnica e referência comercial`);
  writer.paragraph(`${usageText(configuration)}. A referência central utiliza ${hardware.cpuModel}, ${hardware.ramGb} GB de memória RAM por nó e ${hardware.gpuCount} unidade(s) de ${hardware.gpuModel}. A configuração possui ${option.headroomPercent}% de folga planejada, gargalo calculado em ${String(option.bottleneck).replaceAll("_", " ")} e preço de projeto ${money(option.price.median, option.price.currency)}.`);
  writer.paragraph(`Esta ficha descreve a BOM e as especificações encontradas para os seus componentes. O estado de aquisição continua sendo ${option.procurementEligibility === "eligible" ? "apto, sujeito aos demais controles do relatório" : "bloqueado ou restrito a planejamento"}; especificação oficial não substitui benchmark comparável nem calibração física completa do Perceptrum.`, 9.2, true);

  writer.heading(`${index}.1. Resumo dos componentes`);
  const itemRows = (option.bom?.items ?? []).map((item) => {
    const component = componentById.get(item.componentId);
    const completeness = component?.technicalSpecification?.completeness.percent ?? 0;
    return [
      ROLE_LABEL[item.role],
      `${item.quantity} x ${componentDisplayName(component, item.componentId)}`,
      component?.canonicalMpn ?? MISSING_VALUE,
      isResolvedExactSku(component) ? `${completeness}% - SKU com evidência` : `${completeness}% - referência não resolvida`,
    ];
  });
  if (itemRows.length) writer.table(["Função", "Componente", "MPN / código", "Cobertura"], itemRows, [102, 190, 125, 90]);
  else writer.paragraph("A recomendação é legada e não possui BOM normalizada. O hardware foi preservado como referência, mas não será apresentado como uma lista de componentes exatos.");

  writer.heading(`${index}.2. Especificações técnicas detalhadas`);
  for (const [componentIndex, item] of (option.bom?.items ?? []).entries()) {
    const component = componentById.get(item.componentId);
    const componentNumber = `${index}.2.${componentIndex + 1}`;
    writer.heading(`${componentNumber}. ${KIND_LABEL[item.kind] ?? item.kind} - ${componentDisplayName(component, item.componentId)}`, 2);
    if (!component) {
      writer.paragraph("O componente referenciado pela BOM não foi encontrado no catálogo técnico ativo. A ocorrência permanece registrada como vínculo órfão e bloqueia a ficha completa.", 9, true);
      continue;
    }
    const exact = isResolvedExactSku(component);
    writer.paragraph(`${item.quantity} unidade(s) por nó. Fabricante: ${displayManufacturer(component.manufacturer)}. Modelo: ${component.sku}. MPN canônico: ${component.canonicalMpn ?? MISSING_VALUE}. Completude oficial: ${component.technicalSpecification?.completeness.percent ?? 0}%. Estado: ${exact ? "SKU exato com pelo menos uma evidência oficial" : "referência genérica, incompleta ou ainda sem evidência oficial suficiente"}.`);
    const sections = fieldsBySection(component);
    if (!sections.length) writer.paragraph(`Especificações: ${MISSING_VALUE}. O relatório não deduz características a partir do nome comercial.`, 9, true);
    for (const [sectionIndex, section] of sections.entries()) {
      writer.heading(`${componentNumber}.${sectionIndex + 1}. ${section.label}`, 3);
      writer.table(
        ["Característica", "Valor normalizado", "Estado", "Fonte"],
        section.fields.map((field) => [
          field.labelPt,
          displayValue(field),
          fieldStatusLabel(field),
          sourceNumbers(field, sources),
        ]),
        [140, 197, 104, 66],
      );
    }
    const missing = component.technicalSpecification?.completeness.missingRequiredFieldCodes ?? [];
    if (missing.length) writer.paragraph(`Campos críticos ainda sem comprovação oficial: ${missing.join(", ")}. Enquanto houver ausência, ambiguidade ou conflito, o componente não pode ser tratado como plenamente comprovado para aquisição.`, 8.8, true);
  }

  writer.heading(`${index}.3. Compatibilidade da configuração`);
  writer.paragraph(`Plataforma declarada: ${hardware.motherboard}. Memória: ${hardware.ramGb} GB por nó, arquitetura ${hardware.memoryArchitecture}, ECC ${hardware.ecc ? "habilitado ou requerido" : "não declarado como obrigatório"}. GPU: ${hardware.gpuCount} x ${hardware.gpuModel}. Armazenamento: ${hardware.storageModel}, ${hardware.usableStorageTb} TB úteis. Rede: ${hardware.nicGbps} GbE. Fonte: ${hardware.powerSupply}. Refrigeração: ${hardware.cooling}. Chassi: ${hardware.chassis}.`);
  if (option.bom?.compatibility.length) writer.table(
    ["Resultado", "Controle", "Justificativa"],
    option.bom.compatibility.map((decision) => [decision.compatible ? "Compatível" : "Bloqueado", decision.code, decision.message]),
    [74, 135, 298],
  );
  else writer.paragraph("A BOM não possui decisões normalizadas de compatibilidade. É obrigatória a conferência de socket, BIOS, RAM, PCIe, potência, dimensões, refrigeração, driver e sistema operacional antes da aquisição.");

  writer.heading(`${index}.4. Evidências, benchmarks e fontes`);
  const coverage = option.bom?.coverage;
  if (coverage) writer.table(
    ["Estágio", "Cobertura", "Benchmarks", "Âncoras", "Motivo"],
    coverage.stages.map((stage) => [
      stage.stage.replaceAll("_", " "),
      stage.covered ? "Coberto" : "Ausente",
      String(stage.eligibleObservationIds.length),
      String(stage.physicalAnchorRunIds.length),
      stage.reasons.join(" ") || "-",
    ]),
    [96, 58, 67, 54, 232],
  );
  else writer.paragraph("Cobertura de evidências normalizada indisponível para esta recomendação legada.");
  const componentIds = new Set(option.bom?.items.map((item) => item.componentId) ?? []);
  const matchedBenchmarks = benchmarks.filter((benchmark) => benchmark.componentId && componentIds.has(benchmark.componentId));
  if (matchedBenchmarks.length) writer.table(
    ["Componente", "Estágio", "Benchmark", "Resultado", "Elegibilidade"],
    matchedBenchmarks.map((benchmark) => [benchmark.componentId ?? "-", benchmark.stage, `${benchmark.benchmarkName} ${benchmark.benchmarkVersion}`, `${benchmark.score} ${benchmark.unit}`, benchmark.eligibility ?? "reference_only"]),
    [120, 82, 142, 82, 81],
  );
  else writer.paragraph("Não existe benchmark público elegível diretamente associado aos componentes desta BOM no catálogo ativo. A ficha técnica descreve o produto, mas não comprova capacidade sustentada de câmeras.", 9, true);
  if (sources.length) {
    for (const source of sources) {
      writer.paragraph(`[F${source.number}] ${authorityLabel(source.authority)}. ${source.url}${source.retrievedAt ? ` Consulta: ${new Intl.DateTimeFormat("pt-BR").format(new Date(source.retrievedAt))}.` : ""}${source.locator ? ` Evidência: ${source.locator}.` : ""}`, 8.2);
    }
  } else writer.paragraph(`Fontes: ${MISSING_VALUE}.`, 9, true);
}

function renderToc(page: PDFPage, regular: PDFFont, bold: PDFFont, writer: CadernoWriter): void {
  page.drawText("SUMÁRIO", { x: LEFT, y: 782, size: 22, font: bold, color: rgb(0.04, 0.12, 0.15) });
  page.drawText("Configurações consolidadas por BOM", { x: LEFT, y: 756, size: 10, font: regular, color: rgb(0.35, 0.43, 0.45) });
  let y = 718;
  for (const entry of writer.sectionPages) {
    const lines = wrapText(entry.title, regular, 9.2, CONTENT_WIDTH - 45);
    if (y - lines.length * 13 < 70) break;
    lines.forEach((line, index) => page.drawText(line, { x: LEFT, y: y - index * 13, size: 9.2, font: regular, color: rgb(0.08, 0.12, 0.16) }));
    page.drawText(String(entry.page), { x: PAGE_WIDTH - RIGHT - 20, y, size: 9.2, font: bold, color: rgb(0.08, 0.12, 0.16) });
    y -= Math.max(19, lines.length * 13 + 6);
  }
}

function renderGlossary(writer: CadernoWriter): void {
  writer.newPage("Glossário e notas de uso");
  writer.heading("Glossário e notas de uso");
  writer.table(
    ["Sigla", "Significado"],
    [
      ["ECC", "Correção de erros da memória"], ["PCIe", "Interconexão de alta velocidade para GPU, SSD e NIC"],
      ["NVDEC / NVENC", "Motores NVIDIA de decodificação e codificação de vídeo"], ["IOPS", "Operações de entrada e saída por segundo"],
      ["TBW", "Volume total de terabytes que o SSD pode gravar conforme a garantia"], ["RDMA", "Acesso direto remoto à memória"],
      ["TDP", "Referência térmica de projeto; não equivale necessariamente ao consumo máximo"], ["BOM", "Lista exata de materiais e componentes da configuração"],
    ],
    [105, 402],
  );
  writer.paragraph("Este caderno é uma memória técnica identificada. Ele pode apoiar pesquisa, comparação e elaboração interna, mas não substitui o relatório de dimensionamento, benchmarks comparáveis, calibração física, pesquisa de preços, ETP, Termo de Referência ou revisão jurídica.");
  writer.paragraph("Uma especificação publicada pelo fabricante comprova características e compatibilidade declaradas; ela não comprova, isoladamente, quantas câmeras o Perceptrum executará de forma sustentada. Somente as condições de evidência e calibração do relatório principal podem liberar aquisição.", 9.2, true);
}

export async function technicalCadernoPdf(context: ReportContext): Promise<Buffer> {
  const model = buildTechnicalCadernoModel(context);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([readFile(REGULAR_FONT_PATH), readFile(BOLD_FONT_PATH)]);
  const regular = await document.embedFont(regularBytes, { subset: true });
  const bold = await document.embedFont(boldBytes, { subset: true });
  document.setTitle("Caderno técnico detalhado das configurações recomendadas");
  document.setAuthor("Aiquimist - Qual Hardware");
  document.setSubject("BOMs, especificações técnicas, compatibilidade, evidências e fontes");
  document.setCreator("Qual Hardware");

  renderCover(document, regular, bold, context, model);
  const tocPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const writer = new CadernoWriter(document, regular, bold);
  const componentById = new Map((context.components ?? []).map((component) => [component.id, component]));
  const benchmarks = context.benchmarkObservations ?? [];
  model.configurations.forEach((configuration, index) => renderConfiguration(writer, configuration, index + 1, model.configurations.length, componentById, benchmarks));
  renderGlossary(writer);
  renderToc(tocPage, regular, bold, writer);

  const pages = document.getPages();
  pages.forEach((page, index) => {
    if (index > 0) page.drawText("AIQUIMIST - QUAL HARDWARE | CADERNO TÉCNICO DETALHADO", { x: LEFT, y: 818, size: 7.3, font: bold, color: rgb(0.35, 0.43, 0.45) });
    page.drawText(`Página ${index + 1} de ${pages.length}`, { x: PAGE_WIDTH - RIGHT - 62, y: 22, size: 7.5, font: regular, color: rgb(0.35, 0.43, 0.45) });
  });
  return Buffer.from(await document.save());
}
