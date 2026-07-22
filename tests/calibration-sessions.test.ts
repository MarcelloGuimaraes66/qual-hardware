import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCalibrationPlan } from "../src/engine/calibration.js";
import { createDefaultScenario } from "../src/shared/schemas.js";
import { AUTONOMOUS_LOCAL_CALIBRATION_VERSION, CALIBRATION_KERNEL_VERSION, LEGACY_LOCAL_CALIBRATION_VERSION, PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT, WORKLOAD_CONTRACT_VERSION, type CalibrationCheckpoint, type CalibrationCleanupStatus, type CalibrationDiagnosticArtifact, type CalibrationRuntimeStatus, type CalibrationSessionRecord, type LocalCalibrationRun } from "../src/shared/types.js";
import { createApp } from "../src/server/app.js";
import {
  assertAutonomousCalibrationSessionContract,
  authorizeCalibrationSession,
  calibrationPayloadSha256,
  cancelDeliveredCalibrationSession,
  createCalibrationSession,
  createInternalCalibrationSession,
  deliverCalibrationSession,
  normalizeCalibrationProgress,
  legacyCalibrationPayloadSha256,
  publicCalibrationSession,
  resolveCalibrationDirectory,
  tokenSha256,
  validatePerceptrumProtocolUri,
} from "../src/server/calibrationSessions.js";
import { MemoryPlannerStore } from "../src/server/store.js";
import { CatalogUpdateService } from "../src/server/catalogUpdates.js";
import { calibrationHardwareDigest, detectCalibrationHardware } from "../src/server/calibrationHardware.js";
import { calibrationPolicyHash } from "../src/engine/calibrationProfile.js";
import type { CalibrationKernelHandlers, CalibrationKernelPort, CalibrationKernelStartInput } from "../src/server/calibrationKernelService.js";
import { calibrationFailureWasCancelled } from "../src/server/calibrationKernelProtocol.js";
import { CalibrationExchangeService } from "../src/server/calibrationExchange.js";
import { autonomousCalibrationRun } from "./fixtures/autonomousCalibrationRun.js";

const cleaned: CalibrationCleanupStatus = {
  schemaVersion: "qual-hardware-calibration-cleanup/1.0.0",
  state: "completed",
  bytesTemporary: 1_024,
  bytesRemoved: 1_024,
  attempts: 1,
  remainingBytes: 0,
  updatedAt: "2026-07-18T13:10:01.000Z",
  error: null,
};

class FakeCalibrationKernel implements CalibrationKernelPort {
  private activeSessionId: string | null = null;
  private handlers: CalibrationKernelHandlers | null = null;
  readonly starts: CalibrationKernelStartInput[] = [];
  readonly interruptedRecoveries: string[] = [];
  readonly status: CalibrationRuntimeStatus = {
    schemaVersion: "qual-hardware-calibration-runtime-status/1.0.0",
    kernelVersion: "qual-hardware-calibration-kernel/1.0.0",
    authorityCommit: "d918faa0ecd6a9906b711039e5d89f78e0536c44",
    platform: "darwin",
    architecture: "arm64",
    featureMode: "full",
    manifestApproved: true,
    runtimeAssetsVerified: true,
    readyForQuickTest: true,
    readyForFullQualification: true,
    manifestHash: "a".repeat(64),
    contracts: [],
    assets: [{ id: "qwen-core-gguf", status: "verified", path: "/fixture/qwen.gguf", sha256: "b".repeat(64),
      sizeBytes: 1, expectedSizeBytes: 1, version: "test", licenseSpdx: "MIT", sbomRef: "fixture" }],
    reasons: [],
  };
  async runtimeStatus(): Promise<CalibrationRuntimeStatus> { return this.status; }
  async start(input: CalibrationKernelStartInput, handlers: CalibrationKernelHandlers): Promise<void> {
    this.activeSessionId = input.sessionId;
    this.handlers = handlers;
    this.starts.push(input);
    await handlers.onProgress({ phase: "preflight", stage: "preflight", percent: 1, message: "internal", updatedAt: new Date().toISOString() });
  }
  async cancel(sessionId: string): Promise<void> {
    if (this.activeSessionId !== sessionId) throw new Error("calibration_session_not_running");
  }
  async complete(result: LocalCalibrationRun): Promise<void> {
    if (!this.handlers) throw new Error("missing_handlers");
    await this.handlers.onResult(result, cleaned.bytesTemporary);
    this.activeSessionId = null;
    await this.handlers.onCompleted(cleaned);
  }
  async finishCancelled(): Promise<void> {
    if (!this.handlers) throw new Error("missing_handlers");
    this.activeSessionId = null;
    const diagnostic: CalibrationDiagnosticArtifact = {
      schemaVersion: "qual-hardware-calibration-diagnostic-artifact/1.0.0",
      fileName: "cancelled.qhcal-diagnostic.json.gz",
      payloadSha256: "d".repeat(64),
      persistedAt: new Date().toISOString(),
      status: "cancelled",
      completedMeasurementCount: 1,
    };
    await this.handlers.onCancelled(cleaned, diagnostic);
  }
  async emitLateProgress(): Promise<void> {
    if (!this.handlers) throw new Error("missing_handlers");
    await this.handlers.onProgress({
      phase: "discovery", stage: "discovery", percent: 50,
      message: "late worker progress", updatedAt: new Date().toISOString(),
    });
  }
  async retryCleanup(): Promise<CalibrationCleanupStatus> { return cleaned; }
  async recoverInterruptedSession(session: CalibrationSessionRecord): Promise<{
    cleanup: CalibrationCleanupStatus;
    diagnostic: CalibrationDiagnosticArtifact;
  }> {
    this.interruptedRecoveries.push(session.id);
    return {
      cleanup: cleaned,
      diagnostic: {
        schemaVersion: "qual-hardware-calibration-diagnostic-artifact/1.0.0",
        fileName: `${session.id}.interrupted.qhcal-diagnostic.json.gz`,
        payloadSha256: "e".repeat(64),
        persistedAt: new Date().toISOString(),
        status: "interrupted",
        completedMeasurementCount: 0,
      },
    };
  }
  isActive(sessionId: string): boolean { return this.activeSessionId === sessionId; }
  hasActiveSession(): boolean { return this.activeSessionId !== null; }
  async close(): Promise<void> { this.activeSessionId = null; }
}

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
  it("classifies a subprocess error after a stop request as cancellation, not hardware failure", () => {
    expect(calibrationFailureWasCancelled(true, "calibration_process_failed:ffmpeg:255:")).toBe(true);
    expect(calibrationFailureWasCancelled(false, "calibration_cancelled")).toBe(true);
    expect(calibrationFailureWasCancelled(false, "calibration_process_failed:ffmpeg:255:")).toBe(false);
  });

  it("reports independent rollback switches for resume, exchange and evidence policy", async () => {
    const store = new MemoryPlannerStore();
    const application = createApp(store, undefined, {
      calibrationKernel: new FakeCalibrationKernel(),
      calibrationFeatures: { resume: false, exchange: false, evidencePolicy: false },
    });
    const response = await application.request("/api/calibrations/features");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ resume: false, exchange: false, evidencePolicy: false });
  });

  it("uses a canonical checksum while retaining the legacy ordered checksum", () => {
    const first = { schemaVersion: "x", z: 1, nested: { z: 2, a: 3 } } as never;
    const reordered = { nested: { a: 3, z: 2 }, z: 1, schemaVersion: "x" } as never;
    expect(calibrationPayloadSha256(first)).toBe(calibrationPayloadSha256(reordered));
    expect(legacyCalibrationPayloadSha256(first)).not.toBe(legacyCalibrationPayloadSha256(reordered));
  });

  it("rejects an autonomous result when the measured computer is not the selected hardware", () => {
    const targetHardwareTemplateId = "hp-z2-g1i-ultra9-rtx4500ada";
    const plan = createCalibrationPlan(createDefaultScenario(8), "quick", targetHardwareTemplateId);
    const record = createInternalCalibrationSession({
      plan,
      recommendationId: "00000000-0000-4000-8000-000000000010",
      scenarioId: "00000000-0000-4000-8000-000000000011",
      advancedTelemetry: false,
    });
    const runtimeStatus = new FakeCalibrationKernel().status;
    const result = {
      schemaVersion: AUTONOMOUS_LOCAL_CALIBRATION_VERSION,
      mode: plan.mode,
      workloadProfileId: plan.workloadProfile.id,
      workloadProfileSignature: plan.workloadProfile.signature,
      kernelVersion: CALIBRATION_KERNEL_VERSION,
      runtimeManifestHash: runtimeStatus.manifestHash,
      compatiblePerceptrumCommit: PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT,
      qualityGate: { eligibleForCapacityExtrapolation: false },
      fingerprint: {
        hardwareTemplateId: null,
        perceptrumBuildHash: plan.workloadProfile.targetBuildHash,
      },
    } as LocalCalibrationRun;
    expect(() => assertAutonomousCalibrationSessionContract(result, record, runtimeStatus))
      .toThrow("calibration_hardware_fingerprint_mismatch");
    result.fingerprint.hardwareTemplateId = targetHardwareTemplateId;
    expect(() => assertAutonomousCalibrationSessionContract(result, record, runtimeStatus)).not.toThrow();
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
    expect(await resolveCalibrationDirectory({ platform: "win32", home: "C:\\Users\\test", env: {} })).toBe("C:\\Users\\test\\Documents\\Qual Hardware\\Calibracoes");
    expect(await resolveCalibrationDirectory({ platform: "linux", home: "/home/test", env: { QUAL_HARDWARE_CALIBRATION_DOCUMENTS_DIR: "/mnt/docs" } })).toBe("/mnt/docs/Qual Hardware/Calibracoes");
  });

  it("normalizes untrusted progress without allowing unbounded UI data", () => {
    const progress = normalizeCalibrationProgress({ phase: "sustained", stage: "x".repeat(500), percent: 180, message: "m".repeat(2_000) });
    expect(progress.percent).toBe(100);
    expect(progress.stage).toHaveLength(120);
    expect(progress.message).toHaveLength(1_000);
  });

  it("retries cleanup for a known interrupted internal session when the application starts", async () => {
    const store = new MemoryPlannerStore();
    const kernel = new FakeCalibrationKernel();
    const plan = createCalibrationPlan(createDefaultScenario(4), "quick", null);
    const created = createInternalCalibrationSession({
      plan,
      recommendationId: "00000000-0000-4000-8000-000000000030",
      scenarioId: "00000000-0000-4000-8000-000000000031",
      advancedTelemetry: false,
    });
    await store.saveCalibrationSession({
      ...created,
      state: "interrupted",
      cleanup: { ...created.cleanup!, state: "failed", remainingBytes: 1_024, error: "locked" },
      error: "calibration_session_interrupted",
    });

    createApp(store, undefined, { calibrationKernel: kernel });
    await vi.waitFor(async () => {
      expect((await store.getCalibrationSession(created.id))?.cleanup?.state).toBe("completed");
    });
    expect((await store.getCalibrationSession(created.id))?.state).toBe("interrupted");
    expect((await store.getCalibrationSession(created.id))?.cleanup?.remainingBytes).toBe(0);
    await store.close();
  });

  it("preserves a compact diagnostic before cleaning an active session orphaned by process exit", async () => {
    const store = new MemoryPlannerStore();
    const kernel = new FakeCalibrationKernel();
    const plan = createCalibrationPlan(createDefaultScenario(4), "quick", null);
    const created = createInternalCalibrationSession({
      plan,
      recommendationId: "00000000-0000-4000-8000-000000000032",
      scenarioId: "00000000-0000-4000-8000-000000000033",
      advancedTelemetry: false,
    });
    await store.saveCalibrationSession({ ...created, state: "discovering" });

    createApp(store, undefined, { calibrationKernel: kernel });
    await vi.waitFor(async () => {
      expect((await store.getCalibrationSession(created.id))?.state).toBe("interrupted");
    });
    const recovered = await store.getCalibrationSession(created.id);
    expect(recovered?.diagnostic).toMatchObject({ status: "interrupted", completedMeasurementCount: 0 });
    expect(recovered?.cleanup).toMatchObject({ state: "completed", remainingBytes: 0 });
    expect(kernel.interruptedRecoveries).toEqual([created.id]);
    await store.close();
  });

  it("completes the internal worker cycle without opening or calling Perceptrum", async () => {
    const store = new MemoryPlannerStore();
    const openPerceptrumCalibration = vi.fn(async (_uri: string) => undefined);
    const externalFetch = vi.fn(async () => { throw new Error("external fetch must not run"); }) as unknown as typeof fetch;
    const kernel = new FakeCalibrationKernel();
    const catalogUpdates = new CatalogUpdateService(store);
    const application = createApp(store, catalogUpdates, {
      fetchImpl: externalFetch,
      calibrationKernel: kernel,
    });
    const scenarioResponse = await application.request("/api/scenarios", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: createDefaultScenario(8) }),
    });
    const scenario = await scenarioResponse.json() as { id: string };
    const recommendationsResponse = await application.request(`/api/scenarios/${scenario.id}/recommendations`, { method: "POST" });
    const recommendations = await recommendationsResponse.json() as Array<{ id: string }>;
    const startBody = JSON.stringify({ recommendationId: recommendations[0]!.id, mode: "quick", targetHardwareTemplateId: null, advancedTelemetry: false });
    Object.defineProperty(catalogUpdates, "refreshing", { value: true, configurable: true });
    const blockedByRefresh = await application.request("http://127.0.0.1:49152/api/calibration-sessions", {
      method: "POST", headers: { "content-type": "application/json" }, body: startBody,
    });
    expect(blockedByRefresh.status).toBe(409);
    expect(await blockedByRefresh.json()).toEqual({ error: "calibration_blocked_during_catalog_refresh" });
    Object.defineProperty(catalogUpdates, "refreshing", { value: false, configurable: true });
    const startResponse = await application.request("http://127.0.0.1:49152/api/calibration-sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: startBody,
    });
    expect(startResponse.status).toBe(201);
    const started = await startResponse.json() as { session: { id: string; planId: string }; delivery: string };
    expect(started.delivery).toBe("internal");
    expect(openPerceptrumCalibration).not.toHaveBeenCalled();
    expect(externalFetch).not.toHaveBeenCalled();
    const refreshDuringCalibration = await application.request("/api/catalog/refresh", { method: "POST" });
    expect(refreshDuringCalibration.status).toBe(409);
    expect(await refreshDuringCalibration.json()).toEqual({ error: "catalog_refresh_blocked_during_calibration" });
    expect(externalFetch).not.toHaveBeenCalled();
    const plan = (await store.getCalibrationSession(started.session.id))!.plan;
    expect(plan.id).toBe(started.session.planId);
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
    await kernel.complete(legacyResult as LocalCalibrationRun);
    expect((await store.listCalibrationRuns())[0]?.id).toBe(legacyResult.id);
    expect((await store.getCalibrationSession(started.session.id))?.state).toBe("completed");
    expect((await store.getCalibrationSession(started.session.id))?.cleanup?.bytesRemoved).toBe(1_024);
    await store.close();
  });

  it("creates the signed portable result automatically in the exact folder opened by the desktop", async () => {
    const root = await mkdtemp(join(tmpdir(), "qual-hardware-automatic-result-"));
    const evidenceDirectory = join(root, "application-data", "calibration-evidence");
    const documentsDirectory = join(root, "Documents");
    const identityDirectory = join(root, "identity");
    const store = new MemoryPlannerStore();
    const kernel = new FakeCalibrationKernel();
    const openPath = vi.fn(async (_path: string) => undefined);
    try {
      const application = createApp(store, undefined, {
        calibrationKernel: kernel,
        calibrationEvidenceDirectory: evidenceDirectory,
        calibrationIdentityDirectory: identityDirectory,
        documentsDirectory,
        desktopBridge: { openPath },
      });
      const scenarioResponse = await application.request("/api/scenarios", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: createDefaultScenario(8) }),
      });
      const scenario = await scenarioResponse.json() as { id: string };
      const recommendations = await (await application.request(`/api/scenarios/${scenario.id}/recommendations`, { method: "POST" })).json() as Array<{ id: string }>;
      const startedResponse = await application.request("/api/calibration-sessions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ recommendationId: recommendations[0]!.id, mode: "quick", targetHardwareTemplateId: null, advancedTelemetry: false }),
      });
      expect(startedResponse.status).toBe(201);
      const started = await startedResponse.json() as { session: { id: string } };
      const sourceSession = (await store.getCalibrationSession(started.session.id))!;
      const result = autonomousCalibrationRun({
        id: "00000000-0000-4000-8000-000000000099",
        runtimeManifestHash: kernel.status.manifestHash,
      });
      result.planId = sourceSession.planId;
      result.mode = "quick";
      result.executionMode = "readiness";
      result.fingerprint.hardwareTemplateId = null;
      result.fingerprint.formFactor = "unknown";
      result.workloadProfileId = sourceSession.plan.workloadProfile.id;
      result.workloadProfileSignature = sourceSession.plan.workloadProfile.signature;
      result.qualityGate = {
        eligibleForCapacityExtrapolation: false,
        evidenceLevel: "representative_only",
        validationStatus: "diagnostic",
        failures: [],
        warnings: ["quick_test_is_diagnostic"],
      };
      result.artifact = {
        fileName: `${result.id}.qhcal.json.gz`,
        payloadSha256: calibrationPayloadSha256(result),
        persistedAt: new Date().toISOString(),
        storage: "application_data_append_only",
      };

      await kernel.complete(result);

      const portableFileName = `${result.id}.qhcal`;
      expect((await store.getCalibrationSession(started.session.id))?.state).toBe("completed");
      expect(await readdir(evidenceDirectory)).toContain(portableFileName);
      const packageBytes = await readFile(join(evidenceDirectory, portableFileName));
      const verifier = new CalibrationExchangeService({ identityDirectory, evidenceDirectory });
      expect(verifier.parseQhcal(packageBytes).run.id).toBe(result.id);
      expect(await store.listCalibrationExportEvents()).toHaveLength(1);

      await unlink(join(evidenceDirectory, portableFileName));
      const directoryResponse = await application.request("/api/calibration-sessions/directory");
      expect(directoryResponse.status).toBe(200);
      expect(await directoryResponse.json()).toMatchObject({ directory: evidenceDirectory, recoveredFiles: [portableFileName], recoveryErrors: [] });
      const recoveredPackageBytes = await readFile(join(evidenceDirectory, portableFileName));
      expect(verifier.parseQhcal(recoveredPackageBytes).run.id).toBe(result.id);
      const opened = await application.request("/api/calibration-sessions/open-directory", { method: "POST" });
      expect(opened.status).toBe(200);
      expect(openPath).toHaveBeenCalledWith(evidenceDirectory);
      expect(await readdir(documentsDirectory).catch(() => [])).toEqual([]);

      const downloaded = await application.request(`/api/calibrations/${result.id}/export`);
      expect(downloaded.status).toBe(200);
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(recoveredPackageBytes);
      expect((await readdir(evidenceDirectory)).filter((file) => file.endsWith(".qhcal"))).toEqual([portableFileName]);
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows an unmapped computer to run the full candidate-validation cycle without making it purchase evidence", async () => {
    const store = new MemoryPlannerStore();
    const kernel = new FakeCalibrationKernel();
    kernel.status.manifestApproved = false;
    const application = createApp(store, undefined, { calibrationKernel: kernel });
    const scenarioResponse = await application.request("/api/scenarios", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: createDefaultScenario(4) }),
    });
    const scenario = await scenarioResponse.json() as { id: string };
    const recommendations = await (await application.request(`/api/scenarios/${scenario.id}/recommendations`, { method: "POST" })).json() as Array<{ id: string }>;
    const response = await application.request("http://127.0.0.1:49152/api/calibration-sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ recommendationId: recommendations[0]!.id, mode: "full", targetHardwareTemplateId: null, advancedTelemetry: false }),
    });
    expect(response.status).toBe(201);
    const started = await response.json() as { session: { id: string; advancedTelemetry: boolean } };
    expect(started.session.advancedTelemetry).toBe(true);
    expect(kernel.starts[0]?.targetHardware).toBeNull();
    await kernel.finishCancelled();
    expect((await store.getCalibrationSession(started.session.id))?.state).toBe("cancelled");
    expect(await store.listCalibrationRuns()).toHaveLength(0);
    await store.close();
  });

  it("cancels the internal worker, preserves compact diagnostics and removes temporary files without importing a capacity run", async () => {
    const store = new MemoryPlannerStore();
    const openPerceptrumCalibration = vi.fn(async (_uri: string) => undefined);
    const localFetch = vi.fn(async () => { throw new Error("external fetch must not run"); }) as unknown as typeof fetch;
    const kernel = new FakeCalibrationKernel();
    const application = createApp(store, undefined, {
      fetchImpl: localFetch,
      calibrationKernel: kernel,
    });
    const scenarioResponse = await application.request("/api/scenarios", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: createDefaultScenario(2) }),
    });
    const scenario = await scenarioResponse.json() as { id: string };
    const recommendations = await (await application.request(`/api/scenarios/${scenario.id}/recommendations`, { method: "POST" })).json() as Array<{ id: string }>;
    const missingTargetResponse = await application.request("http://127.0.0.1:49152/api/calibration-sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ recommendationId: recommendations[0]!.id, mode: "full", targetHardwareTemplateId: null, advancedTelemetry: false }),
    });
    expect(missingTargetResponse.status).toBe(422);
    expect(await missingTargetResponse.json()).toEqual({ error: "calibration_target_hardware_required_for_full" });
    const startResponse = await application.request("http://127.0.0.1:49152/api/calibration-sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ recommendationId: recommendations[0]!.id, mode: "full", targetHardwareTemplateId: "hp-z2-g1i-ultra9-rtx4500ada", advancedTelemetry: false }),
    });
    const started = await startResponse.json() as { session: { id: string } };
    const cancelResponse = await application.request(`/api/calibration-sessions/${started.session.id}/cancel`, { method: "POST" });
    expect(cancelResponse.status).toBe(202);
    expect((await application.request(`/api/calibration-sessions/${started.session.id}/cancel`, { method: "POST" })).status).toBe(202);
    await kernel.finishCancelled();
    await kernel.emitLateProgress();
    expect((await application.request(`/api/calibration-sessions/${started.session.id}/cancel`, { method: "POST" })).status).toBe(200);
    expect((await store.getCalibrationSession(started.session.id))?.state).toBe("cancelled");
    expect((await store.getCalibrationSession(started.session.id))?.cleanup?.remainingBytes).toBe(0);
    expect((await store.getCalibrationSession(started.session.id))?.diagnostic).toMatchObject({
      status: "cancelled", completedMeasurementCount: 1,
    });
    expect(openPerceptrumCalibration).not.toHaveBeenCalled();
    expect(localFetch).not.toHaveBeenCalled();
    expect(await store.listCalibrationRuns()).toHaveLength(0);
    await store.close();
  });

  it("resumes compatible discovery evidence in a new session while preserving the cancelled source", async () => {
    const store = new MemoryPlannerStore();
    const kernel = new FakeCalibrationKernel();
    const plan = createCalibrationPlan(createDefaultScenario(4), "quick", null);
    const source = createInternalCalibrationSession({
      plan, recommendationId: randomUUID(), scenarioId: randomUUID(), advancedTelemetry: false,
    });
    await store.saveCalibrationSession({ ...source, state: "cancelled", completedAt: new Date().toISOString() });
    const detected = await detectCalibrationHardware();
    const payload = {
      sessionId: source.id, runId: randomUUID(), sequence: 1, phase: "discovery" as const, tier: 4,
      repetition: null, attempt: 1,
      compatibility: {
        hardwareDigest: calibrationHardwareDigest(detected), operatingSystem: detected.operatingSystem,
        operatingSystemVersion: detected.operatingSystemVersion, gpuDriver: detected.gpuDriver,
        workloadProfileSignature: plan.workloadProfile.signature, targetBuildHash: plan.workloadProfile.targetBuildHash,
        kernelVersion: kernel.status.kernelVersion, runtimeManifestHash: kernel.status.manifestHash, modelHash: "b".repeat(64),
        calibrationPolicyHash: calibrationPolicyHash(plan), appVersion: "0.1.0",
      },
      completedDiscoveryTiers: [1, 4], highestPassedDiscoveryTier: 4,
    };
    const checkpoint: CalibrationCheckpoint = {
      schemaVersion: "qual-hardware-calibration-checkpoint/1.0.0", id: randomUUID(), createdAt: new Date().toISOString(),
      ...payload, payloadSha256: "c".repeat(64),
    };
    await store.saveCalibrationCheckpoint(checkpoint);
    const application = createApp(store, undefined, { calibrationKernel: kernel });
    const status = await application.request(`/api/calibration-sessions/${source.id}/resume-status`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ resumable: true, qualificationWillRestart: true });
    const resumed = await application.request(`/api/calibration-sessions/${source.id}/resume`, { method: "POST" });
    expect(resumed.status).toBe(201);
    const body = await resumed.json() as { session: { id: string } };
    expect(body.session.id).not.toBe(source.id);
    expect((await store.getCalibrationSession(source.id))?.state).toBe("cancelled");
    expect(kernel.starts.at(-1)?.resumeCheckpoint?.id).toBe(checkpoint.id);
    await store.close();
  });
});
