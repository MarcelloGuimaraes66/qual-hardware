import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HARDWARE_CATALOG, SEED_PRICE_QUOTES } from "../engine/catalog.js";
import { assertDedicatedSqlitePath, QUAL_HARDWARE_SQLITE_SCHEMA_VERSION } from "./database.js";
import type {
  BenchmarkManifest,
  BenchmarkResultRecord,
  CapacityRecommendation,
  CapacityScenario,
  HardwareNodeTemplate,
  PriceQuote,
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
    const count = Number((this.database.prepare("SELECT COUNT(*) AS count FROM hardware_catalog").get() as { count: number }).count);
    if (count > 0) return;
    const insertHardware = this.database.prepare(
      "INSERT INTO hardware_catalog(id,template_json,updated_at) VALUES(?,?,?)",
    );
    const insertQuote = this.database.prepare(
      "INSERT INTO price_quotes(id,hardware_template_id,quote_json,observed_at) VALUES(?,?,?,?)",
    );
    this.inTransaction(() => {
      const timestamp = now();
      for (const item of HARDWARE_CATALOG) insertHardware.run(item.id, JSON.stringify(item), timestamp);
      for (const quote of SEED_PRICE_QUOTES) {
        insertQuote.run(quote.id, quote.hardwareTemplateId, JSON.stringify(quote), quote.observedAt);
      }
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
  async getCatalog(): Promise<HardwareNodeTemplate[]> {
    const result = rows(this.database.prepare("SELECT template_json FROM hardware_catalog ORDER BY id").all());
    return result.length ? result.map((row) => parseJson<HardwareNodeTemplate>(row.template_json)) : HARDWARE_CATALOG;
  }
  async replaceCatalog(hardware: HardwareNodeTemplate[], quotes: PriceQuote[]): Promise<void> {
    const insertHardware = this.database.prepare(
      "INSERT INTO hardware_catalog(id,template_json,updated_at) VALUES(?,?,?)",
    );
    const insertQuote = this.database.prepare(
      "INSERT INTO price_quotes(id,hardware_template_id,quote_json,observed_at) VALUES(?,?,?,?)",
    );
    this.inTransaction(() => {
      this.database.exec("DELETE FROM price_quotes; DELETE FROM hardware_catalog;");
      const timestamp = now();
      for (const item of hardware) insertHardware.run(item.id, JSON.stringify(item), timestamp);
      for (const quote of quotes) {
        insertQuote.run(quote.id, quote.hardwareTemplateId, JSON.stringify(quote), quote.observedAt);
      }
    }, "IMMEDIATE");
  }
  async getQuotes(): Promise<PriceQuote[]> {
    return rows(this.database.prepare("SELECT quote_json FROM price_quotes ORDER BY observed_at DESC").all())
      .map((row) => parseJson<PriceQuote>(row.quote_json));
  }
  async upsertQuotes(quotes: PriceQuote[]): Promise<void> {
    const statement = this.database.prepare(
      "INSERT INTO price_quotes(id,hardware_template_id,quote_json,observed_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET hardware_template_id=excluded.hardware_template_id,quote_json=excluded.quote_json,observed_at=excluded.observed_at",
    );
    this.inTransaction(() => {
      for (const quote of quotes) {
        statement.run(quote.id, quote.hardwareTemplateId, JSON.stringify(quote), quote.observedAt);
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
