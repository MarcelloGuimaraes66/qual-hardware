import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CalibrationHardwarePreflight,
  ExecutionEnvironment,
  QwenModelProbeResult,
  QwenVisionModelCandidate,
} from "../src/shared/types.js";
import { QwenModelCertificationService } from "../src/server/qwenModelCertification.js";
import {
  findApprovedQwen3VlRevision,
  loadApprovedQwen3VlContract,
} from "../src/server/qwenModelCertificationRegistry.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function hardware(): CalibrationHardwarePreflight {
  return {
    schemaVersion: "qual-hardware-calibration-hardware/2.0.0",
    detectedAt: "2026-07-24T00:00:00.000Z",
    cpuModel: "Intel Core i9",
    cpuArchitecture: "x64",
    physicalCores: 16,
    logicalCores: 32,
    gpuModel: "NVIDIA GeForce RTX",
    gpuDriver: "600.00",
    gpuArchitecture: "NVIDIA CUDA",
    gpuCount: 1,
    gpuVramBytes: 24 * 1024 ** 3,
    ramBytes: 64 * 1024 ** 3,
    operatingSystem: "windows",
    operatingSystemVersion: "test",
    formFactor: "workstation",
    gpuDevices: [],
    networkLinks: [],
  };
}

async function fixtureEnvironment(contractSha256: string): Promise<{
  environment: ExecutionEnvironment;
  candidate: QwenVisionModelCandidate;
}> {
  const directory = await mkdtemp(join(tmpdir(), "qual-hardware-qwen-probe-"));
  temporaryDirectories.push(directory);
  const modelPath = join(directory, "Qwen3VL-2B-Instruct-Q4_K_M.gguf");
  const projectorPath = join(directory, "mmproj-Qwen3VL-2B-Instruct-F16.gguf");
  await Promise.all([writeFile(modelPath, "fixture-model"), writeFile(projectorPath, "fixture-projector")]);
  const candidate: QwenVisionModelCandidate = {
    id: "a".repeat(24),
    family: "Qwen3-VL",
    modelPath,
    modelFileName: "Qwen3VL-2B-Instruct-Q4_K_M.gguf",
    modelSizeBytes: 13,
    projectorPath,
    projectorFileName: "mmproj-Qwen3VL-2B-Instruct-F16.gguf",
    projectorSizeBytes: 17,
    parameterBillions: 2,
    quantization: "Q4_K_M",
    estimatedMemoryBytes: 1024 ** 3,
    fit: "gpu_memory",
    estimatedCompatible: true,
    compatible: false,
    inventorySignature: "b".repeat(64),
    certificationState: "not_tested",
    certificationLevel: "none",
    usageGate: "blocked",
    probeId: null,
    resourceProfile: null,
  };
  return {
    candidate,
    environment: {
      schemaVersion: "qual-hardware-execution-environment/2.0.0",
      detectedAt: "2026-07-24T00:00:00.000Z",
      platform: process.platform,
      architecture: process.arch,
      supported: true,
      readiness: "ready_diagnostic",
      evidenceLevel: "generic_native",
      environmentSignature: "c".repeat(64),
      runtimeIdentity: {
        llamaServerPath: process.execPath,
        llamaServerSha256: createHash("sha256").update(process.execPath).digest("hex"),
        llamaServerVersion: "fake",
        backend: "cuda",
        deviceId: "CUDA0",
        deviceName: "NVIDIA GeForce RTX",
        driverVersion: "600.00",
      },
      components: [],
      qwenModelSelection: {
        schemaVersion: "qual-hardware-qwen-vision-selection/2.0.0",
        mode: "automatic",
        certificationContractSha256: contractSha256,
        systemMemoryBudgetBytes: 32 * 1024 ** 3,
        acceleratorMemoryBudgetBytes: 18 * 1024 ** 3,
        effectiveMemoryBudgetBytes: 18 * 1024 ** 3,
        recommendedCoreModelId: candidate.id,
        recommendedCoreMaxModelId: candidate.id,
        selectedCoreModelId: null,
        selectedCoreMaxModelId: null,
        candidates: [candidate],
        warnings: ["qwen3_vl_functional_probe_required"],
      },
      missingRequiredComponentIds: [],
      warnings: [],
      externalDownloadsPerformed: false,
    },
  };
}

async function waitForTerminal(
  service: QwenModelCertificationService,
  probeId: string,
): Promise<QwenModelProbeResult> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = service.get(probeId);
    if (result && !["queued", "running"].includes(result.status)) return result;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error("probe did not finish");
}

async function serviceFor(
  mode: "success" | "invalid" | "concurrent" | "health" | "crash" | "persistence" = "success",
) {
  const contract = await loadApprovedQwen3VlContract(process.cwd());
  const updates: QwenModelProbeResult[] = [];
  const service = new QwenModelCertificationService({
    resourceRoot: process.cwd(),
    contract,
    loadTimeoutMs: 2_000,
    requestTimeoutMs: 2_000,
    onUpdate: (result) => {
      updates.push(result);
      if (mode === "persistence" && result.status === "passed") {
        throw new Error("fixture_persistence_failure");
      }
    },
    spawnServer: (_executable, argumentsList, options) => spawn(process.execPath, [
      resolve("tests", "fixtures", "fake-llama-server.mjs"),
      ...argumentsList,
    ], {
      cwd: options.cwd,
      env: {
        ...options.env,
        ...(mode === "invalid" ? { FAKE_LLAMA_INVALID_RESPONSE: "1" } : {}),
        ...(mode === "concurrent" ? { FAKE_LLAMA_FAIL_CONCURRENT: "1" } : {}),
        ...(mode === "health" ? { FAKE_LLAMA_HEALTH_HANG: "1" } : {}),
        ...(mode === "crash" ? { FAKE_LLAMA_CRASH: "1" } : {}),
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  });
  return { contract, service, updates };
}

describe("Qwen3-VL functional certification", () => {
  it("matches only the exact approved model and mmproj hash pair", async () => {
    const { contract } = await serviceFor();
    expect(contract.contract.functionalProbe).toMatchObject({
      id: "qwen3-vl-visual-probe/1.0.0",
      maxTokens: 96,
      parallelism: 2,
    });
    expect(contract.contract.functionalProbe.sequentialChallenges.map((challenge) => challenge.id))
      .toEqual(["logo-letters", "red-panel", "blue-panel"]);
    const approved = contract.contract.revisions[0]!;
    expect(findApprovedQwen3VlRevision(
      contract.contract,
      approved.model.sha256,
      approved.projector.sha256,
    )?.id).toBe(approved.id);
    expect(findApprovedQwen3VlRevision(
      contract.contract,
      approved.model.sha256,
      "0".repeat(64),
    )).toBeNull();
  });

  it("passes three sequential and two concurrent visual requests but limits unknown hashes to planning", async () => {
    const { contract, service, updates } = await serviceFor();
    const { environment, candidate } = await fixtureEnvironment(contract.sha256);
    await expect(service.start("z".repeat(24), environment, hardware()))
      .rejects.toThrow("qwen_probe_candidate_not_in_inventory");
    const unsafeEnvironment = structuredClone(environment);
    unsafeEnvironment.qwenModelSelection!.candidates[0]!.estimatedCompatible = false;
    await expect(service.start(candidate.id, unsafeEnvironment, hardware()))
      .rejects.toThrow("qwen_probe_candidate_exceeds_safe_memory_budget");
    const started = await service.start(candidate.id, environment, hardware());
    await expect(service.start(candidate.id, environment, hardware()))
      .rejects.toThrow("qwen_probe_already_running");
    const result = await waitForTerminal(service, started.id);
    expect(result.status).toBe("passed");
    expect(result.challenges).toHaveLength(5);
    expect(result.concurrency).toEqual({ attempted: true, passed: true, maxValidatedParallelism: 2 });
    expect(result.certificationLevel).toBe("unknown_revision");
    expect(result.usageGate).toBe("planning_only");
    expect(result.resourceProfile?.maxValidatedParallelism).toBe(2);
    expect(updates.map((update) => update.status)).toContain("running");
  });

  it("fails closed on an invalid visual answer", async () => {
    const { contract, service } = await serviceFor("invalid");
    const { environment, candidate } = await fixtureEnvironment(contract.sha256);
    const result = await waitForTerminal(service, (await service.start(candidate.id, environment, hardware())).id);
    expect(result.status).toBe("failed");
    expect(result.failureCode).toContain("qwen_probe_visual_answer_invalid");
    expect(result.usageGate).toBe("blocked");
  });

  it("fails closed when the second concurrent request fails", async () => {
    const { contract, service } = await serviceFor("concurrent");
    const { environment, candidate } = await fixtureEnvironment(contract.sha256);
    const result = await waitForTerminal(service, (await service.start(candidate.id, environment, hardware())).id);
    expect(result.status).toBe("failed");
    expect(result.failureCode).toContain("qwen_probe_http_500");
  });

  it("fails closed and releases the serialized slot when terminal persistence fails", async () => {
    const { contract, service } = await serviceFor("persistence");
    const { environment, candidate } = await fixtureEnvironment(contract.sha256);
    const result = await waitForTerminal(service, (await service.start(candidate.id, environment, hardware())).id);
    expect(result.status).toBe("failed");
    expect(result.failureCode).toBe("qwen_probe_result_persistence_failed");
    expect(result.usageGate).toBe("blocked");
    expect(service.hasActiveProbe()).toBe(false);
  });

  it("cancels model loading and releases the serialized probe slot", async () => {
    const { contract, service } = await serviceFor("health");
    const { environment, candidate } = await fixtureEnvironment(contract.sha256);
    const started = await service.start(candidate.id, environment, hardware());
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    await service.cancel(started.id);
    const cancelled = await waitForTerminal(service, started.id);
    expect(cancelled.status).toBe("cancelled");
    expect(service.hasActiveProbe()).toBe(false);
  });

  it("reports bounded health timeout and server crash as incompatible", async () => {
    const timeoutFixture = await serviceFor("health");
    const timeoutEnvironment = await fixtureEnvironment(timeoutFixture.contract.sha256);
    const timeout = await waitForTerminal(
      timeoutFixture.service,
      (await timeoutFixture.service.start(
        timeoutEnvironment.candidate.id,
        timeoutEnvironment.environment,
        hardware(),
      )).id,
    );
    expect(timeout.status).toBe("failed");
    expect(timeout.failureCode).toBe("qwen_probe_health_timeout");

    const crashFixture = await serviceFor("crash");
    const crashEnvironment = await fixtureEnvironment(crashFixture.contract.sha256);
    const crashed = await waitForTerminal(
      crashFixture.service,
      (await crashFixture.service.start(
        crashEnvironment.candidate.id,
        crashEnvironment.environment,
        hardware(),
      )).id,
    );
    expect(crashed.status).toBe("failed");
    expect(crashed.failureCode).toContain("qwen_probe_server_exit_17");
  });

  it("rejects a CPU or wrong-backend runtime when the inventory requires CUDA", async () => {
    const { contract, service } = await serviceFor();
    const { environment, candidate } = await fixtureEnvironment(contract.sha256);
    environment.runtimeIdentity!.backend = "unavailable";
    environment.runtimeIdentity!.deviceId = null;
    const result = await waitForTerminal(service, (await service.start(candidate.id, environment, hardware())).id);
    expect(result.status).toBe("failed");
    expect(result.failureCode).toContain("qwen_probe_backend_mismatch");
  });
});
