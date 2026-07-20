import { z } from "zod";
import { CATALOG_BUNDLE_VERSION, SOURCE_REGISTRY_VERSION } from "./types.js";
import type { HardwareNodeTemplate } from "./types.js";
import { hardwareComponentSchema, publicBenchmarkObservationSchema } from "./schemas.js";

const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "HTTPS is required");
const marketSchema = z.enum(["BR", "US", "DE"]);
const currencySchema = z.enum(["BRL", "USD", "EUR"]);
const hardwareNodeTemplateSchema = z.custom<HardwareNodeTemplate>((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.name === "string" && typeof item.kind === "string" &&
    typeof item.cpuModel === "string" && typeof item.gpuModel === "string" && typeof item.physicalCores === "number" &&
    typeof item.ramGb === "number" && typeof item.operatingSystemFamily === "string" && Array.isArray(item.sources);
}, "Invalid hardware template");

export const catalogSourceSchema = z.object({
  id: z.string().min(1).max(160),
  organization: z.string().min(1).max(160),
  primaryUrl: httpsUrl,
  discoveryUrls: z.array(httpsUrl).max(30),
  allowedHosts: z.array(z.string().min(1).max(255)).min(1).max(30),
  allowedRedirectHosts: z.array(z.string().min(1).max(255)).max(30),
  category: z.enum(["specification", "oem", "price", "benchmark", "exchange_rate"]),
  markets: z.array(marketSchema).max(3),
  currencies: z.array(currencySchema).max(3),
  parser: z.enum(["api", "json_ld", "sitemap", "csv", "html_table", "pdf"]),
  products: z.array(z.string().min(1).max(160)).max(100),
  trustTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  maxRequestsPerRun: z.number().int().min(1).max(10_000),
  minimumIntervalMs: z.number().int().nonnegative().max(86_400_000),
  robotsRequired: z.boolean(),
  state: z.enum(["active", "degraded", "unavailable", "disabled"]),
  lastRunAt: z.iso.datetime().nullable(),
  lastSuccessAt: z.iso.datetime().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  notes: z.array(z.string().max(500)).max(30),
});

export const sourceRegistrySchema = z.object({
  schemaVersion: z.literal(SOURCE_REGISTRY_VERSION),
  generatedAt: z.iso.datetime(),
  sources: z.array(catalogSourceSchema).min(1).max(10_000),
}).superRefine((value, context) => {
  const ids = new Set<string>();
  for (const [index, source] of value.sources.entries()) {
    if (ids.has(source.id)) context.addIssue({ code: "custom", path: ["sources", index, "id"], message: "Duplicate source id" });
    ids.add(source.id);
    if (!source.allowedHosts.includes(new URL(source.primaryUrl).hostname)) {
      context.addIssue({ code: "custom", path: ["sources", index, "allowedHosts"], message: "Primary host must be allowlisted" });
    }
  }
});

const priceQuoteSchema = z.object({
  id: z.string().min(1), hardwareTemplateId: z.string().min(1).nullable(), componentId: z.string().min(1).nullable().optional(), mpn: z.string().min(1), seller: z.string().min(1),
  market: marketSchema, currency: currencySchema, condition: z.literal("new"), inStock: z.boolean(), taxIncluded: z.boolean().nullable(),
  amount: z.number().positive(), originalAmount: z.number().positive(), originalCurrency: currencySchema,
  exchangeRate: z.number().positive(), exchangeRateSource: z.string().nullable(), url: httpsUrl, observedAt: z.iso.datetime(),
  sourceKind: z.enum(["official_api", "allowed_page", "curated"]), sourceId: z.string().optional(),
  scope: z.enum(["component", "system"]).optional(), gtin: z.string().nullable().optional(), sku: z.string().nullable().optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), evidenceLocator: z.string().max(1_000).optional(),
  retrievedAt: z.iso.datetime().optional(), validUntil: z.iso.datetime().optional(),
}).superRefine((value, context) => {
  if (value.scope === "component" && !value.componentId) context.addIssue({ code: "custom", path: ["componentId"], message: "Component quote requires componentId" });
  if (value.scope !== "component" && !value.hardwareTemplateId) context.addIssue({ code: "custom", path: ["hardwareTemplateId"], message: "System quote requires hardwareTemplateId" });
});

const sourceHealthSchema = z.object({
  active: z.number().int().nonnegative(), healthy: z.number().int().nonnegative(), degraded: z.number().int().nonnegative(),
  unavailable: z.number().int().nonnegative(), failedPercent: z.number().min(0).max(100),
});

export const catalogBundleSchema = z.object({
  schemaVersion: z.literal(CATALOG_BUNDLE_VERSION), channel: z.literal("stable"), sequence: z.number().int().positive(),
  publicationId: z.string().regex(/^catalog-\d{4}-\d{2}-\d{2}\.\d+$/), catalogVersion: z.string().min(1).max(160),
  generatedAt: z.iso.datetime(), publishedAt: z.iso.datetime(), validUntil: z.iso.datetime(),
  previousBundleSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), collectorCommit: z.string().min(7).max(64),
  qwen: z.object({
    model: z.string().min(1).max(240), modelSha256: z.string().regex(/^[a-f0-9]{64}$/), promptVersion: z.string().min(1), used: z.boolean(),
    temperature: z.literal(0).optional(), mode: z.literal("/no_think").optional(), profileVersion: z.string().min(1).max(160).optional(),
    parameterBillions: z.number().positive().max(10_000).optional(), quantization: z.string().min(1).max(40).optional(),
    sizeBytes: z.number().int().positive().optional(), selection: z.enum(["pinned_ci", "explicit", "auto_detected"]).optional(),
  }),
  markets: z.array(marketSchema).min(1).max(3), hardware: z.array(hardwareNodeTemplateSchema).min(1).max(100_000),
  components: z.array(hardwareComponentSchema).max(100_000), benchmarks: z.array(publicBenchmarkObservationSchema).max(100_000),
  prices: z.array(priceQuoteSchema).max(1_000_000), sources: z.array(catalogSourceSchema).min(1).max(10_000),
  sourceHealth: sourceHealthSchema,
  summary: z.object({ added: z.number().int().nonnegative(), updated: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), checkedWithoutChanges: z.boolean() }),
}).superRefine((value, context) => {
  if (Date.parse(value.validUntil) <= Date.parse(value.publishedAt)) context.addIssue({ code: "custom", path: ["validUntil"], message: "Bundle validity must end after publication" });
  const sourceIds = new Set(value.sources.map((source) => source.id));
  value.prices.forEach((price, index) => {
    if (price.sourceId && !sourceIds.has(price.sourceId)) context.addIssue({ code: "custom", path: ["prices", index, "sourceId"], message: "Unknown source" });
  });
});

export const signedCatalogBundleSchema = z.object({
  payload: catalogBundleSchema,
  keyId: z.string().min(1).max(120),
  signature: z.string().min(32).max(1_024),
});
