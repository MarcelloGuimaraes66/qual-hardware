import { createHash, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { HARDWARE_CATALOG, SEED_PRICE_QUOTES } from "../src/engine/catalog.js";
import { BUNDLED_SOURCE_REGISTRY } from "../src/engine/sourceRegistry.js";
import { sourceRegistrySchema, catalogBundleSchema, signedCatalogBundleSchema } from "../src/shared/catalogSchemas.js";
import { OFFICIAL_CATALOG_CHANNEL, QWEN_CATALOG_MODEL_SHA256 } from "../src/shared/catalogChannel.js";
import type { CalibrationStage, CatalogBundle, CatalogSource, HardwareComponent, HardwareNodeTemplate, PriceQuote, PublicBenchmarkObservation, SignedCatalogBundle, SourceObservation } from "../src/shared/types.js";
import { collectCatalogSource, type SourceCollectionResult } from "../src/server/catalogSourceFetcher.js";
import { buildCatalogBundle, isPublicationDue, rejectUnconfirmedPriceOutliers, sha256, signCatalogBundle, verifyCatalogBundle } from "../src/server/catalogPublication.js";
import { classifyCatalogCandidate, createLlamaCppRunner, QWEN_CATALOG_METADATA } from "../src/server/qwenCatalog.js";

interface CollectionArtifact {
  schemaVersion: "qual-hardware-catalog-collection/1.0.0";
  collectedAt: string;
  sources: CatalogSource[];
  results: SourceCollectionResult[];
  observations: SourceObservation[];
  qwenCandidates: SourceObservation[];
}

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing_argument_${name}`);
}

function optionalArgument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : null;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function observationNeedsQwen(observation: SourceObservation): boolean {
  const payload = observation.payload;
  if (payload.kind === "public_benchmark" || payload.kind === "exchange_rate") return false;
  const brand = payload.brand ?? payload.manufacturer ?? BUNDLED_SOURCE_REGISTRY.sources.find((source) => source.id === observation.sourceId)?.organization;
  const offer = firstOffer(payload.offers);
  return !(typeof brand === "string" || (brand && typeof brand === "object")) || !(typeof payload.sku === "string" || typeof payload.mpn === "string" || typeof offer?.sku === "string");
}

function updatedSource(result: SourceCollectionResult): CatalogSource {
  const completedAt = result.run.completedAt;
  if (result.run.status === "collected") return { ...result.source, state: "active", lastRunAt: completedAt, lastSuccessAt: completedAt, consecutiveFailures: 0 };
  if (result.run.status === "skipped") return { ...result.source, lastRunAt: completedAt };
  const failures = result.source.consecutiveFailures + 1;
  return { ...result.source, state: failures >= 3 ? "degraded" : result.source.state, lastRunAt: completedAt, consecutiveFailures: failures };
}

async function collect(outputDirectory: string): Promise<void> {
  const results: SourceCollectionResult[] = [];
  for (const source of BUNDLED_SOURCE_REGISTRY.sources) results.push(await collectCatalogSource(source));
  const sources = results.map(updatedSource);
  const observations = results.flatMap((result) => result.observations);
  const artifact: CollectionArtifact = {
    schemaVersion: "qual-hardware-catalog-collection/1.0.0", collectedAt: new Date().toISOString(),
    sources, results, observations, qwenCandidates: observations.filter(observationNeedsQwen).slice(0, 20),
  };
  await writeJson(resolve(outputDirectory, "collection.json"), artifact);
  await writeJson(resolve(outputDirectory, "source-registry.json"), sourceRegistrySchema.parse({ ...BUNDLED_SOURCE_REGISTRY, generatedAt: artifact.collectedAt, sources }));
}

async function runQwen(collectionFile: string, outputFile: string): Promise<void> {
  const collection = await readJson<CollectionArtifact>(collectionFile);
  const classifications: Array<{ observationId: string; classification?: unknown; error?: string }> = [];
  const executable = process.env.LLAMA_CPP_PATH;
  const model = process.env.QWEN_MODEL_PATH;
  let used = false;
  if (collection.qwenCandidates.length && executable && model) {
    const modelHash = createHash("sha256").update(await readFile(model)).digest("hex");
    if (modelHash !== QWEN_CATALOG_MODEL_SHA256) throw new Error("qwen_model_checksum_mismatch");
    const runner = createLlamaCppRunner(executable, model);
    for (const candidate of collection.qwenCandidates) {
      const sourceText = JSON.stringify(candidate.payload);
      try { classifications.push({ observationId: candidate.id, classification: await classifyCatalogCandidate(sourceText, runner) }); used = true; }
      catch (error) { classifications.push({ observationId: candidate.id, error: error instanceof Error ? error.message : "qwen_failed" }); }
    }
  } else {
    for (const candidate of collection.qwenCandidates) classifications.push({ observationId: candidate.id, error: "qwen_model_unavailable_candidate_rejected" });
  }
  await writeJson(outputFile, { schemaVersion: "qual-hardware-qwen-classification/1.0.0", metadata: QWEN_CATALOG_METADATA, used, classifications });
}

function normalized(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function brandName(value: unknown): string | null {
  if (typeof value === "string") return normalized(value);
  if (value && typeof value === "object") return normalized((value as Record<string, unknown>).name);
  return null;
}

function firstOffer(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : null;
}

function observedComponentIdentity(observation: SourceObservation): { id: string; manufacturer: string; sku: string; kind: HardwareComponent["kind"] } | null {
  const offer = firstOffer(observation.payload.offers);
  const sku = normalized(observation.payload.mpn) ?? normalized(observation.payload.sku) ?? normalized(offer?.sku);
  const manufacturer = brandName(observation.payload.brand) ?? brandName(observation.payload.manufacturer) ?? BUNDLED_SOURCE_REGISTRY.sources.find((source) => source.id === observation.sourceId)?.organization ?? null;
  if (!sku || !manufacturer) return null;
  const name = normalized(observation.payload.name)?.toLowerCase() ?? "";
  const kind: HardwareComponent["kind"] = /placa de v[ií]deo|graphics|gpu/.test(name) ? "gpu"
    : /mem[oó]ria|memory|ddr[45]/.test(name) ? "memory"
      : /ssd|nvme|storage|disco/.test(name) ? "storage" : "system";
  const id = `observed:${observation.sourceId}:${sku}`.toLowerCase().replace(/[^a-z0-9:]+/g, "-");
  return { id, manufacturer, sku, kind };
}

function componentsFromHardware(observations: SourceObservation[]): HardwareComponent[] {
  const components = new Map<string, HardwareComponent>();
  for (const hardware of HARDWARE_CATALOG) {
    const cpuId = `cpu:${hardware.cpuVendor}:${hardware.cpuModel}`.toLowerCase().replace(/[^a-z0-9:]+/g, "-");
    components.set(cpuId, { id: cpuId, kind: "cpu", manufacturer: hardware.cpuVendor, sku: hardware.cpuModel, architecture: hardware.cpuArchitecture ?? "undisclosed", specifications: { physicalCores: hardware.physicalCores }, sourceUrls: hardware.sources.map((source) => source.url) });
    const gpuId = `gpu:${hardware.gpuVendor}:${hardware.gpuModel}`.toLowerCase().replace(/[^a-z0-9:]+/g, "-");
    components.set(gpuId, { id: gpuId, kind: "gpu", manufacturer: hardware.gpuVendor, sku: hardware.gpuModel, architecture: hardware.gpuArchitecture ?? "undisclosed", specifications: { count: hardware.gpuCount, vramGb: hardware.gpuVramGbTotal, decodeStreams: hardware.gpuDecode1080p30Streams }, sourceUrls: hardware.sources.map((source) => source.url) });
    const manufacturer = hardware.name.split(" ")[0] ?? "OEM";
    components.set(`memory:${hardware.id}`, { id: `memory:${hardware.id}`, kind: "memory", manufacturer, sku: `${hardware.id}-memory`, architecture: hardware.memoryArchitecture, specifications: { ramGb: hardware.ramGb, ecc: hardware.ecc }, sourceUrls: hardware.sources.map((source) => source.url) });
    components.set(`storage:${hardware.id}`, { id: `storage:${hardware.id}`, kind: "storage", manufacturer, sku: hardware.storageModel, architecture: "nvme", specifications: { usableStorageTb: hardware.usableStorageTb, sustainedWriteMbps: hardware.diskWriteMbps }, sourceUrls: hardware.sources.map((source) => source.url) });
    components.set(`network:${hardware.id}`, { id: `network:${hardware.id}`, kind: "network", manufacturer, sku: `${hardware.id}-nic`, architecture: "ethernet", specifications: { nicGbps: hardware.nicGbps }, sourceUrls: hardware.sources.map((source) => source.url) });
    components.set(`system:${hardware.id}`, { id: `system:${hardware.id}`, kind: "system", manufacturer, sku: hardware.id, architecture: hardware.chassis, specifications: { cooling: hardware.cooling, thermalClass: hardware.thermalClass ?? null, operatingSystem: hardware.operatingSystemFamily }, sourceUrls: hardware.sources.map((source) => source.url) });
  }
  for (const observation of observations) {
    const identity = observedComponentIdentity(observation);
    if (!identity) continue;
    components.set(identity.id, { id: identity.id, kind: identity.kind, manufacturer: identity.manufacturer, sku: identity.sku, architecture: "reference_only", specifications: { name: normalized(observation.payload.name), evidenceLocator: observation.evidenceLocator }, sourceUrls: [observation.url] });
  }
  return [...components.values()];
}

function exactHardwareForObservation(observation: SourceObservation): (typeof HARDWARE_CATALOG)[number] | null {
  const name = normalized(observation.payload.name)?.toLowerCase().replaceAll("‑", "-") ?? "";
  if (!name.includes("mac mini")) return null;
  const ram = Number(/(\d+)\s*(?:gb|gb arbeitsspeicher)/i.exec(name)?.[1] ?? "0");
  const cores = Number(/(\d+)[-\s]?core cpu/i.exec(name)?.[1] ?? "0");
  const storageMatch = /(\d+)\s*(tb|gb)\s*(?:storage|speicher)/i.exec(name);
  const storageGb = storageMatch ? Number(storageMatch[1]) * (storageMatch[2]?.toLowerCase() === "tb" ? 1024 : 1) : 0;
  const family = name.includes("m4 pro") ? "m4 pro" : name.includes("m4") ? "m4" : "";
  return HARDWARE_CATALOG.find((hardware) =>
    hardware.cpuVendor === "apple" && hardware.kind === "mini_pc" && hardware.cpuModel.toLowerCase().includes(family) &&
    hardware.physicalCores === cores && hardware.ramGb === ram &&
    ((storageGb === 1024 && hardware.storageModel.toLowerCase().startsWith("1 tb")) || (storageGb === 512 && hardware.storageModel.toLowerCase().startsWith("512 gb"))),
  ) ?? null;
}

function priceQuotesFromObservations(observations: SourceObservation[], collectedAt: string): PriceQuote[] {
  const knownByMpn = new Map(SEED_PRICE_QUOTES.map((quote) => [quote.mpn.toLowerCase(), quote]));
  const quotes = new Map<string, PriceQuote>();
  const sources = new Map(BUNDLED_SOURCE_REGISTRY.sources.map((source) => [source.id, source]));
  for (const observation of observations) {
    const payload = observation.payload;
    const offers = firstOffer(payload.offers);
    const mpn = normalized(payload.mpn) ?? normalized(payload.sku) ?? normalized(offers?.sku);
    if (!mpn) continue;
    const known = knownByMpn.get(mpn.toLowerCase());
    const rawPrice = offers?.price;
    const amount = typeof rawPrice === "number" ? rawPrice : Number(rawPrice);
    const currency = normalized(offers?.priceCurrency);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (known && currency === known.currency) {
      quotes.set(`system:${known.mpn.toLowerCase()}`, {
        ...known, id: `${known.id}:${observation.contentHash.slice(0, 12)}`, seller: brandName(offers?.seller) ?? known.seller,
        amount, originalAmount: amount, exchangeRate: 1, exchangeRateSource: null, url: normalized(offers?.url) ?? observation.url,
        observedAt: collectedAt, sourceKind: "allowed_page", sourceId: observation.sourceId, scope: "system",
        sku: normalized(payload.sku), gtin: normalized(payload.gtin13) ?? normalized(payload.gtin), contentHash: observation.contentHash,
        evidenceLocator: `${observation.evidenceLocator}.offers.price`, retrievedAt: observation.retrievedAt,
        validUntil: new Date(Date.parse(collectedAt) + 18 * 24 * 60 * 60 * 1_000).toISOString(),
      });
      continue;
    }
    const identity = observedComponentIdentity(observation);
    const catalogSource = sources.get(observation.sourceId);
    const availability = normalized(offers?.availability)?.toLowerCase() ?? "";
    const purchaseOfferAvailable = availability.endsWith("instock") || Boolean(offers?.shippingDetails);
    const market = catalogSource?.markets[0];
    if (!identity || !catalogSource || !market || !currency || !catalogSource.currencies.includes(currency as PriceQuote["currency"]) || !purchaseOfferAvailable) continue;
    const offerUrl = normalized(offers?.url) ?? observation.url;
    if (new URL(offerUrl).protocol !== "https:") continue;
    const exactHardware = exactHardwareForObservation(observation);
    if (exactHardware) {
      quotes.set(`system:${exactHardware.id}:${market}`, {
        id: `price:${observation.sourceId}:${exactHardware.id}:${observation.contentHash.slice(0, 12)}`,
        hardwareTemplateId: exactHardware.id, componentId: null, mpn, seller: catalogSource.organization,
        market, currency: currency as PriceQuote["currency"], condition: "new", inStock: true, taxIncluded: null,
        amount, originalAmount: amount, originalCurrency: currency as PriceQuote["currency"], exchangeRate: 1,
        exchangeRateSource: null, url: offerUrl, observedAt: observation.retrievedAt, sourceKind: "allowed_page",
        sourceId: observation.sourceId, scope: "system", sku: normalized(offers?.sku), gtin: null,
        contentHash: observation.contentHash, evidenceLocator: `${observation.evidenceLocator}.offers.price+shippingDetails`,
        retrievedAt: observation.retrievedAt, validUntil: new Date(Date.parse(observation.retrievedAt) + 18 * 24 * 60 * 60 * 1_000).toISOString(),
      });
      continue;
    }
    quotes.set(`component:${observation.sourceId}:${mpn.toLowerCase()}`, {
      id: `price:${observation.sourceId}:${mpn}:${observation.contentHash.slice(0, 12)}`.toLowerCase().replace(/[^a-z0-9:]+/g, "-"),
      hardwareTemplateId: null, componentId: identity.id, mpn, seller: catalogSource.organization,
      market, currency: currency as PriceQuote["currency"], condition: "new", inStock: true, taxIncluded: null,
      amount, originalAmount: amount, originalCurrency: currency as PriceQuote["currency"], exchangeRate: 1,
      exchangeRateSource: null, url: offerUrl, observedAt: observation.retrievedAt, sourceKind: "allowed_page",
      sourceId: observation.sourceId, scope: "component", sku: normalized(payload.sku),
      gtin: normalized(payload.gtin13) ?? normalized(payload.gtin), contentHash: observation.contentHash,
      evidenceLocator: `${observation.evidenceLocator}.offers.price+(availability|shippingDetails)`, retrievedAt: observation.retrievedAt,
      validUntil: new Date(Date.parse(observation.retrievedAt) + 18 * 24 * 60 * 60 * 1_000).toISOString(),
    });
  }
  const quoteValues = [...quotes.values()];
  const replacedMpns = new Set(quoteValues.filter((quote) => quote.scope !== "component").map((quote) => quote.mpn.toLowerCase()));
  return [...SEED_PRICE_QUOTES.filter((quote) => !replacedMpns.has(quote.mpn.toLowerCase())), ...quoteValues];
}

function normalizedHardwareName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchingHardware(observation: SourceObservation): HardwareNodeTemplate[] {
  const explicit = normalized(observation.payload.hardwareTemplateId);
  if (explicit) return HARDWARE_CATALOG.filter((hardware) => hardware.id === explicit);
  const device = normalized(observation.payload.device);
  if (!device) return [];
  const needle = normalizedHardwareName(device);
  if (needle.length < 5) return [];
  return HARDWARE_CATALOG.filter((hardware) => [hardware.cpuModel, hardware.gpuModel, hardware.storageModel, hardware.name]
    .some((value) => {
      const candidate = normalizedHardwareName(value);
      return candidate === needle || candidate.includes(needle) || needle.includes(candidate);
    }));
}

function componentForStage(hardware: HardwareNodeTemplate, stage: CalibrationStage): { id: string; kind: HardwareComponent["kind"] } {
  if (["video_decode", "video_encode", "local_inference"].includes(stage)) {
    return { id: `gpu:${hardware.gpuVendor}:${hardware.gpuModel}`.toLowerCase().replace(/[^a-z0-9:]+/g, "-"), kind: "gpu" };
  }
  if (stage === "memory_bandwidth") return { id: `memory:${hardware.id}`, kind: "memory" };
  if (stage === "disk_read" || stage === "disk_write") return { id: `storage:${hardware.id}`, kind: "storage" };
  if (stage === "network_ingest" || stage === "rtsp_ingest") return { id: `network:${hardware.id}`, kind: "network" };
  if (["thermal_sustain", "database_persistence", "dashboard_queries", "intelligence_scheduler"].includes(stage)) return { id: `system:${hardware.id}`, kind: "system" };
  return { id: `cpu:${hardware.cpuVendor}:${hardware.cpuModel}`.toLowerCase().replace(/[^a-z0-9:]+/g, "-"), kind: "cpu" };
}

function benchmarksFromObservations(observations: SourceObservation[]): PublicBenchmarkObservation[] {
  const benchmarks: PublicBenchmarkObservation[] = [];
  const sources = new Map(BUNDLED_SOURCE_REGISTRY.sources.map((source) => [source.id, source]));
  for (const observation of observations) {
    const payload = observation.payload;
    if (payload.kind !== "public_benchmark" || typeof payload.device !== "string" || typeof payload.score !== "number" ||
        typeof payload.sampleCount !== "number" || typeof payload.stage !== "string") continue;
    const source = sources.get(observation.sourceId);
    if (!source || source.category !== "benchmark") continue;
    const stage = payload.stage as CalibrationStage;
    const configuration = normalized(payload.configuration);
    const benchmarkVersion = normalized(payload.benchmarkVersion) ?? "source-current";
    const reproducible = payload.reproducible === true && Boolean(configuration && configuration.length >= 20) && benchmarkVersion !== "source-current";
    for (const hardware of matchingHardware(observation)) {
      const component = componentForStage(hardware, stage);
      const profileId = normalized(payload.profileId) ?? `${observation.sourceId}-${stage}`;
      const metricName = normalized(payload.metricName) ?? "score";
      const qualityFlags = [
        ...(reproducible ? ["deterministic_parser", "exact_hardware_match"] : ["incomplete_reproducibility_metadata"]),
        ...(observation.sourceId === "benchmark-blender" ? ["profile_not_aiq", "secondary_gpu_indicator_only"] : []),
        ...(observation.sourceId === "benchmark-mlcommons" && !/qwen|aiq/i.test(`${payload.profileId ?? ""} ${payload.benchmarkName ?? ""}`) ? ["model_not_aiq"] : []),
      ];
      benchmarks.push({
        id: `${observation.sourceId}:${hardware.id}:${profileId}:${observation.contentHash.slice(0, 16)}`,
        hardwareTemplateId: hardware.id, stage, profileId,
        benchmarkName: normalized(payload.benchmarkName) ?? source.organization, benchmarkVersion, score: payload.score,
        unit: normalized(payload.unit) ?? "score", higherIsBetter: payload.higherIsBetter !== false,
        componentId: component.id, componentKind: component.kind, sourceTier: source.trustTier,
        sourceUrl: observation.url, observedAt: observation.retrievedAt, operatingSystem: "any",
        configuration: configuration ?? `Public numerical observation for ${payload.device}; the source did not disclose enough configuration metadata for purchasing extrapolation.`,
        powerWatts: typeof payload.powerWatts === "number" ? payload.powerWatts : null,
        driverVersion: normalized(payload.driverVersion), coolingProfile: normalized(payload.coolingProfile),
        sampleCount: payload.sampleCount, qualityFlags,
        benchmarkSuiteId: `${observation.sourceId}:${normalized(payload.benchmarkName) ?? source.organization}:${benchmarkVersion}`,
        metricName, aggregation: observation.sourceId === "benchmark-blender" ? "median" : "single",
        systemFingerprint: { hardwareTemplateId: hardware.id, device: payload.device, operatingSystem: normalized(payload.operatingSystem) ?? "any" },
        evidenceLocator: observation.evidenceLocator, rawArtifactSha256: observation.contentHash,
        licensePolicy: observation.sourceId === "benchmark-spec" ? "Normalized result metadata only; SPEC tools are not redistributed." : "Normalized public observation with source attribution.",
        reproducible,
      });
    }
  }
  return benchmarks;
}

async function build(collectionFile: string, qwenFile: string, outputDirectory: string): Promise<void> {
  const collection = await readJson<CollectionArtifact>(collectionFile);
  const qwen = await readJson<{ used: boolean; metadata?: unknown; classifications?: unknown[] }>(qwenFile);
  const previousBundleFile = optionalArgument("previous-bundle");
  const previousBundle = previousBundleFile
    ? (await readJson<SignedCatalogBundle>(previousBundleFile)).payload
    : null;
  const sequence = Number(argument("sequence"));
  const previousHash = argument("previous-sha", "") || null;
  const serial = Number(argument("serial", "1"));
  const attemptedActiveSources = collection.results.filter((result) => result.source.state === "active" || result.source.state === "degraded");
  const failedActiveSources = attemptedActiveSources.filter((result) => result.run.status === "failed");
  if (attemptedActiveSources.length && failedActiveSources.length / attemptedActiveSources.length > 0.2) {
    throw new Error("publication_current_run_source_failure_gate");
  }
  const components = componentsFromHardware(collection.observations);
  const benchmarks = benchmarksFromObservations(collection.observations);
  const priceGate = rejectUnconfirmedPriceOutliers(priceQuotesFromObservations(collection.observations, collection.collectedAt));
  const prices = priceGate.accepted;
  const indexed = (bundle: Pick<CatalogBundle, "hardware" | "components" | "benchmarks" | "prices">): Map<string, string> => new Map([
    ...bundle.hardware.map((item) => [`hardware:${item.id}`, JSON.stringify(item)] as const),
    ...bundle.components.map((item) => [`component:${item.id}`, JSON.stringify(item)] as const),
    ...bundle.benchmarks.map((item) => [`benchmark:${item.id}`, JSON.stringify(item)] as const),
    ...bundle.prices.map((item) => [`price:${item.id}`, JSON.stringify(item)] as const),
  ]);
  const currentIndex = indexed({ hardware: HARDWARE_CATALOG, components, benchmarks, prices });
  const previousIndex = previousBundle ? indexed(previousBundle) : new Map<string, string>();
  const added = [...currentIndex.keys()].filter((id) => !previousIndex.has(id)).length;
  const updated = [...currentIndex].filter(([id, value]) => previousIndex.has(id) && previousIndex.get(id) !== value).length;
  const unchanged = [...currentIndex].filter(([id, value]) => previousIndex.get(id) === value).length;
  const payload = buildCatalogBundle({
    sequence, now: new Date(), serial, previousBundleSha256: previousHash,
    collectorCommit: process.env.GITHUB_SHA ?? argument("commit", "0846ff7"), hardware: HARDWARE_CATALOG,
    components, benchmarks, prices, sources: collection.sources, qwenUsed: qwen.used,
    previousHardwareCount: previousBundle?.hardware.length,
    previousSourceCount: previousBundle?.sources.length,
    summary: { added, updated, unchanged, rejected: priceGate.rejected.length, checkedWithoutChanges: added === 0 && updated === 0 },
  });
  const failed = collection.results.filter((result) => result.run.status === "failed");
  const report = {
    schemaVersion: "qual-hardware-publication-report/1.0.0", publicationId: payload.publicationId,
    sequence: payload.sequence, generatedAt: payload.generatedAt, checkedSources: collection.results.length,
    successfulSources: collection.results.filter((result) => result.run.status === "collected").length,
    skippedSources: collection.results.filter((result) => result.run.status === "skipped").length,
    failedSources: failed.map((result) => ({ sourceId: result.source.id, error: result.run.error })),
    observations: collection.observations.length, qwenUsed: qwen.used, qwen: {
      metadata: qwen.metadata ?? QWEN_CATALOG_METADATA,
      classifications: qwen.classifications ?? [],
    }, summary: payload.summary,
    guarantees: { openAiCalls: 0, paidAiCalls: 0, userDataUploaded: false, appendOnly: true },
  };
  await writeJson(resolve(outputDirectory, "catalog-payload.json"), payload);
  await writeJson(resolve(outputDirectory, "publication-report.json"), report);
  await writeJson(resolve(outputDirectory, "source-registry.json"), { schemaVersion: BUNDLED_SOURCE_REGISTRY.schemaVersion, generatedAt: collection.collectedAt, sources: collection.sources });
}

async function signOutput(payloadFile: string, outputDirectory: string): Promise<void> {
  const privateKey = process.env.CATALOG_SIGNING_PRIVATE_KEY;
  if (!privateKey) throw new Error("catalog_signing_private_key_missing");
  const payload = catalogBundleSchema.parse(await readJson(payloadFile));
  const envelope = signCatalogBundle(payload as never, privateKey.replaceAll("\\n", "\n"), "catalog-2026-01");
  const raw = `${JSON.stringify(envelope, null, 2)}\n`;
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, "catalog-bundle.json"), raw, "utf8");
  const reportPath = resolve(outputDirectory, "publication-report.json");
  const report = await readJson(reportPath);
  const reportEnvelope = {
    payload: report, keyId: "catalog-2026-01",
    signature: cryptoSign(null, Buffer.from(JSON.stringify(report)), privateKey.replaceAll("\\n", "\n")).toString("base64"),
  };
  await writeJson(reportPath, reportEnvelope);
  const files = ["catalog-bundle.json", "source-registry.json", "publication-report.json"];
  const lines: string[] = [];
  for (const name of files) {
    const bytes = await readFile(resolve(outputDirectory, name));
    lines.push(`${sha256(bytes)}  ${name}`);
  }
  await writeFile(resolve(outputDirectory, "SHA256SUMS"), `${lines.join("\n")}\n`, "utf8");
}

async function validateFile(path: string): Promise<void> {
  const value = await readJson(path);
  if (basename(path) === "source-registry.json") sourceRegistrySchema.parse(value);
  else if (basename(path) === "catalog-payload.json") catalogBundleSchema.parse(value);
  else if (basename(path) === "catalog-bundle.json") {
    const envelope = signedCatalogBundleSchema.parse(value) as SignedCatalogBundle;
    const publicKey = OFFICIAL_CATALOG_CHANNEL.keyRing[envelope.keyId];
    if (!publicKey) throw new Error("unknown_catalog_signing_key");
    verifyCatalogBundle(envelope, publicKey);
  }
  else if (basename(path) === "publication-report.json") {
    const report = value as Record<string, unknown>;
    const payload = report.payload && typeof report.payload === "object" ? report.payload as Record<string, unknown> : report;
    if (payload.schemaVersion !== "qual-hardware-publication-report/1.0.0") throw new Error("invalid_publication_report");
    if (report.payload) {
      if (typeof report.keyId !== "string" || typeof report.signature !== "string") throw new Error("invalid_signed_publication_report");
      const publicKey = OFFICIAL_CATALOG_CHANNEL.keyRing[report.keyId];
      if (!publicKey || !cryptoVerify(null, Buffer.from(JSON.stringify(payload)), publicKey, Buffer.from(report.signature, "base64"))) {
        throw new Error("invalid_publication_report_signature");
      }
    }
  }
  else if (basename(path) === "collection.json") {
    const artifact = value as Partial<CollectionArtifact>;
    if (artifact.schemaVersion !== "qual-hardware-catalog-collection/1.0.0" || !Array.isArray(artifact.results)) throw new Error("invalid_collection_artifact");
  } else throw new Error("unsupported_validation_file");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "due") {
    process.stdout.write(isPublicationDue(argument("last", "") || null, new Date(argument("now", new Date().toISOString()))) ? "true\n" : "false\n");
  } else if (command === "collect") await collect(argument("output"));
  else if (command === "qwen") await runQwen(argument("collection"), argument("output"));
  else if (command === "build") await build(argument("collection"), argument("qwen"), argument("output"));
  else if (command === "sign") await signOutput(argument("payload"), argument("output"));
  else if (command === "validate") await validateFile(argument("file"));
  else throw new Error("catalog_publisher_command_required");
}

await main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
