import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HARDWARE_CATALOG, SEED_PRICE_QUOTES } from "../engine/catalog.js";
import { buildHistoricalComponentBuilds, deriveComponentCatalog, validateBuildCompatibility } from "../engine/componentCatalog.js";
import { BUNDLED_SOURCE_REGISTRY } from "../engine/sourceRegistry.js";
import { assertDedicatedSqlitePath, QUAL_HARDWARE_SQLITE_SCHEMA_VERSION } from "./database.js";
import { isPublicObservationEligible } from "../engine/evidence.js";
import { fieldDefinitionsForKind, withTechnicalSpecification } from "../engine/technicalSpecifications.js";
import { calibrationHardwareDigest } from "./calibrationHardware.js";
import { CALIBRATION_COMPUTE_EVIDENCE_VERSION } from "../shared/types.js";
import type {
  ComponentBuild,
  CapacityPrediction,
  CapacityRecommendation,
  CapacityScenario,
  CalibrationCheckpoint,
  CalibrationCollectionSnapshot,
  CalibrationDeviceIdentity,
  CalibrationExportEvent,
  CalibrationImportBatch,
  CalibrationImportItem,
  CalibrationRunProvenance,
  CalibrationSessionLineage,
  CalibrationSessionRecord,
  CalibrationWorkloadProfile,
  CatalogBundle,
  CatalogPublication,
  CatalogSource,
  CatalogUpdateRun,
  EvidenceCatalogSnapshot,
  HardwareComponent,
  ComponentTechnicalSpecification,
  HardwareNodeTemplate,
  HardwareCapacityAssessment,
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

export interface ClaimedJob {
  id: number;
  jobType: string;
  payload: unknown;
}

export interface PlannerStore {
  readonly storageKind: "memory" | "sqlite";
  readonly calibrationExtensionReady: boolean;
  listScenarios(): Promise<ScenarioRecord[]>;
  getScenario(id: string): Promise<ScenarioRecord | null>;
  createScenario(scenario: CapacityScenario): Promise<ScenarioRecord>;
  updateScenario(id: string, expectedRevision: number, scenario: CapacityScenario): Promise<ScenarioRecord>;
  duplicateScenario(id: string): Promise<ScenarioRecord | null>;
  saveRecommendations(recommendations: CapacityRecommendation[]): Promise<void>;
  listRecommendations(scenarioId: string): Promise<CapacityRecommendation[]>;
  getRecommendation(id: string): Promise<CapacityRecommendation | null>;
  saveCalibrationRun(run: LocalCalibrationRun): Promise<void>;
  commitCalibrationRun(run: LocalCalibrationRun, predictions: CapacityPrediction[]): Promise<void>;
  listCalibrationRuns(): Promise<LocalCalibrationRun[]>;
  saveCalibrationSession(session: CalibrationSessionRecord): Promise<void>;
  getCalibrationSession(id: string): Promise<CalibrationSessionRecord | null>;
  listCalibrationSessions(): Promise<CalibrationSessionRecord[]>;
  saveCalibrationCheckpoint(checkpoint: CalibrationCheckpoint): Promise<void>;
  listCalibrationCheckpoints(sessionId: string): Promise<CalibrationCheckpoint[]>;
  saveCalibrationSessionLineage(lineage: CalibrationSessionLineage): Promise<void>;
  saveCalibrationDeviceIdentity(identity: CalibrationDeviceIdentity): Promise<void>;
  listCalibrationDeviceIdentities(): Promise<CalibrationDeviceIdentity[]>;
  listCalibrationRunProvenance(): Promise<CalibrationRunProvenance[]>;
  setCalibrationDeviceTrust(id: string, trust: CalibrationDeviceIdentity["trust"]): Promise<CalibrationDeviceIdentity>;
  commitCalibrationImport(input: {
    batch: CalibrationImportBatch;
    items: CalibrationImportItem[];
    deviceIdentities: CalibrationDeviceIdentity[];
    runs: Array<{ run: LocalCalibrationRun; provenance: CalibrationRunProvenance; workloadProfile: CalibrationWorkloadProfile }>;
    predictions: CapacityPrediction[];
  }): Promise<void>;
  saveCalibrationExportEvent(event: CalibrationExportEvent): Promise<void>;
  saveCalibrationCollectionSnapshot(snapshot: CalibrationCollectionSnapshot): Promise<void>;
  listCalibrationExportEvents(): Promise<CalibrationExportEvent[]>;
  listCapacityAssessments(): Promise<HardwareCapacityAssessment[]>;
  upsertBenchmarkObservations(observations: PublicBenchmarkObservation[]): Promise<void>;
  listBenchmarkObservations(): Promise<PublicBenchmarkObservation[]>;
  saveEvidenceSnapshot(snapshot: EvidenceCatalogSnapshot): Promise<void>;
  getActiveEvidenceSnapshot(): Promise<EvidenceCatalogSnapshot | null>;
  listHardwareComponents(): Promise<HardwareComponent[]>;
  listCatalogComponents(): Promise<HardwareComponent[]>;
  listComponentSpecificationHistory(componentId: string): Promise<ComponentTechnicalSpecification[]>;
  saveComponentBuilds(builds: ComponentBuild[]): Promise<void>;
  listComponentBuilds(): Promise<ComponentBuild[]>;
  getComponentBuild(id: string): Promise<ComponentBuild | null>;
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

function capacityAssessmentForPrediction(
  prediction: CapacityPrediction,
  runs: LocalCalibrationRun[],
): HardwareCapacityAssessment | null {
  if (!prediction.workloadProfileId) return null;
  const calibrationRunIds = prediction.exactCalibrationRunId ? [prediction.exactCalibrationRunId] :
    [...new Set(prediction.stagePredictions.flatMap((stage) => stage.anchorRunIds))];
  const exactRun = prediction.exactCalibrationRunId
    ? runs.find((run) => run.id === prediction.exactCalibrationRunId)
    : null;
  return {
    schemaVersion: "qual-hardware-capacity-assessment/1.0.0",
    id: `assessment:${prediction.id}`,
    hardwareTemplateId: prediction.hardwareTemplateId,
    workloadProfileId: prediction.workloadProfileId,
    targetBuildHash: prediction.targetBuildHash ?? "unknown",
    kernelVersion: prediction.kernelVersion ?? "unknown",
    runtimeManifestHash: prediction.runtimeManifestHash ?? "unknown",
    calibrationRunIds,
    generatedAt: prediction.generatedAt,
    status: prediction.status,
    procurementEligibility: prediction.procurementEligibility,
    safeCameraMaximum: prediction.safeCameraMaximum,
    capacityBound: exactRun?.capacityBound ?? null,
    bottleneck: prediction.bottleneck,
    reasons: structuredClone(prediction.reasons),
  };
}

export class MemoryPlannerStore implements PlannerStore {
  readonly storageKind = "memory" as const;
  readonly calibrationExtensionReady = true;
  private scenarios = new Map<string, ScenarioRecord>();
  private recommendations = new Map<string, CapacityRecommendation>();
  private calibrationRuns = new Map<string, LocalCalibrationRun>();
  private calibrationSessions = new Map<string, CalibrationSessionRecord>();
  private calibrationCheckpoints = new Map<string, CalibrationCheckpoint[]>();
  private calibrationLineage = new Map<string, CalibrationSessionLineage>();
  private calibrationDevices = new Map<string, CalibrationDeviceIdentity>();
  private calibrationProvenance = new Map<string, CalibrationRunProvenance>();
  private calibrationImportBatches = new Map<string, CalibrationImportBatch>();
  private calibrationImportItems = new Map<string, CalibrationImportItem>();
  private calibrationExportEvents = new Map<string, CalibrationExportEvent>();
  private calibrationCollectionSnapshots = new Map<string, CalibrationCollectionSnapshot>();
  private capacityAssessments = new Map<string, HardwareCapacityAssessment>();
  private observations = new Map<string, PublicBenchmarkObservation>();
  private components = new Map<string, HardwareComponent>(deriveComponentCatalog(HARDWARE_CATALOG).components.map((item) => [item.id, item]));
  private activeObservationIds = new Set<string>();
  private activeComponentIds = new Set<string>(deriveComponentCatalog(HARDWARE_CATALOG).components.map((item) => item.id));
  private activeEvidenceSnapshot: EvidenceCatalogSnapshot | null = null;
  private catalogUpdateRuns = new Map<string, CatalogUpdateRun>();
  private catalogSources = new Map<string, CatalogSource>(BUNDLED_SOURCE_REGISTRY.sources.map((source) => [source.id, structuredClone(source)]));
  private sourceFetchRuns = new Map<string, SourceFetchRun>();
  private sourceObservations = new Map<string, SourceObservation>();
  private publications = new Map<number, CatalogPublication>();
  private activePublication: CatalogPublication | null = null;
  private predictions = new Map<string, CapacityPrediction>();
  private builds = new Map<string, ComponentBuild>(buildHistoricalComponentBuilds(
    HARDWARE_CATALOG, deriveComponentCatalog(HARDWARE_CATALOG).components, [], [],
  ).map((item) => [item.id, item]));
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
  async saveCalibrationRun(run: LocalCalibrationRun): Promise<void> {
    if (this.calibrationRuns.has(run.id)) throw new Error("duplicate_calibration_run");
    this.calibrationRuns.set(run.id, structuredClone(run));
  }
  async commitCalibrationRun(run: LocalCalibrationRun, predictions: CapacityPrediction[]): Promise<void> {
    await this.saveCalibrationRun(run);
    await this.savePredictions(predictions);
  }
  async listCalibrationRuns(): Promise<LocalCalibrationRun[]> {
    return [...this.calibrationRuns.values()].sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  }
  async saveCalibrationSession(session: CalibrationSessionRecord): Promise<void> {
    this.calibrationSessions.set(session.id, structuredClone(session));
  }
  async getCalibrationSession(id: string): Promise<CalibrationSessionRecord | null> {
    const session = this.calibrationSessions.get(id);
    return session ? structuredClone(session) : null;
  }
  async listCalibrationSessions(): Promise<CalibrationSessionRecord[]> {
    return [...this.calibrationSessions.values()].map((session) => structuredClone(session))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  async saveCalibrationCheckpoint(checkpoint: CalibrationCheckpoint): Promise<void> {
    const current = this.calibrationCheckpoints.get(checkpoint.sessionId) ?? [];
    if (current.some((item) => item.id === checkpoint.id || item.sequence === checkpoint.sequence)) {
      throw new Error("duplicate_calibration_checkpoint");
    }
    this.calibrationCheckpoints.set(checkpoint.sessionId, [...current, structuredClone(checkpoint)]);
  }
  async listCalibrationCheckpoints(sessionId: string): Promise<CalibrationCheckpoint[]> {
    return (this.calibrationCheckpoints.get(sessionId) ?? []).map((item) => structuredClone(item))
      .sort((left, right) => right.sequence - left.sequence);
  }
  async saveCalibrationSessionLineage(lineage: CalibrationSessionLineage): Promise<void> {
    if (this.calibrationLineage.has(lineage.childSessionId)) throw new Error("duplicate_calibration_session_lineage");
    this.calibrationLineage.set(lineage.childSessionId, structuredClone(lineage));
  }
  async saveCalibrationDeviceIdentity(identity: CalibrationDeviceIdentity): Promise<void> {
    const existing = this.calibrationDevices.get(identity.id);
    if (existing && existing.publicKeyPem !== identity.publicKeyPem) throw new Error("calibration_device_key_changed");
    this.calibrationDevices.set(identity.id, structuredClone(existing
      ? { ...identity, trust: existing.trust, firstSeenAt: existing.firstSeenAt }
      : identity));
  }
  async listCalibrationDeviceIdentities(): Promise<CalibrationDeviceIdentity[]> {
    return [...this.calibrationDevices.values()].map((identity) => structuredClone(identity))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  async listCalibrationRunProvenance(): Promise<CalibrationRunProvenance[]> {
    return [...this.calibrationProvenance.values()].map((provenance) => structuredClone(provenance));
  }
  async setCalibrationDeviceTrust(id: string, trust: CalibrationDeviceIdentity["trust"]): Promise<CalibrationDeviceIdentity> {
    const current = this.calibrationDevices.get(id);
    if (!current) throw new Error("calibration_device_not_found");
    const updated = { ...current, trust, updatedAt: now() };
    this.calibrationDevices.set(id, updated);
    return structuredClone(updated);
  }
  async commitCalibrationImport(input: {
    batch: CalibrationImportBatch;
    items: CalibrationImportItem[];
    deviceIdentities: CalibrationDeviceIdentity[];
    runs: Array<{ run: LocalCalibrationRun; provenance: CalibrationRunProvenance; workloadProfile: CalibrationWorkloadProfile }>;
    predictions: CapacityPrediction[];
  }): Promise<void> {
    if (this.calibrationImportBatches.has(input.batch.id)) throw new Error("duplicate_calibration_import_batch");
    for (const { run } of input.runs) {
      if (this.calibrationRuns.has(run.id)) throw new Error("duplicate_calibration_run");
    }
    for (const identity of input.deviceIdentities) await this.saveCalibrationDeviceIdentity(identity);
    this.calibrationImportBatches.set(input.batch.id, structuredClone(input.batch));
    for (const item of input.items) this.calibrationImportItems.set(item.id, structuredClone(item));
    for (const { run, provenance } of input.runs) {
      this.calibrationRuns.set(run.id, structuredClone(run));
      this.calibrationProvenance.set(run.id, structuredClone(provenance));
    }
    await this.savePredictions(input.predictions);
  }
  async saveCalibrationExportEvent(event: CalibrationExportEvent): Promise<void> {
    if (this.calibrationExportEvents.has(event.id)) throw new Error("duplicate_calibration_export_event");
    this.calibrationExportEvents.set(event.id, structuredClone(event));
  }
  async saveCalibrationCollectionSnapshot(snapshot: CalibrationCollectionSnapshot): Promise<void> {
    if (this.calibrationCollectionSnapshots.has(snapshot.id)) throw new Error("duplicate_calibration_collection_snapshot");
    this.calibrationCollectionSnapshots.set(snapshot.id, structuredClone(snapshot));
  }
  async listCalibrationExportEvents(): Promise<CalibrationExportEvent[]> {
    return [...this.calibrationExportEvents.values()].map((event) => structuredClone(event))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  async listCapacityAssessments(): Promise<HardwareCapacityAssessment[]> {
    return [...this.capacityAssessments.values()].map((item) => structuredClone(item))
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
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
  async listCatalogComponents(): Promise<HardwareComponent[]> {
    return [...this.components.values()].map((item) => structuredClone(item)).sort((left, right) => left.id.localeCompare(right.id));
  }
  async listComponentSpecificationHistory(componentId: string): Promise<ComponentTechnicalSpecification[]> {
    const component = this.components.get(componentId);
    if (!component) return [];
    return [structuredClone(withTechnicalSpecification(component).technicalSpecification!)];
  }
  async saveComponentBuilds(builds: ComponentBuild[]): Promise<void> {
    for (const build of builds) this.builds.set(build.id, structuredClone(build));
  }
  async listComponentBuilds(): Promise<ComponentBuild[]> {
    return [...this.builds.values()].map((item) => structuredClone(item)).sort((left, right) => left.name.localeCompare(right.name));
  }
  async getComponentBuild(id: string): Promise<ComponentBuild | null> {
    const build = this.builds.get(id);
    return build ? structuredClone(build) : null;
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
    const runs = [...this.calibrationRuns.values()];
    for (const prediction of predictions) {
      this.predictions.set(prediction.id, structuredClone(prediction));
      const assessment = capacityAssessmentForPrediction(prediction, runs);
      if (assessment) this.capacityAssessments.set(assessment.id, assessment);
    }
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

function verifiedSqliteBackup(database: DatabaseSync, databasePath: string, label: string): string {
  const backupDirectory = resolve(dirname(databasePath), "schema-backups");
  mkdirSync(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(backupDirectory, `${label}-${timestamp}-${randomUUID()}.sqlite`);
  database.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const result = backup.prepare("PRAGMA integrity_check").get() as Record<string, unknown> | undefined;
    if (!result || Object.values(result)[0] !== "ok") throw new Error("calibration_extension_backup_integrity_check_failed");
  } finally {
    backup.close();
  }
  return backupPath;
}

function migrateCalibrationSessionEventStates(database: DatabaseSync): void {
  const table = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='calibration_session_events'",
  ).get() as { sql?: string } | undefined;
  if (!table?.sql || table.sql.includes("'validating'")) return;
  database.exec(`
    BEGIN IMMEDIATE;
    ALTER TABLE calibration_session_events RENAME TO calibration_session_events_legacy_states;
    CREATE TABLE calibration_session_events (
      event_id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES calibration_sessions_v2(id),
      state TEXT NOT NULL CHECK (state IN ('pending','preflight','discovering','validating','qualifying','finalizing','cancelled','completed','failed','interrupted','expired')),
      session_json TEXT NOT NULL CHECK (json_valid(session_json)),
      created_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO calibration_session_events(event_id,session_id,state,session_json,created_at)
      SELECT event_id,session_id,
        CASE state
          WHEN 'launching' THEN 'preflight'
          WHEN 'running' THEN CASE
            WHEN json_extract(session_json,'$.mode') IN ('full','qualification') THEN 'qualifying'
            ELSE 'validating'
          END
          WHEN 'cancelling' THEN 'finalizing'
          ELSE state
        END,
        session_json,created_at
      FROM calibration_session_events_legacy_states;
    DROP TABLE calibration_session_events_legacy_states;
    CREATE INDEX calibration_session_events_latest_idx
      ON calibration_session_events(session_id,event_id DESC);
    COMMIT;
  `);
}

function migrateCalibrationTierCapacity(database: DatabaseSync): void {
  const table = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='calibration_tier_results'",
  ).get() as { sql?: string } | undefined;
  if (!table?.sql || table.sql.includes("1000000")) return;
  database.exec(`
    BEGIN IMMEDIATE;
    ALTER TABLE calibration_tier_results RENAME TO calibration_tier_results_v9;
    CREATE TABLE calibration_tier_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES calibration_runs_v2(id),
      tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 1000000),
      repetition INTEGER CHECK (repetition BETWEEN 1 AND 3),
      phase TEXT NOT NULL,
      result_json TEXT NOT NULL CHECK (json_valid(result_json)),
      completed_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO calibration_tier_results(id,run_id,tier,repetition,phase,result_json,completed_at)
      SELECT id,run_id,tier,repetition,phase,result_json,completed_at FROM calibration_tier_results_v9;
    DROP TABLE calibration_tier_results_v9;
    CREATE INDEX calibration_tier_results_run_idx
      ON calibration_tier_results(run_id,tier,repetition,phase);
    COMMIT;
  `);
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
  readonly calibrationExtensionReady: boolean;
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
    if (currentVersion > 0 && currentVersion < QUAL_HARDWARE_SQLITE_SCHEMA_VERSION) {
      verifiedSqliteBackup(this.database, dedicatedPath, `qual-hardware-pre-v${QUAL_HARDWARE_SQLITE_SCHEMA_VERSION}`);
    }
    const hasCalibrationExtension = Boolean(this.database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='calibration_extension_metadata'",
    ).get());
    const calibrationExtensionVersion = hasCalibrationExtension
      ? Number((this.database.prepare("SELECT extension_version FROM calibration_extension_metadata WHERE singleton=1").get() as { extension_version?: number } | undefined)?.extension_version ?? 0)
      : 0;
    const eventTableSql = (this.database.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='calibration_session_events'",
    ).get() as { sql?: string } | undefined)?.sql;
    const calibrationStateMigrationRequired = Boolean(eventTableSql && !eventTableSql.includes("'validating'"));
    if (currentVersion === QUAL_HARDWARE_SQLITE_SCHEMA_VERSION && (calibrationExtensionVersion < 3 || calibrationStateMigrationRequired)) {
      verifiedSqliteBackup(this.database, dedicatedPath,
        calibrationExtensionVersion === 0
          ? "qual-hardware-pre-calibration-extension"
          : calibrationStateMigrationRequired
            ? "qual-hardware-pre-autonomous-state-migration"
            : "qual-hardware-pre-calibration-extension-v2");
    }
    const resourceRoot = process.env.QUAL_HARDWARE_RESOURCE_ROOT ?? process.cwd();
    const schemaSql = readFileSync(schemaPath ?? resolve(resourceRoot, "database", "sqlite-schema.sql"), "utf8");
    let calibrationExtensionReady = true;
    try {
      migrateCalibrationSessionEventStates(this.database);
      migrateCalibrationTierCapacity(this.database);
      this.database.exec(schemaSql);
      const integrity = this.database.prepare("PRAGMA integrity_check").get() as Record<string, unknown> | undefined;
      if (!integrity || Object.values(integrity)[0] !== "ok") throw new Error("calibration_extension_post_migration_integrity_check_failed");
    } catch (error) {
      if (this.database.isTransaction) this.database.exec("ROLLBACK");
      if (currentVersion === QUAL_HARDWARE_SQLITE_SCHEMA_VERSION && (calibrationExtensionVersion < 3 || calibrationStateMigrationRequired)) {
        calibrationExtensionReady = false;
      } else {
        this.database.close();
        throw error;
      }
    }
    this.calibrationExtensionReady = calibrationExtensionReady;
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

  private insertCalibrationRunV2(run: LocalCalibrationRun): void {
    const runJson = JSON.stringify(run);
    const digest = createHash("sha256").update(runJson).digest("hex");
    const recordedAt = now();
    this.database.prepare(
      "INSERT INTO calibration_runs_v2(id,hardware_template_id,workload_profile_id,run_digest,run_json,completed_at,recorded_at) VALUES(?,?,?,?,?,?,?)",
    ).run(run.id, run.fingerprint.hardwareTemplateId, run.workloadProfileId ?? null, digest, runJson, run.completedAt, recordedAt);
    const statement = this.database.prepare(
      "INSERT INTO calibration_tier_results(id,run_id,tier,repetition,phase,result_json,completed_at) VALUES(?,?,?,?,?,?,?)",
    );
    for (const [index, result] of (run.tierResults ?? []).entries()) {
      statement.run(`${run.id}:${index}`, run.id, result.tier, result.repetition, result.phase, JSON.stringify(result), result.completedAt);
    }
    if (run.fingerprint.cpuPackages || run.fingerprint.processorGroups ||
        run.fingerprint.numaNodes || run.fingerprint.gpuDevices) {
      this.database.prepare(
        "INSERT INTO calibration_hardware_topologies(run_id,schema_version,topology_json,recorded_at) VALUES(?,?,?,?)",
      ).run(run.id, "qual-hardware-calibration-hardware/2.0.0", JSON.stringify({
        cpuPackages: run.fingerprint.cpuPackages ?? [],
        processorGroups: run.fingerprint.processorGroups ?? [],
        numaNodes: run.fingerprint.numaNodes ?? [],
        gpuDevices: run.fingerprint.gpuDevices ?? [],
      }), recordedAt);
    }
    if (run.computeEvidence?.schemaVersion === CALIBRATION_COMPUTE_EVIDENCE_VERSION) {
      const insertDevice = this.database.prepare(
        "INSERT INTO calibration_device_results(run_id,device_id,classification,result_json,recorded_at) VALUES(?,?,?,?,?)",
      );
      for (const device of run.computeEvidence.devices) {
        insertDevice.run(run.id, device.deviceId, device.classification, JSON.stringify(device), recordedAt);
      }
    }
    if (run.capacityBoundary) {
      this.database.prepare(
        "INSERT INTO calibration_capacity_boundaries(run_id,bound_kind,highest_passing_cameras,first_failing_cameras,safe_cameras,boundary_json,recorded_at) VALUES(?,?,?,?,?,?,?)",
      ).run(run.id, run.capacityBoundary.bound, run.capacityBoundary.highestPassingCameraCount,
        run.capacityBoundary.firstFailingCameraCount, run.capacityBoundary.operationalSafeCameraCount,
        JSON.stringify(run.capacityBoundary), recordedAt);
    }
    if (run.runtimeManifestHash) {
      this.database.prepare(
        "INSERT OR IGNORE INTO calibration_runtime_manifests(manifest_hash,manifest_json,recorded_at) VALUES(?,?,?)",
      ).run(run.runtimeManifestHash, JSON.stringify(run.runtimeProvenance ?? {
        kernelVersion: run.kernelVersion ?? null,
        compatibleCommit: run.compatiblePerceptrumCommit ?? null,
        manifestHash: run.runtimeManifestHash,
      }), now());
    }
  }

  private insertPrediction(prediction: CapacityPrediction): void {
    this.database.prepare(
      "INSERT INTO hardware_predictions(id,hardware_template_id,prediction_json,generated_at) VALUES(?,?,?,?)",
    ).run(prediction.id, prediction.hardwareTemplateId, JSON.stringify(prediction), prediction.generatedAt);
    this.upsertNormalizedPrediction(prediction);
  }

  private currentCalibrationRuns(): LocalCalibrationRun[] {
    return rows(this.database.prepare("SELECT run_json FROM calibration_runs_v2").all())
      .map((row) => parseJson<LocalCalibrationRun>(row.run_json));
  }

  private insertCapacityAssessment(prediction: CapacityPrediction, runs: LocalCalibrationRun[]): void {
    const assessment = capacityAssessmentForPrediction(prediction, runs);
    if (!assessment) return;
    this.database.prepare(
      "INSERT INTO hardware_capacity_assessments(id,hardware_template_id,workload_profile_id,assessment_json,generated_at) VALUES(?,?,?,?,?)",
    ).run(assessment.id, assessment.hardwareTemplateId, assessment.workloadProfileId,
      JSON.stringify(assessment), assessment.generatedAt);
  }

  private upsertNormalizedBenchmarkObservation(observation: PublicBenchmarkObservation, importedAt: string): void {
    const suiteId = observation.benchmarkSuiteId ?? `${observation.benchmarkName}:${observation.benchmarkVersion}`;
    const profileId = `${suiteId}::${observation.profileId}`;
    const systemId = `${observation.hardwareTemplateId}::${observation.operatingSystem}::${observation.profileId}`;
    const runId = `benchmark-run:${observation.id}`;
    this.database.prepare(
      "INSERT INTO benchmark_suites(id,name,version,license_policy,source_url,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,license_policy=excluded.license_policy,source_url=excluded.source_url",
    ).run(suiteId, observation.benchmarkName, observation.benchmarkVersion, observation.licensePolicy ?? null, observation.sourceUrl, importedAt);
    this.database.prepare(
      "INSERT INTO benchmark_profiles(id,suite_id,stage,profile_json,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET suite_id=excluded.suite_id,stage=excluded.stage,profile_json=excluded.profile_json",
    ).run(profileId, suiteId, observation.stage, JSON.stringify({
      profileId: observation.profileId,
      configuration: observation.configuration,
      powerWatts: observation.powerWatts ?? null,
      driverVersion: observation.driverVersion ?? null,
      coolingProfile: observation.coolingProfile ?? null,
    }), importedAt);
    this.database.prepare(
      "INSERT INTO benchmark_systems(id,hardware_template_id,operating_system,fingerprint_json,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hardware_template_id=excluded.hardware_template_id,operating_system=excluded.operating_system,fingerprint_json=excluded.fingerprint_json",
    ).run(systemId, observation.hardwareTemplateId, observation.operatingSystem, JSON.stringify(observation.systemFingerprint ?? {
      hardwareTemplateId: observation.hardwareTemplateId,
      configuration: observation.configuration,
    }), importedAt);
    this.database.prepare(
      "INSERT INTO benchmark_runs(id,observation_id,profile_id,system_id,run_json,observed_at,imported_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile_id=excluded.profile_id,system_id=excluded.system_id,run_json=excluded.run_json,observed_at=excluded.observed_at,imported_at=excluded.imported_at",
    ).run(runId, observation.id, profileId, systemId, JSON.stringify(observation), observation.observedAt, importedAt);
    this.database.prepare(
      "INSERT INTO benchmark_metrics(id,run_id,metric_name,numeric_value,unit,higher_is_better,aggregation) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metric_name=excluded.metric_name,numeric_value=excluded.numeric_value,unit=excluded.unit,higher_is_better=excluded.higher_is_better,aggregation=excluded.aggregation",
    ).run(`benchmark-metric:${observation.id}`, runId, observation.metricName ?? observation.benchmarkName, observation.score,
      observation.unit, observation.higherIsBetter ? 1 : 0, observation.aggregation ?? "single");
    if (observation.componentId) {
      this.database.prepare(
        "INSERT INTO benchmark_component_links(run_id,component_id,component_kind) VALUES(?,?,?) ON CONFLICT(run_id,component_id) DO UPDATE SET component_kind=excluded.component_kind",
      ).run(runId, observation.componentId, observation.componentKind ?? null);
    }
    this.database.prepare(
      "INSERT INTO benchmark_quality_assessments(run_id,source_tier,reproducible,assessment_json,assessed_at) VALUES(?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET source_tier=excluded.source_tier,reproducible=excluded.reproducible,assessment_json=excluded.assessment_json,assessed_at=excluded.assessed_at",
    ).run(runId, observation.sourceTier, observation.reproducible === true ? 1 : 0, JSON.stringify({
      qualityFlags: observation.qualityFlags ?? [],
      evidenceLocator: observation.evidenceLocator ?? null,
      rawArtifactSha256: observation.rawArtifactSha256 ?? null,
      sampleCount: observation.sampleCount ?? null,
    }), importedAt);
    if (observation.rawArtifactSha256 && observation.evidenceLocator) {
      this.database.prepare(
        "INSERT INTO benchmark_artifacts(sha256,source_url,content_type,license_policy,evidence_locator,retrieved_at,metadata_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(sha256) DO UPDATE SET source_url=excluded.source_url,license_policy=excluded.license_policy,evidence_locator=excluded.evidence_locator,metadata_json=excluded.metadata_json",
      ).run(observation.rawArtifactSha256, observation.sourceUrl, null, observation.licensePolicy ?? "unspecified",
        observation.evidenceLocator, observation.observedAt, JSON.stringify({ benchmarkName: observation.benchmarkName, benchmarkVersion: observation.benchmarkVersion }));
    }
    const componentIds = [...new Set([observation.componentId, ...(observation.componentIds ?? [])].filter((id): id is string => Boolean(id)))];
    for (const componentId of componentIds) {
      const exists = this.database.prepare("SELECT 1 AS present FROM component_identities WHERE id=?").get(componentId);
      if (!exists) continue;
      const eligibility = isPublicObservationEligible(observation) ? "eligible"
        : observation.eligibility === "rejected" ? "rejected" : "reference_only";
      this.database.prepare(
        "INSERT INTO benchmark_observation_component_coverage(observation_id,component_id,stage,eligibility,assessment_json) VALUES(?,?,?,?,?) ON CONFLICT(observation_id,component_id,stage) DO UPDATE SET eligibility=excluded.eligibility,assessment_json=excluded.assessment_json",
      ).run(observation.id, componentId, observation.stage, eligibility, JSON.stringify({
        qualityFlags: observation.qualityFlags ?? [], rejectionReasons: observation.rejectionReasons ?? [],
      }));
    }
  }

  private upsertComponentIdentity(component: HardwareComponent, importedAt: string): void {
    component = withTechnicalSpecification(component, component.updatedAt ?? importedAt);
    const canonicalMpn = component.canonicalMpn ?? component.sku;
    const marketState = component.marketState ?? "reference_only";
    const inventoryState = component.inventoryState ?? "discovered_inventory";
    this.database.prepare(
      "INSERT INTO hardware_components(id,component_json,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET component_json=excluded.component_json,updated_at=excluded.updated_at",
    ).run(component.id, JSON.stringify(component), importedAt);
    this.database.prepare(
      "INSERT INTO component_identities(id,kind,manufacturer,canonical_mpn,market_state,inventory_state,component_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,manufacturer=excluded.manufacturer,canonical_mpn=excluded.canonical_mpn,market_state=excluded.market_state,inventory_state=excluded.inventory_state,component_json=excluded.component_json,updated_at=excluded.updated_at",
    ).run(component.id, component.kind, component.manufacturer, canonicalMpn, marketState, inventoryState,
      JSON.stringify(component), component.discoveredAt ?? importedAt, importedAt);
    const aliases = [...new Set([component.sku, canonicalMpn, ...(component.aliases ?? [])])];
    const insertAlias = this.database.prepare(
      "INSERT INTO component_aliases(component_id,alias,normalized_alias,source_url) VALUES(?,?,?,?) ON CONFLICT(component_id,normalized_alias) DO UPDATE SET alias=excluded.alias,source_url=excluded.source_url",
    );
    for (const alias of aliases) insertAlias.run(component.id, alias, alias.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), component.sourceUrls[0] ?? null);
    const evidence = component.evidence ?? [];
    const version = component.specificationVersion ?? "legacy-v1";
    const artifactHash = evidence[0]?.rawArtifactSha256 ?? null;
    this.database.prepare(
      "INSERT INTO component_specification_versions(id,component_id,specification_version,specification_json,evidence_json,raw_artifact_sha256,observed_at,imported_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET specification_json=excluded.specification_json,evidence_json=excluded.evidence_json,raw_artifact_sha256=excluded.raw_artifact_sha256,observed_at=excluded.observed_at,imported_at=excluded.imported_at",
    ).run(`spec:${component.id}:${version}:${artifactHash ?? "unverified"}`, component.id, version, JSON.stringify(component.specifications),
      JSON.stringify(evidence), artifactHash, component.updatedAt ?? importedAt, importedAt);
    if (component.compatibility) {
      this.database.prepare(
        "INSERT INTO component_compatibility_rules(id,component_id,rule_type,rule_json,evidence_json,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET rule_json=excluded.rule_json,evidence_json=excluded.evidence_json",
      ).run(`compat:${component.id}:${version}`, component.id, "declared_capabilities", JSON.stringify(component.compatibility), JSON.stringify(evidence), importedAt);
    }
    const technical = component.technicalSpecification;
    if (!technical) return;
    const insertDefinition = this.database.prepare(
      "INSERT INTO technical_specification_field_definitions(component_kind,field_code,label_pt,value_type,canonical_unit,required,roles_json,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(component_kind,field_code) DO UPDATE SET label_pt=excluded.label_pt,value_type=excluded.value_type,canonical_unit=excluded.canonical_unit,required=excluded.required,roles_json=excluded.roles_json",
    );
    const profileDefinitions = new Map(fieldDefinitionsForKind(component.kind).map((definition) => [definition.code, definition]));
    for (const field of technical.fields) {
      const definition = profileDefinitions.get(field.code);
      insertDefinition.run(component.kind, field.code, definition?.labelPt ?? field.labelPt, definition?.valueType ?? field.valueType,
        definition?.unit ?? field.unit, (definition?.required ?? field.required) ? 1 : 0, JSON.stringify(definition?.roles ?? field.roles), importedAt);
      for (const source of field.sourceEvidence) {
        this.database.prepare(
          "INSERT INTO manufacturer_specification_artifacts(sha256,source_id,source_url,content_type,license_policy,retrieved_at,metadata_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(sha256) DO UPDATE SET source_id=excluded.source_id,source_url=excluded.source_url,license_policy=excluded.license_policy,retrieved_at=excluded.retrieved_at,metadata_json=excluded.metadata_json",
        ).run(source.rawArtifactSha256, source.sourceId, source.url, null, source.licensePolicy, source.retrievedAt,
          JSON.stringify({ evidenceLocator: source.evidenceLocator, componentId: component.id, fieldCode: field.code }));
      }
    }
    const insertObservation = this.database.prepare(
      "INSERT INTO manufacturer_specification_observations(id,component_id,schema_version,manufacturer,canonical_mpn,scope,subject,field_code,section_code,section_label_pt,display_order,value_type,original_label,original_value_json,original_unit,normalized_value_json,normalized_unit,authority,source_id,source_url,retrieved_at,evidence_locator,raw_artifact_sha256,parser_id,parser_version,license_policy) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
    );
    const insertParser = this.database.prepare(
      "INSERT INTO specification_parser_versions(parser_id,parser_version,source_id,schema_hash,created_at) VALUES(?,?,?,?,?) ON CONFLICT(parser_id,parser_version) DO NOTHING",
    );
    const insertMapping = this.database.prepare(
      "INSERT INTO component_source_mappings(component_id,source_id,source_url,expected_subject,expected_scope,mapping_version,verified_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(component_id,source_id,source_url) DO UPDATE SET expected_subject=excluded.expected_subject,expected_scope=excluded.expected_scope,mapping_version=excluded.mapping_version,verified_at=excluded.verified_at",
    );
    for (const observation of technical.observations ?? []) {
      insertObservation.run(
        observation.id, observation.componentId, observation.schemaVersion, observation.manufacturer, observation.canonicalMpn,
        observation.scope, observation.subject, observation.fieldCode, observation.sectionCode, observation.sectionLabelPt,
        observation.displayOrder, observation.valueType, observation.originalLabel, JSON.stringify(observation.originalValue),
        observation.originalUnit, JSON.stringify(observation.normalizedValue), observation.normalizedUnit, observation.authority,
        observation.sourceId, observation.sourceUrl, observation.retrievedAt, observation.evidenceLocator,
        observation.rawArtifactSha256, observation.parserId, observation.parserVersion, observation.licensePolicy,
      );
      const schemaHash = createHash("sha256").update(JSON.stringify({
        parserId: observation.parserId, parserVersion: observation.parserVersion, sourceId: observation.sourceId,
      })).digest("hex");
      insertParser.run(observation.parserId, observation.parserVersion, observation.sourceId, schemaHash, importedAt);
      insertMapping.run(component.id, observation.sourceId, observation.sourceUrl, observation.subject, observation.scope, observation.parserVersion, observation.retrievedAt);
    }
    const specificationId = `technical:${component.id}:${technical.specificationVersion}:${technical.generatedAt}`;
    this.database.prepare(
      "INSERT INTO component_technical_specification_versions(id,component_id,schema_version,specification_version,specification_json,generated_at,imported_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET specification_json=excluded.specification_json,imported_at=excluded.imported_at",
    ).run(specificationId, component.id, technical.schemaVersion, technical.specificationVersion, JSON.stringify(technical), technical.generatedAt, importedAt);
    const insertValue = this.database.prepare(
      "INSERT INTO component_technical_specification_values(specification_id,field_code,status,value_type,text_value,numeric_value,boolean_value,unit,original_label,original_value_json,required,confidence,normalization_rule,evidence_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(specification_id,field_code) DO UPDATE SET status=excluded.status,value_type=excluded.value_type,text_value=excluded.text_value,numeric_value=excluded.numeric_value,boolean_value=excluded.boolean_value,unit=excluded.unit,original_label=excluded.original_label,original_value_json=excluded.original_value_json,required=excluded.required,confidence=excluded.confidence,normalization_rule=excluded.normalization_rule,evidence_json=excluded.evidence_json",
    );
    const insertResolution = this.database.prepare(
      "INSERT INTO component_specification_resolutions(specification_id,field_code,status,selected_observation_id,observation_ids_json,rationale,resolved_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(specification_id,field_code) DO UPDATE SET status=excluded.status,selected_observation_id=excluded.selected_observation_id,observation_ids_json=excluded.observation_ids_json,rationale=excluded.rationale,resolved_at=excluded.resolved_at",
    );
    const insertConflict = this.database.prepare(
      "INSERT INTO component_specification_conflicts(id,component_id,field_code,observation_ids_json,conflict_json,detected_at,resolved_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET conflict_json=excluded.conflict_json,resolved_at=excluded.resolved_at",
    );
    const insertInheritance = this.database.prepare(
      "INSERT INTO component_specification_inheritance(component_id,field_code,source_observation_id,source_scope,rule_id,inherited_at) VALUES(?,?,?,?,?,?) ON CONFLICT(component_id,field_code,source_observation_id) DO NOTHING",
    );
    const insertReportSection = this.database.prepare(
      "INSERT INTO component_report_sections(component_kind,section_code,section_label_pt,display_order,created_at) VALUES(?,?,?,?,?) ON CONFLICT(component_kind,section_code) DO UPDATE SET section_label_pt=excluded.section_label_pt,display_order=excluded.display_order",
    );
    for (const field of technical.fields) {
      insertValue.run(specificationId, field.code, field.status, field.valueType,
        typeof field.value === "string" ? field.value : null,
        typeof field.value === "number" ? field.value : null,
        typeof field.value === "boolean" ? (field.value ? 1 : 0) : null,
        field.unit, field.originalLabel, JSON.stringify(field.originalValue), field.required ? 1 : 0,
        field.confidence, field.normalizationRule, JSON.stringify(field.sourceEvidence));
      if (field.sectionCode && field.sectionLabelPt) insertReportSection.run(component.kind, field.sectionCode, field.sectionLabelPt, field.displayOrder ?? 100_000, importedAt);
      if (field.resolution) {
        insertResolution.run(specificationId, field.code, field.resolution.status, field.resolution.selectedObservationId,
          JSON.stringify(field.resolution.observationIds), field.resolution.rationale, field.resolution.resolvedAt);
        if (field.resolution.status === "conflicting") {
          const conflictId = `conflict:${component.id}:${field.code}:${createHash("sha256").update(field.resolution.observationIds.join("|")).digest("hex").slice(0, 16)}`;
          insertConflict.run(conflictId, component.id, field.code, JSON.stringify(field.resolution.observationIds),
            JSON.stringify({ rationale: field.resolution.rationale, specificationId }), field.resolution.resolvedAt, null);
        }
        const selected = (technical.observations ?? []).find((observation) => observation.id === field.resolution?.selectedObservationId);
        if (selected && selected.scope !== "sku") {
          insertInheritance.run(component.id, field.code, selected.id, selected.scope, `scope-precedence:${selected.authority}`, field.resolution.resolvedAt);
        }
      }
    }
    this.database.prepare(
      "INSERT INTO component_specification_completeness(specification_id,component_id,required_field_count,published_required_field_count,completeness_percent,procurement_ready,completeness_json,assessed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(specification_id) DO UPDATE SET required_field_count=excluded.required_field_count,published_required_field_count=excluded.published_required_field_count,completeness_percent=excluded.completeness_percent,procurement_ready=excluded.procurement_ready,completeness_json=excluded.completeness_json,assessed_at=excluded.assessed_at",
    ).run(specificationId, component.id, technical.completeness.requiredFieldCount, technical.completeness.publishedRequiredFieldCount,
      technical.completeness.percent, technical.completeness.procurementReady ? 1 : 0, JSON.stringify(technical.completeness), importedAt);
  }

  private upsertComponentBuild(build: ComponentBuild, timestamp: string): void {
    this.database.prepare(
      "INSERT INTO component_builds(id,build_kind,hardware_template_id,operating_system,build_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET build_json=excluded.build_json,updated_at=excluded.updated_at",
    ).run(build.id, build.kind, build.hardwareTemplateId, build.operatingSystem, JSON.stringify(build), build.createdAt, timestamp);
    const insertItem = this.database.prepare(
      "INSERT INTO component_build_items(build_id,component_id,role,quantity,required) VALUES(?,?,?,?,?) ON CONFLICT(build_id,component_id,role) DO UPDATE SET quantity=excluded.quantity,required=excluded.required",
    );
    for (const item of build.items) insertItem.run(build.id, item.componentId, item.role, item.quantity, item.required ? 1 : 0);
    const insertDecision = this.database.prepare(
      "INSERT INTO component_build_decisions(id,build_id,compatible,decision_code,decision_json,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET compatible=excluded.compatible,decision_json=excluded.decision_json",
    );
    for (const [index, decision] of build.compatibility.entries()) {
      insertDecision.run(`decision:${build.id}:${index}:${decision.code}`, build.id, decision.compatible ? 1 : 0, decision.code, JSON.stringify(decision), timestamp);
    }
    this.database.prepare(
      "INSERT INTO evidence_coverage_reports(id,subject_type,subject_id,report_json,generated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET report_json=excluded.report_json,generated_at=excluded.generated_at",
    ).run(`coverage:${build.id}:${build.createdAt}`, "build", build.id, JSON.stringify(build.coverage), timestamp);
  }

  private upsertNormalizedPrediction(prediction: CapacityPrediction): void {
    const modelId = `capacity-model:${prediction.schemaVersion}`;
    this.database.prepare(
      "INSERT INTO capacity_model_versions(id,schema_version,model_json,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING",
    ).run(modelId, prediction.schemaVersion, JSON.stringify({
      method: "stage_specific_conservative_ratio",
      finalCapacity: "minimum_across_required_stages",
      procurementGate: ["validated_local", "extrapolated_high"],
    }), prediction.generatedAt);
    const stageStatement = this.database.prepare(
      "INSERT INTO capacity_prediction_stage_results(prediction_id,stage,result_json,raw_camera_capacity,safe_camera_capacity,reserve_percent) VALUES(?,?,?,?,?,?) ON CONFLICT(prediction_id,stage) DO UPDATE SET result_json=excluded.result_json,raw_camera_capacity=excluded.raw_camera_capacity,safe_camera_capacity=excluded.safe_camera_capacity,reserve_percent=excluded.reserve_percent",
    );
    for (const stage of prediction.stagePredictions) {
      stageStatement.run(prediction.id, stage.stage, JSON.stringify(stage), stage.rawCameraCapacity, stage.safeCameraCapacity, stage.reservePercent);
    }
    this.database.prepare(
      "INSERT INTO capacity_prediction_validations(prediction_id,procurement_eligibility,unsafe_overestimate_count,validation_json,validated_at) VALUES(?,?,?,?,?) ON CONFLICT(prediction_id) DO UPDATE SET procurement_eligibility=excluded.procurement_eligibility,unsafe_overestimate_count=excluded.unsafe_overestimate_count,validation_json=excluded.validation_json,validated_at=excluded.validated_at",
    ).run(prediction.id, prediction.procurementEligibility, prediction.leaveOneOutUnsafeOverestimateCount, JSON.stringify({
      status: prediction.status,
      confidenceClass: prediction.confidenceClass,
      reasons: prediction.reasons,
      modelId,
    }), prediction.generatedAt);
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
      const derived = deriveComponentCatalog(HARDWARE_CATALOG);
      for (const component of derived.components) this.upsertComponentIdentity(component, timestamp);
      for (const build of buildHistoricalComponentBuilds(HARDWARE_CATALOG, derived.components, [], []).map((item) => validateBuildCompatibility(item, derived.components))) {
        this.upsertComponentBuild(build, timestamp);
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
    const insertSpecification = this.database.prepare(
      "INSERT INTO procurement_specifications(id,recommendation_alternative_id,schema_version,status,procurement_eligibility,specification_json,generated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,procurement_eligibility=excluded.procurement_eligibility,specification_json=excluded.specification_json",
    );
    const insertRequirement = this.database.prepare(
      "INSERT INTO procurement_requirements(id,specification_id,component_kind,component_role,characteristic_code,comparator,requirement_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET requirement_json=excluded.requirement_json",
    );
    const insertMatch = this.database.prepare(
      "INSERT INTO procurement_market_matches(specification_id,component_id,manufacturer,assessment_status) VALUES(?,?,?,?) ON CONFLICT(specification_id,component_id) DO UPDATE SET manufacturer=excluded.manufacturer,assessment_status=excluded.assessment_status",
    );
    const insertFleetPlan = this.database.prepare(
      "INSERT INTO fleet_plans(id,recommendation_id,alternative_id,workload_signature,project_cameras,active_servers,reserve_servers,plan_json,generated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET plan_json=excluded.plan_json,generated_at=excluded.generated_at",
    );
    this.inTransaction(() => {
      for (const item of items) {
        statement.run(item.id, item.scenarioId, item.scenarioRevision, JSON.stringify(item), item.generatedAt);
        for (const alternative of [item.primary, ...item.alternatives]) {
          if (alternative.fleetPlan) {
            insertFleetPlan.run(`fleet:${item.id}:${alternative.id}`, item.id, alternative.id,
              alternative.fleetPlan.workloadSignature, alternative.fleetPlan.projectCameraCount,
              alternative.fleetPlan.activeServers, alternative.fleetPlan.reserveServers,
              JSON.stringify(alternative.fleetPlan), item.generatedAt);
          }
          const specification = alternative.procurementNeutralSpecification;
          if (!specification) continue;
          insertSpecification.run(specification.id, alternative.id, specification.schemaVersion, specification.status,
            specification.procurementEligibility, JSON.stringify(specification), specification.generatedAt);
          for (const requirement of specification.requirements) {
            insertRequirement.run(requirement.id, specification.id, requirement.componentKind, requirement.componentRole,
              requirement.characteristicCode, requirement.comparator, JSON.stringify(requirement));
          }
          for (const componentId of specification.marketCompetitionAssessment.matchingComponentIds) {
            const row = this.database.prepare("SELECT manufacturer FROM component_identities WHERE id=?").get(componentId) as { manufacturer?: string } | undefined;
            if (row?.manufacturer) insertMatch.run(specification.id, componentId, row.manufacturer, specification.marketCompetitionAssessment.status);
          }
        }
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
  async saveCalibrationRun(run: LocalCalibrationRun): Promise<void> {
    if (!this.calibrationExtensionReady) throw new Error("calibration_extension_unavailable");
    this.insertCalibrationRunV2(run);
  }
  async commitCalibrationRun(run: LocalCalibrationRun, predictions: CapacityPrediction[]): Promise<void> {
    if (!this.calibrationExtensionReady) throw new Error("calibration_extension_unavailable");
    this.inTransaction(() => {
      this.insertCalibrationRunV2(run);
      const runs = this.currentCalibrationRuns();
      for (const prediction of predictions) {
        this.insertPrediction(prediction);
        this.insertCapacityAssessment(prediction, runs);
      }
    }, "IMMEDIATE");
  }
  async listCalibrationRuns(): Promise<LocalCalibrationRun[]> {
    const current = this.calibrationExtensionReady
      ? rows(this.database.prepare("SELECT run_json FROM calibration_runs_v2 ORDER BY completed_at DESC").all())
        .map((row) => parseJson<LocalCalibrationRun>(row.run_json)) : [];
    const currentIds = new Set(current.map((run) => run.id));
    const legacy = rows(this.database.prepare("SELECT run_json FROM calibration_runs ORDER BY completed_at DESC").all())
      .map((row) => parseJson<LocalCalibrationRun>(row.run_json)).filter((run) => !currentIds.has(run.id));
    return [...current, ...legacy].sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  }
  async saveCalibrationSession(session: CalibrationSessionRecord): Promise<void> {
    if (!this.calibrationExtensionReady) throw new Error("calibration_extension_unavailable");
    const updatedAt = now();
    this.inTransaction(() => {
      this.database.prepare(
        "INSERT OR IGNORE INTO calibration_sessions_v2(id,plan_id,base_json,created_at) VALUES(?,?,?,?)",
      ).run(session.id, session.planId, JSON.stringify({ ...session, result: null, progress: null }), session.createdAt);
      this.database.prepare(
        "INSERT INTO calibration_session_events(session_id,state,session_json,created_at) VALUES(?,?,?,?)",
      ).run(session.id, session.state, JSON.stringify(session), updatedAt);
      this.database.prepare(
        "INSERT OR IGNORE INTO calibration_workload_profiles(id,signature,profile_json,created_at) VALUES(?,?,?,?)",
      ).run(session.plan.workloadProfile.id, session.plan.workloadProfile.signature, JSON.stringify(session.plan.workloadProfile), session.createdAt);
    }, "IMMEDIATE");
  }
  async getCalibrationSession(id: string): Promise<CalibrationSessionRecord | null> {
    if (!this.calibrationExtensionReady) {
      const legacy = this.database.prepare("SELECT session_json FROM calibration_sessions WHERE id=?").get(id) as Record<string, unknown> | undefined;
      return legacy ? parseJson<CalibrationSessionRecord>(legacy.session_json) : null;
    }
    const row = this.database.prepare(
      "SELECT session_json FROM calibration_session_events WHERE session_id=? ORDER BY event_id DESC LIMIT 1",
    ).get(id) as Record<string, unknown> | undefined;
    return row ? parseJson<CalibrationSessionRecord>(row.session_json) : null;
  }
  async listCalibrationSessions(): Promise<CalibrationSessionRecord[]> {
    if (!this.calibrationExtensionReady) {
      return rows(this.database.prepare("SELECT session_json FROM calibration_sessions ORDER BY created_at DESC").all())
        .map((row) => parseJson<CalibrationSessionRecord>(row.session_json));
    }
    return rows(this.database.prepare(
      "SELECT e.session_json FROM calibration_session_events e JOIN (SELECT session_id,MAX(event_id) event_id FROM calibration_session_events GROUP BY session_id) latest ON latest.event_id=e.event_id ORDER BY e.event_id DESC",
    ).all())
      .map((row) => parseJson<CalibrationSessionRecord>(row.session_json));
  }
  async saveCalibrationCheckpoint(checkpoint: CalibrationCheckpoint): Promise<void> {
    if (!this.calibrationExtensionReady) throw new Error("calibration_extension_unavailable");
    this.database.prepare(
      "INSERT INTO calibration_checkpoints(id,session_id,sequence,checkpoint_json,payload_sha256,created_at) VALUES(?,?,?,?,?,?)",
    ).run(checkpoint.id, checkpoint.sessionId, checkpoint.sequence, JSON.stringify(checkpoint), checkpoint.payloadSha256, checkpoint.createdAt);
  }
  async listCalibrationCheckpoints(sessionId: string): Promise<CalibrationCheckpoint[]> {
    if (!this.calibrationExtensionReady) return [];
    return rows(this.database.prepare(
      "SELECT checkpoint_json FROM calibration_checkpoints WHERE session_id=? ORDER BY sequence DESC",
    ).all(sessionId)).map((row) => parseJson<CalibrationCheckpoint>(row.checkpoint_json));
  }
  async saveCalibrationSessionLineage(lineage: CalibrationSessionLineage): Promise<void> {
    if (!this.calibrationExtensionReady) throw new Error("calibration_extension_unavailable");
    this.database.prepare(
      "INSERT INTO calibration_session_lineage(id,parent_session_id,child_session_id,checkpoint_id,created_at) VALUES(?,?,?,?,?)",
    ).run(lineage.id, lineage.parentSessionId, lineage.childSessionId, lineage.checkpointId, lineage.createdAt);
  }
  async saveCalibrationDeviceIdentity(identity: CalibrationDeviceIdentity): Promise<void> {
    if (!this.calibrationExtensionReady) throw new Error("calibration_extension_unavailable");
    const existing = this.database.prepare(
      "SELECT public_key_pem FROM calibration_device_identities WHERE id=?",
    ).get(identity.id) as { public_key_pem?: string } | undefined;
    if (existing?.public_key_pem && existing.public_key_pem !== identity.publicKeyPem) {
      throw new Error("calibration_device_key_changed");
    }
    this.database.prepare(
      "INSERT OR IGNORE INTO calibration_device_identities(id,public_key_pem,short_code,trust_state,protection,first_seen_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).run(identity.id, identity.publicKeyPem, identity.shortCode, identity.trust, identity.protection, identity.firstSeenAt, identity.updatedAt);
  }
  async listCalibrationDeviceIdentities(): Promise<CalibrationDeviceIdentity[]> {
    if (!this.calibrationExtensionReady) return [];
    return rows(this.database.prepare(
      "SELECT id,public_key_pem,short_code,trust_state,protection,first_seen_at,updated_at FROM calibration_device_identities ORDER BY updated_at DESC",
    ).all()).map((row) => ({
      id: String(row.id), publicKeyPem: String(row.public_key_pem), shortCode: String(row.short_code),
      trust: row.trust_state as CalibrationDeviceIdentity["trust"],
      protection: row.protection as CalibrationDeviceIdentity["protection"],
      firstSeenAt: String(row.first_seen_at), updatedAt: String(row.updated_at),
    }));
  }
  async listCalibrationRunProvenance(): Promise<CalibrationRunProvenance[]> {
    if (!this.calibrationExtensionReady) return [];
    return rows(this.database.prepare(
      "SELECT run_id,source,device_id,package_digest,trusted_at_import,imported_at FROM calibration_run_provenance",
    ).all()).map((row) => ({
      runId: String(row.run_id), source: row.source as CalibrationRunProvenance["source"],
      deviceId: String(row.device_id), packageDigest: String(row.package_digest),
      trustedAtImport: Number(row.trusted_at_import) === 1,
      importedAt: row.imported_at === null ? null : String(row.imported_at),
    }));
  }
  async setCalibrationDeviceTrust(id: string, trust: CalibrationDeviceIdentity["trust"]): Promise<CalibrationDeviceIdentity> {
    if (!this.calibrationExtensionReady) throw new Error("calibration_extension_unavailable");
    const result = this.database.prepare(
      "UPDATE calibration_device_identities SET trust_state=?,updated_at=? WHERE id=?",
    ).run(trust, now(), id);
    if (result.changes !== 1) throw new Error("calibration_device_not_found");
    const identity = (await this.listCalibrationDeviceIdentities()).find((item) => item.id === id);
    if (!identity) throw new Error("calibration_device_not_found");
    return identity;
  }
  async commitCalibrationImport(input: {
    batch: CalibrationImportBatch;
    items: CalibrationImportItem[];
    deviceIdentities: CalibrationDeviceIdentity[];
    runs: Array<{ run: LocalCalibrationRun; provenance: CalibrationRunProvenance; workloadProfile: CalibrationWorkloadProfile }>;
    predictions: CapacityPrediction[];
  }): Promise<void> {
    if (!this.calibrationExtensionReady) throw new Error("calibration_extension_unavailable");
    this.inTransaction(() => {
      for (const identity of input.deviceIdentities) {
        const existing = this.database.prepare("SELECT public_key_pem FROM calibration_device_identities WHERE id=?")
          .get(identity.id) as { public_key_pem?: string } | undefined;
        if (existing?.public_key_pem && existing.public_key_pem !== identity.publicKeyPem) throw new Error("calibration_device_key_changed");
        this.database.prepare(
          "INSERT OR IGNORE INTO calibration_device_identities(id,public_key_pem,short_code,trust_state,protection,first_seen_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        ).run(identity.id, identity.publicKeyPem, identity.shortCode, identity.trust, identity.protection, identity.firstSeenAt, identity.updatedAt);
      }
      this.database.prepare(
        "INSERT INTO calibration_import_batches(id,format,batch_json,created_at,completed_at) VALUES(?,?,?,?,?)",
      ).run(input.batch.id, input.batch.format, JSON.stringify(input.batch), input.batch.createdAt, input.batch.completedAt);
      const itemStatement = this.database.prepare(
        "INSERT INTO calibration_import_items(id,batch_id,run_id,package_digest,status,item_json,recorded_at) VALUES(?,?,?,?,?,?,?)",
      );
      for (const item of input.items) {
        itemStatement.run(item.id, item.batchId, item.runId, item.packageDigest, item.status, JSON.stringify(item), item.recordedAt);
      }
      for (const { run, provenance, workloadProfile } of input.runs) {
        this.insertCalibrationRunV2(run);
        this.database.prepare(
          "INSERT OR IGNORE INTO calibration_workload_profiles(id,signature,profile_json,created_at) VALUES(?,?,?,?)",
        ).run(workloadProfile.id, workloadProfile.signature, JSON.stringify(workloadProfile), run.createdAt);
        const hardwareDigest = calibrationHardwareDigest(run.fingerprint);
        const measuredSystemId = createHash("sha256").update(JSON.stringify({
          hardwareDigest,
          hostnameHash: run.fingerprint.hostnameHash,
        })).digest("hex");
        this.database.prepare(
          "INSERT OR IGNORE INTO measured_system_identities(id,hardware_digest,identity_json,first_seen_at) VALUES(?,?,?,?)",
        ).run(measuredSystemId, hardwareDigest, JSON.stringify({ fingerprint: run.fingerprint }), run.completedAt);
        this.database.prepare(
          "INSERT INTO calibration_run_provenance(run_id,source,device_id,package_digest,trusted_at_import,imported_at) VALUES(?,?,?,?,?,?)",
        ).run(run.id, provenance.source, provenance.deviceId, provenance.packageDigest,
          provenance.trustedAtImport ? 1 : 0, provenance.importedAt);
      }
      const runs = this.currentCalibrationRuns();
      for (const prediction of input.predictions) {
        this.insertPrediction(prediction);
        this.insertCapacityAssessment(prediction, runs);
      }
    }, "IMMEDIATE");
  }
  async saveCalibrationExportEvent(event: CalibrationExportEvent): Promise<void> {
    if (!this.calibrationExtensionReady) throw new Error("calibration_extension_unavailable");
    this.database.prepare(
      "INSERT INTO calibration_export_events(id,format,event_json,created_at) VALUES(?,?,?,?)",
    ).run(event.id, event.format, JSON.stringify(event), event.createdAt);
  }
  async saveCalibrationCollectionSnapshot(snapshot: CalibrationCollectionSnapshot): Promise<void> {
    if (!this.calibrationExtensionReady) throw new Error("calibration_extension_unavailable");
    this.database.prepare(
      "INSERT INTO calibration_collection_snapshots(id,package_digest,result_count,snapshot_json,created_at) VALUES(?,?,?,?,?)",
    ).run(snapshot.id, snapshot.packageDigest, snapshot.resultCount, JSON.stringify(snapshot), snapshot.createdAt);
  }
  async listCalibrationExportEvents(): Promise<CalibrationExportEvent[]> {
    if (!this.calibrationExtensionReady) return [];
    return rows(this.database.prepare(
      "SELECT event_json FROM calibration_export_events ORDER BY created_at DESC",
    ).all()).map((row) => parseJson<CalibrationExportEvent>(row.event_json));
  }
  async listCapacityAssessments(): Promise<HardwareCapacityAssessment[]> {
    if (!this.calibrationExtensionReady) return [];
    return rows(this.database.prepare("SELECT assessment_json FROM hardware_capacity_assessments ORDER BY generated_at DESC").all())
      .map((row) => parseJson<HardwareCapacityAssessment>(row.assessment_json));
  }
  async upsertBenchmarkObservations(observations: PublicBenchmarkObservation[]): Promise<void> {
    const statement = this.database.prepare(
      "INSERT INTO public_benchmark_observations(id,hardware_template_id,stage,profile_id,observation_json,observed_at,imported_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hardware_template_id=excluded.hardware_template_id,stage=excluded.stage,profile_id=excluded.profile_id,observation_json=excluded.observation_json,observed_at=excluded.observed_at,imported_at=excluded.imported_at",
    );
    this.inTransaction(() => {
      for (const observation of observations) {
        const importedAt = now();
        statement.run(observation.id, observation.hardwareTemplateId, observation.stage, observation.profileId, JSON.stringify(observation), observation.observedAt, importedAt);
        this.upsertNormalizedBenchmarkObservation(observation, importedAt);
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
      for (const component of snapshot.components ?? []) {
        componentStatement.run(component.id, JSON.stringify(component), importedAt);
        this.upsertComponentIdentity(component, importedAt);
        this.database.prepare(
          "INSERT INTO evidence_snapshot_components(catalog_version,component_id) VALUES(?,?) ON CONFLICT(catalog_version,component_id) DO NOTHING",
        ).run(snapshot.catalogVersion, component.id);
      }
      for (const observation of snapshot.observations) {
        observationStatement.run(observation.id, observation.hardwareTemplateId, observation.stage, observation.profileId, JSON.stringify(observation), observation.observedAt, importedAt);
        this.upsertNormalizedBenchmarkObservation(observation, importedAt);
        this.database.prepare(
          "INSERT INTO evidence_snapshot_observations(catalog_version,observation_id) VALUES(?,?) ON CONFLICT(catalog_version,observation_id) DO NOTHING",
        ).run(snapshot.catalogVersion, observation.id);
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
  async listCatalogComponents(): Promise<HardwareComponent[]> {
    const result = rows(this.database.prepare("SELECT component_json FROM component_identities ORDER BY kind,manufacturer,canonical_mpn").all());
    return result.map((row) => parseJson<HardwareComponent>(row.component_json));
  }
  async listComponentSpecificationHistory(componentId: string): Promise<ComponentTechnicalSpecification[]> {
    return rows(this.database.prepare(
      "SELECT specification_json FROM component_technical_specification_versions WHERE component_id=? ORDER BY generated_at DESC, imported_at DESC",
    ).all(componentId)).map((row) => parseJson<ComponentTechnicalSpecification>(row.specification_json));
  }
  async saveComponentBuilds(builds: ComponentBuild[]): Promise<void> {
    this.inTransaction(() => {
      const timestamp = now();
      for (const build of builds) this.upsertComponentBuild(build, timestamp);
    }, "IMMEDIATE");
  }
  async listComponentBuilds(): Promise<ComponentBuild[]> {
    return rows(this.database.prepare("SELECT build_json FROM component_builds ORDER BY updated_at DESC,json_extract(build_json,'$.name') COLLATE NOCASE").all())
      .map((row) => parseJson<ComponentBuild>(row.build_json));
  }
  async getComponentBuild(id: string): Promise<ComponentBuild | null> {
    const row = this.database.prepare("SELECT build_json FROM component_builds WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? parseJson<ComponentBuild>(row.build_json) : null;
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
      for (const component of bundle.components) {
        insertComponent.run(component.id, JSON.stringify(component), timestamp);
        this.upsertComponentIdentity(component, timestamp);
      }
      for (const quote of bundle.prices) {
        if (quote.scope === "component" && quote.componentId) insertComponentQuote.run(quote.id, quote.componentId, bundle.sequence, JSON.stringify(quote), quote.observedAt);
        else if (quote.hardwareTemplateId) insertQuote.run(quote.id, quote.hardwareTemplateId, JSON.stringify(quote), quote.observedAt);
      }
      for (const observation of bundle.benchmarks) {
        insertBenchmark.run(observation.id, observation.hardwareTemplateId, observation.stage, observation.profileId, JSON.stringify(observation), observation.observedAt, timestamp);
        this.upsertNormalizedBenchmarkObservation(observation, timestamp);
      }
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
    this.inTransaction(() => {
      const runs = this.currentCalibrationRuns();
      for (const prediction of predictions) {
        this.insertPrediction(prediction);
        this.insertCapacityAssessment(prediction, runs);
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
