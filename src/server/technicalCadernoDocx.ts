import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { HardwareComponent, PublicBenchmarkObservation, TechnicalSpecificationField } from "../shared/types.js";
import { marketLabelPt, scenarioMarkets } from "../shared/markets.js";
import type { ReportContext } from "./reports.js";
import {
  KIND_LABEL,
  MISSING_VALUE,
  ROLE_LABEL,
  authorityLabel,
  buildTechnicalCadernoModel,
  componentDisplayName,
  componentSources,
  configurationComponents,
  displayManufacturer,
  displayValue,
  fieldStatusLabel,
  fieldsBySection,
  isResolvedExactSku,
  money,
  operatingSystemLabel,
  sourceNumbers,
  usageText,
  type TechnicalCadernoConfiguration,
} from "./technicalCadernoPdf.js";

const BRAND = "12343A";
const BRAND_ACCENT = "8DBD1F";
const LIGHT_FILL = "F3F7F7";
const BORDER = "B6C4C6";

function run(text: string, bold = false, color = "172226", size?: number): TextRun {
  return new TextRun({ text, bold, color, font: "Arial", ...(size === undefined ? {} : { size }) });
}

function bodyParagraph(text: string, bold = false): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120, line: 300 },
    children: [run(text, bold)],
  });
}

function heading(text: string, level: typeof HeadingLevel.HEADING_1 | typeof HeadingLevel.HEADING_2 | typeof HeadingLevel.HEADING_3): Paragraph {
  return new Paragraph({
    heading: level,
    keepNext: true,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 260 : 180, after: 100 },
    children: [run(text, true, level === HeadingLevel.HEADING_1 ? BRAND : "1F4851")],
  });
}

function cell(text: string, header = false): TableCell {
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    shading: { fill: header ? BRAND : LIGHT_FILL },
    margins: { top: 80, bottom: 80, left: 90, right: 90 },
    children: [new Paragraph({ spacing: { after: 0 }, children: [run(text, header, header ? "FFFFFF" : "172226", header ? 17 : 16)] })],
  });
}

function table(headers: string[], rows: string[][], widths: number[]): Table {
  const borders = {
    top: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
    bottom: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
    left: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
    right: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
    insideHorizontal: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
    insideVertical: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
  } as const;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    borders,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((value) => cell(value, true)) }),
      ...rows.map((values) => new TableRow({ cantSplit: true, children: values.map((value) => cell(value)) })),
    ],
  });
}

function spacer(points = 100): Paragraph {
  return new Paragraph({ spacing: { after: points }, children: [] });
}

function fieldRows(fields: TechnicalSpecificationField[], sources: ReturnType<typeof componentSources>): string[][] {
  return fields.map((field) => [field.labelPt, displayValue(field), fieldStatusLabel(field), sourceNumbers(field, sources)]);
}

function configurationSection(
  configuration: TechnicalCadernoConfiguration,
  index: number,
  total: number,
  componentById: Map<string, HardwareComponent>,
  benchmarks: PublicBenchmarkObservation[],
): Array<Paragraph | Table> {
  const option = configuration.representative;
  const hardware = option.hardware;
  const components = configurationComponents(configuration, componentById);
  const sources = componentSources(components);
  const children: Array<Paragraph | Table> = [
    new Paragraph({ children: [new PageBreak()] }),
    heading(`Configuração ${index} de ${total} - ${hardware.name}`, HeadingLevel.HEADING_1),
    bodyParagraph(`Sistema operacional: ${operatingSystemLabel(hardware.operatingSystemFamily)}. ${usageText(configuration)}.`),
    heading(`${index}. Configuração técnica e referência comercial`, HeadingLevel.HEADING_2),
    bodyParagraph(`${usageText(configuration)}. A referência central utiliza ${hardware.cpuModel}, ${hardware.ramGb} GB de memória RAM por nó e ${hardware.gpuCount} unidade(s) de ${hardware.gpuModel}. A configuração possui ${option.headroomPercent}% de folga planejada, gargalo calculado em ${String(option.bottleneck).replaceAll("_", " ")} e preço de projeto ${money(option.price.median, option.price.currency)}.`),
    bodyParagraph(`Esta ficha descreve a BOM e as especificações encontradas para os seus componentes. O estado de aquisição continua sendo ${option.procurementEligibility === "eligible" ? "apto, sujeito aos demais controles do relatório" : "bloqueado ou restrito a planejamento"}; especificação oficial não substitui benchmark comparável nem calibração física completa do Perceptrum.`, true),
    heading(`${index}.1. Resumo dos componentes`, HeadingLevel.HEADING_2),
  ];

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
  if (itemRows.length) children.push(table(["Função", "Componente", "MPN / código", "Cobertura"], itemRows, [1900, 3400, 2500, 1900]));
  else children.push(bodyParagraph("A recomendação é legada e não possui BOM normalizada. O hardware foi preservado como referência, mas não será apresentado como uma lista de componentes exatos."));

  children.push(heading(`${index}.2. Especificações técnicas detalhadas`, HeadingLevel.HEADING_2));
  for (const [componentIndex, item] of (option.bom?.items ?? []).entries()) {
    const component = componentById.get(item.componentId);
    const componentNumber = `${index}.2.${componentIndex + 1}`;
    children.push(heading(`${componentNumber}. ${KIND_LABEL[item.kind] ?? item.kind} - ${componentDisplayName(component, item.componentId)}`, HeadingLevel.HEADING_3));
    if (!component) {
      children.push(bodyParagraph("O componente referenciado pela BOM não foi encontrado no catálogo técnico ativo. A ocorrência permanece registrada como vínculo órfão e bloqueia a ficha completa.", true));
      continue;
    }
    const exact = isResolvedExactSku(component);
    children.push(bodyParagraph(`${item.quantity} unidade(s) por nó. Fabricante: ${displayManufacturer(component.manufacturer)}. Modelo: ${component.sku}. MPN canônico: ${component.canonicalMpn ?? MISSING_VALUE}. Completude oficial: ${component.technicalSpecification?.completeness.percent ?? 0}%. Estado: ${exact ? "SKU exato com pelo menos uma evidência oficial" : "referência genérica, incompleta ou ainda sem evidência oficial suficiente"}.`));
    const sections = fieldsBySection(component);
    if (!sections.length) children.push(bodyParagraph(`Especificações: ${MISSING_VALUE}. O relatório não deduz características a partir do nome comercial.`, true));
    for (const [sectionIndex, section] of sections.entries()) {
      children.push(heading(`${componentNumber}.${sectionIndex + 1}. ${section.label}`, HeadingLevel.HEADING_3));
      children.push(table(["Característica", "Valor normalizado", "Estado", "Fonte"], fieldRows(section.fields, sources), [2500, 3600, 2200, 1400]));
      children.push(spacer(80));
    }
    const missing = component.technicalSpecification?.completeness.missingRequiredFieldCodes ?? [];
    if (missing.length) children.push(bodyParagraph(`Campos críticos ainda sem comprovação oficial: ${missing.join(", ")}. Enquanto houver ausência, ambiguidade ou conflito, o componente não pode ser tratado como plenamente comprovado para aquisição.`, true));
  }

  children.push(heading(`${index}.3. Compatibilidade da configuração`, HeadingLevel.HEADING_2));
  children.push(bodyParagraph(`Plataforma declarada: ${hardware.motherboard}. Memória: ${hardware.ramGb} GB por nó, arquitetura ${hardware.memoryArchitecture}, ECC ${hardware.ecc ? "habilitado ou requerido" : "não declarado como obrigatório"}. GPU: ${hardware.gpuCount} x ${hardware.gpuModel}. Armazenamento: ${hardware.storageModel}, ${hardware.usableStorageTb} TB úteis. Rede: ${hardware.nicGbps} GbE. Fonte: ${hardware.powerSupply}. Refrigeração: ${hardware.cooling}. Chassi: ${hardware.chassis}.`));
  if (option.bom?.compatibility.length) children.push(table(
    ["Resultado", "Controle", "Justificativa"],
    option.bom.compatibility.map((decision) => [decision.compatible ? "Compatível" : "Bloqueado", decision.code, decision.message]),
    [1500, 2500, 5700],
  ));
  else children.push(bodyParagraph("A BOM não possui decisões normalizadas de compatibilidade. É obrigatória a conferência de socket, BIOS, RAM, PCIe, potência, dimensões, refrigeração, driver e sistema operacional antes da aquisição."));

  children.push(heading(`${index}.4. Evidências, benchmarks e fontes`, HeadingLevel.HEADING_2));
  const coverage = option.bom?.coverage;
  if (coverage) children.push(table(
    ["Estágio", "Cobertura", "Benchmarks", "Âncoras", "Motivo"],
    coverage.stages.map((stage) => [stage.stage.replaceAll("_", " "), stage.covered ? "Coberto" : "Ausente", String(stage.eligibleObservationIds.length), String(stage.physicalAnchorRunIds.length), stage.reasons.join(" ") || "-"]),
    [1700, 1400, 1400, 1200, 4000],
  ));
  else children.push(bodyParagraph("Cobertura de evidências normalizada indisponível para esta recomendação legada."));

  const componentIds = new Set(option.bom?.items.map((item) => item.componentId) ?? []);
  const matchedBenchmarks = benchmarks.filter((benchmark) => benchmark.componentId && componentIds.has(benchmark.componentId));
  if (matchedBenchmarks.length) children.push(table(
    ["Componente", "Estágio", "Benchmark", "Resultado", "Elegibilidade"],
    matchedBenchmarks.map((benchmark) => [benchmark.componentId ?? "-", benchmark.stage, `${benchmark.benchmarkName} ${benchmark.benchmarkVersion}`, `${benchmark.score} ${benchmark.unit}`, benchmark.eligibility ?? "reference_only"]),
    [2200, 1600, 2600, 1600, 1700],
  ));
  else children.push(bodyParagraph("Não existe benchmark público elegível diretamente associado aos componentes desta BOM no catálogo ativo. A ficha técnica descreve o produto, mas não comprova capacidade sustentada de câmeras.", true));

  if (sources.length) {
    for (const source of sources) children.push(bodyParagraph(`[F${source.number}] ${authorityLabel(source.authority)}. ${source.url}${source.retrievedAt ? ` Consulta: ${new Intl.DateTimeFormat("pt-BR").format(new Date(source.retrievedAt))}.` : ""}${source.locator ? ` Evidência: ${source.locator}.` : ""}`));
  } else children.push(bodyParagraph(`Fontes: ${MISSING_VALUE}.`, true));
  return children;
}

export async function technicalCadernoDocx(context: ReportContext): Promise<Buffer> {
  const model = buildTechnicalCadernoModel(context);
  const componentById = new Map((context.components ?? []).map((component) => [component.id, component]));
  const benchmarks = context.benchmarkObservations ?? [];
  const children: Array<Paragraph | Table> = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 240 }, children: [run("AIQUIMIST.AI", true, BRAND_ACCENT, 28)] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400, after: 260 }, children: [run("CADERNO TÉCNICO DETALHADO DAS CONFIGURAÇÕES RECOMENDADAS", true, BRAND, 38)] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [run(context.scenario.scenario.projectName || "Projeto sem nome", true, BRAND, 26)] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [run(`${context.scenario.scenario.totalCameras} câmera(s) - ${model.configurations.length} BOM(s) únicas`, false, "40565C", 21)] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [run(`Mercados pesquisados: ${marketLabelPt(scenarioMarkets(context.scenario.scenario))}`, false, "40565C", 20)] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [run(`Catálogo avaliado: ${model.evaluatedComponentCount} componentes`, false, "40565C", 20)] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1200 }, children: [run(`Gerado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(new Date())}`, false, "65777B", 17)] }),
    new Paragraph({ children: [new PageBreak()] }),
    heading("Sumário das configurações", HeadingLevel.HEADING_1),
    bodyParagraph("As configurações repetidas por política ou número de nós foram consolidadas pela identidade canônica da BOM."),
    ...model.configurations.flatMap((configuration, index) => [
      heading(`${index + 1}. ${configuration.representative.hardware.name}`, HeadingLevel.HEADING_2),
      bodyParagraph(usageText(configuration)),
    ]),
  ];

  model.configurations.forEach((configuration, index) => children.push(...configurationSection(configuration, index + 1, model.configurations.length, componentById, benchmarks)));
  children.push(
    new Paragraph({ children: [new PageBreak()] }),
    heading("Glossário e notas de uso", HeadingLevel.HEADING_1),
    table(["Sigla", "Significado"], [
      ["ECC", "Correção de erros da memória"], ["PCIe", "Interconexão de alta velocidade para GPU, SSD e NIC"],
      ["NVDEC / NVENC", "Motores NVIDIA de decodificação e codificação de vídeo"], ["IOPS", "Operações de entrada e saída por segundo"],
      ["TBW", "Volume total de terabytes que o SSD pode gravar conforme a garantia"], ["RDMA", "Acesso direto remoto à memória"],
      ["TDP", "Referência térmica de projeto; não equivale necessariamente ao consumo máximo"], ["BOM", "Lista exata de materiais e componentes da configuração"],
    ], [1800, 7900]),
    bodyParagraph("Este caderno é uma memória técnica identificada. Ele pode apoiar pesquisa, comparação e elaboração interna, mas não substitui o relatório de dimensionamento, benchmarks comparáveis, calibração física, pesquisa de preços, ETP, Termo de Referência ou revisão jurídica."),
    bodyParagraph("Uma especificação publicada pelo fabricante comprova características e compatibilidade declaradas; ela não comprova, isoladamente, quantas câmeras o Perceptrum executará de forma sustentada. Somente as condições de evidência e calibração do relatório principal podem liberar aquisição.", true),
  );

  const document = new Document({
    creator: "Aiquimist - Qual Hardware",
    title: "Caderno técnico detalhado das configurações recomendadas",
    subject: "BOMs, especificações técnicas, compatibilidade, evidências e fontes",
    description: "Versão editável do caderno técnico detalhado do Qual Hardware",
    styles: {
      default: {
        document: { run: { font: "Arial", size: 20, color: "172226" }, paragraph: { spacing: { after: 100, line: 280 } } },
        heading1: { run: { font: "Arial", bold: true, color: BRAND, size: 30 } },
        heading2: { run: { font: "Arial", bold: true, color: "1F4851", size: 25 } },
        heading3: { run: { font: "Arial", bold: true, color: "1F4851", size: 21 } },
      },
    },
    sections: [{
      properties: {
        page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 850, bottom: 1134, left: 850, header: 425, footer: 425 } },
      },
      headers: { default: new Header({ children: [new Paragraph({ children: [run("AIQUIMIST - QUAL HARDWARE | CADERNO TÉCNICO DETALHADO", true, "52656A", 14)] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run("Página ", false, "52656A", 14), new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 14, color: "52656A" }), run(" de ", false, "52656A", 14), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Arial", size: 14, color: "52656A" })] })] }) },
      children,
    }],
  });
  return Buffer.from(await Packer.toBuffer(document));
}
