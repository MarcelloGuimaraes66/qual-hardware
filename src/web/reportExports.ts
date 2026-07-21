export const REPORT_DOWNLOAD_FILENAMES = Object.freeze({
  pdf: "qual-hardware-recomendacoes.pdf",
  xlsx: "qual-hardware-relatorio-comercial-e-neutro.xlsx",
  json: "qual-hardware-relatorio-comercial-e-neutro.json",
  "technical-pdf": "qual-hardware-caderno-tecnico-detalhado.pdf",
  "technical-docx": "qual-hardware-caderno-tecnico-detalhado.docx",
  "tr-pdf": "qual-hardware-anexo-tecnico-neutro.pdf",
  "tr-docx": "qual-hardware-anexo-tecnico-neutro.docx",
  "tr-json": "qual-hardware-anexo-tecnico-neutro.json",
} as const);

export type ExportFormat = keyof typeof REPORT_DOWNLOAD_FILENAMES;

export const REPORT_EXPORT_COPY = Object.freeze({
  pt: {
    mainTitle: "Relatório completo de recomendações",
    mainDescription: "Este é o relatório comparativo do modelo: três propostas, outras máquinas qualificadas, custos, capacidade, carga, fontes e avisos.",
    mainPdfButton: "BAIXAR RELATÓRIO PDF",
    auditDescription: "Planilhas e dados completos para auditoria",
    technicalTitle: "Caderno técnico detalhado por configuração",
    technicalDescription: "Uma ficha por BOM, com componentes, especificações do fabricante, compatibilidade, benchmarks, lacunas e fontes rastreáveis.",
    technicalPdfButton: "CADERNO TÉCNICO PDF",
    technicalDocxButton: "CADERNO TÉCNICO DOCX",
    neutralSummary: "Documentos para licitação - anexo neutro separado",
    neutralWarning: "Este NÃO é o relatório de recomendações. É um anexo separado, sem marcas e preços, destinado somente à revisão técnica do Termo de Referência.",
  },
  en: {
    mainTitle: "Complete recommendations report",
    mainDescription: "This is the reference-style comparison report: three proposals, other qualified machines, costs, capacity, workload, sources and warnings.",
    mainPdfButton: "DOWNLOAD RECOMMENDATIONS PDF",
    auditDescription: "Complete spreadsheets and data for auditing",
    technicalTitle: "Detailed technical book by configuration",
    technicalDescription: "One sheet per BOM with components, manufacturer specifications, compatibility, benchmarks, gaps and traceable sources.",
    technicalPdfButton: "TECHNICAL BOOK PDF",
    technicalDocxButton: "TECHNICAL BOOK DOCX",
    neutralSummary: "Procurement documents - separate brand-neutral annex",
    neutralWarning: "This is NOT the recommendations report. It is a separate annex without brands and prices, intended only for technical procurement review.",
  },
} as const);

export function isNeutralAnnexFormat(format: ExportFormat): boolean {
  return format.startsWith("tr-");
}
