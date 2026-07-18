import { verify } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { HARDWARE_CATALOG, HARDWARE_CATALOG_GENERATED_AT, HARDWARE_CATALOG_VERSION, SEED_PRICE_QUOTES } from "../engine/catalog.js";
import type { CatalogStatus, HardwareNodeTemplate, PriceQuote } from "../shared/types.js";
import type { PlannerStore } from "./store.js";

const MAX_SNAPSHOT_BYTES = 10_000_000;
const STALE_PRICE_MILLISECONDS = 72 * 60 * 60 * 1_000;

interface CatalogPayload {
  schemaVersion: "qual-hardware-catalog/1.0.0";
  catalogVersion: string;
  generatedAt: string;
  hardware: HardwareNodeTemplate[];
  quotes: PriceQuote[];
}

interface SignedCatalogSnapshot {
  payload: CatalogPayload;
  signature: string;
}

export interface CatalogUpdateOptions {
  remoteUrl?: string | undefined;
  publicKeyPem?: string | undefined;
  cacheFile?: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSnapshot(raw: string): SignedCatalogSnapshot {
  if (Buffer.byteLength(raw, "utf8") > MAX_SNAPSHOT_BYTES) throw new Error("catalog_snapshot_too_large");
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value) || !isRecord(value.payload) || typeof value.signature !== "string") throw new Error("invalid_catalog_envelope");
  const payload = value.payload;
  if (payload.schemaVersion !== "qual-hardware-catalog/1.0.0" || typeof payload.catalogVersion !== "string" ||
      typeof payload.generatedAt !== "string" || !Array.isArray(payload.hardware) || !Array.isArray(payload.quotes)) {
    throw new Error("invalid_catalog_payload");
  }
  if (!payload.hardware.length || payload.hardware.some((item) => !isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string")) {
    throw new Error("invalid_hardware_catalog");
  }
  if (payload.quotes.some((item) => !isRecord(item) || typeof item.mpn !== "string" || typeof item.observedAt !== "string")) {
    throw new Error("invalid_price_catalog");
  }
  const generatedAt = Date.parse(payload.generatedAt);
  if (!Number.isFinite(generatedAt) || generatedAt > Date.now() + 5 * 60_000) throw new Error("invalid_catalog_timestamp");
  return value as unknown as SignedCatalogSnapshot;
}

function verifySnapshot(snapshot: SignedCatalogSnapshot, publicKeyPem: string): void {
  const payload = Buffer.from(JSON.stringify(snapshot.payload), "utf8");
  const signature = Buffer.from(snapshot.signature, "base64");
  if (!signature.length || !verify(null, payload, publicKeyPem, signature)) throw new Error("invalid_catalog_signature");
}

function quoteIsStale(quote: PriceQuote): boolean {
  const observedAt = Date.parse(quote.observedAt);
  return !Number.isFinite(observedAt) || Date.now() - observedAt > STALE_PRICE_MILLISECONDS;
}

export class CatalogUpdateService {
  private currentStatus: CatalogStatus;

  constructor(private readonly store: PlannerStore, private readonly options: CatalogUpdateOptions = {}) {
    this.currentStatus = {
      catalogVersion: HARDWARE_CATALOG_VERSION,
      generatedAt: HARDWARE_CATALOG_GENERATED_AT,
      checkedAt: new Date().toISOString(),
      source: "bundled",
      hardwareCount: HARDWARE_CATALOG.length,
      quoteCount: SEED_PRICE_QUOTES.length,
      stalePriceCount: SEED_PRICE_QUOTES.filter(quoteIsStale).length,
      remoteUpdateConfigured: Boolean(options.remoteUrl && options.publicKeyPem),
      lastError: null,
    };
  }

  get status(): CatalogStatus { return { ...this.currentStatus }; }

  async initialize(): Promise<CatalogStatus> {
    if (this.options.cacheFile && this.options.publicKeyPem) {
      try {
        const cached = parseSnapshot(await readFile(this.options.cacheFile, "utf8"));
        verifySnapshot(cached, this.options.publicKeyPem);
        await this.apply(cached.payload, "cached");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.currentStatus.lastError = "cached_catalog_rejected";
      }
    }
    if (this.currentStatus.remoteUpdateConfigured) {
      try { await this.refresh(); } catch { this.currentStatus.lastError = "remote_catalog_refresh_failed"; }
    }
    return this.status;
  }

  async refresh(): Promise<CatalogStatus> {
    if (!this.options.remoteUrl || !this.options.publicKeyPem) throw new Error("catalog_update_not_configured");
    const url = new URL(this.options.remoteUrl);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    if (url.protocol !== "https:" && !loopback) throw new Error("catalog_update_requires_https");
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`catalog_update_http_${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_SNAPSHOT_BYTES) throw new Error("catalog_snapshot_too_large");
    const raw = await response.text();
    const snapshot = parseSnapshot(raw);
    verifySnapshot(snapshot, this.options.publicKeyPem);
    await this.apply(snapshot.payload, "remote");
    if (this.options.cacheFile) {
      await mkdir(dirname(this.options.cacheFile), { recursive: true });
      const temporary = `${this.options.cacheFile}.next`;
      await writeFile(temporary, raw, "utf8");
      await rename(temporary, this.options.cacheFile);
    }
    return this.status;
  }

  private async apply(payload: CatalogPayload, source: "cached" | "remote"): Promise<void> {
    await this.store.replaceCatalog(payload.hardware, payload.quotes);
    this.currentStatus = {
      catalogVersion: payload.catalogVersion,
      generatedAt: payload.generatedAt,
      checkedAt: new Date().toISOString(),
      source,
      hardwareCount: payload.hardware.length,
      quoteCount: payload.quotes.length,
      stalePriceCount: payload.quotes.filter(quoteIsStale).length,
      remoteUpdateConfigured: Boolean(this.options.remoteUrl && this.options.publicKeyPem),
      lastError: null,
    };
  }
}
