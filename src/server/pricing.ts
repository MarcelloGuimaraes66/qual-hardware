import { createHash } from "node:crypto";
import type { Currency, Market, PriceQuote } from "../shared/types.js";
import { getFxRate } from "./fx.js";

export interface PriceSourceConfig {
  name: string;
  url: string;
  market: Market;
  currency: Currency;
  hardwareTemplateId: string;
  mpn: string;
}

function allowedHosts(): Set<string> {
  return new Set((process.env.PRICE_ALLOWLIST ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
}

function configuredSources(): PriceSourceConfig[] {
  if (!process.env.PRICE_SOURCES_JSON) return [];
  const parsed = JSON.parse(process.env.PRICE_SOURCES_JSON) as unknown;
  if (!Array.isArray(parsed)) throw new Error("PRICE_SOURCES_JSON must be an array");
  return parsed as PriceSourceConfig[];
}

function assertAllowedPriceUrl(url: URL, allowlist: Set<string>): void {
  if (url.protocol !== "https:" || !allowlist.has(url.hostname.toLowerCase())) {
    throw new Error("price_redirect_not_allowlisted");
  }
}

async function fetchAllowlisted(url: URL, allowlist: Set<string>, headers: Record<string, string>): Promise<Response> {
  let current = new URL(url);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    assertAllowedPriceUrl(current, allowlist);
    const response = await fetch(current, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirect === 3) throw new Error("price_redirect_rejected");
    current = new URL(location, current);
  }
  throw new Error("price_redirect_rejected");
}

async function robotsAllows(url: URL, allowlist: Set<string>): Promise<boolean> {
  const robotsUrl = new URL("/robots.txt", url.origin);
  const response = await fetchAllowlisted(robotsUrl, allowlist, { "user-agent": process.env.PRICE_COLLECTION_USER_AGENT ?? "AiquimistQualHardware/0.1 (+internal-catalog)" });
  if (response.status === 404) return true;
  if (!response.ok) return false;
  let applies = false;
  for (const raw of (await response.text()).split(/\r?\n/)) {
    const line = raw.split("#", 1)[0]?.trim() ?? "";
    const [field, ...valueParts] = line.split(":");
    const value = valueParts.join(":").trim();
    if (field?.trim().toLowerCase() === "user-agent") applies = value === "*";
    if (applies && field?.trim().toLowerCase() === "disallow" && value && url.pathname.startsWith(value)) return false;
  }
  return true;
}

function deterministicQuoteId(source: PriceSourceConfig): string {
  return createHash("sha256")
    .update([source.hardwareTemplateId, source.market, source.currency, source.mpn.toLowerCase(), source.url].join("\u0000"))
    .digest("hex");
}

function objects(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(objects)];
}

function exactProduct(html: string, mpn: string): { amount: number; currency: Currency; inStock: boolean; seller: string } | null {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1] ?? "null") as unknown;
      for (const item of objects(parsed)) {
        const identifiers = [item.mpn, item.sku, item.productID].map(String);
        if (!identifiers.some((value) => value.toLowerCase() === mpn.toLowerCase())) continue;
        const offer = objects(item.offers)[0];
        const amount = Number(offer?.price ?? offer?.lowPrice);
        const currency = String(offer?.priceCurrency ?? "") as Currency;
        if (!Number.isFinite(amount) || amount <= 0 || !["BRL", "USD", "EUR"].includes(currency)) continue;
        const availability = String(offer?.availability ?? "").toLowerCase();
        return { amount, currency, inStock: availability.includes("instock"), seller: String(objects(offer?.seller)[0]?.name ?? "Published seller") };
      }
    } catch { /* malformed third-party JSON-LD is skipped */ }
  }
  return null;
}

export async function collectConfiguredPriceSources(): Promise<{ quotes: PriceQuote[]; messages: string[] }> {
  const quotes: PriceQuote[] = [];
  const messages: string[] = [];
  const allowlist = allowedHosts();
  for (const source of configuredSources()) {
    const url = new URL(source.url);
    try { assertAllowedPriceUrl(url, allowlist); } catch { messages.push(`${source.name}: host_not_allowlisted`); continue; }
    if (!await robotsAllows(url, allowlist)) { messages.push(`${source.name}: robots_disallowed`); continue; }
    let response: Response;
    try {
      response = await fetchAllowlisted(url, allowlist, { "user-agent": process.env.PRICE_COLLECTION_USER_AGENT ?? "AiquimistQualHardware/0.1 (+internal-catalog)", accept: "text/html" });
    } catch (error) {
      messages.push(`${source.name}: ${error instanceof Error ? error.message : "request_rejected"}`);
      continue;
    }
    if (!response.ok) { messages.push(`${source.name}: http_${response.status}`); continue; }
    const html = await response.text();
    if (/captcha|sign in to continue|access denied/i.test(html)) { messages.push(`${source.name}: access_control_detected`); continue; }
    const product = exactProduct(html, source.mpn);
    if (!product) { messages.push(`${source.name}: exact_mpn_or_price_not_found`); continue; }
    let exchangeRate = 1;
    let exchangeRateSource: string | null = null;
    if (product.currency !== source.currency) {
      try {
        const fx = await getFxRate(product.currency, source.currency);
        exchangeRate = fx.rate;
        exchangeRateSource = `${fx.sourceUrl}#${fx.observedAt}`;
      } catch (error) {
        messages.push(`${source.name}: fx_unavailable_${error instanceof Error ? error.message : "unknown"}`);
        continue;
      }
    }
    const normalizedAmount = Math.round(product.amount * exchangeRate * 100) / 100;
    quotes.push({
      id: deterministicQuoteId(source), hardwareTemplateId: source.hardwareTemplateId, mpn: source.mpn,
      seller: product.seller, market: source.market, currency: source.currency, condition: "new",
      inStock: product.inStock, taxIncluded: null, amount: normalizedAmount,
      originalAmount: product.amount, originalCurrency: product.currency, exchangeRate, exchangeRateSource,
      url: response.url || source.url, observedAt: new Date().toISOString(), sourceKind: "allowed_page",
    });
    messages.push(`${source.name}: collected`);
  }
  return { quotes, messages };
}
