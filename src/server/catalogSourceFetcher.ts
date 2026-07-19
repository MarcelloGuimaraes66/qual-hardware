import { createHash, randomUUID } from "node:crypto";
import type { CalibrationStage, CatalogSource, SourceFetchRun, SourceObservation } from "../shared/types.js";

const MAX_SOURCE_BYTES = 5_000_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "QualHardwareCatalogPublisher/1.0 (+https://github.com/MarcelloGuimaraes66/qual-hardware)";

export interface SourceCollectionResult {
  source: CatalogSource;
  run: SourceFetchRun;
  observations: SourceObservation[];
}

function hostnameAllowed(hostname: string, allowedHosts: string[]): boolean {
  const normalized = hostname.toLowerCase();
  return allowedHosts.some((host) => normalized === host.toLowerCase());
}

export function assertAllowedSourceUrl(candidate: string, source: CatalogSource, redirect = false): URL {
  const url = new URL(candidate);
  if (url.protocol !== "https:") throw new Error("source_requires_https");
  const hosts = redirect ? source.allowedRedirectHosts : source.allowedHosts;
  if (!hostnameAllowed(url.hostname, hosts)) throw new Error(redirect ? "source_redirect_host_rejected" : "source_host_rejected");
  if (url.username || url.password) throw new Error("source_credentials_rejected");
  return url;
}

async function readLimited(response: Response, maxBytes = MAX_SOURCE_BYTES): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error("source_response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("source_response_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

async function fetchAllowed(url: URL, source: CatalogSource, fetchImpl: typeof fetch): Promise<Response> {
  let current = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchImpl(current, {
      redirect: "manual", signal: AbortSignal.timeout(20_000),
      headers: { accept: "application/json, application/ld+json, text/csv, text/html, application/pdf;q=0.8", "user-agent": USER_AGENT },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirects === MAX_REDIRECTS) throw new Error("source_redirect_limit");
    const location = response.headers.get("location");
    if (!location) throw new Error("source_redirect_without_location");
    current = assertAllowedSourceUrl(new URL(location, current).toString(), source, true);
  }
  throw new Error("source_redirect_limit");
}

export function robotsAllows(robotsText: string, pathname: string): boolean {
  let applies = false;
  const disallowed: string[] = [];
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0]?.trim() ?? "";
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") applies = value === "*" || value.toLowerCase().includes("qualhardwarecatalogpublisher");
    if (applies && key === "disallow" && value) disallowed.push(value);
  }
  return !disallowed.some((rule) => rule === "/" || pathname.startsWith(rule));
}

async function enforceRobots(url: URL, source: CatalogSource, fetchImpl: typeof fetch): Promise<void> {
  if (!source.robotsRequired) return;
  const robotsUrl = assertAllowedSourceUrl(new URL("/robots.txt", url.origin).toString(), source);
  const response = await fetchAllowed(robotsUrl, source, fetchImpl);
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`robots_http_${response.status}`);
  const text = await readLimited(response, 1_000_000);
  if (!robotsAllows(text, url.pathname)) throw new Error("robots_disallowed");
}

function captchaOrLoginPage(text: string): boolean {
  const normalized = text.toLowerCase();
  return ["captcha", "verify you are human", "access denied", "sign in to continue", "faça login para continuar"].some((marker) => normalized.includes(marker));
}

function jsonLdValues(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdValues);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(jsonLdValues)];
}

function normalizedFieldName(value: string): string {
  const key = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (["sku", "product sku", "part number", "partnumber"].includes(key)) return "sku";
  if (["mpn", "manufacturer part number"].includes(key)) return "mpn";
  if (["model", "modelo"].includes(key)) return "model";
  if (["name", "product", "product name", "nome", "produto"].includes(key)) return "name";
  if (["manufacturer", "fabricante"].includes(key)) return "manufacturer";
  if (["brand", "marca"].includes(key)) return "brand";
  if (["price", "preco", "preis"].includes(key)) return "price";
  if (["currency", "moeda", "wahrung"].includes(key)) return "priceCurrency";
  if (["availability", "disponibilidade", "verfugbarkeit"].includes(key)) return "availability";
  if (["hardware template id", "hardware_template_id"].includes(key)) return "hardwareTemplateId";
  if (["cpu", "processor", "processor name", "device", "device name", "system", "system name"].includes(key)) return "device";
  if (["benchmark", "benchmark name", "test", "test name"].includes(key)) return "benchmarkName";
  if (["benchmark version", "test version", "version"].includes(key)) return "benchmarkVersion";
  if (["profile", "profile id", "workload", "workload profile"].includes(key)) return "profileId";
  if (["metric", "metric name", "result type"].includes(key)) return "metricName";
  if (["score", "result", "base rate result", "peak rate result", "throughput", "frames per second", "fps", "bandwidth"].includes(key)) return "score";
  if (["unit", "units"].includes(key)) return "unit";
  if (["sample count", "samples", "number of results", "number of benchmarks"].includes(key)) return "sampleCount";
  if (["operating system", "os"].includes(key)) return "operatingSystem";
  if (["power", "power watts", "tdp"].includes(key)) return "powerWatts";
  if (["driver", "driver version"].includes(key)) return "driverVersion";
  if (["cooling", "cooling profile"].includes(key)) return "coolingProfile";
  if (["configuration", "test configuration", "notes"].includes(key)) return "configuration";
  if (["higher is better", "higher_is_better"].includes(key)) return "higherIsBetter";
  if (["reproducible", "validated"].includes(key)) return "reproducible";
  if (key === "stage") return "stage";
  return key.replaceAll(" ", "_");
}

function stripMarkup(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}

function identifyingRecord(value: Record<string, unknown>): Record<string, unknown> | null {
  const sku = value.sku ?? value.mpn ?? value.model ?? value.device ?? value.hardwareTemplateId ?? value.productId ?? value.product_id;
  if (typeof sku !== "string" && typeof sku !== "number") return null;
  const normalized = { ...value };
  if (normalized.sku === undefined && normalized.mpn === undefined) normalized.sku = String(sku);
  return normalized;
}

function csvRows(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(field.trim()); field = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim()); field = ""; if (row.some(Boolean)) result.push(row); row = [];
    } else field += character;
  }
  if (field || row.length) { row.push(field.trim()); if (row.some(Boolean)) result.push(row); }
  return result;
}

function tabularRecords(headers: string[], rows: string[][]): Record<string, unknown>[] {
  const fields = headers.map(normalizedFieldName);
  return rows.map((row) => Object.fromEntries(fields.map((field, index) => [field, row[index] ?? ""])))
    .map(identifyingRecord).filter((item): item is Record<string, unknown> => Boolean(item));
}

function deterministicRecords(contentType: string, text: string): Array<{ record: Record<string, unknown>; locator: string }> {
  if (contentType.includes("csv")) {
    const rows = csvRows(text); const headers = rows.shift() ?? [];
    return tabularRecords(headers, rows).map((record, index) => ({ record, locator: `csv:row[${index + 2}]` }));
  }
  if (contentType.includes("html")) {
    const results: Array<{ record: Record<string, unknown>; locator: string }> = [];
    for (const [tableIndex, table] of [...text.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].entries()) {
      const rows = [...(table[1] ?? "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) =>
        [...(match[1] ?? "").matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => stripMarkup(cell[1] ?? "")));
      const headers = rows.shift() ?? [];
      for (const [rowIndex, record] of tabularRecords(headers, rows).entries()) results.push({ record, locator: `html:table[${tableIndex}].row[${rowIndex + 1}]` });
    }
    return results;
  }
  if (contentType.includes("pdf")) {
    const printable = text.replace(/[^\x20-\x7e\n\r]/g, " ");
    const results: Array<{ record: Record<string, unknown>; locator: string }> = [];
    for (const [index, match] of [...printable.matchAll(/(?:SKU|MPN|MODEL)\s*[:#-]\s*([A-Za-z0-9._/-]{3,80})(?:\s+[|;]\s*(?:NAME|PRODUCT)\s*[:#-]\s*([^\r\n|;]{2,160}))?/gi)].entries()) {
      results.push({ record: { sku: match[1]!, ...(match[2] ? { name: match[2].trim() } : {}) }, locator: `pdf:text-layer[${index}]` });
    }
    return results;
  }
  if (contentType.includes("json")) {
    const parsed = JSON.parse(text) as unknown;
    return jsonLdValues(parsed).map(identifyingRecord).filter((item): item is Record<string, unknown> => Boolean(item))
      .map((record, index) => ({ record, locator: `json:record[${index}]` }));
  }
  return [];
}

export function extractStructuredObservations(source: CatalogSource, url: string, contentType: string, text: string, retrievedAt: string): SourceObservation[] {
  const values: Record<string, unknown>[] = [];
  if (contentType.includes("json")) {
    try { values.push(...jsonLdValues(JSON.parse(text))); } catch { throw new Error("invalid_source_json"); }
  } else if (contentType.includes("html")) {
    for (const match of text.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try { values.push(...jsonLdValues(JSON.parse(match[1] ?? "null"))); } catch { /* one malformed block does not invalidate other deterministic blocks */ }
    }
  }
  const contentHash = createHash("sha256").update(text).digest("hex");
  const productRecords = values.filter((value) => {
    const type = value["@type"];
    return type === "Product" || (Array.isArray(type) && type.includes("Product"));
  }).map((record, index) => ({ record, locator: `json-ld:Product[${index}]` }));
  const deterministic = deterministicRecords(contentType, text);
  const records = [...productRecords, ...deterministic]
    .filter((item, index, all) => all.findIndex((candidate) => JSON.stringify(candidate.record) === JSON.stringify(item.record)) === index)
    .slice(0, source.maxRequestsPerRun * 100);
  return records.map(({ record, locator }, index) => ({
    id: `${source.id}:${contentHash}:${index}`,
    sourceId: source.id,
    retrievedAt,
    url,
    contentType,
    contentHash,
    evidenceLocator: locator,
    payload: record,
  }));
}

function sitemapDiscoveryUrls(text: string, source: CatalogSource, baseUrl: string): URL[] {
  const urls = new Map<string, URL>();
  for (const match of text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    try {
      const url = assertAllowedSourceUrl(new URL(stripMarkup(match[1] ?? ""), baseUrl).toString(), source);
      urls.set(url.toString(), url);
    } catch { /* an out-of-scope sitemap URL is never followed */ }
    if (urls.size >= Math.max(0, source.maxRequestsPerRun - 1)) break;
  }
  return [...urls.values()];
}

const CALIBRATION_STAGES = new Set<CalibrationStage>([
  "rtsp_ingest", "video_decode", "bgr_processing", "video_encode", "disk_write", "disk_read",
  "frame_extraction", "local_inference", "memory_bandwidth", "network_ingest", "job_scheduler",
  "intelligence_scheduler", "database_persistence", "dashboard_queries", "thermal_sustain",
]);

function numericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s/g, "").replace(/,(?=\d{3}(?:\D|$))/g, "").replace(/[^0-9.+-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  if (/^(true|yes|sim|1)$/i.test(value.trim())) return true;
  if (/^(false|no|nao|não|0)$/i.test(value.trim())) return false;
  return fallback;
}

function benchmarkStage(source: CatalogSource, record: Record<string, unknown>): CalibrationStage | null {
  const explicit = typeof record.stage === "string" ? record.stage.trim() as CalibrationStage : null;
  if (explicit && CALIBRATION_STAGES.has(explicit)) return explicit;
  const name = `${String(record.benchmarkName ?? "")} ${String(record.profileId ?? "")} ${String(record.metricName ?? "")} ${source.id}`.toLowerCase();
  if (source.id === "benchmark-spec") return "job_scheduler";
  if (source.id === "benchmark-mlcommons") return "local_inference";
  if (/stream|memory bandwidth|ram bandwidth/.test(name)) return "memory_bandwidth";
  if (/fio|disk|storage|nvme/.test(name)) return /read/.test(name) ? "disk_read" : "disk_write";
  if (/opencv|bgr|pixel/.test(name)) return "bgr_processing";
  if (/ffmpeg|video/.test(name)) return /encod/.test(name) ? "video_encode" : "video_decode";
  return null;
}

function extractBenchmarkObservation(source: CatalogSource, url: string, contentType: string, text: string, retrievedAt: string): SourceObservation[] {
  if (source.id === "benchmark-blender" && contentType.includes("html") && url.includes("/devices/")) {
  const device = /<title>([^<]+?)\s+-\s+Blender Open Data<\/title>/i.exec(text)?.[1]?.trim();
  const sampleCount = Number(/Number of Benchmarks<\/dt>\s*<dd>(\d+)<\/dd>/i.exec(text)?.[1] ?? "0");
  const score = Number(/<h2>Median Score<\/h2>\s*<h1[^>]*title="([0-9.]+)"/i.exec(text)?.[1] ?? "0");
  if (!device || !Number.isFinite(score) || score <= 0 || !Number.isInteger(sampleCount) || sampleCount <= 0) return [];
  const contentHash = createHash("sha256").update(text).digest("hex");
  return [{
    id: `${source.id}:${contentHash}:device-median`, sourceId: source.id, retrievedAt, url, contentType, contentHash,
    evidenceLocator: "device-summary:Median Score+Number of Benchmarks",
    payload: { kind: "public_benchmark", benchmarkName: "Blender Open Data", benchmarkVersion: "current-device-median", device, stage: "local_inference", profileId: "blender-opendata-device-median-v1", metricName: "median_score", score, unit: "blender_score", sampleCount, higherIsBetter: true, reproducible: false },
  }];
  }
  if (source.category !== "benchmark") return [];
  const contentHash = createHash("sha256").update(text).digest("hex");
  const observations: SourceObservation[] = [];
  for (const [index, item] of deterministicRecords(contentType, text).entries()) {
    const record = item.record;
    const score = numericValue(record.score);
    const device = [record.device, record.model, record.sku].find((value) => typeof value === "string" && value.trim());
    const stage = benchmarkStage(source, record);
    if (score === null || score <= 0 || typeof device !== "string" || !stage) continue;
    const benchmarkName = typeof record.benchmarkName === "string" && record.benchmarkName.trim()
      ? record.benchmarkName.trim() : source.organization;
    const benchmarkVersion = typeof record.benchmarkVersion === "string" && record.benchmarkVersion.trim()
      ? record.benchmarkVersion.trim() : "source-current";
    const metricName = typeof record.metricName === "string" && record.metricName.trim()
      ? record.metricName.trim() : "score";
    observations.push({
      id: `${source.id}:${contentHash}:benchmark-${index}`,
      sourceId: source.id,
      retrievedAt,
      url,
      contentType,
      contentHash,
      evidenceLocator: item.locator,
      payload: {
        kind: "public_benchmark",
        hardwareTemplateId: record.hardwareTemplateId,
        benchmarkName,
        benchmarkVersion,
        device,
        stage,
        profileId: typeof record.profileId === "string" && record.profileId.trim() ? record.profileId.trim() : `${source.id}-${stage}`,
        metricName,
        score,
        unit: typeof record.unit === "string" && record.unit.trim() ? record.unit.trim() : "score",
        sampleCount: Math.max(1, Math.trunc(numericValue(record.sampleCount) ?? 1)),
        higherIsBetter: booleanValue(record.higherIsBetter, !/latency|time/.test(metricName.toLowerCase())),
        operatingSystem: record.operatingSystem,
        powerWatts: numericValue(record.powerWatts),
        driverVersion: record.driverVersion,
        coolingProfile: record.coolingProfile,
        configuration: record.configuration,
        reproducible: booleanValue(record.reproducible, false),
      },
    });
  }
  return observations;
}

function discoveredProductUrls(observations: SourceObservation[], source: CatalogSource): URL[] {
  const urls = new Map<string, URL>();
  for (const observation of observations) {
    const offers = Array.isArray(observation.payload.offers) ? observation.payload.offers : [observation.payload.offers];
    for (const offer of offers) {
      if (!offer || typeof offer !== "object") continue;
      const value = (offer as Record<string, unknown>).url;
      if (typeof value !== "string") continue;
      try {
        const url = assertAllowedSourceUrl(new URL(value, observation.url).toString(), source);
        urls.set(url.toString(), url);
      } catch { /* a discovered URL outside the registered host is intentionally ignored */ }
    }
  }
  return [...urls.values()].slice(0, Math.min(20, source.maxRequestsPerRun - 1));
}

export async function collectCatalogSource(source: CatalogSource, fetchImpl: typeof fetch = fetch): Promise<SourceCollectionResult> {
  const startedAt = new Date().toISOString();
  const run: SourceFetchRun = {
    id: randomUUID(), sourceId: source.id, startedAt, completedAt: null, status: "failed", httpStatus: null,
    observationCount: 0, rejectedCount: 0, message: "Coleta iniciada.", error: null,
  };
  if (source.state === "disabled" || source.state === "unavailable") {
    run.status = "skipped"; run.completedAt = new Date().toISOString(); run.message = `Fonte ${source.state}; nenhuma proteção foi contornada.`;
    return { source, run, observations: [] };
  }
  try {
    const url = assertAllowedSourceUrl(source.primaryUrl, source);
    await enforceRobots(url, source, fetchImpl);
    const response = await fetchAllowed(url, source, fetchImpl);
    run.httpStatus = response.status;
    if (response.status === 401 || response.status === 403) throw new Error("source_requires_interactive_access");
    if (response.status === 429) throw new Error("source_rate_limited");
    if (!response.ok) throw new Error(`source_http_${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const allowedType = ["json", "html", "csv", "pdf", "xml"].some((type) => contentType.includes(type));
    if (!allowedType) throw new Error("source_content_type_rejected");
    const text = await readLimited(response);
    if (captchaOrLoginPage(text)) throw new Error("source_interactive_protection_detected");
    const retrievedAt = new Date().toISOString();
    const observations = [
      ...extractStructuredObservations(source, response.url || url.toString(), contentType, text, retrievedAt),
      ...extractBenchmarkObservation(source, response.url || url.toString(), contentType, text, retrievedAt),
    ];
    const discoveryValues = [...new Set([
      ...source.discoveryUrls,
      ...(source.parser === "sitemap" ? sitemapDiscoveryUrls(text, source, response.url || url.toString()).map((item) => item.toString()) : []),
    ])].slice(0, Math.max(0, source.maxRequestsPerRun - 1));
    for (const discoveryValue of discoveryValues) {
      try {
        const discoveryUrl = assertAllowedSourceUrl(discoveryValue, source);
        await enforceRobots(discoveryUrl, source, fetchImpl);
        if (source.minimumIntervalMs > 0) await new Promise((resolve) => setTimeout(resolve, source.minimumIntervalMs));
        const discoveryResponse = await fetchAllowed(discoveryUrl, source, fetchImpl);
        if (!discoveryResponse.ok) { run.rejectedCount += 1; continue; }
        const discoveryType = (discoveryResponse.headers.get("content-type") ?? "").toLowerCase();
        const discoveryText = await readLimited(discoveryResponse);
        const discoveryAt = new Date().toISOString();
        observations.push(...extractStructuredObservations(source, discoveryResponse.url || discoveryUrl.toString(), discoveryType, discoveryText, discoveryAt));
        observations.push(...extractBenchmarkObservation(source, discoveryResponse.url || discoveryUrl.toString(), discoveryType, discoveryText, discoveryAt));
      } catch { run.rejectedCount += 1; }
    }
    if (source.category === "price") {
      for (const productUrl of discoveredProductUrls(observations, source)) {
        try {
          if (source.minimumIntervalMs > 0) await new Promise((resolve) => setTimeout(resolve, source.minimumIntervalMs));
          const productResponse = await fetchAllowed(productUrl, source, fetchImpl);
          if (!productResponse.ok) { run.rejectedCount += 1; continue; }
          const productContentType = (productResponse.headers.get("content-type") ?? "").toLowerCase();
          if (!productContentType.includes("html") && !productContentType.includes("json")) { run.rejectedCount += 1; continue; }
          const productText = await readLimited(productResponse);
          if (captchaOrLoginPage(productText)) { run.rejectedCount += 1; continue; }
          observations.push(...extractStructuredObservations(source, productResponse.url || productUrl.toString(), productContentType, productText, new Date().toISOString()));
        } catch { run.rejectedCount += 1; }
      }
    }
    const uniqueObservations = [...new Map(observations.map((observation) => [observation.id, observation])).values()];
    run.status = "collected"; run.completedAt = new Date().toISOString(); run.observationCount = observations.length;
    run.message = `${uniqueObservations.length} observação(ões) estruturada(s) coletada(s); ${run.rejectedCount} descoberta(s) rejeitada(s).`;
    run.observationCount = uniqueObservations.length;
    return { source, run, observations: uniqueObservations };
  } catch (error) {
    run.completedAt = new Date().toISOString(); run.error = error instanceof Error ? error.message : "source_collection_failed";
    run.message = `Fonte rejeitada com segurança: ${run.error}.`;
    return { source, run, observations: [] };
  }
}
