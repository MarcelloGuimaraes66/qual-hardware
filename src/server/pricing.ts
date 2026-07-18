import { randomUUID } from "node:crypto";
import type { Currency, Market, PriceQuote } from "../shared/types.js";

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

async function robotsAllows(url: URL): Promise<boolean> {
  const robotsUrl = new URL("/robots.txt", url.origin);
  const response = await fetch(robotsUrl, { headers: { "user-agent": process.env.PRICE_COLLECTION_USER_AGENT ?? "AiquimistQualHardware/0.1 (+internal-catalog)" } });
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
    if (!allowlist.has(url.hostname.toLowerCase())) { messages.push(`${source.name}: host_not_allowlisted`); continue; }
    if (!await robotsAllows(url)) { messages.push(`${source.name}: robots_disallowed`); continue; }
    const response = await fetch(url, { headers: { "user-agent": process.env.PRICE_COLLECTION_USER_AGENT ?? "AiquimistQualHardware/0.1 (+internal-catalog)", accept: "text/html" }, redirect: "follow" });
    if (!response.ok) { messages.push(`${source.name}: http_${response.status}`); continue; }
    const html = await response.text();
    if (/captcha|sign in to continue|access denied/i.test(html)) { messages.push(`${source.name}: access_control_detected`); continue; }
    const product = exactProduct(html, source.mpn);
    if (!product) { messages.push(`${source.name}: exact_mpn_or_price_not_found`); continue; }
    if (product.currency !== source.currency) { messages.push(`${source.name}: configured_currency_mismatch`); continue; }
    quotes.push({
      id: randomUUID(), hardwareTemplateId: source.hardwareTemplateId, mpn: source.mpn,
      seller: product.seller, market: source.market, currency: source.currency, condition: "new",
      inStock: product.inStock, taxIncluded: null, amount: product.amount,
      originalAmount: product.amount, originalCurrency: product.currency, exchangeRate: 1, exchangeRateSource: null,
      url: source.url, observedAt: new Date().toISOString(), sourceKind: "allowed_page",
    });
    messages.push(`${source.name}: collected`);
  }
  return { quotes, messages };
}
