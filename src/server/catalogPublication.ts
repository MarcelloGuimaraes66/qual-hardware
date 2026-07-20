import { createHash, sign, verify } from "node:crypto";
import { CATALOG_BUNDLE_VERSION, type CatalogBundle, type CatalogBundleSourceHealth, type CatalogSource, type HardwareComponent, type HardwareNodeTemplate, type PriceQuote, type PublicBenchmarkObservation, type SignedCatalogBundle } from "../shared/types.js";
import { catalogBundleSchema, signedCatalogBundleSchema } from "../shared/catalogSchemas.js";
import { QWEN_CATALOG_METADATA } from "./qwenCatalog.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
export const PUBLICATION_INTERVAL_DAYS = 15;
export const PRICE_CURRENT_DAYS = 18;
export const PRICE_REFERENCE_DAYS = 30;

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isPublicationDue(lastPublishedAt: string | null, now = new Date()): boolean {
  if (!lastPublishedAt) return true;
  const previous = Date.parse(lastPublishedAt);
  if (!Number.isFinite(previous)) return true;
  return now.getTime() - previous >= PUBLICATION_INTERVAL_DAYS * DAY_MS;
}

export function publicationId(date: Date, serial = 1): string {
  return `catalog-${date.toISOString().slice(0, 10)}.${serial}`;
}

export function priceAgeState(quote: PriceQuote, now = new Date()): "current" | "reference" | "quotation_required" {
  const observedAt = Date.parse(quote.observedAt);
  if (!Number.isFinite(observedAt) || now.getTime() - observedAt > PRICE_REFERENCE_DAYS * DAY_MS) return "quotation_required";
  if (now.getTime() - observedAt > PRICE_CURRENT_DAYS * DAY_MS) return "reference";
  return "current";
}

export function rejectUnconfirmedPriceOutliers(quotes: PriceQuote[]): { accepted: PriceQuote[]; rejected: PriceQuote[] } {
  const accepted: PriceQuote[] = []; const rejected: PriceQuote[] = [];
  const grouped = new Map<string, PriceQuote[]>();
  for (const quote of quotes) {
    const key = `${quote.market}:${quote.currency}:${quote.mpn.toLowerCase()}`;
    grouped.set(key, [...(grouped.get(key) ?? []), quote]);
  }
  for (const group of grouped.values()) {
    const amounts = group.map((quote) => quote.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)] ?? 0;
    for (const quote of group) {
      const divergent = median > 0 && Math.abs(quote.amount - median) / median > 0.4;
      const independentConfirmation = group.some((other) => other.id !== quote.id && other.seller !== quote.seller && Math.abs(other.amount - quote.amount) / quote.amount <= 0.4);
      (divergent && !independentConfirmation ? rejected : accepted).push(quote);
    }
  }
  return { accepted, rejected };
}

export function sourceHealth(sources: CatalogSource[]): CatalogBundleSourceHealth {
  const activeSources = sources.filter((source) => source.state === "active" || source.state === "degraded");
  const degraded = activeSources.filter((source) => source.state === "degraded").length;
  const unavailable = sources.filter((source) => source.state === "unavailable").length;
  const healthy = activeSources.filter((source) => source.state === "active").length;
  return { active: activeSources.length, healthy, degraded, unavailable, failedPercent: activeSources.length ? (degraded / activeSources.length) * 100 : 0 };
}

export interface BuildCatalogBundleInput {
  sequence: number;
  now: Date;
  serial?: number;
  previousBundleSha256: string | null;
  collectorCommit: string;
  hardware: HardwareNodeTemplate[];
  components: HardwareComponent[];
  benchmarks: PublicBenchmarkObservation[];
  prices: PriceQuote[];
  sources: CatalogSource[];
  qwenUsed: boolean;
  qwen?: CatalogBundle["qwen"];
  previousHardwareCount?: number;
  previousSourceCount?: number;
  summary?: CatalogBundle["summary"];
}

export function buildCatalogBundle(input: BuildCatalogBundleInput): CatalogBundle {
  const filteredPrices = rejectUnconfirmedPriceOutliers(input.prices);
  const health = sourceHealth(input.sources);
  if (health.failedPercent > 20) throw new Error("publication_source_failure_gate");
  if (input.previousHardwareCount && input.hardware.length < input.previousHardwareCount * 0.9) throw new Error("publication_coverage_drop_gate");
  if (input.previousSourceCount && input.sources.length < input.previousSourceCount * 0.9) throw new Error("publication_source_registry_drop_gate");
  if (!input.hardware.length) throw new Error("publication_empty_hardware_gate");
  const publishedAt = input.now.toISOString();
  const id = publicationId(input.now, input.serial ?? 1);
  return catalogBundleSchema.parse({
    schemaVersion: CATALOG_BUNDLE_VERSION, channel: "stable", sequence: input.sequence,
    publicationId: id, catalogVersion: `hardware-reference/${id}`, generatedAt: publishedAt, publishedAt,
    validUntil: new Date(input.now.getTime() + PRICE_CURRENT_DAYS * DAY_MS).toISOString(),
    previousBundleSha256: input.previousBundleSha256, collectorCommit: input.collectorCommit,
    qwen: input.qwen ? { ...input.qwen, used: input.qwenUsed } : { ...QWEN_CATALOG_METADATA, used: input.qwenUsed }, markets: ["BR", "US", "DE"],
    hardware: input.hardware, components: input.components, benchmarks: input.benchmarks,
    prices: filteredPrices.accepted, sources: input.sources, sourceHealth: health,
    summary: input.summary
      ? { ...input.summary, rejected: input.summary.rejected + filteredPrices.rejected.length }
      : { added: 0, updated: 0, unchanged: input.hardware.length + input.components.length + input.benchmarks.length + filteredPrices.accepted.length, rejected: filteredPrices.rejected.length, checkedWithoutChanges: true },
  }) as CatalogBundle;
}

export function signCatalogBundle(payload: CatalogBundle, privateKeyPem: string, keyId: string): SignedCatalogBundle {
  const validated = catalogBundleSchema.parse(payload) as CatalogBundle;
  return { payload: validated, keyId, signature: sign(null, Buffer.from(JSON.stringify(validated)), privateKeyPem).toString("base64") };
}

export function verifyCatalogBundle(envelope: SignedCatalogBundle, publicKeyPem: string): CatalogBundle {
  const parsed = signedCatalogBundleSchema.parse(envelope) as SignedCatalogBundle;
  const valid = verify(null, Buffer.from(JSON.stringify(parsed.payload)), publicKeyPem, Buffer.from(parsed.signature, "base64"));
  if (!valid) throw new Error("invalid_catalog_bundle_signature");
  return parsed.payload;
}
