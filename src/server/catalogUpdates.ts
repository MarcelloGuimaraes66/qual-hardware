import { createPublicKey, verify } from "node:crypto";
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
  configFile?: string | undefined;
}

export interface CatalogUpdateConfiguration {
  remoteUrl: string | null;
  publicKeyPem: string;
}

interface PersistedCatalogUpdateConfiguration extends CatalogUpdateConfiguration {
  schemaVersion: "qual-hardware-catalog-config/1.0.0";
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

function validatedRemoteUrl(input: string | null | undefined): string | undefined {
  const value = input?.trim();
  if (!value) return undefined;
  if (value.length > 2_048) throw new Error("catalog_url_too_long");
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !loopback) throw new Error("catalog_update_requires_https");
  return url.toString();
}

function validatedPublicKey(input: string | null | undefined): string | undefined {
  const value = input?.trim();
  if (!value) return undefined;
  if (value.length > 16_384) throw new Error("catalog_public_key_too_long");
  try {
    const key = createPublicKey(value);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("not_ed25519");
  } catch {
    throw new Error("invalid_catalog_public_key");
  }
  return value;
}

function quoteIsStale(quote: PriceQuote): boolean {
  const observedAt = Date.parse(quote.observedAt);
  return !Number.isFinite(observedAt) || Date.now() - observedAt > STALE_PRICE_MILLISECONDS;
}

export class CatalogUpdateService {
  private currentStatus: CatalogStatus;
  private remoteUrl: string | undefined;
  private publicKeyPem: string | undefined;
  private readonly cacheFile: string | undefined;
  private readonly configFile: string | undefined;

  constructor(private readonly store: PlannerStore, options: CatalogUpdateOptions = {}) {
    this.remoteUrl = validatedRemoteUrl(options.remoteUrl ?? process.env.QUAL_HARDWARE_CATALOG_URL);
    this.publicKeyPem = validatedPublicKey(
      options.publicKeyPem ?? process.env.QUAL_HARDWARE_CATALOG_PUBLIC_KEY?.replaceAll("\\n", "\n"),
    );
    this.cacheFile = options.cacheFile ?? process.env.QUAL_HARDWARE_CATALOG_CACHE;
    this.configFile = options.configFile ?? process.env.QUAL_HARDWARE_CATALOG_CONFIG;
    this.currentStatus = {
      catalogVersion: HARDWARE_CATALOG_VERSION,
      generatedAt: HARDWARE_CATALOG_GENERATED_AT,
      checkedAt: new Date().toISOString(),
      source: "bundled",
      hardwareCount: HARDWARE_CATALOG.length,
      quoteCount: SEED_PRICE_QUOTES.length,
      stalePriceCount: SEED_PRICE_QUOTES.filter(quoteIsStale).length,
      remoteUpdateConfigured: Boolean(this.remoteUrl && this.publicKeyPem),
      verificationKeyConfigured: Boolean(this.publicKeyPem),
      configurationWritable: Boolean(this.configFile),
      remoteUrl: this.remoteUrl ?? null,
      lastError: null,
    };
  }

  get status(): CatalogStatus { return { ...this.currentStatus }; }

  async initialize(): Promise<CatalogStatus> {
    if (this.configFile) {
      try {
        const parsed = JSON.parse(await readFile(this.configFile, "utf8")) as Partial<PersistedCatalogUpdateConfiguration>;
        if (parsed.schemaVersion !== "qual-hardware-catalog-config/1.0.0") throw new Error("invalid_catalog_config");
        this.remoteUrl ??= validatedRemoteUrl(parsed.remoteUrl);
        this.publicKeyPem ??= validatedPublicKey(parsed.publicKeyPem);
        this.updateConfigurationStatus();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.currentStatus.lastError = "catalog_config_rejected";
      }
    }
    if (this.cacheFile && this.publicKeyPem) {
      try {
        const cached = parseSnapshot(await readFile(this.cacheFile, "utf8"));
        verifySnapshot(cached, this.publicKeyPem);
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
    if (!this.remoteUrl || !this.publicKeyPem) throw new Error("catalog_update_not_configured");
    const url = new URL(this.remoteUrl);
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
    verifySnapshot(snapshot, this.publicKeyPem);
    await this.apply(snapshot.payload, "remote");
    await this.writeCache(raw);
    return this.status;
  }

  async configure(configuration: CatalogUpdateConfiguration): Promise<CatalogStatus> {
    if (!this.configFile) throw new Error("catalog_configuration_read_only");
    const publicKeyPem = validatedPublicKey(configuration.publicKeyPem);
    if (!publicKeyPem) throw new Error("catalog_public_key_required");
    this.remoteUrl = validatedRemoteUrl(configuration.remoteUrl);
    this.publicKeyPem = publicKeyPem;
    if (this.configFile) {
      const persisted: PersistedCatalogUpdateConfiguration = {
        schemaVersion: "qual-hardware-catalog-config/1.0.0",
        remoteUrl: this.remoteUrl ?? null,
        publicKeyPem,
      };
      await mkdir(dirname(this.configFile), { recursive: true });
      const temporary = `${this.configFile}.next`;
      await writeFile(temporary, JSON.stringify(persisted, null, 2), "utf8");
      await rename(temporary, this.configFile);
    }
    this.updateConfigurationStatus();
    this.currentStatus.lastError = null;
    return this.status;
  }

  async importSignedSnapshot(raw: string): Promise<CatalogStatus> {
    if (!this.publicKeyPem) throw new Error("catalog_verification_key_not_configured");
    const snapshot = parseSnapshot(raw);
    verifySnapshot(snapshot, this.publicKeyPem);
    await this.apply(snapshot.payload, "imported");
    await this.writeCache(raw);
    return this.status;
  }

  private updateConfigurationStatus(): void {
    this.currentStatus.remoteUpdateConfigured = Boolean(this.remoteUrl && this.publicKeyPem);
    this.currentStatus.verificationKeyConfigured = Boolean(this.publicKeyPem);
    this.currentStatus.configurationWritable = Boolean(this.configFile);
    this.currentStatus.remoteUrl = this.remoteUrl ?? null;
    this.currentStatus.checkedAt = new Date().toISOString();
  }

  private async writeCache(raw: string): Promise<void> {
    if (!this.cacheFile) return;
    await mkdir(dirname(this.cacheFile), { recursive: true });
    const temporary = `${this.cacheFile}.next`;
    await writeFile(temporary, raw, "utf8");
    await rename(temporary, this.cacheFile);
  }

  private async apply(payload: CatalogPayload, source: "cached" | "remote" | "imported"): Promise<void> {
    await this.store.replaceCatalog(payload.hardware, payload.quotes);
    this.currentStatus = {
      catalogVersion: payload.catalogVersion,
      generatedAt: payload.generatedAt,
      checkedAt: new Date().toISOString(),
      source,
      hardwareCount: payload.hardware.length,
      quoteCount: payload.quotes.length,
      stalePriceCount: payload.quotes.filter(quoteIsStale).length,
      remoteUpdateConfigured: Boolean(this.remoteUrl && this.publicKeyPem),
      verificationKeyConfigured: Boolean(this.publicKeyPem),
      configurationWritable: Boolean(this.configFile),
      remoteUrl: this.remoteUrl ?? null,
      lastError: null,
    };
  }
}
