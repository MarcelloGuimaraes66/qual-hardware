import { describe, expect, it } from "vitest";
import { buildRecommendations } from "../src/engine/capacity.js";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import { createDefaultScenario } from "../src/shared/schemas.js";
import type { BenchmarkMetrics, ScenarioRecord } from "../src/shared/types.js";
import { createBenchmarkManifest, validateBenchmark } from "../src/server/benchmark.js";
import { findForbiddenBenchmarkData } from "../src/server/security.js";

function fixture() {
  const scenario = createDefaultScenario(8); scenario.perceptrumBuildHash = "build-abc";
  const record: ScenarioRecord = { id: "00000000-0000-4000-8000-000000000001", revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), scenario };
  const recommendation = buildRecommendations(record.id, 1, scenario, HARDWARE_CATALOG, [])[1]!;
  const manifest = createBenchmarkManifest(record, recommendation, "https://qual-hardware.internal", "600.1", 10_000);
  const metrics: BenchmarkMetrics = {
    cpuModel: manifest.targetHardware.cpuModel, gpuModel: manifest.targetHardware.gpuModel, gpuDriver: "600.1",
    perceptrumBuildHash: "build-abc", workloadContractVersion: manifest.workloadContractVersion,
    startedAt: "2026-07-17T10:00:00.000Z", completedAt: "2026-07-17T11:30:00.000Z",
    p95InferenceLatencyMs: 3000, p99InferenceLatencyMs: 5000, peakCpuPercent: 68, peakRamBytes: 100,
    peakGpuPercent: 75, peakVramBytes: 100, peakDecoderPercent: 60, peakDiskWriteBytesPerSecond: 100,
    gpuTelemetryAvailable: true, peakHandleCount: 100, peakThreadCount: 50, peakProcessCount: 3,
    peakNetworkReceiveBytesPerSecond: 100, captureReadP95Ms: 5, decodeP95Ms: 8, maxQueueDepth: 3, queueGrowthPerMinute: 0,
    inferenceSuccessRate: 1, outOfMemoryCount: 0, mediaFieldCount: 0, credentialFieldCount: 0,
    phases: manifest.phases.map((phase) => ({ ...phase, p95InferenceLatencyMs: 3000, maxQueueDepth: 3, queueGrowthPerMinute: 0, outOfMemoryCount: 0 })),
  };
  return { manifest, metrics };
}

describe("benchmark validation", () => {
  it("validates only a complete matching run", () => {
    const { manifest, metrics } = fixture();
    expect(validateBenchmark(manifest, metrics).passed).toBe(true);
    expect(validateBenchmark(manifest, { ...metrics, outOfMemoryCount: 1 }).failures).toContain("out_of_memory");
    expect(validateBenchmark(manifest, { ...metrics, completedAt: "2026-07-17T10:30:00.000Z" }).failures).toContain("benchmark_duration_too_short");
    expect(validateBenchmark(manifest, { ...metrics, gpuDriver: "different" }).failures).toContain("gpu_driver_mismatch");
  });

  it("rejects media, frame and RTSP credential-shaped payloads", () => {
    expect(findForbiddenBenchmarkData({ metrics: { peakCpuPercent: 20 } })).toEqual([]);
    expect(findForbiddenBenchmarkData({ frameBase64: "abc" })).not.toEqual([]);
    expect(findForbiddenBenchmarkData({ endpoint: "rtsp://user:pass@camera" })).not.toEqual([]);
  });
});
