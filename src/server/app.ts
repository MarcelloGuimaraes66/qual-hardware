import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import { buildRecommendations, CapacityError } from "../engine/capacity.js";
import { buildCapacityPredictions, createCalibrationPlan } from "../engine/calibration.js";
import {
  benchmarkMetricsSchema,
  calibrationPlanRequestSchema,
  localCalibrationRunSchema,
  scenarioCreateSchema,
  scenarioUpdateSchema,
} from "../shared/schemas.js";
import type { BenchmarkMetrics, CapacityRecommendation, LocalCalibrationRun } from "../shared/types.js";
import type { HardwareNodeTemplate } from "../shared/types.js";
import { createBenchmarkManifest, evidenceValidatesRecommendation, nonceMatches, validateBenchmark } from "./benchmark.js";
import { CatalogUpdateService } from "./catalogUpdates.js";
import { jsonReport, pdfReport, xlsxReport } from "./reports.js";
import { findForbiddenBenchmarkData, findForbiddenCalibrationData, safeError } from "./security.js";
import { RevisionConflictError, type PlannerStore } from "./store.js";

const manifestRequestSchema = z.object({
  recommendationId: z.string().uuid(),
  gpuDriver: z.string().min(1).max(120),
  slaInferenceLatencyMs: z.number().positive().max(3_600_000).default(10_000),
});
const compareRequestSchema = z.object({ scenarioIds: z.array(z.string().uuid()).min(2).max(10) });
const catalogConfigurationSchema = z.object({
  remoteUrl: z.string().max(2_048).nullable(),
  publicKeyPem: z.string().min(1).max(16_384),
});
const reportPolicies = ["minimum", "recommended", "n_plus_one"] as const;

function normalizedHardwareModel(value: string): string {
  return value.toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:r|tm|processor|graphics|integrated|generation|gpu)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fingerprintMatchesTemplate(run: LocalCalibrationRun, template: HardwareNodeTemplate): boolean {
  const cpu = normalizedHardwareModel(run.fingerprint.cpuModel);
  const expectedCpu = normalizedHardwareModel(template.cpuModel);
  const gpu = normalizedHardwareModel(run.fingerprint.gpuModel);
  const expectedGpu = normalizedHardwareModel(template.gpuModel);
  const cpuMatches = cpu.includes(template.cpuVendor) && (cpu.includes(expectedCpu) || expectedCpu.includes(cpu));
  const gpuMatches = gpu.includes(template.gpuVendor) && (gpu.includes(expectedGpu) || expectedGpu.includes(gpu));
  return cpuMatches && gpuMatches && run.fingerprint.formFactor === template.kind;
}

async function refreshPredictions(store: PlannerStore) {
  const predictions = buildCapacityPredictions(
    await store.getCatalog(),
    await store.listCalibrationRuns(),
    await store.listBenchmarkObservations(),
  );
  await store.savePredictions(predictions);
  return predictions;
}

function applicationResourcePath(...segments: string[]): string {
  const root = process.env.QUAL_HARDWARE_RESOURCE_ROOT ?? process.cwd();
  return resolve(root, ...segments);
}

function currentEvidence(
  recommendations: CapacityRecommendation[],
  evidence: Awaited<ReturnType<PlannerStore["listBenchmarkEvidence"]>>,
): CapacityRecommendation[] {
  return recommendations.map((recommendation) => evidenceValidatesRecommendation(recommendation, evidence) ? {
    ...recommendation,
    confidence: "validated",
    evidence: [...recommendation.evidence, ...evidence.filter(({ manifest, result }) => result.passed &&
      manifest.targetHardware.cpuModel === recommendation.primary.hardware.cpuModel &&
      manifest.targetHardware.gpuModel === recommendation.primary.hardware.gpuModel).map(({ manifest }) => `benchmark:${manifest.id}`)],
  } : recommendation);
}

function reportRecommendationSet(
  selected: CapacityRecommendation,
  stored: CapacityRecommendation[],
): CapacityRecommendation[] {
  const selectedTime = Date.parse(selected.generatedAt);
  return reportPolicies.map((policy) => {
    if (policy === selected.policy) return selected;
    return stored
      .filter((item) => item.scenarioRevision === selected.scenarioRevision && item.policy === policy)
      .sort((left, right) => Math.abs(Date.parse(left.generatedAt) - selectedTime) - Math.abs(Date.parse(right.generatedAt) - selectedTime))[0];
  }).filter((item): item is CapacityRecommendation => Boolean(item));
}

export function createApp(store: PlannerStore, catalogUpdates = new CatalogUpdateService(store)): Hono {
  const app = new Hono();
  app.use("/api/*", async (context, next) => {
    const length = Number(context.req.header("content-length") ?? "0");
    const maximumLength = context.req.path === "/api/catalog/import" ||
      context.req.path === "/api/evidence/import" || context.req.path === "/api/calibrations/import"
      ? 10_500_000 : 2_000_000;
    if (length > maximumLength) return context.json({ error: "payload_too_large" }, 413);
    context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    return next();
  });

  app.get("/api/health", (context) => context.json({ status: "ok", storage: store.storageKind }));
  app.get("/api/contract", async (context) => {
    const file = applicationResourcePath("contracts", "perceptrum-workload-v2.json");
    return context.json(JSON.parse(await readFile(file, "utf8")) as unknown);
  });
  app.get("/api/scenarios", async (context) => context.json(await store.listScenarios()));
  app.post("/api/scenarios/compare", async (context) => {
    const request = compareRequestSchema.parse(await context.req.json());
    const comparisons = [];
    for (const id of request.scenarioIds) {
      const scenario = await store.getScenario(id);
      if (!scenario) return context.json({ error: "scenario_not_found", id }, 404);
      const stored = (await store.listRecommendations(id)).filter((item) => item.scenarioRevision === scenario.revision);
      const recommendations = stored.length ? stored : buildRecommendations(
        id, scenario.revision, scenario.scenario, await store.getCatalog(), await store.getQuotes(), false,
        catalogUpdates.status.catalogVersion, await refreshPredictions(store));
      comparisons.push({ scenario, recommendations });
    }
    return context.json({ schemaVersion: "capacity-scenario-comparison/1.0.0", comparisons });
  });
  app.post("/api/scenarios", async (context) => {
    const parsed = scenarioCreateSchema.parse(await context.req.json());
    return context.json(await store.createScenario(parsed.scenario), 201);
  });
  app.get("/api/scenarios/:id", async (context) => {
    const record = await store.getScenario(context.req.param("id"));
    return record ? context.json(record) : context.json({ error: "scenario_not_found" }, 404);
  });
  app.patch("/api/scenarios/:id", async (context) => {
    const parsed = scenarioUpdateSchema.parse(await context.req.json());
    return context.json(await store.updateScenario(context.req.param("id"), parsed.expectedRevision, parsed.scenario));
  });
  app.post("/api/scenarios/:id/duplicate", async (context) => {
    const record = await store.duplicateScenario(context.req.param("id"));
    return record ? context.json(record, 201) : context.json({ error: "scenario_not_found" }, 404);
  });
  app.post("/api/scenarios/:id/recommendations", async (context) => {
    const scenario = await store.getScenario(context.req.param("id"));
    if (!scenario) return context.json({ error: "scenario_not_found" }, 404);
    const recommendations = buildRecommendations(
      scenario.id, scenario.revision, scenario.scenario, await store.getCatalog(), await store.getQuotes(), false,
      catalogUpdates.status.catalogVersion, await refreshPredictions(store));
    const withEvidence = currentEvidence(recommendations, await store.listBenchmarkEvidence(scenario.id, scenario.revision));
    await store.saveRecommendations(withEvidence);
    return context.json(withEvidence, 201);
  });
  app.get("/api/scenarios/:id/recommendations", async (context) => context.json(await store.listRecommendations(context.req.param("id"))));
  app.get("/api/catalog/hardware", async (context) => context.json(await store.getCatalog()));
  app.get("/api/catalog/quotes", async (context) => context.json(await store.getQuotes()));
  app.get("/api/catalog/status", (context) => context.json(catalogUpdates.status));
  app.get("/api/catalog/update-runs", async (context) => context.json(await store.listCatalogUpdateRuns()));
  app.post("/api/catalog/refresh", async (context) => {
    if (!catalogUpdates.status.remoteUpdateConfigured) return context.json({ error: "catalog_update_not_configured" }, 503);
    return context.json(await catalogUpdates.refresh());
  });
  app.post("/api/catalog/configure", async (context) => {
    const configuration = catalogConfigurationSchema.parse(await context.req.json());
    try {
      return context.json(await catalogUpdates.configure(configuration));
    } catch (error) {
      return context.json({ error: safeError(error) }, 422);
    }
  });
  app.post("/api/catalog/import", async (context) => {
    try {
      return context.json(await catalogUpdates.importSignedSnapshot(await context.req.text()));
    } catch (error) {
      return context.json({ error: safeError(error) }, 422);
    }
  });

  app.get("/api/calibrations", async (context) => context.json(await store.listCalibrationRuns()));
  app.get("/api/predictions", async (context) => context.json(await store.listPredictions()));
  app.get("/api/evidence", async (context) => context.json(await store.listBenchmarkObservations()));
  app.get("/api/evidence/components", async (context) => context.json(await store.listHardwareComponents()));
  app.get("/api/calibrations/status", async (context) => context.json({
    schemaVersion: "qual-hardware-calibration-status/1.0.0",
    calibrationRuns: (await store.listCalibrationRuns()).length,
    publicObservations: (await store.listBenchmarkObservations()).length,
    predictions: (await store.listPredictions()).length,
    localOnly: true,
    inferenceProvider: "aiq_local",
  }));
  app.post("/api/calibrations/plans", async (context) => {
    const request = calibrationPlanRequestSchema.parse(await context.req.json());
    const recommendation = await store.getRecommendation(request.recommendationId);
    if (!recommendation) return context.json({ error: "recommendation_not_found" }, 404);
    const scenario = await store.getScenario(recommendation.scenarioId);
    if (!scenario || scenario.revision !== recommendation.scenarioRevision) {
      return context.json({ error: "recommendation_revision_is_not_current" }, 409);
    }
    if (request.targetHardwareTemplateId && !(await store.getCatalog()).some((item) => item.id === request.targetHardwareTemplateId)) {
      return context.json({ error: "calibration_hardware_not_in_catalog" }, 422);
    }
    return context.json(createCalibrationPlan(scenario.scenario, request.mode, request.targetHardwareTemplateId), 201);
  });
  app.post("/api/calibrations/import", async (context) => {
    const raw = await context.req.json();
    const findings = findForbiddenCalibrationData(raw);
    if (findings.length) return context.json({ error: "privacy_contract_violation", findings }, 422);
    const run = localCalibrationRunSchema.parse(raw) as LocalCalibrationRun;
    if (run.fingerprint.hardwareTemplateId) {
      const target = (await store.getCatalog()).find((item) => item.id === run.fingerprint.hardwareTemplateId);
      if (!target) return context.json({ error: "calibration_hardware_not_in_catalog" }, 422);
      if (!fingerprintMatchesTemplate(run, target)) {
        return context.json({ error: "calibration_hardware_fingerprint_mismatch", targetHardwareTemplateId: target.id }, 422);
      }
    }
    await store.saveCalibrationRun(run);
    const predictions = await refreshPredictions(store);
    return context.json({ run, predictions }, 201);
  });
  app.post("/api/evidence/import", async (context) => {
    try {
      const snapshot = await catalogUpdates.importSignedEvidenceSnapshot(await context.req.text());
      const predictions = await refreshPredictions(store);
      return context.json({ snapshot, predictions }, 201);
    } catch (error) {
      return context.json({ error: safeError(error) }, 422);
    }
  });
  app.post("/api/predictions/recalculate", async (context) => context.json(await refreshPredictions(store), 201));

  app.post("/api/benchmarks/manifests", async (context) => {
    const request = manifestRequestSchema.parse(await context.req.json());
    const recommendation = await store.getRecommendation(request.recommendationId);
    if (!recommendation) return context.json({ error: "recommendation_not_found" }, 404);
    const scenario = await store.getScenario(recommendation.scenarioId);
    if (!scenario || scenario.revision !== recommendation.scenarioRevision) return context.json({ error: "recommendation_revision_is_not_current" }, 409);
    const origin = process.env.PUBLIC_BASE_URL ?? new URL(context.req.url).origin;
    const manifest = createBenchmarkManifest(scenario, recommendation, origin, request.gpuDriver, request.slaInferenceLatencyMs);
    await store.saveManifest(manifest);
    return context.json(manifest, 201);
  });
  app.post("/api/benchmarks/:id/results", async (context) => {
    const manifest = await store.getManifest(context.req.param("id"));
    if (!manifest) return context.json({ error: "manifest_not_found" }, 404);
    if (await store.getBenchmarkResult(manifest.id)) return context.json({ error: "benchmark_challenge_already_used" }, 409);
    const nonce = context.req.header("x-benchmark-nonce") ?? "";
    if (!nonceMatches(manifest.nonce, nonce)) return context.json({ error: "invalid_benchmark_nonce" }, 403);
    const raw = await context.req.json();
    const findings = findForbiddenBenchmarkData(raw);
    if (findings.length) return context.json({ error: "privacy_contract_violation", findings }, 422);
    const metrics = benchmarkMetricsSchema.parse(raw) as BenchmarkMetrics;
    const result = validateBenchmark(manifest, metrics);
    await store.saveBenchmarkResult(result);
    return context.json(result, result.passed ? 201 : 422);
  });

  app.get("/api/recommendations/:id/export/:format", async (context) => {
    const recommendation = await store.getRecommendation(context.req.param("id"));
    if (!recommendation) return context.json({ error: "recommendation_not_found" }, 404);
    const scenario = await store.getScenario(recommendation.scenarioId);
    if (!scenario) return context.json({ error: "scenario_not_found" }, 404);
    const recommendations = reportRecommendationSet(recommendation, await store.listRecommendations(recommendation.scenarioId));
    if (recommendations.length !== reportPolicies.length) return context.json({ error: "recommendation_set_incomplete" }, 409);
    const format = context.req.param("format");
    const reportContext = { scenario, recommendations };
    let body: Buffer;
    let contentType: string;
    if (format === "json") { body = jsonReport(reportContext); contentType = "application/json; charset=utf-8"; }
    else if (format === "xlsx") { body = await xlsxReport(reportContext); contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; }
    else if (format === "pdf") { body = await pdfReport(reportContext); contentType = "application/pdf"; }
    else return context.json({ error: "unsupported_export_format" }, 404);
    context.header("Content-Type", contentType);
    context.header("Content-Disposition", `attachment; filename="qual-hardware-3-configuracoes.${format}"`);
    context.header("Content-Length", String(body.byteLength));
    if (process.env.REPORT_STORAGE_DIR) {
      const reportDirectory = resolve(process.env.REPORT_STORAGE_DIR);
      await mkdir(reportDirectory, { recursive: true });
      await writeFile(resolve(reportDirectory, `${recommendation.id}.${format}`), body);
    }
    return context.body(Uint8Array.from(body));
  });

  app.post("/api/internal/catalog/collect", async (context) => {
    const configured = process.env.ADMIN_TOKEN;
    if (!configured) return context.json({ error: "admin_operations_disabled" }, 503);
    if (!nonceMatches(configured, context.req.header("x-admin-token") ?? "")) return context.json({ error: "forbidden" }, 403);
    const jobId = await store.enqueue("collect_prices", { requestedAt: new Date().toISOString() });
    return context.json({ jobId, status: "queued" }, 202);
  });

  app.onError((error, context) => {
    if (error instanceof z.ZodError) return context.json({ error: "validation_error", issues: error.issues }, 422);
    if (error instanceof RevisionConflictError) return context.json({ error: "revision_conflict", currentRevision: error.currentRevision }, 409);
    if (error instanceof CapacityError) return context.json({ error: "capacity_error", message: error.message, details: error.details }, 422);
    if (error instanceof SyntaxError) return context.json({ error: "invalid_json" }, 400);
    console.error(error);
    return context.json({ error: "internal_error", message: safeError(error) }, 500);
  });

  const webRoot = applicationResourcePath("dist", "web");
  app.use("/*", serveStatic({ root: webRoot }));
  app.get("/*", serveStatic({ root: webRoot, path: "index.html" }));
  return app;
}
