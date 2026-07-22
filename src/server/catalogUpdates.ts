import { createPublicKey, randomUUID, verify } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { HARDWARE_CATALOG, HARDWARE_CATALOG_GENERATED_AT, HARDWARE_CATALOG_VERSION, SEED_PRICE_QUOTES } from "../engine/catalog.js";
import type { CatalogPublication, CatalogStatus, CatalogUpdateRun, HardwareNodeTemplate, PriceQuote } from "../shared/types.js";
import type { EvidenceCatalogSnapshot } from "../shared/types.js";
import { evidenceCatalogSnapshotSchema } from "../shared/schemas.js";
import { OFFICIAL_CATALOG_CHANNEL } from "../shared/catalogChannel.js";
import { BUNDLED_SOURCE_REGISTRY } from "../engine/sourceRegistry.js";
import { sourceHealth } from "./catalogPublication.js";
import { OfficialCatalogChannel, type OfficialCatalogChannelOptions } from "./officialCatalogChannel.js";
import type { PlannerStore } from "./store.js";

const MAX_SNAPSHOT_BYTES = 10_000_000;
const STALE_PRICE_MILLISECONDS = 18 * 24 * 60 * 60 * 1_000;

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
  officialEnabled?: boolean | undefined;
  officialChannel?: OfficialCatalogChannelOptions | undefined;
  allowLegacyConfiguration?: boolean | undefined;
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
  private readonly officialEnabled: boolean;
  private readonly officialChannel: OfficialCatalogChannel;
  private readonly allowLegacyConfiguration: boolean;
  private refreshPromise: Promise<CatalogStatus> | null = null;

  constructor(private readonly store: PlannerStore, options: CatalogUpdateOptions = {}) {
    this.remoteUrl = validatedRemoteUrl(options.remoteUrl ?? process.env.QUAL_HARDWARE_CATALOG_URL);
    this.publicKeyPem = validatedPublicKey(
      options.publicKeyPem ?? process.env.QUAL_HARDWARE_CATALOG_PUBLIC_KEY?.replaceAll("\\n", "\n"),
    );
    this.cacheFile = options.cacheFile ?? process.env.QUAL_HARDWARE_CATALOG_CACHE;
    this.configFile = options.configFile ?? process.env.QUAL_HARDWARE_CATALOG_CONFIG;
    this.officialEnabled = options.officialEnabled ?? false;
    this.officialChannel = new OfficialCatalogChannel(options.officialChannel);
    this.allowLegacyConfiguration = options.allowLegacyConfiguration ?? true;
    if (this.officialEnabled && !this.publicKeyPem) this.publicKeyPem = Object.values(OFFICIAL_CATALOG_CHANNEL.keyRing)[0];
    const bundledHealth = sourceHealth(BUNDLED_SOURCE_REGISTRY.sources);
    this.currentStatus = {
      catalogVersion: HARDWARE_CATALOG_VERSION,
      generatedAt: HARDWARE_CATALOG_GENERATED_AT,
      checkedAt: new Date().toISOString(),
      source: "bundled",
      hardwareCount: HARDWARE_CATALOG.length,
      quoteCount: SEED_PRICE_QUOTES.length,
      stalePriceCount: SEED_PRICE_QUOTES.filter(quoteIsStale).length,
      remoteUpdateConfigured: this.officialEnabled || Boolean(this.remoteUrl && this.publicKeyPem),
      verificationKeyConfigured: this.officialEnabled || Boolean(this.publicKeyPem),
      configurationWritable: Boolean(this.configFile && this.allowLegacyConfiguration),
      remoteUrl: this.officialEnabled ? this.officialChannel.releasesUrl : this.remoteUrl ?? null,
      lastError: null,
      lastUpdate: null,
      channel: this.officialEnabled ? "official_public" : (this.remoteUrl ? "legacy_admin" : "bundled"),
      automatic: this.officialEnabled,
      latestSequence: null,
      lastPublicationAt: null,
      nextCollectionExpectedAt: null,
      publicationDelayDays: 0,
      markets: ["BR", "US", "DE"],
      componentCount: 0,
      benchmarkCount: 0,
      sourceHealth: bundledHealth,
      latestSummary: null,
    };
  }

  get status(): CatalogStatus { return { ...this.currentStatus }; }
  get refreshing(): boolean { return this.refreshPromise !== null; }

  async initialize(): Promise<CatalogStatus> {
    const activePublication = await this.store.getActiveCatalogPublication();
    if (activePublication) await this.updateFromPublication(activePublication, "cached");
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
    if (this.officialEnabled) {
      try { await this.refresh(); } catch { this.currentStatus.lastError = "official_catalog_refresh_failed"; }
    } else if (this.currentStatus.remoteUpdateConfigured) {
      try { await this.refresh(); } catch { this.currentStatus.lastError = "remote_catalog_refresh_failed"; }
    }
    return this.status;
  }

  async refresh(): Promise<CatalogStatus> {
    if (this.refreshPromise) return this.refreshPromise;
    const operation = (this.officialEnabled ? this.refreshOfficial() : this.refreshConfigured())
      .finally(() => {
        if (this.refreshPromise === operation) this.refreshPromise = null;
      });
    this.refreshPromise = operation;
    return operation;
  }

  private async refreshConfigured(): Promise<CatalogStatus> {
    if (!this.remoteUrl || !this.publicKeyPem) throw new Error("catalog_update_not_configured");
    const run = await this.beginRun("inventory_prices", "remote", "Verificando atualização assinada de equipamentos e preços.");
    try {
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
      if (Date.parse(snapshot.payload.generatedAt) < Date.parse(this.currentStatus.generatedAt)) throw new Error("catalog_snapshot_rollback_rejected");
      await this.apply(snapshot.payload, "remote", run);
      await this.writeCache(raw);
      return this.status;
    } catch (error) {
      await this.failRun(run, error);
      throw error;
    }
  }

  async configure(configuration: CatalogUpdateConfiguration): Promise<CatalogStatus> {
    if (!this.configFile || !this.allowLegacyConfiguration) throw new Error("catalog_configuration_read_only");
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
    const run = await this.beginRun("inventory_prices", "imported", "Validando o arquivo local assinado antes de alterar o catálogo ativo.");
    try {
      if (this.officialEnabled) {
        const publication = await this.officialChannel.importRaw(this.store, raw);
        run.toVersion = publication.catalogVersion;
        run.added = publication.summary.added; run.updated = publication.summary.updated;
        run.unchanged = publication.summary.unchanged; run.rejected = publication.summary.rejected;
        run.status = "applied"; run.completedAt = new Date().toISOString();
        run.message = `Publicação oficial ${publication.publicationId} importada como recuperação avançada.`;
        await this.store.saveCatalogUpdateRun(run);
        await this.updateFromPublication(publication, "imported");
        this.currentStatus.lastUpdate = run;
        return this.status;
      }
      const snapshot = parseSnapshot(raw);
      verifySnapshot(snapshot, this.publicKeyPem);
      if (Date.parse(snapshot.payload.generatedAt) < Date.parse(this.currentStatus.generatedAt)) throw new Error("catalog_snapshot_rollback_rejected");
      await this.apply(snapshot.payload, "imported", run);
      await this.writeCache(raw);
      return this.status;
    } catch (error) {
      await this.failRun(run, error);
      throw error;
    }
  }

  async importSignedEvidenceSnapshot(raw: string): Promise<EvidenceCatalogSnapshot> {
    if (!this.publicKeyPem) throw new Error("catalog_verification_key_not_configured");
    const run = await this.beginRun("evidence", "imported", "Validando componentes, benchmarks e proveniência do snapshot público.");
    try {
      if (Buffer.byteLength(raw, "utf8") > MAX_SNAPSHOT_BYTES) throw new Error("evidence_snapshot_too_large");
      const envelope = JSON.parse(raw) as unknown;
      if (!isRecord(envelope) || !isRecord(envelope.payload) || typeof envelope.signature !== "string") {
        throw new Error("invalid_evidence_envelope");
      }
      const payload = evidenceCatalogSnapshotSchema.parse(envelope.payload) as EvidenceCatalogSnapshot;
      const signature = Buffer.from(envelope.signature, "base64");
      if (!signature.length || !verify(null, Buffer.from(JSON.stringify(payload), "utf8"), this.publicKeyPem, signature)) {
        throw new Error("invalid_evidence_signature");
      }
      const activeSnapshot = await this.store.getActiveEvidenceSnapshot();
      if (activeSnapshot && Date.parse(payload.generatedAt) < Date.parse(activeSnapshot.generatedAt)) {
        throw new Error("evidence_snapshot_rollback_rejected");
      }
      const before = await this.store.listBenchmarkObservations();
      const beforeById = new Map(before.map((item) => [item.id, JSON.stringify(item)]));
      const afterItems = payload.observations;
      run.toVersion = payload.catalogVersion;
      run.added = afterItems.filter((item) => !beforeById.has(item.id)).length + (payload.components?.length ?? 0);
      run.updated = afterItems.filter((item) => beforeById.has(item.id) && beforeById.get(item.id) !== JSON.stringify(item)).length;
      run.unchanged = afterItems.filter((item) => beforeById.get(item.id) === JSON.stringify(item)).length;
      await this.store.saveEvidenceSnapshot(payload);
      run.status = "applied";
      run.completedAt = new Date().toISOString();
      run.message = `Base pública ${payload.catalogVersion} ativada: ${run.added} novo(s), ${run.updated} atualizado(s), ${run.unchanged} inalterado(s).`;
      await this.store.saveCatalogUpdateRun(run);
      this.currentStatus.lastUpdate = run;
      return payload;
    } catch (error) {
      await this.failRun(run, error);
      throw error;
    }
  }

  private async beginRun(updateType: CatalogUpdateRun["updateType"], source: CatalogUpdateRun["source"], message: string): Promise<CatalogUpdateRun> {
    const run: CatalogUpdateRun = {
      id: randomUUID(), updateType, status: "checking", startedAt: new Date().toISOString(), completedAt: null,
      source, fromVersion: updateType === "inventory_prices" ? this.currentStatus.catalogVersion : null,
      toVersion: null, added: 0, updated: 0, unchanged: 0, rejected: 0, message, error: null,
    };
    await this.store.saveCatalogUpdateRun(run);
    this.currentStatus.lastUpdate = run;
    return run;
  }

  private async failRun(run: CatalogUpdateRun, error: unknown): Promise<void> {
    run.status = "failed";
    run.completedAt = new Date().toISOString();
    run.error = error instanceof Error ? error.message : "catalog_update_failed";
    run.message = `Atualização rejeitada: ${run.error}. O snapshot anterior continua ativo.`;
    await this.store.saveCatalogUpdateRun(run);
    this.currentStatus.lastUpdate = run;
    this.currentStatus.lastError = run.error;
  }

  private updateConfigurationStatus(): void {
    this.currentStatus.remoteUpdateConfigured = this.officialEnabled || Boolean(this.remoteUrl && this.publicKeyPem);
    this.currentStatus.verificationKeyConfigured = this.officialEnabled || Boolean(this.publicKeyPem);
    this.currentStatus.configurationWritable = Boolean(this.configFile && this.allowLegacyConfiguration);
    this.currentStatus.remoteUrl = this.officialEnabled ? this.officialChannel.releasesUrl : this.remoteUrl ?? null;
    this.currentStatus.checkedAt = new Date().toISOString();
  }

  private async writeCache(raw: string): Promise<void> {
    if (!this.cacheFile) return;
    await mkdir(dirname(this.cacheFile), { recursive: true });
    const temporary = `${this.cacheFile}.next`;
    await writeFile(temporary, raw, "utf8");
    await rename(temporary, this.cacheFile);
  }

  private async refreshOfficial(): Promise<CatalogStatus> {
    const run = await this.beginRun("inventory_prices", "remote", "Consultando o canal público oficial e verificando a cadeia Ed25519.");
    try {
      const result = await this.officialChannel.refresh(this.store);
      run.status = result.applied ? "applied" : "verified";
      run.completedAt = new Date().toISOString();
      if (result.publication) {
        run.toVersion = result.publication.catalogVersion;
        run.added = result.publication.summary.added;
        run.updated = result.publication.summary.updated;
        run.unchanged = result.publication.summary.unchanged;
        run.rejected = result.publication.summary.rejected;
        run.message = result.applied
          ? `Publicação ${result.publication.publicationId} validada e ativada atomicamente.`
          : `Canal oficial verificado; ${result.publication.publicationId} continua sendo a publicação mais recente.`;
        await this.updateFromPublication(result.publication, result.applied ? "remote" : this.currentStatus.source);
      } else {
        run.message = "Canal oficial verificado; ainda não existe publicação assinada. O catálogo embarcado continua ativo.";
      }
      await this.store.saveCatalogUpdateRun(run);
      this.currentStatus.lastUpdate = run;
      this.currentStatus.checkedAt = new Date().toISOString();
      this.currentStatus.lastError = null;
      return this.status;
    } catch (error) {
      await this.failRun(run, error);
      throw error;
    }
  }

  private async updateFromPublication(publication: CatalogPublication, source: CatalogStatus["source"]): Promise<void> {
    const hardware = await this.store.getCatalog();
    const quotes = await this.store.getQuotes();
    const components = await this.store.listHardwareComponents();
    const benchmarks = await this.store.listBenchmarkObservations();
    const sources = await this.store.listCatalogSources();
    const nextCollection = new Date(Date.parse(publication.publishedAt) + 15 * 24 * 60 * 60 * 1_000);
    const delayDays = Math.max(0, (Date.now() - nextCollection.getTime()) / (24 * 60 * 60 * 1_000));
    this.currentStatus = {
      ...this.currentStatus,
      catalogVersion: publication.catalogVersion, generatedAt: publication.publishedAt,
      checkedAt: new Date().toISOString(), source, hardwareCount: hardware.length, quoteCount: quotes.length,
      stalePriceCount: quotes.filter(quoteIsStale).length, remoteUpdateConfigured: true,
      verificationKeyConfigured: true, configurationWritable: Boolean(this.configFile && this.allowLegacyConfiguration),
      remoteUrl: this.officialChannel.releasesUrl, lastError: null, channel: "official_public", automatic: true,
      latestSequence: publication.sequence, lastPublicationAt: publication.publishedAt,
      nextCollectionExpectedAt: nextCollection.toISOString(), publicationDelayDays: Math.round(delayDays * 10) / 10,
      markets: ["BR", "US", "DE"], componentCount: components.length, benchmarkCount: benchmarks.length,
      sourceHealth: sources.length ? sourceHealth(sources) : publication.sourceHealth, latestSummary: publication.summary,
    };
  }

  private async apply(payload: CatalogPayload, source: "cached" | "remote" | "imported", run?: CatalogUpdateRun): Promise<void> {
    const beforeHardware = await this.store.getCatalog();
    const beforeQuotes = await this.store.getQuotes();
    const before = new Map([
      ...beforeHardware.map((item) => [`hardware:${item.id}`, JSON.stringify(item)] as const),
      ...beforeQuotes.map((item) => [`quote:${item.id}`, JSON.stringify(item)] as const),
    ]);
    const after = [
      ...payload.hardware.map((item) => [`hardware:${item.id}`, JSON.stringify(item)] as const),
      ...payload.quotes.map((item) => [`quote:${item.id}`, JSON.stringify(item)] as const),
    ];
    await this.store.replaceCatalog(payload.hardware, payload.quotes);
    if (run) {
      run.toVersion = payload.catalogVersion;
      run.added = after.filter(([id]) => !before.has(id)).length;
      run.updated = after.filter(([id, value]) => before.has(id) && before.get(id) !== value).length;
      run.unchanged = after.filter(([id, value]) => before.get(id) === value).length;
      run.status = "applied";
      run.completedAt = new Date().toISOString();
      run.message = `Catálogo ${payload.catalogVersion} ativado: ${run.added} novo(s), ${run.updated} atualizado(s), ${run.unchanged} inalterado(s); ${payload.quotes.filter(quoteIsStale).length} preço(s) vencido(s) não sustentam compra.`;
      await this.store.saveCatalogUpdateRun(run);
    }
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
      lastUpdate: run ?? this.currentStatus.lastUpdate ?? null,
      channel: this.officialEnabled ? "official_public" : (this.remoteUrl ? "legacy_admin" : "bundled"),
      automatic: this.officialEnabled,
      latestSequence: this.currentStatus.latestSequence,
      lastPublicationAt: this.currentStatus.lastPublicationAt,
      nextCollectionExpectedAt: this.currentStatus.nextCollectionExpectedAt,
      publicationDelayDays: this.currentStatus.publicationDelayDays,
      markets: this.currentStatus.markets,
      componentCount: this.currentStatus.componentCount,
      benchmarkCount: this.currentStatus.benchmarkCount,
      sourceHealth: this.currentStatus.sourceHealth,
      latestSummary: this.currentStatus.latestSummary,
    };
  }
}
