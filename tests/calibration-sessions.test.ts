import { describe, expect, it, vi } from "vitest";
import { createCalibrationPlan } from "../src/engine/calibration.js";
import { createDefaultScenario } from "../src/shared/schemas.js";
import { LEGACY_LOCAL_CALIBRATION_VERSION, WORKLOAD_CONTRACT_VERSION } from "../src/shared/types.js";
import { createApp } from "../src/server/app.js";
import {
  authorizeCalibrationSession,
  calibrationPayloadSha256,
  cancelDeliveredCalibrationSession,
  createCalibrationSession,
  deliverCalibrationSession,
  normalizeCalibrationProgress,
  legacyCalibrationPayloadSha256,
  publicCalibrationSession,
  resolveCalibrationDirectory,
  tokenSha256,
  validatePerceptrumProtocolUri,
} from "../src/server/calibrationSessions.js";
import { MemoryPlannerStore } from "../src/server/store.js";

function session() {
  const plan = createCalibrationPlan(createDefaultScenario(8), "quick", null);
  return createCalibrationSession({
    plan,
    recommendationId: "00000000-0000-4000-8000-000000000010",
    scenarioId: "00000000-0000-4000-8000-000000000011",
    advancedTelemetry: true,
    callbackOrigin: "http://127.0.0.1:49152",
    now: new Date("2026-07-18T12:00:00.000Z"),
  });
}

describe("secure cross-platform calibration handoff", () => {
  it("uses a canonical checksum while retaining the legacy ordered checksum", () => {
    const first = { schemaVersion: "x", z: 1, nested: { z: 2, a: 3 } } as never;
    const reordered = { nested: { a: 3, z: 2 }, z: 1, schemaVersion: "x" } as never;
    expect(calibrationPayloadSha256(first)).toBe(calibrationPayloadSha256(reordered));
    expect(legacyCalibrationPayloadSha256(first)).not.toBe(legacyCalibrationPayloadSha256(reordered));
  });

  it("persists only a token hash and exposes no secret in public session state", async () => {
    const created = session();
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.record.tokenHash).toBe(tokenSha256(created.token));
    expect(JSON.stringify(publicCalibrationSession(created.record))).not.toContain(created.token);
    expect(validatePerceptrumProtocolUri(created.uri)).toBe(created.uri);
    expect(validatePerceptrumProtocolUri(created.uri.replace("127.0.0.1", "example.com"))).toBeNull();

    const store = new MemoryPlannerStore();
    await store.saveCalibrationSession(created.record);
    expect((await store.getCalibrationSession(created.record.id))?.planId).toBe(created.record.planId);
    await store.close();
  });

  it("uses constant-shape authorization checks and rejects expiry or replayed completion", () => {
    const created = session();
    expect(() => authorizeCalibrationSession(created.record, `Bearer ${created.token}`, Date.parse("2026-07-18T12:30:00.000Z"))).not.toThrow();
    expect(() => authorizeCalibrationSession(created.record, "Bearer invalid", Date.parse("2026-07-18T12:30:00.000Z"))).toThrow("invalid_calibration_session_token");
    expect(() => authorizeCalibrationSession(created.record, `Bearer ${created.token}`, Date.parse("2026-07-18T14:00:01.000Z"))).toThrow("calibration_session_expired");
    expect(() => authorizeCalibrationSession({ ...created.record, state: "completed" }, `Bearer ${created.token}`, Date.parse("2026-07-18T12:30:00.000Z"))).toThrow("calibration_session_already_completed");
    expect(() => authorizeCalibrationSession({ ...created.record, state: "cancelled" }, `Bearer ${created.token}`, Date.parse("2026-07-18T12:30:00.000Z"))).toThrow("calibration_session_already_completed");
  });

  it("delivers to a running Perceptrum or falls back to the exact native protocol", async () => {
    const created = session();
    const runningFetch = vi.fn(async () => new Response("{}", { status: 202 })) as unknown as typeof fetch;
    await expect(deliverCalibrationSession(created.uri, true, undefined, runningFetch)).resolves.toBe("running_instance");
    const openPerceptrumCalibration = vi.fn(async (_uri: string) => undefined);
    const unavailableFetch = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    await expect(deliverCalibrationSession(created.uri, false, { openPerceptrumCalibration }, unavailableFetch)).resolves.toBe("protocol_launch");
    expect(openPerceptrumCalibration).toHaveBeenCalledWith(created.uri);
  });

  it("cancels only the exact active session through loopback without persisting the token", async () => {
    const created = session();
    const cancelFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ authorization: `Bearer ${created.token}` });
      expect(JSON.parse(String(init?.body))).toEqual({ sessionId: created.record.id });
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch;
    await expect(cancelDeliveredCalibrationSession(created.record.id, created.token, cancelFetch)).resolves.toBeUndefined();
    expect(cancelFetch).toHaveBeenCalledWith("http://127.0.0.1:4000/api/runtime/calibration/cancel", expect.any(Object));
  });

  it("resolves the real Documents convention for macOS, Windows and Ubuntu", async () => {
    expect(await resolveCalibrationDirectory({ platform: "darwin", home: "/Users/test", env: {} })).toBe("/Users/test/Documents/Qual Hardware/Calibracoes");
    expect(await resolveCalibrationDirectory({ platform: "win32", home: "/Users/test", env: {} })).toBe("/Users/test/Documents/Qual Hardware/Calibracoes");
    expect(await resolveCalibrationDirectory({ platform: "linux", home: "/home/test", env: { QUAL_HARDWARE_CALIBRATION_DOCUMENTS_DIR: "/mnt/docs" } })).toBe("/mnt/docs/Qual Hardware/Calibracoes");
  });

  it("normalizes untrusted progress without allowing unbounded UI data", () => {
    const progress = normalizeCalibrationProgress({ phase: "sustained", stage: "x".repeat(500), percent: 180, message: "m".repeat(2_000) });
    expect(progress.percent).toBe(100);
    expect(progress.stage).toHaveLength(120);
    expect(progress.message).toHaveLength(1_000);
  });

  it("completes the authenticated plan, progress and result callback cycle", async () => {
    const store = new MemoryPlannerStore();
    const openPerceptrumCalibration = vi.fn(async (_uri: string) => undefined);
    const unavailableFetch = vi.fn(async () => { throw new Error("not running"); }) as unknown as typeof fetch;
    const application = createApp(store, undefined, {
      desktopBridge: { openPerceptrumCalibration },
      fetchImpl: unavailableFetch,
    });
    const scenarioResponse = await application.request("/api/scenarios", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: createDefaultScenario(8) }),
    });
    const scenario = await scenarioResponse.json() as { id: string };
    const recommendationsResponse = await application.request(`/api/scenarios/${scenario.id}/recommendations`, { method: "POST" });
    const recommendations = await recommendationsResponse.json() as Array<{ id: string }>;
    const startResponse = await application.request("http://127.0.0.1:49152/api/calibration-sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ recommendationId: recommendations[0]!.id, mode: "quick", targetHardwareTemplateId: null, advancedTelemetry: false }),
    });
    expect(startResponse.status).toBe(201);
    const started = await startResponse.json() as { session: { id: string; planId: string } };
    const uri = new URL(openPerceptrumCalibration.mock.calls[0]![0]);
    const token = uri.searchParams.get("token")!;
    const authorization = { authorization: `Bearer ${token}` };
    const planResponse = await application.request(`/api/calibration-sessions/${started.session.id}/plan`, { headers: authorization });
    expect(planResponse.status).toBe(200);
    const { plan } = await planResponse.json() as { plan: ReturnType<typeof createCalibrationPlan> };
    expect(plan.id).toBe(started.session.planId);
    const rejected = await application.request(`/api/calibration-sessions/${started.session.id}/progress`, {
      method: "POST", headers: { authorization: "Bearer invalid", "content-type": "application/json" }, body: "{}",
    });
    expect(rejected.status).toBe(403);
    const progress = await application.request(`/api/calibration-sessions/${started.session.id}/progress`, {
      method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ progress: { stage: "sustained", percent: 50 } }),
    });
    expect(progress.status).toBe(200);
    const completedAt = "2026-07-18T13:10:00.000Z";
    const legacyResult = {
      schemaVersion: LEGACY_LOCAL_CALIBRATION_VERSION,
      id: "00000000-0000-4000-8000-000000000090", planId: plan.id,
      createdAt: "2026-07-18T13:00:00.000Z", startedAt: "2026-07-18T13:00:00.000Z", completedAt,
      workloadContractVersion: WORKLOAD_CONTRACT_VERSION, mode: "quick",
      fingerprint: {
        hardwareTemplateId: null, hostnameHash: "0123456789abcdef", cpuModel: "Apple M4 Pro", cpuArchitecture: "arm64",
        physicalCores: 14, logicalCores: 14, cpuPowerLimitWatts: null, gpuModel: "Apple M4 Pro", gpuArchitecture: "Apple GPU",
        gpuCount: 1, gpuVramBytes: null, unifiedMemoryBytes: 48 * 1024 ** 3, gpuDriver: "Metal", ramBytes: 48 * 1024 ** 3,
        memoryChannels: null, memorySpeedMtps: null, storageModel: "Apple SSD", filesystem: "apfs", nicModel: "loopback",
        operatingSystem: "macos", operatingSystemVersion: "26", powerProfile: "automatic", formFactor: "mini_pc", coolingProfile: "active",
        perceptrumBuildHash: "test", aiqModel: "Qwen local", aiqModelHash: "test-hash", inferenceBackend: "llama.cpp-metal",
      },
      requestedSourceFps: 15, measuredSourceFps: 15, requestedInferenceFps: 1, effectiveInferenceFps: 1,
      framesPlanned: 100, framesExtracted: 100, framesPacked: 100, framesInferred: 100,
      rtspOrigin: "rtsp://127.0.0.1:8554", aiqOrigin: "http://127.0.0.1:8899", networkPolicy: "loopback_only",
      externalRequestCount: 0, openAiRequestCount: 0, mediaFieldCount: 0, credentialFieldCount: 0,
      stages: ["rtsp_ingest", "video_decode", "bgr_processing", "video_encode", "disk_write", "disk_read", "local_inference", "memory_bandwidth", "network_ingest", "thermal_sustain"].map((stage) => ({
        stage, safeCameraCapacity: 8, throughput: 8, throughputUnit: "camera-equivalent", p95LatencyMs: 100,
        peakUtilizationPercent: 70, queueGrowthPerMinute: 0, thermalThrottlePercent: 0,
      })),
      phases: plan.phases.map((phase) => ({ ...phase, cameraCount: 8, inferenceSuccessRate: 1, maxQueueDepth: 1, queueGrowthPerMinute: 0, outOfMemoryCount: 0 })),
      overallSafeCameraCapacity: 8, bottleneck: "local_inference", notes: [],
    };
    const resultResponse = await application.request(`/api/calibration-sessions/${started.session.id}/result`, {
      method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ result: legacyResult }),
    });
    expect(resultResponse.status).toBe(201);
    expect((await store.listCalibrationRuns())[0]?.id).toBe(legacyResult.id);
    expect((await store.getCalibrationSession(started.session.id))?.state).toBe("completed");
    await store.close();
  });

  it("records an authenticated cancelled callback without importing partial evidence", async () => {
    const store = new MemoryPlannerStore();
    const openPerceptrumCalibration = vi.fn(async (_uri: string) => undefined);
    const localFetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/api/runtime/calibration/cancel")) return new Response("{}", { status: 202 });
      throw new Error("Perceptrum is not running yet");
    }) as unknown as typeof fetch;
    const application = createApp(store, undefined, {
      desktopBridge: { openPerceptrumCalibration },
      fetchImpl: localFetch,
    });
    const scenarioResponse = await application.request("/api/scenarios", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: createDefaultScenario(2) }),
    });
    const scenario = await scenarioResponse.json() as { id: string };
    const recommendations = await (await application.request(`/api/scenarios/${scenario.id}/recommendations`, { method: "POST" })).json() as Array<{ id: string }>;
    const startResponse = await application.request("http://127.0.0.1:49152/api/calibration-sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ recommendationId: recommendations[0]!.id, mode: "full", targetHardwareTemplateId: null, advancedTelemetry: false }),
    });
    const started = await startResponse.json() as { session: { id: string } };
    const uri = new URL(openPerceptrumCalibration.mock.calls[0]![0]);
    const token = uri.searchParams.get("token")!;
    const authorization = { authorization: `Bearer ${token}` };
    await application.request(`/api/calibration-sessions/${started.session.id}/plan`, { headers: authorization });
    const cancelResponse = await application.request(`/api/calibration-sessions/${started.session.id}/cancel`, { method: "POST" });
    expect(cancelResponse.status).toBe(202);
    const callback = await application.request(`/api/calibration-sessions/${started.session.id}/cancelled`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ progress: { phase: "sustained", percent: 54 }, artifact: { fileName: "run-interrompido.partial.json", payloadSha256: "a".repeat(64) } }),
    });
    expect(callback.status).toBe(200);
    expect((await store.getCalibrationSession(started.session.id))?.state).toBe("cancelled");
    expect(await store.listCalibrationRuns()).toHaveLength(0);
    await store.close();
  });
});
