import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDefaultScenario } from "../src/shared/schemas.js";
import { createApp } from "../src/server/app.js";
import { MemoryPlannerStore } from "../src/server/store.js";

const scenario = createDefaultScenario(24);
scenario.projectName = "Validação - 24 câmeras AiQ";
scenario.customerName = "Aiquimist QA";
scenario.cameraGroups[0]!.agents[0]!.model = "aiq-3.7";
const app = createApp(new MemoryPlannerStore());
const scenarioResponse = await app.request("/api/scenarios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario }) });
if (!scenarioResponse.ok) throw new Error(`scenario_failed:${scenarioResponse.status}`);
const record = await scenarioResponse.json() as { id: string };
const recommendationResponse = await app.request(`/api/scenarios/${record.id}/recommendations`, { method: "POST" });
if (!recommendationResponse.ok) throw new Error(`recommendation_failed:${recommendationResponse.status}`);
const recommendations = await recommendationResponse.json() as Array<{ id: string; policy: string }>;
const recommendationId = recommendations.find((item) => item.policy === "recommended")?.id ?? recommendations[0]?.id;
if (!recommendationId) throw new Error("recommendation_missing");
const pdfDirectory = resolve("output", "pdf");
const workbookDirectory = resolve("outputs", "report-validation");
const documentDirectory = resolve("output", "documents");
const jsonDirectory = resolve("output", "json");
await Promise.all([mkdir(pdfDirectory, { recursive: true }), mkdir(workbookDirectory, { recursive: true }), mkdir(documentDirectory, { recursive: true }), mkdir(jsonDirectory, { recursive: true })]);
const targets = [
  { format: "pdf", path: resolve(pdfDirectory, "qual-hardware-commercial-and-neutral.pdf") },
  { format: "xlsx", path: resolve(workbookDirectory, "qual-hardware-commercial-and-neutral.xlsx") },
  { format: "json", path: resolve(jsonDirectory, "qual-hardware-commercial-and-neutral.json") },
  { format: "tr-pdf", path: resolve(pdfDirectory, "qual-hardware-neutral-annex.pdf") },
  { format: "tr-docx", path: resolve(documentDirectory, "qual-hardware-neutral-annex.docx") },
  { format: "tr-json", path: resolve(jsonDirectory, "qual-hardware-neutral-annex.json") },
];
await Promise.all(targets.map(async (target) => {
  const response = await app.request(`/api/recommendations/${recommendationId}/export/${target.format}`);
  if (!response.ok) throw new Error(`export_${target.format}_failed:${response.status}`);
  await writeFile(target.path, Buffer.from(await response.arrayBuffer()));
}));
console.log(JSON.stringify({ policies: recommendations.map((item) => item.policy), files: targets.map((target) => target.path) }));
