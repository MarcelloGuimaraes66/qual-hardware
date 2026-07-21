import { Document, HeadingLevel, Packer, PageBreak, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { procurementReportOptions } from "../engine/procurementSpecifications.js";
import type { ReportContext } from "./reports.js";
import type { ProcurementNeutralSpecification, TrTechnicalAnnex } from "../shared/types.js";
import { TR_TECHNICAL_ANNEX_VERSION } from "../shared/types.js";

const LEGAL_NOTICE = "Este anexo e uma memoria tecnica de apoio. Nao substitui Estudo Tecnico Preliminar, pesquisa de mercado, edital, parecer juridico ou aprovacao da autoridade competente nos termos da Lei 14.133/2021.";

export function buildTrTechnicalAnnex(context: ReportContext): TrTechnicalAnnex {
  const specifications = procurementReportOptions(context.recommendations).map((item) => {
    const specification = item.procurementNeutralSpecification;
    return {
      ...specification,
      requirements: specification.requirements.map((requirement) => ({ ...requirement, matchingComponentIds: [] })),
      marketCompetitionAssessment: {
        ...specification.marketCompetitionAssessment,
        matchingComponentIds: [],
        manufacturerNames: [],
      },
      forbiddenIdentifierFindings: [],
    };
  });
  return {
    schemaVersion: TR_TECHNICAL_ANNEX_VERSION,
    generatedAt: new Date().toISOString(),
    scenarioId: context.scenario.id,
    projectName: context.scenario.scenario.projectName,
    totalCameras: context.scenario.scenario.totalCameras,
    specifications,
    legalNotice: LEGAL_NOTICE,
  };
}

export function procurementAnnexJson(context: ReportContext): Buffer {
  return Buffer.from(JSON.stringify(buildTrTechnicalAnnex(context), null, 2));
}

function neutralStatusText(specification: ProcurementNeutralSpecification): string {
  if (specification.status === "apt") return "APTA PARA REVISAO E INCORPORACAO AO TR";
  if (specification.status === "review_required") return "REVISAO TECNICA, DE MERCADO E JURIDICA OBRIGATORIA";
  return "NAO UTILIZAR COMO ESPECIFICACAO DE AQUISICAO";
}

function requirementValue(specification: ProcurementNeutralSpecification["requirements"][number]): string {
  const comparator = specification.comparator === "minimum" ? "minimo" : specification.comparator === "maximum" ? "maximo" : specification.comparator;
  return `${comparator}: ${String(specification.value)}${specification.unit ? ` ${specification.unit}` : ""}`;
}

function cell(text: string, bold = false): TableCell {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });
}

function docxSpecification(specification: ProcurementNeutralSpecification, index: number): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`Opcao tecnica neutra ${index}`)] }),
    new Paragraph({ children: [new TextRun({ text: neutralStatusText(specification), bold: true })] }),
    new Paragraph(`Quantidade: ${specification.nodeCount} no(s), sendo ${specification.activeNodeCount} ativo(s).`),
    new Paragraph(`Avaliacao de mercado: ${specification.marketCompetitionAssessment.status}; ${specification.marketCompetitionAssessment.matchingProductCount} produto(s) no requisito limitante e ${specification.marketCompetitionAssessment.distinctManufacturerCount} fabricante(s) distintos.`),
  ];
  if (specification.status === "blocked") children.push(new Paragraph({ children: [new TextRun({ text: "Esta opcao permanece apenas como referencia de planejamento ate a conclusao das evidencias e da pesquisa de mercado.", bold: true })] }));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: [cell("Componente", true), cell("Caracteristica", true), cell("Requisito", true), cell("Justificativa e aceite", true)] }),
      ...specification.requirements.map((item) => new TableRow({ children: [
        cell(`${item.componentRole} (${item.quantityPerNode}/no; ${item.projectQuantity}/projeto)`),
        cell(item.characteristic),
        cell(requirementValue(item)),
        cell(`${item.rationale} Aceite: ${item.acceptanceCriterion}`),
      ] })),
    ],
  }));
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Comprovacao e competitividade")] }));
  for (const reason of specification.marketCompetitionAssessment.reasons) children.push(new Paragraph({ text: reason, bullet: { level: 0 } }));
  for (const disclaimer of specification.disclaimers) children.push(new Paragraph({ text: disclaimer, bullet: { level: 0 } }));
  return children;
}

export async function procurementAnnexDocx(context: ReportContext): Promise<Buffer> {
  const annex = buildTrTechnicalAnnex(context);
  const body: Array<Paragraph | Table> = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("Anexo tecnico neutro de infraestrutura")] }),
    new Paragraph({ children: [new TextRun({ text: annex.projectName, bold: true, size: 26 })] }),
    new Paragraph(`Carga dimensionada: ${annex.totalCameras} camera(s).`),
    new Paragraph({ children: [new TextRun({ text: annex.legalNotice, bold: true })] }),
    new Paragraph("As referencias comerciais permanecem exclusivamente no relatorio interno. Este anexo nao contem fabricante, marca, modelo, MPN, SKU, vendedor ou preco."),
  ];
  annex.specifications.forEach((specification, index) => {
    body.push(new Paragraph({ children: [new PageBreak()] }), ...docxSpecification(specification, index + 1));
  });
  const document = new Document({
    creator: "Aiquimist Qual Hardware",
    title: "Anexo tecnico neutro",
    description: "Especificacoes funcionais de apoio a Termo de Referencia",
    sections: [{
      properties: { page: { margin: { top: 900, right: 850, bottom: 900, left: 850 } } },
      children: body,
    }],
    styles: {
      default: { document: { run: { font: "Aptos", size: 20 }, paragraph: { spacing: { after: 120, line: 276 } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { font: "Aptos Display", size: 38, bold: true, color: "102127" }, paragraph: { spacing: { after: 240 } } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Aptos Display", size: 28, bold: true, color: "102127" }, paragraph: { spacing: { before: 260, after: 120 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Aptos Display", size: 23, bold: true, color: "324850" }, paragraph: { spacing: { before: 180, after: 100 } } },
      ],
    },
  });
  return Buffer.from(await Packer.toBuffer(document));
}

interface PdfWriter {
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  newPage: () => void;
  line: (text: string, size?: number, bold?: boolean, indent?: number) => void;
}

function safeText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\x7e]/g, "?");
}

function words(text: string, width: number): string[] {
  const output: string[] = [];
  let line = "";
  for (const word of safeText(text).split(/\s+/)) {
    if (`${line} ${word}`.trim().length > width) { if (line) output.push(line); line = word; }
    else line = `${line} ${word}`.trim();
  }
  if (line) output.push(line);
  return output;
}

function pdfWriter(document: PDFDocument, regular: PDFFont, bold: PDFFont): PdfWriter {
  const writer = {} as PdfWriter;
  writer.regular = regular; writer.bold = bold;
  writer.newPage = () => { writer.page = document.addPage([595, 842]); writer.y = 790; };
  writer.line = (text, size = 9.5, strong = false, indent = 0) => {
    for (const line of words(text, Math.max(48, 94 - indent * 2))) {
      if (writer.y < 55) writer.newPage();
      writer.page.drawText(line, { x: 48 + indent, y: writer.y, size, font: strong ? bold : regular, color: rgb(0.07, 0.13, 0.15) });
      writer.y -= size + 4.5;
    }
  };
  writer.newPage();
  return writer;
}

export async function procurementAnnexPdf(context: ReportContext): Promise<Buffer> {
  const annex = buildTrTechnicalAnnex(context);
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const writer = pdfWriter(document, regular, bold);
  writer.line("AIQUIMIST - QUAL HARDWARE", 11, true);
  writer.line("ANEXO TECNICO NEUTRO DE INFRAESTRUTURA", 20, true);
  writer.line(annex.projectName, 13, true);
  writer.line(`Carga dimensionada: ${annex.totalCameras} camera(s).`);
  writer.line(annex.legalNotice, 10, true);
  writer.line("O documento nao contem fabricante, marca, modelo, codigo comercial, vendedor ou preco.");
  annex.specifications.forEach((specification, index) => {
    writer.newPage();
    writer.line(`OPCAO TECNICA NEUTRA ${index + 1}`, 16, true);
    writer.line(neutralStatusText(specification), 11, true);
    writer.line(`Quantidade: ${specification.nodeCount} no(s), ${specification.activeNodeCount} ativo(s). Concorrencia: ${specification.marketCompetitionAssessment.status}.`);
    for (const item of specification.requirements) {
      writer.line(`${item.componentRole} - ${item.characteristic}: ${requirementValue(item)}; ${item.quantityPerNode} por no e ${item.projectQuantity} no projeto.`, 9.5, item.mandatory);
      writer.line(`Justificativa: ${item.rationale} Aceite: ${item.acceptanceCriterion}`, 8.5, false, 10);
    }
    writer.line("CONTROLE DE COMPETITIVIDADE", 12, true);
    for (const reason of specification.marketCompetitionAssessment.reasons) writer.line(reason);
    for (const disclaimer of specification.disclaimers) writer.line(`Nota: ${disclaimer}`);
  });
  const pages = document.getPages();
  pages.forEach((page, index) => page.drawText(`Qual Hardware | pagina ${index + 1} de ${pages.length}`, { x: 48, y: 24, size: 8, font: regular, color: rgb(0.35, 0.4, 0.45) }));
  return Buffer.from(await document.save());
}
