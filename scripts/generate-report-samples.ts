import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import { buildRecommendations } from "../src/engine/capacity.js";
import { createDefaultScenario } from "../src/shared/schemas.js";
import type { ScenarioRecord } from "../src/shared/types.js";
import { jsonReport, pdfReport, xlsxReport } from "../src/server/reports.js";

const scenario = createDefaultScenario(25);
scenario.projectName = "Validação - 25 câmeras";
scenario.customerName = "Aiquimist QA";
const timestamp = new Date().toISOString();
const record: ScenarioRecord = {
  id: randomUUID(),
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  scenario,
};
const recommendations = buildRecommendations(record.id, record.revision, scenario, HARDWARE_CATALOG, []);
const context = { scenario: record, recommendations };
const pdfDirectory = resolve("output", "pdf");
const workbookDirectory = resolve("outputs", "report-validation");
const jsonDirectory = resolve("output", "json");
await Promise.all([mkdir(pdfDirectory, { recursive: true }), mkdir(workbookDirectory, { recursive: true }), mkdir(jsonDirectory, { recursive: true })]);
await Promise.all([
  writeFile(resolve(pdfDirectory, "qual-hardware-three-configurations.pdf"), await pdfReport(context)),
  writeFile(resolve(workbookDirectory, "qual-hardware-three-configurations.xlsx"), await xlsxReport(context)),
  writeFile(resolve(jsonDirectory, "qual-hardware-three-configurations.json"), jsonReport(context)),
]);
console.log(JSON.stringify({ policies: recommendations.map((item) => item.policy), pdfDirectory, workbookDirectory, jsonDirectory }));
