import { describe, expect, it } from "vitest";
import { REPORT_DOWNLOAD_FILENAMES, REPORT_EXPORT_COPY, isNeutralAnnexFormat } from "../src/web/reportExports.js";

describe("report export identity", () => {
  it("makes the recommendations PDF the unambiguous primary download", () => {
    expect(REPORT_DOWNLOAD_FILENAMES.pdf).toBe("qual-hardware-recomendacoes.pdf");
    expect(REPORT_EXPORT_COPY.pt.mainTitle).toBe("Relatório completo de recomendações");
    expect(REPORT_EXPORT_COPY.pt.mainPdfButton).toBe("BAIXAR RELATÓRIO PDF");
    expect(REPORT_EXPORT_COPY.pt.mainDescription).toContain("três propostas");
  });

  it("identifies every neutral annex as a separate document", () => {
    expect(REPORT_EXPORT_COPY.pt.neutralSummary).toContain("anexo neutro separado");
    expect(REPORT_EXPORT_COPY.pt.neutralWarning).toContain("NÃO é o relatório de recomendações");
    expect(isNeutralAnnexFormat("tr-pdf")).toBe(true);
    expect(isNeutralAnnexFormat("pdf")).toBe(false);
    expect(REPORT_DOWNLOAD_FILENAMES["tr-pdf"]).toBe("qual-hardware-anexo-tecnico-neutro.pdf");
  });
});
