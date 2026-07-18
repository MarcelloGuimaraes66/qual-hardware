import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import { buildRecommendations, CapacityError } from "../engine/capacity.js";
import { benchmarkMetricsSchema, scenarioCreateSchema, scenarioUpdateSchema } from "../shared/schemas.js";
import type { BenchmarkMetrics, CapacityRecommendation } from "../shared/types.js";
import { createBenchmarkManifest, evidenceValidatesRecommendation, nonceMatches, validateBenchmark } from "./benchmark.js";
import { CatalogUpdateService } from "./catalogUpdates.js";
import { jsonReport, pdfReport, xlsxReport } from "./reports.js";
import { findForbiddenBenchmarkData, safeError } from "./security.js";
import { RevisionConflictError, type PlannerStore } from "./store.js";

const manifestRequestSchema = z.object({
  recommendationId: z.string().uuid(),
  gpuDriver: z.string().min(1).max(120),
  slaInferenceLatencyMs: z.number().positive().max(3_600_000).default(10_000),
});
const compareRequestSchema = z.object({ scenarioIds: z.array(z.string().uuid()).min(2).max(10) });

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

export function createApp(store: PlannerStore, catalogUpdates = new CatalogUpdateService(store)): Hono {
  const app = new Hono();
  app.use("/api/*", async (context, next) => {
    const length = Number(context.req.header("content-length") ?? "0");
    if (length > 2_000_000) return context.json({ error: "payload_too_large" }, 413);
    context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    return next();
  });

  app.get("/api/health", (context) => context.json({ status: "ok", storage: store.storageKind }));
  app.get("/api/contract", async (context) => {
    const file = applicationResourcePath("contracts", "perceptrum-workload-v1.json");
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
        id, scenario.revision, scenario.scenario, await store.getCatalog(), await store.getQuotes(), false, catalogUpdates.status.catalogVersion);
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
      scenario.id, scenario.revision, scenario.scenario, await store.getCatalog(), await store.getQuotes(), false, catalogUpdates.status.catalogVersion);
    const withEvidence = currentEvidence(recommendations, await store.listBenchmarkEvidence(scenario.id, scenario.revision));
    await store.saveRecommendations(withEvidence);
    return context.json(withEvidence, 201);
  });
  app.get("/api/scenarios/:id/recommendations", async (context) => context.json(await store.listRecommendations(context.req.param("id"))));
  app.get("/api/catalog/hardware", async (context) => context.json(await store.getCatalog()));
  app.get("/api/catalog/quotes", async (context) => context.json(await store.getQuotes()));
  app.get("/api/catalog/status", (context) => context.json(catalogUpdates.status));
  app.post("/api/catalog/refresh", async (context) => {
    if (!catalogUpdates.status.remoteUpdateConfigured) return context.json({ error: "catalog_update_not_configured" }, 503);
    return context.json(await catalogUpdates.refresh());
  });

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
    const format = context.req.param("format");
    const reportContext = { scenario, recommendation };
    let body: Buffer;
    let contentType: string;
    if (format === "json") { body = jsonReport(reportContext); contentType = "application/json; charset=utf-8"; }
    else if (format === "xlsx") { body = await xlsxReport(reportContext); contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; }
    else if (format === "pdf") { body = await pdfReport(reportContext); contentType = "application/pdf"; }
    else return context.json({ error: "unsupported_export_format" }, 404);
    context.header("Content-Type", contentType);
    context.header("Content-Disposition", `attachment; filename="qual-hardware-${recommendation.policy}.${format}"`);
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
