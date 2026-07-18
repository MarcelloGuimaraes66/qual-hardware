import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  BenchmarkManifest,
  BenchmarkMetrics,
  BenchmarkResultRecord,
  CapacityRecommendation,
  ScenarioRecord,
} from "../shared/types.js";

export function createBenchmarkManifest(
  scenario: ScenarioRecord,
  recommendation: CapacityRecommendation,
  publicBaseUrl: string,
  gpuDriver: string,
  slaInferenceLatencyMs: number,
): BenchmarkManifest {
  const id = randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
  return {
    schemaVersion: "capacity-benchmark-manifest/1.0.0",
    id,
    nonce: randomBytes(32).toString("base64url"),
    scenarioId: scenario.id,
    scenarioRevision: scenario.revision,
    workloadContractVersion: recommendation.contractVersion,
    perceptrumBuildHash: scenario.scenario.perceptrumBuildHash,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    uploadUrl: `${publicBaseUrl.replace(/\/$/, "")}/api/benchmarks/${id}/results`,
    targetHardware: {
      cpuModel: recommendation.primary.hardware.cpuModel,
      gpuModel: recommendation.primary.hardware.gpuModel,
      gpuDriver,
    },
    slaInferenceLatencyMs,
    privacy: { acceptMedia: false, acceptRtspCredentials: false, aggregateMetricsOnly: true },
    phases: [
      { name: "warmup", durationSeconds: 900, loadPercent: 100 },
      { name: "sustained", durationSeconds: 3600, loadPercent: 100 },
      { name: "surge", durationSeconds: 900, loadPercent: 120 },
    ],
    scenario: scenario.scenario,
  };
}

export function nonceMatches(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function validateBenchmark(manifest: BenchmarkManifest, metrics: BenchmarkMetrics): BenchmarkResultRecord {
  const failures: string[] = [];
  if (Date.now() > Date.parse(manifest.expiresAt)) failures.push("manifest_expired");
  if (metrics.perceptrumBuildHash !== manifest.perceptrumBuildHash) failures.push("build_hash_mismatch");
  if (metrics.workloadContractVersion !== manifest.workloadContractVersion) failures.push("workload_contract_mismatch");
  if (!hardwareModelMatches(metrics.cpuModel, manifest.targetHardware.cpuModel)) failures.push("cpu_mismatch");
  if (!hardwareModelMatches(metrics.gpuModel, manifest.targetHardware.gpuModel)) failures.push("gpu_mismatch");
  if (metrics.gpuDriver !== manifest.targetHardware.gpuDriver) failures.push("gpu_driver_mismatch");
  if (!metrics.gpuTelemetryAvailable) failures.push("gpu_telemetry_unavailable");
  if (metrics.mediaFieldCount !== 0 || metrics.credentialFieldCount !== 0) failures.push("privacy_counter_nonzero");
  if (metrics.outOfMemoryCount > 0) failures.push("out_of_memory");
  if (metrics.queueGrowthPerMinute > 0.05) failures.push("queue_is_growing");
  if (metrics.inferenceSuccessRate < 0.99) failures.push("inference_success_below_99_percent");
  if (metrics.p95InferenceLatencyMs > manifest.slaInferenceLatencyMs) failures.push("inference_sla_exceeded");

  const elapsed = (Date.parse(metrics.completedAt) - Date.parse(metrics.startedAt)) / 1000;
  const requiredElapsed = manifest.phases.reduce((sum, phase) => sum + phase.durationSeconds, 0);
  if (!Number.isFinite(elapsed) || elapsed < requiredElapsed) failures.push("benchmark_duration_too_short");
  for (const required of manifest.phases) {
    const actual = metrics.phases.find((phase) => phase.name === required.name);
    if (!actual) { failures.push(`missing_phase:${required.name}`); continue; }
    if (actual.durationSeconds < required.durationSeconds) failures.push(`phase_too_short:${required.name}`);
    if (actual.loadPercent < required.loadPercent) failures.push(`phase_load_too_low:${required.name}`);
    if (actual.outOfMemoryCount > 0) failures.push(`phase_oom:${required.name}`);
    if (actual.queueGrowthPerMinute > 0.05) failures.push(`phase_queue_growth:${required.name}`);
    if (actual.p95InferenceLatencyMs > manifest.slaInferenceLatencyMs) failures.push(`phase_sla_exceeded:${required.name}`);
  }
  return {
    manifestId: manifest.id,
    receivedAt: new Date().toISOString(),
    passed: failures.length === 0,
    failures: [...new Set(failures)],
    metrics,
  };
}

function normalizedHardwareModel(value: string): string {
  return value.toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+\s*[x×]\s*/g, " ")
    .replace(/\b\d+\s*(gb|gib)\b/g, " ")
    .replace(/\(r\)|\(tm\)|®|™/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hardwareModelMatches(actual: string, expected: string): boolean {
  const actualNormalized = normalizedHardwareModel(actual);
  const expectedNormalized = normalizedHardwareModel(expected);
  return actualNormalized.length > 3 && expectedNormalized.length > 3 &&
    (actualNormalized.includes(expectedNormalized) || expectedNormalized.includes(actualNormalized));
}

export function evidenceValidatesRecommendation(
  recommendation: CapacityRecommendation,
  evidence: Array<{ manifest: BenchmarkManifest; result: BenchmarkResultRecord }>,
): boolean {
  if (recommendation.primary.activeNodeCount !== 1) return false;
  return evidence.some(({ manifest, result }) => result.passed &&
    manifest.perceptrumBuildHash === recommendation.perceptrumBuildHash &&
    manifest.workloadContractVersion === recommendation.contractVersion &&
    manifest.targetHardware.cpuModel === recommendation.primary.hardware.cpuModel &&
    manifest.targetHardware.gpuModel === recommendation.primary.hardware.gpuModel);
}
