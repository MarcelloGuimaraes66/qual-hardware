import { randomUUID } from "node:crypto";
import pg from "pg";
import { HARDWARE_CATALOG, SEED_PRICE_QUOTES } from "../engine/catalog.js";
import { assertDedicatedDatabaseUrl } from "./database.js";
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

function scenarioRow(row: Record<string, unknown>): ScenarioRecord {
  return {
    id: String(row.id), revision: Number(row.revision), createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(), scenario: row.scenario_json as CapacityScenario,
  };
}

export class PostgresPlannerStore implements PlannerStore {
  private readonly pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString: assertDedicatedDatabaseUrl(connectionString), max: 10 });
  }
  async listScenarios(): Promise<ScenarioRecord[]> {
    const result = await this.pool.query("SELECT * FROM qual_hardware.scenarios ORDER BY updated_at DESC");
    return result.rows.map(scenarioRow);
  }
  async getScenario(id: string): Promise<ScenarioRecord | null> {
    const result = await this.pool.query("SELECT * FROM qual_hardware.scenarios WHERE id=$1", [id]);
    return result.rows[0] ? scenarioRow(result.rows[0]) : null;
  }
  async createScenario(scenario: CapacityScenario): Promise<ScenarioRecord> {
    const id = randomUUID();
    const result = await this.pool.query(
      "INSERT INTO qual_hardware.scenarios(id,revision,scenario_json) VALUES($1,1,$2) RETURNING *", [id, scenario]);
    return scenarioRow(result.rows[0]);
  }
  async updateScenario(id: string, expectedRevision: number, scenario: CapacityScenario): Promise<ScenarioRecord> {
    const result = await this.pool.query(
      "UPDATE qual_hardware.scenarios SET revision=revision+1,scenario_json=$3,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *",
      [id, expectedRevision, scenario]);
    if (result.rows[0]) return scenarioRow(result.rows[0]);
    const current = await this.getScenario(id);
    if (!current) throw new Error("scenario_not_found");
    throw new RevisionConflictError(current.revision);
  }
  async duplicateScenario(id: string): Promise<ScenarioRecord | null> {
    const source = await this.getScenario(id);
    return source ? this.createScenario({ ...source.scenario, projectName: `${source.scenario.projectName} — Copy` }) : null;
  }
  async saveRecommendations(items: CapacityRecommendation[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const item of items) await client.query(
        "INSERT INTO qual_hardware.recommendations(id,scenario_id,scenario_revision,recommendation_json,generated_at) VALUES($1,$2,$3,$4,$5)",
        [item.id, item.scenarioId, item.scenarioRevision, item, item.generatedAt]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async listRecommendations(scenarioId: string): Promise<CapacityRecommendation[]> {
    const result = await this.pool.query(
      "SELECT recommendation_json FROM qual_hardware.recommendations WHERE scenario_id=$1 ORDER BY generated_at DESC", [scenarioId]);
    return result.rows.map((row) => row.recommendation_json as CapacityRecommendation);
  }
  async getRecommendation(id: string): Promise<CapacityRecommendation | null> {
    const result = await this.pool.query("SELECT recommendation_json FROM qual_hardware.recommendations WHERE id=$1", [id]);
    return (result.rows[0]?.recommendation_json as CapacityRecommendation | undefined) ?? null;
  }
  async saveManifest(manifest: BenchmarkManifest): Promise<void> {
    await this.pool.query(
      "INSERT INTO qual_hardware.benchmark_manifests(id,scenario_id,scenario_revision,manifest_json,expires_at) VALUES($1,$2,$3,$4,$5)",
      [manifest.id, manifest.scenarioId, manifest.scenarioRevision, manifest, manifest.expiresAt]);
  }
  async getManifest(id: string): Promise<BenchmarkManifest | null> {
    const result = await this.pool.query("SELECT manifest_json FROM qual_hardware.benchmark_manifests WHERE id=$1", [id]);
    return (result.rows[0]?.manifest_json as BenchmarkManifest | undefined) ?? null;
  }
  async saveBenchmarkResult(result: BenchmarkResultRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO qual_hardware.benchmark_results(manifest_id,result_json,received_at) VALUES($1,$2,$3) ON CONFLICT(manifest_id) DO UPDATE SET result_json=excluded.result_json,received_at=excluded.received_at",
      [result.manifestId, result, result.receivedAt]);
  }
  async getBenchmarkResult(manifestId: string): Promise<BenchmarkResultRecord | null> {
    const result = await this.pool.query("SELECT result_json FROM qual_hardware.benchmark_results WHERE manifest_id=$1", [manifestId]);
    return (result.rows[0]?.result_json as BenchmarkResultRecord | undefined) ?? null;
  }
  async listBenchmarkEvidence(scenarioId: string, revision: number): Promise<BenchmarkEvidence[]> {
    const result = await this.pool.query(
      "SELECT m.manifest_json,r.result_json FROM qual_hardware.benchmark_manifests m JOIN qual_hardware.benchmark_results r ON r.manifest_id=m.id WHERE m.scenario_id=$1 AND m.scenario_revision=$2",
      [scenarioId, revision]);
    return result.rows.map((row) => ({ manifest: row.manifest_json as BenchmarkManifest, result: row.result_json as BenchmarkResultRecord }));
  }
  async getCatalog(): Promise<HardwareNodeTemplate[]> {
    const result = await this.pool.query("SELECT template_json FROM qual_hardware.hardware_catalog ORDER BY id");
    return result.rowCount ? result.rows.map((row) => row.template_json as HardwareNodeTemplate) : HARDWARE_CATALOG;
  }
  async replaceCatalog(hardware: HardwareNodeTemplate[], quotes: PriceQuote[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM qual_hardware.hardware_catalog");
      await client.query("DELETE FROM qual_hardware.price_quotes");
      for (const item of hardware) await client.query(
        "INSERT INTO qual_hardware.hardware_catalog(id,template_json) VALUES($1,$2)", [item.id, item]);
      for (const quote of quotes) await client.query(
        "INSERT INTO qual_hardware.price_quotes(id,hardware_template_id,quote_json,observed_at) VALUES($1,$2,$3,$4)",
        [quote.id, quote.hardwareTemplateId, quote, quote.observedAt]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async getQuotes(): Promise<PriceQuote[]> {
    const result = await this.pool.query("SELECT quote_json FROM qual_hardware.price_quotes ORDER BY observed_at DESC");
    return result.rows.map((row) => row.quote_json as PriceQuote);
  }
  async upsertQuotes(quotes: PriceQuote[]): Promise<void> {
    for (const quote of quotes) await this.pool.query(
      "INSERT INTO qual_hardware.price_quotes(id,hardware_template_id,quote_json,observed_at) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET quote_json=excluded.quote_json,observed_at=excluded.observed_at",
      [quote.id, quote.hardwareTemplateId, quote, quote.observedAt]);
  }
  async enqueue(jobType: string, payload: unknown): Promise<number> {
    const result = await this.pool.query("INSERT INTO qual_hardware.work_queue(job_type,payload_json) VALUES($1,$2) RETURNING id", [jobType, payload]);
    return Number(result.rows[0].id);
  }
  async claimJob(): Promise<ClaimedJob | null> {
    const result = await this.pool.query(`WITH next AS (
      SELECT id FROM qual_hardware.work_queue WHERE status='queued' AND available_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE qual_hardware.work_queue q SET status='running',locked_at=now(),attempts=attempts+1 FROM next WHERE q.id=next.id
      RETURNING q.id,q.job_type,q.payload_json`);
    const row = result.rows[0];
    return row ? { id: Number(row.id), jobType: String(row.job_type), payload: row.payload_json } : null;
  }
  async finishJob(id: number, error: string | null): Promise<void> {
    await this.pool.query(
      "UPDATE qual_hardware.work_queue SET status=$2,completed_at=now(),error_text=$3 WHERE id=$1",
      [id, error === null ? "completed" : "failed", error]);
  }
  async close(): Promise<void> { await this.pool.end(); }
}

export function createStore(): PlannerStore {
  return process.env.DATABASE_URL ? new PostgresPlannerStore(process.env.DATABASE_URL) : new MemoryPlannerStore();
}
