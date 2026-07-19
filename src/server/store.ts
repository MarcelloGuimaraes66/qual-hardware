import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HARDWARE_CATALOG, SEED_PRICE_QUOTES } from "../engine/catalog.js";
import { BUNDLED_SOURCE_REGISTRY } from "../engine/sourceRegistry.js";
import { assertDedicatedSqlitePath, QUAL_HARDWARE_SQLITE_SCHEMA_VERSION } from "./database.js";
import type {
  BenchmarkManifest,
  BenchmarkResultRecord,
  CapacityPrediction,
  CapacityRecommendation,
  CapacityScenario,
  CatalogBundle,
  CatalogPublication,
  CatalogSource,
  CatalogUpdateRun,
  EvidenceCatalogSnapshot,
  HardwareComponent,
  HardwareNodeTemplate,
  LocalCalibrationRun,
  PriceQuote,
  PublicBenchmarkObservation,
  SignedCatalogBundle,
  SourceFetchRun,
  SourceObservation,
  ScenarioRecord,
} from "../shared/types.js";

export class RevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super(`Scenario was changed by another user (current revision ${currentRevision}).`);
    this.name = "RevisionConflictError";
  }
}

export interface BenchmarkEvidence {
  manifest: BenchmarkManifest;
  result: BenchmarkResultRecord;
}

export interface ClaimedJob {
  id: number;
  jobType: string;
  payload: unknown;
}

export interface PlannerStore {
  readonly storageKind: "memory" | "sqlite";
  listScenarios(): Promise<ScenarioRecord[]>;
  getScenario(id: string): Promise<ScenarioRecord | null>;
  createScenario(scenario: CapacityScenario): Promise<ScenarioRecord>;
  updateScenario(id: string, expectedRevision: number, scenario: CapacityScenario): Promise<ScenarioRecord>;
  duplicateScenario(id: string): Promise<ScenarioRecord | null>;
  saveRecommendations(recommendations: CapacityRecommendation[]): Promise<void>;
  listRecommendations(scenarioId: string): Promise<CapacityRecommendation[]>;
  getRecommendation(id: string): Promise<CapacityRecommendation | null>;
  saveManifest(manifest: BenchmarkManifest): Promise<void>;
  getManifest(id: string): Promise<BenchmarkManifest | null>;
  saveBenchmarkResult(result: BenchmarkResultRecord): Promise<void>;
  getBenchmarkResult(manifestId: string): Promise<BenchmarkResultRecord | null>;
  listBenchmarkEvidence(scenarioId: string, revision: number): Promise<BenchmarkEvidence[]>;
  saveCalibrationRun(run: LocalCalibrationRun): Promise<void>;
  listCalibrationRuns(): Promise<LocalCalibrationRun[]>;
  upsertBenchmarkObservations(observations: PublicBenchmarkObservation[]): Promise<void>;
  listBenchmarkObservations(): Promise<PublicBenchmarkObservation[]>;
  saveEvidenceSnapshot(snapshot: EvidenceCatalogSnapshot): Promise<void>;
  getActiveEvidenceSnapshot(): Promise<EvidenceCatalogSnapshot | null>;
  listHardwareComponents(): Promise<HardwareComponent[]>;
  saveCatalogUpdateRun(run: CatalogUpdateRun): Promise<void>;
  listCatalogUpdateRuns(): Promise<CatalogUpdateRun[]>;
  saveSourceRegistry(sources: CatalogSource[]): Promise<void>;
  listCatalogSources(): Promise<CatalogSource[]>;
  saveSourceFetchRun(run: SourceFetchRun): Promise<void>;
  saveSourceObservations(observations: SourceObservation[]): Promise<void>;
  listCatalogPublications(): Promise<CatalogPublication[]>;
  getActiveCatalogPublication(): Promise<CatalogPublication | null>;
  activateCatalogBundle(envelope: SignedCatalogBundle, bundleSha256: string, etag: string | null): Promise<CatalogPublication>;
  savePredictions(predictions: CapacityPrediction[]): Promise<void>;
  listPredictions(): Promise<CapacityPrediction[]>;
  getCatalog(): Promise<HardwareNodeTemplate[]>;
  replaceCatalog(hardware: HardwareNodeTemplate[], quotes: PriceQuote[]): Promise<void>;
  getQuotes(): Promise<PriceQuote[]>;
  upsertQuotes(quotes: PriceQuote[]): Promise<void>;
  enqueue(jobType: string, payload: unknown): Promise<number>;
  claimJob(): Promise<ClaimedJob | null>;
  finishJob(id: number, error: string | null): Promise<void>;
  close(): Promise<void>;
}

function now(): string {
  return new Date().toISOString();
}

export class MemoryPlannerStore implements PlannerStore {
  readonly storageKind = "memory" as const;
  private scenarios = new Map<string, ScenarioRecord>();
  private recommendations = new Map<string, CapacityRecommendation>();
  private manifests = new Map<string, BenchmarkManifest>();
  private results = new Map<string, BenchmarkResultRecord>();
  private calibrationRuns = new Map<string, LocalCalibrationRun>();
  private observations = new Map<string, PublicBenchmarkObservation>();
  private components = new Map<string, HardwareComponent>();
  private activeObservationIds = new Set<string>();
  private activeComponentIds = new Set<string>();
  private activeEvidenceSnapshot: EvidenceCatalogSnapshot | null = null;
  private catalogUpdateRuns = new Map<string, CatalogUpdateRun>();
  private catalogSources = new Map<string, CatalogSource>(BUNDLED_SOURCE_REGISTRY.sources.map((source) => [source.id, structuredClone(source)]));
  private sourceFetchRuns = new Map<string, SourceFetchRun>();
  private sourceObservations = new Map<string, SourceObservation>();
  private publications = new Map<number, CatalogPublication>();
  private activePublication: CatalogPublication | null = null;
  private predictions = new Map<string, CapacityPrediction>();
  private quotes = [...SEED_PRICE_QUOTES];
  private hardware = [...HARDWARE_CATALOG];
  private jobs: Array<ClaimedJob & { status: "queued" | "running" | "completed" | "failed" }> = [];

  async listScenarios(): Promise<ScenarioRecord[]> {
    return [...this.scenarios.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getScenario(id: string): Promise<ScenarioRecord | null> { return this.scenarios.get(id) ?? null; }
  async createScenario(scenario: CapacityScenario): Promise<ScenarioRecord> {
    const timestamp = now();
    const record: ScenarioRecord = { id: randomUUID(), revision: 1, createdAt: timestamp, updatedAt: timestamp, scenario };
    this.scenarios.set(record.id, record);
    return record;
  }
  async updateScenario(id: string, expectedRevision: number, scenario: CapacityScenario): Promise<ScenarioRecord> {
    const current = this.scenarios.get(id);
    if (!current) throw new Error("scenario_not_found");
    if (current.revision !== expectedRevision) throw new RevisionConflictError(current.revision);
    const record: ScenarioRecord = { ...current, revision: current.revision + 1, updatedAt: now(), scenario };
    this.scenarios.set(id, record);
    return record;
  }
  async duplicateScenario(id: string): Promise<ScenarioRecord | null> {
    const source = this.scenarios.get(id);
    if (!source) return null;
    return this.createScenario({ ...source.scenario, projectName: `${source.scenario.projectName} — Copy` });
  }
  async saveRecommendations(items: CapacityRecommendation[]): Promise<void> {
    for (const item of items) this.recommendations.set(item.id, item);
  }
  async listRecommendations(scenarioId: string): Promise<CapacityRecommendation[]> {
    return [...this.recommendations.values()].filter((item) => item.scenarioId === scenarioId)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  }
  async getRecommendation(id: string): Promise<CapacityRecommendation | null> { return this.recommendations.get(id) ?? null; }
  async saveManifest(manifest: BenchmarkManifest): Promise<void> { this.manifests.set(manifest.id, manifest); }
  async getManifest(id: string): Promise<BenchmarkManifest | null> { return this.manifests.get(id) ?? null; }
  async saveBenchmarkResult(result: BenchmarkResultRecord): Promise<void> { this.results.set(result.manifestId, result); }
  async getBenchmarkResult(manifestId: string): Promise<BenchmarkResultRecord | null> { return this.results.get(manifestId) ?? null; }
  async listBenchmarkEvidence(scenarioId: string, revision: number): Promise<BenchmarkEvidence[]> {
    const evidence: BenchmarkEvidence[] = [];
    for (const manifest of this.manifests.values()) {
      const result = this.results.get(manifest.id);
      if (result && manifest.scenarioId === scenarioId && manifest.scenarioRevision === revision) evidence.push({ manifest, result });
    }
    return evidence;
  }
  async saveCalibrationRun(run: LocalCalibrationRun): Promise<void> { this.calibrationRuns.set(run.id, run); }
  async listCalibrationRuns(): Promise<LocalCalibrationRun[]> {
    return [...this.calibrationRuns.values()].sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  }
  async upsertBenchmarkObservations(observations: PublicBenchmarkObservation[]): Promise<void> {
    for (const observation of observations) {
      this.observations.set(observation.id, observation);
      this.activeObservationIds.add(observation.id);
    }
  }
  async listBenchmarkObservations(): Promise<PublicBenchmarkObservation[]> {
    return [...this.activeObservationIds].map((id) => this.observations.get(id)).filter((item): item is PublicBenchmarkObservation => Boolean(item));
  }
  async saveEvidenceSnapshot(snapshot: EvidenceCatalogSnapshot): Promise<void> {
    for (const observation of snapshot.observations) this.observations.set(observation.id, observation);
    for (const component of snapshot.components ?? []) this.components.set(component.id, component);
    this.activeObservationIds = new Set(snapshot.observations.map((item) => item.id));
    this.activeComponentIds = new Set((snapshot.components ?? []).map((item) => item.id));
    this.activeEvidenceSnapshot = structuredClone(snapshot);
  }
  async getActiveEvidenceSnapshot(): Promise<EvidenceCatalogSnapshot | null> {
    return this.activeEvidenceSnapshot ? structuredClone(this.activeEvidenceSnapshot) : null;
  }
  async listHardwareComponents(): Promise<HardwareComponent[]> {
    return [...this.activeComponentIds].map((id) => this.components.get(id)).filter((item): item is HardwareComponent => Boolean(item));
  }
  async saveCatalogUpdateRun(run: CatalogUpdateRun): Promise<void> { this.catalogUpdateRuns.set(run.id, structuredClone(run)); }
  async listCatalogUpdateRuns(): Promise<CatalogUpdateRun[]> {
    return [...this.catalogUpdateRuns.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }
  async saveSourceRegistry(sources: CatalogSource[]): Promise<void> {
    for (const source of sources) this.catalogSources.set(source.id, structuredClone(source));
  }
  async listCatalogSources(): Promise<CatalogSource[]> {
    return [...this.catalogSources.values()].map((source) => structuredClone(source)).sort((left, right) => left.id.localeCompare(right.id));
  }
  async saveSourceFetchRun(run: SourceFetchRun): Promise<void> { this.sourceFetchRuns.set(run.id, structuredClone(run)); }
  async saveSourceObservations(observations: SourceObservation[]): Promise<void> {
    for (const observation of observations) this.sourceObservations.set(observation.id, structuredClone(observation));
  }
  async listCatalogPublications(): Promise<CatalogPublication[]> {
    return [...this.publications.values()].map((publication) => structuredClone(publication)).sort((left, right) => right.sequence - left.sequence);
  }
  async getActiveCatalogPublication(): Promise<CatalogPublication | null> {
    return this.activePublication ? structuredClone(this.activePublication) : null;
  }
  async activateCatalogBundle(envelope: SignedCatalogBundle, bundleSha256: string, etag: string | null): Promise<CatalogPublication> {
    const publication = catalogPublication(envelope.payload, envelope.keyId, bundleSha256, etag);
    this.hardware = structuredClone(envelope.payload.hardware);
    this.quotes = structuredClone(envelope.payload.prices);
    this.components = new Map(envelope.payload.components.map((component) => [component.id, structuredClone(component)]));
    this.activeComponentIds = new Set(envelope.payload.components.map((component) => component.id));
    this.observations = new Map(envelope.payload.benchmarks.map((observation) => [observation.id, structuredClone(observation)]));
    this.activeObservationIds = new Set(envelope.payload.benchmarks.map((observation) => observation.id));
    this.catalogSources = new Map(envelope.payload.sources.map((source) => [source.id, structuredClone(source)]));
    this.publications.set(publication.sequence, structuredClone(publication));
    this.activePublication = structuredClone(publication);
    return publication;
  }
  async savePredictions(predictions: CapacityPrediction[]): Promise<void> {
    for (const prediction of predictions) this.predictions.set(prediction.id, prediction);
  }
  async listPredictions(): Promise<CapacityPrediction[]> {
    return [...this.predictions.values()].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  }
  async getCatalog(): Promise<HardwareNodeTemplate[]> { return this.hardware; }
  async replaceCatalog(hardware: HardwareNodeTemplate[], quotes: PriceQuote[]): Promise<void> {
    this.hardware = [...hardware];
    this.quotes = [...quotes];
  }
  async getQuotes(): Promise<PriceQuote[]> { return this.quotes; }
  async upsertQuotes(quotes: PriceQuote[]): Promise<void> {
    const incoming = new Set(quotes.map((quote) => quote.id));
    this.quotes = [...this.quotes.filter((quote) => !incoming.has(quote.id)), ...quotes];
  }
  async enqueue(jobType: string, payload: unknown): Promise<number> {
    const id = this.jobs.length + 1;
    this.jobs.push({ id, jobType, payload, status: "queued" });
    return id;
  }
  async claimJob(): Promise<ClaimedJob | null> {
    const job = this.jobs.find((item) => item.status === "queued");
    if (!job) return null;
    job.status = "running";
    return { id: job.id, jobType: job.jobType, payload: job.payload };
  }
  async finishJob(id: number, error: string | null): Promise<void> {
    const job = this.jobs.find((item) => item.id === id);
    if (job) job.status = error === null ? "completed" : "failed";
  }
  async close(): Promise<void> {}
}

function parseJson<T>(value: unknown): T {
  if (typeof value !== "string") throw new Error("invalid_sqlite_json");
  return JSON.parse(value) as T;
}

function scenarioRow(row: Record<string, unknown>): ScenarioRecord {
  return {
    id: String(row.id), revision: Number(row.revision), createdAt: String(row.created_at),
    updatedAt: String(row.updated_at), scenario: parseJson<CapacityScenario>(row.scenario_json),
  };
}

function rows(result: unknown[]): Record<string, unknown>[] {
  return result as Record<string, unknown>[];
}

function catalogPublication(bundle: CatalogBundle, keyId: string, bundleSha256: string, etag: string | null): CatalogPublication {
  return {
    sequence: bundle.sequence, publicationId: bundle.publicationId, catalogVersion: bundle.catalogVersion,
    bundleSha256, previousBundleSha256: bundle.previousBundleSha256, keyId,
    publishedAt: bundle.publishedAt, validUntil: bundle.validUntil, etag,
    sourceHealth: structuredClone(bundle.sourceHealth), summary: structuredClone(bundle.summary),
  };
}

export class SqlitePlannerStore implements PlannerStore {
  readonly storageKind = "sqlite" as const;
  private readonly database: DatabaseSync;

  constructor(databasePath: string, schemaPath?: string) {
    const dedicatedPath = assertDedicatedSqlitePath(databasePath);
    mkdirSync(dirname(dedicatedPath), { recursive: true });
    this.database = new DatabaseSync(dedicatedPath);
    this.database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");

    const currentVersion = Number((this.database.prepare("PRAGMA user_version").get() as { user_version?: number }).user_version ?? 0);
    if (currentVersion > QUAL_HARDWARE_SQLITE_SCHEMA_VERSION) {
      this.database.close();
      throw new Error(`SQLite schema version ${currentVersion} is newer than supported version ${QUAL_HARDWARE_SQLITE_SCHEMA_VERSION}.`);
    }
    const resourceRoot = process.env.QUAL_HARDWARE_RESOURCE_ROOT ?? process.cwd();
    this.database.exec(readFileSync(schemaPath ?? resolve(resourceRoot, "database", "sqlite-schema.sql"), "utf8"));
    this.seedBundledCatalog();
  }

  private inTransaction<T>(action: () => T, mode: "DEFERRED" | "IMMEDIATE" = "DEFERRED"): T {
    this.database.exec(`BEGIN ${mode}`);
    try {
      const result = action();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private seedBundledCatalog(): void {
    const officialPublicationActive = Boolean(this.database.prepare("SELECT 1 AS present FROM catalog_bundle_active_state WHERE singleton=1").get());
    const conflictHardware = officialPublicationActive
      ? "ON CONFLICT(id) DO NOTHING"
      : "ON CONFLICT(id) DO UPDATE SET template_json=excluded.template_json,updated_at=excluded.updated_at";
    const conflictQuote = officialPublicationActive
      ? "ON CONFLICT(id) DO NOTHING"
      : "ON CONFLICT(id) DO UPDATE SET hardware_template_id=excluded.hardware_template_id,quote_json=excluded.quote_json,observed_at=excluded.observed_at";
    const insertHardware = this.database.prepare(
      `INSERT INTO hardware_catalog(id,template_json,updated_at) VALUES(?,?,?) ${conflictHardware}`,
    );
    const insertQuote = this.database.prepare(
      `INSERT INTO price_quotes(id,hardware_template_id,quote_json,observed_at) VALUES(?,?,?,?) ${conflictQuote}`,
    );
    const insertSource = this.database.prepare(
      officialPublicationActive
        ? "INSERT INTO catalog_sources(id,source_json,state,last_run_at,last_success_at,consecutive_failures,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING"
        : "INSERT INTO catalog_sources(id,source_json,state,last_run_at,last_success_at,consecutive_failures,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_json=excluded.source_json,state=excluded.state,last_run_at=COALESCE(catalog_sources.last_run_at,excluded.last_run_at),last_success_at=COALESCE(catalog_sources.last_success_at,excluded.last_success_at),consecutive_failures=catalog_sources.consecutive_failures,updated_at=excluded.updated_at",
    );
    this.inTransaction(() => {
      const timestamp = now();
      for (const item of HARDWARE_CATALOG) insertHardware.run(item.id, JSON.stringify(item), timestamp);
      for (const quote of SEED_PRICE_QUOTES) {
        if (quote.hardwareTemplateId) insertQuote.run(quote.id, quote.hardwareTemplateId, JSON.stringify(quote), quote.observedAt);
      }
      for (const source of BUNDLED_SOURCE_REGISTRY.sources) {
        insertSource.run(source.id, JSON.stringify(source), source.state, source.lastRunAt, source.lastSuccessAt, source.consecutiveFailures, timestamp);
      }
      this.database.prepare("INSERT INTO catalog_snapshots(id,created_at) VALUES('bundled',?) ON CONFLICT(id) DO NOTHING").run(timestamp);
      const membership = this.database.prepare(
        "INSERT INTO catalog_snapshot_membership(snapshot_id,hardware_template_id) VALUES('bundled',?) ON CONFLICT(snapshot_id,hardware_template_id) DO NOTHING",
      );
      for (const item of HARDWARE_CATALOG) membership.run(item.id);
      const quoteMembership = this.database.prepare(
        "INSERT INTO catalog_snapshot_quote_membership(snapshot_id,quote_id) VALUES('bundled',?) ON CONFLICT(snapshot_id,quote_id) DO NOTHING",
      );
      for (const quote of SEED_PRICE_QUOTES) if (quote.hardwareTemplateId) quoteMembership.run(quote.id);
      this.database.prepare(
        officialPublicationActive
          ? "INSERT INTO catalog_active_state(singleton,snapshot_id,activated_at) VALUES(1,'bundled',?) ON CONFLICT(singleton) DO NOTHING"
          : "INSERT INTO catalog_active_state(singleton,snapshot_id,activated_at) VALUES(1,'bundled',?) ON CONFLICT(singleton) DO UPDATE SET snapshot_id=excluded.snapshot_id,activated_at=excluded.activated_at",
      ).run(timestamp);
    });
  }

  async listScenarios(): Promise<ScenarioRecord[]> {
    return rows(this.database.prepare("SELECT * FROM scenarios ORDER BY updated_at DESC").all()).map(scenarioRow);
  }
  async getScenario(id: string): Promise<ScenarioRecord | null> {
    const row = this.database.prepare("SELECT * FROM scenarios WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? scenarioRow(row) : null;
  }
  async createScenario(scenario: CapacityScenario): Promise<ScenarioRecord> {
    const id = randomUUID();
    const timestamp = now();
    this.database.prepare(
      "INSERT INTO scenarios(id,revision,scenario_json,created_at,updated_at) VALUES(?,1,?,?,?)",
    ).run(id, JSON.stringify(scenario), timestamp, timestamp);
    return { id, revision: 1, createdAt: timestamp, updatedAt: timestamp, scenario };
  }
  async updateScenario(id: string, expectedRevision: number, scenario: CapacityScenario): Promise<ScenarioRecord> {
    const timestamp = now();
    const result = this.database.prepare(
      "UPDATE scenarios SET revision=revision+1,scenario_json=?,updated_at=? WHERE id=? AND revision=?",
    ).run(JSON.stringify(scenario), timestamp, id, expectedRevision);
    if (result.changes > 0) {
      const updated = await this.getScenario(id);
      if (updated) return updated;
    }
    const current = await this.getScenario(id);
    if (!current) throw new Error("scenario_not_found");
    throw new RevisionConflictError(current.revision);
  }
  async duplicateScenario(id: string): Promise<ScenarioRecord | null> {
    const source = await this.getScenario(id);
    return source ? this.createScenario({ ...source.scenario, projectName: `${source.scenario.projectName} — Copy` }) : null;
  }
  async saveRecommendations(items: CapacityRecommendation[]): Promise<void> {
    const statement = this.database.prepare(
      "INSERT INTO recommendations(id,scenario_id,scenario_revision,recommendation_json,generated_at) VALUES(?,?,?,?,?)",
    );
    this.inTransaction(() => {
      for (const item of items) {
        statement.run(item.id, item.scenarioId, item.scenarioRevision, JSON.stringify(item), item.generatedAt);
      }
    });
  }
  async listRecommendations(scenarioId: string): Promise<CapacityRecommendation[]> {
    return rows(this.database.prepare(
      "SELECT recommendation_json FROM recommendations WHERE scenario_id=? ORDER BY generated_at DESC",
    ).all(scenarioId)).map((row) => parseJson<CapacityRecommendation>(row.recommendation_json));
  }
  async getRecommendation(id: string): Promise<CapacityRecommendation | null> {
    const row = this.database.prepare("SELECT recommendation_json FROM recommendations WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? parseJson<CapacityRecommendation>(row.recommendation_json) : null;
  }
  async saveManifest(manifest: BenchmarkManifest): Promise<void> {
    this.database.prepare(
      "INSERT INTO benchmark_manifests(id,scenario_id,scenario_revision,manifest_json,expires_at,created_at) VALUES(?,?,?,?,?,?)",
    ).run(manifest.id, manifest.scenarioId, manifest.scenarioRevision, JSON.stringify(manifest), manifest.expiresAt, manifest.createdAt);
  }
  async getManifest(id: string): Promise<BenchmarkManifest | null> {
    const row = this.database.prepare("SELECT manifest_json FROM benchmark_manifests WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? parseJson<BenchmarkManifest>(row.manifest_json) : null;
  }
  async saveBenchmarkResult(result: BenchmarkResultRecord): Promise<void> {
    this.database.prepare(
      "INSERT INTO benchmark_results(manifest_id,result_json,received_at) VALUES(?,?,?) ON CONFLICT(manifest_id) DO UPDATE SET result_json=excluded.result_json,received_at=excluded.received_at",
    ).run(result.manifestId, JSON.stringify(result), result.receivedAt);
  }
  async getBenchmarkResult(manifestId: string): Promise<BenchmarkResultRecord | null> {
    const row = this.database.prepare("SELECT result_json FROM benchmark_results WHERE manifest_id=?").get(manifestId) as Record<string, unknown> | undefined;
    return row ? parseJson<BenchmarkResultRecord>(row.result_json) : null;
  }
  async listBenchmarkEvidence(scenarioId: string, revision: number): Promise<BenchmarkEvidence[]> {
    return rows(this.database.prepare(
      "SELECT m.manifest_json,r.result_json FROM benchmark_manifests m JOIN benchmark_results r ON r.manifest_id=m.id WHERE m.scenario_id=? AND m.scenario_revision=?",
    ).all(scenarioId, revision)).map((row) => ({
      manifest: parseJson<BenchmarkManifest>(row.manifest_json),
      result: parseJson<BenchmarkResultRecord>(row.result_json),
    }));
  }
  async saveCalibrationRun(run: LocalCalibrationRun): Promise<void> {
    this.database.prepare(
      "INSERT INTO calibration_runs(id,hardware_template_id,run_json,completed_at,imported_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hardware_template_id=excluded.hardware_template_id,run_json=excluded.run_json,completed_at=excluded.completed_at,imported_at=excluded.imported_at",
    ).run(run.id, run.fingerprint.hardwareTemplateId, JSON.stringify(run), run.completedAt, now());
  }
  async listCalibrationRuns(): Promise<LocalCalibrationRun[]> {
    return rows(this.database.prepare("SELECT run_json FROM calibration_runs ORDER BY completed_at DESC").all())
      .map((row) => parseJson<LocalCalibrationRun>(row.run_json));
  }
  async upsertBenchmarkObservations(observations: PublicBenchmarkObservation[]): Promise<void> {
    const statement = this.database.prepare(
      "INSERT INTO public_benchmark_observations(id,hardware_template_id,stage,profile_id,observation_json,observed_at,imported_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hardware_template_id=excluded.hardware_template_id,stage=excluded.stage,profile_id=excluded.profile_id,observation_json=excluded.observation_json,observed_at=excluded.observed_at,imported_at=excluded.imported_at",
    );
    this.inTransaction(() => {
      for (const observation of observations) {
        statement.run(observation.id, observation.hardwareTemplateId, observation.stage, observation.profileId, JSON.stringify(observation), observation.observedAt, now());
      }
    }, "IMMEDIATE");
  }
  async listBenchmarkObservations(): Promise<PublicBenchmarkObservation[]> {
    const active = rows(this.database.prepare(
      "SELECT observation_json FROM (SELECT o.observation_json,o.observed_at FROM public_benchmark_observations o JOIN evidence_snapshot_observations m ON m.observation_id=o.id JOIN evidence_active_state a ON a.catalog_version=m.catalog_version WHERE a.singleton=1 UNION SELECT o.observation_json,o.observed_at FROM public_benchmark_observations o JOIN catalog_publication_benchmark_membership m ON m.observation_id=o.id JOIN catalog_bundle_active_state a ON a.sequence=m.publication_sequence WHERE a.singleton=1) ORDER BY observed_at DESC",
    ).all());
    const selected = active.length ? active : rows(this.database.prepare(
      "SELECT observation_json FROM public_benchmark_observations ORDER BY observed_at DESC",
    ).all());
    return selected.map((row) => parseJson<PublicBenchmarkObservation>(row.observation_json));
  }
  async saveEvidenceSnapshot(snapshot: EvidenceCatalogSnapshot): Promise<void> {
    const observationStatement = this.database.prepare(
      "INSERT INTO public_benchmark_observations(id,hardware_template_id,stage,profile_id,observation_json,observed_at,imported_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hardware_template_id=excluded.hardware_template_id,stage=excluded.stage,profile_id=excluded.profile_id,observation_json=excluded.observation_json,observed_at=excluded.observed_at,imported_at=excluded.imported_at",
    );
    const componentStatement = this.database.prepare(
      "INSERT INTO hardware_components(id,component_json,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET component_json=excluded.component_json,updated_at=excluded.updated_at",
    );
    this.inTransaction(() => {
      const importedAt = now();
      this.database.prepare(
        "INSERT INTO evidence_catalog_snapshots(catalog_version,snapshot_json,generated_at,imported_at) VALUES(?,?,?,?) ON CONFLICT(catalog_version) DO UPDATE SET snapshot_json=excluded.snapshot_json,generated_at=excluded.generated_at,imported_at=excluded.imported_at",
      ).run(snapshot.catalogVersion, JSON.stringify(snapshot), snapshot.generatedAt, importedAt);
      for (const observation of snapshot.observations) {
        observationStatement.run(observation.id, observation.hardwareTemplateId, observation.stage, observation.profileId, JSON.stringify(observation), observation.observedAt, importedAt);
        this.database.prepare(
          "INSERT INTO evidence_snapshot_observations(catalog_version,observation_id) VALUES(?,?) ON CONFLICT(catalog_version,observation_id) DO NOTHING",
        ).run(snapshot.catalogVersion, observation.id);
      }
      for (const component of snapshot.components ?? []) {
        componentStatement.run(component.id, JSON.stringify(component), importedAt);
        this.database.prepare(
          "INSERT INTO evidence_snapshot_components(catalog_version,component_id) VALUES(?,?) ON CONFLICT(catalog_version,component_id) DO NOTHING",
        ).run(snapshot.catalogVersion, component.id);
      }
      this.database.prepare(
        "INSERT INTO evidence_active_state(singleton,catalog_version,activated_at) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET catalog_version=excluded.catalog_version,activated_at=excluded.activated_at",
      ).run(snapshot.catalogVersion, importedAt);
    }, "IMMEDIATE");
  }
  async getActiveEvidenceSnapshot(): Promise<EvidenceCatalogSnapshot | null> {
    const row = this.database.prepare(
      "SELECT s.snapshot_json FROM evidence_catalog_snapshots s JOIN evidence_active_state a ON a.catalog_version=s.catalog_version WHERE a.singleton=1",
    ).get() as Record<string, unknown> | undefined;
    return row ? parseJson<EvidenceCatalogSnapshot>(row.snapshot_json) : null;
  }
  async listHardwareComponents(): Promise<HardwareComponent[]> {
    const active = rows(this.database.prepare(
      "SELECT component_json FROM (SELECT c.component_json,c.id FROM hardware_components c JOIN evidence_snapshot_components m ON m.component_id=c.id JOIN evidence_active_state a ON a.catalog_version=m.catalog_version WHERE a.singleton=1 UNION SELECT c.component_json,c.id FROM hardware_components c JOIN catalog_publication_component_membership m ON m.component_id=c.id JOIN catalog_bundle_active_state a ON a.sequence=m.publication_sequence WHERE a.singleton=1) ORDER BY id",
    ).all());
    const selected = active.length ? active : rows(this.database.prepare("SELECT component_json FROM hardware_components ORDER BY id").all());
    return selected.map((row) => parseJson<HardwareComponent>(row.component_json));
  }
  async saveCatalogUpdateRun(run: CatalogUpdateRun): Promise<void> {
    this.database.prepare(
      "INSERT INTO catalog_update_runs(id,update_type,status,run_json,started_at,completed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,run_json=excluded.run_json,completed_at=excluded.completed_at",
    ).run(run.id, run.updateType, run.status, JSON.stringify(run), run.startedAt, run.completedAt);
  }
  async listCatalogUpdateRuns(): Promise<CatalogUpdateRun[]> {
    return rows(this.database.prepare("SELECT run_json FROM catalog_update_runs ORDER BY started_at DESC LIMIT 100").all())
      .map((row) => parseJson<CatalogUpdateRun>(row.run_json));
  }
  async saveSourceRegistry(sources: CatalogSource[]): Promise<void> {
    const statement = this.database.prepare(
      "INSERT INTO catalog_sources(id,source_json,state,last_run_at,last_success_at,consecutive_failures,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_json=excluded.source_json,state=excluded.state,last_run_at=excluded.last_run_at,last_success_at=excluded.last_success_at,consecutive_failures=excluded.consecutive_failures,updated_at=excluded.updated_at",
    );
    this.inTransaction(() => {
      const timestamp = now();
      for (const source of sources) statement.run(source.id, JSON.stringify(source), source.state, source.lastRunAt, source.lastSuccessAt, source.consecutiveFailures, timestamp);
    });
  }
  async listCatalogSources(): Promise<CatalogSource[]> {
    return rows(this.database.prepare("SELECT source_json FROM catalog_sources ORDER BY id").all()).map((row) => parseJson<CatalogSource>(row.source_json));
  }
  async saveSourceFetchRun(run: SourceFetchRun): Promise<void> {
    this.database.prepare(
      "INSERT INTO source_fetch_runs(id,source_id,run_json,started_at,completed_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET run_json=excluded.run_json,completed_at=excluded.completed_at",
    ).run(run.id, run.sourceId, JSON.stringify(run), run.startedAt, run.completedAt);
  }
  async saveSourceObservations(observations: SourceObservation[]): Promise<void> {
    const statement = this.database.prepare(
      "INSERT INTO source_observations(id,source_id,observation_json,content_hash,retrieved_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET observation_json=excluded.observation_json,content_hash=excluded.content_hash,retrieved_at=excluded.retrieved_at",
    );
    this.inTransaction(() => {
      for (const observation of observations) statement.run(observation.id, observation.sourceId, JSON.stringify(observation), observation.contentHash, observation.retrievedAt);
    });
  }
  async listCatalogPublications(): Promise<CatalogPublication[]> {
    return rows(this.database.prepare("SELECT publication_json FROM catalog_publications ORDER BY sequence DESC LIMIT 100").all())
      .map((row) => parseJson<CatalogPublication>(row.publication_json));
  }
  async getActiveCatalogPublication(): Promise<CatalogPublication | null> {
    const row = this.database.prepare(
      "SELECT p.publication_json FROM catalog_publications p JOIN catalog_bundle_active_state a ON a.sequence=p.sequence WHERE a.singleton=1",
    ).get() as Record<string, unknown> | undefined;
    return row ? parseJson<CatalogPublication>(row.publication_json) : null;
  }
  async activateCatalogBundle(envelope: SignedCatalogBundle, bundleSha256: string, etag: string | null): Promise<CatalogPublication> {
    const bundle = envelope.payload;
    const publication = catalogPublication(bundle, envelope.keyId, bundleSha256, etag);
    const insertHardware = this.database.prepare(
      "INSERT INTO hardware_catalog(id,template_json,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET template_json=excluded.template_json,updated_at=excluded.updated_at",
    );
    const insertQuote = this.database.prepare(
      "INSERT INTO price_quotes(id,hardware_template_id,quote_json,observed_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET hardware_template_id=excluded.hardware_template_id,quote_json=excluded.quote_json,observed_at=excluded.observed_at",
    );
    const insertComponent = this.database.prepare(
      "INSERT INTO hardware_components(id,component_json,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET component_json=excluded.component_json,updated_at=excluded.updated_at",
    );
    const insertBenchmark = this.database.prepare(
      "INSERT INTO public_benchmark_observations(id,hardware_template_id,stage,profile_id,observation_json,observed_at,imported_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hardware_template_id=excluded.hardware_template_id,stage=excluded.stage,profile_id=excluded.profile_id,observation_json=excluded.observation_json,observed_at=excluded.observed_at,imported_at=excluded.imported_at",
    );
    const insertSource = this.database.prepare(
      "INSERT INTO catalog_sources(id,source_json,state,last_run_at,last_success_at,consecutive_failures,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_json=excluded.source_json,state=excluded.state,last_run_at=excluded.last_run_at,last_success_at=excluded.last_success_at,consecutive_failures=excluded.consecutive_failures,updated_at=excluded.updated_at",
    );
    const insertComponentQuote = this.database.prepare(
      "INSERT INTO catalog_component_price_quotes(id,component_id,publication_sequence,quote_json,observed_at) VALUES(?,?,?,?,?)",
    );
    this.inTransaction(() => {
      const timestamp = now(); const snapshotId = `bundle:${bundle.sequence}`;
      this.database.prepare("INSERT INTO catalog_publications(sequence,publication_id,catalog_version,bundle_sha256,previous_bundle_sha256,key_id,publication_json,envelope_json,published_at,valid_until) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(bundle.sequence, bundle.publicationId, bundle.catalogVersion, bundleSha256, bundle.previousBundleSha256, envelope.keyId, JSON.stringify(publication), JSON.stringify(envelope), bundle.publishedAt, bundle.validUntil);
      for (const item of bundle.hardware) insertHardware.run(item.id, JSON.stringify(item), timestamp);
      for (const component of bundle.components) insertComponent.run(component.id, JSON.stringify(component), timestamp);
      for (const quote of bundle.prices) {
        if (quote.scope === "component" && quote.componentId) insertComponentQuote.run(quote.id, quote.componentId, bundle.sequence, JSON.stringify(quote), quote.observedAt);
        else if (quote.hardwareTemplateId) insertQuote.run(quote.id, quote.hardwareTemplateId, JSON.stringify(quote), quote.observedAt);
      }
      for (const observation of bundle.benchmarks) insertBenchmark.run(observation.id, observation.hardwareTemplateId, observation.stage, observation.profileId, JSON.stringify(observation), observation.observedAt, timestamp);
      const componentMembership = this.database.prepare("INSERT INTO catalog_publication_component_membership(publication_sequence,component_id) VALUES(?,?)");
      for (const component of bundle.components) componentMembership.run(bundle.sequence, component.id);
      const benchmarkMembership = this.database.prepare("INSERT INTO catalog_publication_benchmark_membership(publication_sequence,observation_id) VALUES(?,?)");
      for (const observation of bundle.benchmarks) benchmarkMembership.run(bundle.sequence, observation.id);
      for (const source of bundle.sources) insertSource.run(source.id, JSON.stringify(source), source.state, source.lastRunAt, source.lastSuccessAt, source.consecutiveFailures, timestamp);
      this.database.prepare("INSERT INTO catalog_snapshots(id,created_at) VALUES(?,?)").run(snapshotId, timestamp);
      const hardwareMembership = this.database.prepare("INSERT INTO catalog_snapshot_membership(snapshot_id,hardware_template_id) VALUES(?,?)");
      for (const item of bundle.hardware) hardwareMembership.run(snapshotId, item.id);
      const quoteMembership = this.database.prepare("INSERT INTO catalog_snapshot_quote_membership(snapshot_id,quote_id) VALUES(?,?)");
      for (const quote of bundle.prices) if (quote.hardwareTemplateId) quoteMembership.run(snapshotId, quote.id);
      this.database.prepare("INSERT INTO catalog_active_state(singleton,snapshot_id,activated_at) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET snapshot_id=excluded.snapshot_id,activated_at=excluded.activated_at").run(snapshotId, timestamp);
      this.database.prepare("INSERT INTO catalog_bundle_active_state(singleton,sequence,etag,activated_at) VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET sequence=excluded.sequence,etag=excluded.etag,activated_at=excluded.activated_at")
        .run(bundle.sequence, etag, timestamp);
    }, "IMMEDIATE");
    return publication;
  }
  async savePredictions(predictions: CapacityPrediction[]): Promise<void> {
    const statement = this.database.prepare(
      "INSERT INTO hardware_predictions(id,hardware_template_id,prediction_json,generated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET prediction_json=excluded.prediction_json,generated_at=excluded.generated_at",
    );
    this.inTransaction(() => {
      for (const prediction of predictions) {
        statement.run(prediction.id, prediction.hardwareTemplateId, JSON.stringify(prediction), prediction.generatedAt);
      }
    });
  }
  async listPredictions(): Promise<CapacityPrediction[]> {
    return rows(this.database.prepare("SELECT prediction_json FROM hardware_predictions ORDER BY generated_at DESC").all())
      .map((row) => parseJson<CapacityPrediction>(row.prediction_json));
  }
  async getCatalog(): Promise<HardwareNodeTemplate[]> {
    const result = rows(this.database.prepare(
      "SELECT h.template_json FROM hardware_catalog h JOIN catalog_snapshot_membership m ON m.hardware_template_id=h.id JOIN catalog_active_state a ON a.snapshot_id=m.snapshot_id WHERE a.singleton=1 ORDER BY h.id",
    ).all());
    return result.length ? result.map((row) => parseJson<HardwareNodeTemplate>(row.template_json)) : HARDWARE_CATALOG;
  }
  async replaceCatalog(hardware: HardwareNodeTemplate[], quotes: PriceQuote[]): Promise<void> {
    const insertHardware = this.database.prepare(
      "INSERT INTO hardware_catalog(id,template_json,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET template_json=excluded.template_json,updated_at=excluded.updated_at",
    );
    const insertQuote = this.database.prepare(
      "INSERT INTO price_quotes(id,hardware_template_id,quote_json,observed_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET hardware_template_id=excluded.hardware_template_id,quote_json=excluded.quote_json,observed_at=excluded.observed_at",
    );
    this.inTransaction(() => {
      const timestamp = now();
      const snapshotId = randomUUID();
      for (const item of hardware) insertHardware.run(item.id, JSON.stringify(item), timestamp);
      for (const quote of quotes) {
        if (quote.hardwareTemplateId) insertQuote.run(quote.id, quote.hardwareTemplateId, JSON.stringify(quote), quote.observedAt);
      }
      this.database.prepare("INSERT INTO catalog_snapshots(id,created_at) VALUES(?,?)").run(snapshotId, timestamp);
      const membership = this.database.prepare(
        "INSERT INTO catalog_snapshot_membership(snapshot_id,hardware_template_id) VALUES(?,?)",
      );
      for (const item of hardware) membership.run(snapshotId, item.id);
      const quoteMembership = this.database.prepare(
        "INSERT INTO catalog_snapshot_quote_membership(snapshot_id,quote_id) VALUES(?,?)",
      );
      for (const quote of quotes) if (quote.hardwareTemplateId) quoteMembership.run(snapshotId, quote.id);
      this.database.prepare(
        "INSERT INTO catalog_active_state(singleton,snapshot_id,activated_at) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET snapshot_id=excluded.snapshot_id,activated_at=excluded.activated_at",
      ).run(snapshotId, timestamp);
    }, "IMMEDIATE");
  }
  async getQuotes(): Promise<PriceQuote[]> {
    return rows(this.database.prepare(
      "SELECT quote_json FROM (SELECT q.quote_json,q.observed_at FROM price_quotes q JOIN catalog_snapshot_quote_membership m ON m.quote_id=q.id JOIN catalog_active_state a ON a.snapshot_id=m.snapshot_id WHERE a.singleton=1 UNION ALL SELECT c.quote_json,c.observed_at FROM catalog_component_price_quotes c JOIN catalog_bundle_active_state a ON a.sequence=c.publication_sequence WHERE a.singleton=1) ORDER BY observed_at DESC",
    ).all())
      .map((row) => parseJson<PriceQuote>(row.quote_json));
  }
  async upsertQuotes(quotes: PriceQuote[]): Promise<void> {
    const statement = this.database.prepare(
      "INSERT INTO price_quotes(id,hardware_template_id,quote_json,observed_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET hardware_template_id=excluded.hardware_template_id,quote_json=excluded.quote_json,observed_at=excluded.observed_at",
    );
    this.inTransaction(() => {
      for (const quote of quotes) {
        if (!quote.hardwareTemplateId) continue;
        statement.run(quote.id, quote.hardwareTemplateId, JSON.stringify(quote), quote.observedAt);
        this.database.prepare(
          "INSERT INTO catalog_snapshot_quote_membership(snapshot_id,quote_id) SELECT snapshot_id,? FROM catalog_active_state WHERE singleton=1 ON CONFLICT(snapshot_id,quote_id) DO NOTHING",
        ).run(quote.id);
      }
    });
  }
  async enqueue(jobType: string, payload: unknown): Promise<number> {
    const result = this.database.prepare(
      "INSERT INTO work_queue(job_type,payload_json,available_at) VALUES(?,?,?)",
    ).run(jobType, JSON.stringify(payload), now());
    return Number(result.lastInsertRowid);
  }
  async claimJob(): Promise<ClaimedJob | null> {
    return this.inTransaction(() => {
      const row = this.database.prepare(
        "SELECT id,job_type,payload_json FROM work_queue WHERE status='queued' AND available_at<=? ORDER BY id LIMIT 1",
      ).get(now()) as Record<string, unknown> | undefined;
      if (!row) return null;
      this.database.prepare(
        "UPDATE work_queue SET status='running',locked_at=?,attempts=attempts+1 WHERE id=? AND status='queued'",
      ).run(now(), Number(row.id));
      return { id: Number(row.id), jobType: String(row.job_type), payload: parseJson<unknown>(row.payload_json) };
    }, "IMMEDIATE");
  }
  async finishJob(id: number, error: string | null): Promise<void> {
    this.database.prepare(
      "UPDATE work_queue SET status=?,completed_at=?,error_text=? WHERE id=?",
    ).run(error === null ? "completed" : "failed", now(), error, id);
  }
  async close(): Promise<void> { this.database.close(); }
}

export function createStore(): PlannerStore {
  if (process.env.QUAL_HARDWARE_IN_MEMORY === "1") return new MemoryPlannerStore();
  const databasePath = process.env.QUAL_HARDWARE_SQLITE_PATH ?? resolve(process.cwd(), "data", "qual-hardware.sqlite");
  return new SqlitePlannerStore(databasePath);
}
