import { describe, expect, it } from "vitest";
import {
  DEPENDENCY_DOWNLOAD_LINKS,
  dependencyDownloadLink,
  runtimeStatusFromExecutionEnvironment,
} from "../src/server/executionEnvironment.js";
import type { CalibrationRuntimeStatus, ExecutionEnvironment } from "../src/shared/types.js";

function environment(level: ExecutionEnvironment["evidenceLevel"], qwenCertified = false): ExecutionEnvironment {
  const profile = {
    staticEstimateBytes: 2_000_000_000,
    peakRamParallel1Bytes: 1_000_000_000,
    peakVramParallel1Bytes: 2_000_000_000,
    peakRamParallel2Bytes: 1_200_000_000,
    peakVramParallel2Bytes: 2_200_000_000,
    baseRequirementBytes: 2_000_000_000,
    incrementalSlotBytes: 200_000_000,
    maxValidatedParallelism: 2,
    safeAvailableMemoryFraction: 0.75 as const,
    sequentialLatencyMs: [10, 11, 12],
    concurrentLatencyMs: [20, 21],
  };
  const candidate = {
    id: "a".repeat(24),
    family: "Qwen3-VL" as const,
    modelPath: "C:\\models\\qwen.gguf",
    modelFileName: "Qwen3VL-2B-Instruct-Q4_K_M.gguf",
    modelSizeBytes: 1_000_000_000,
    projectorPath: "C:\\models\\mmproj.gguf",
    projectorFileName: "mmproj-Qwen3VL-2B-Instruct-F16.gguf",
    projectorSizeBytes: 800_000_000,
    parameterBillions: 2,
    quantization: "Q4_K_M",
    estimatedMemoryBytes: 2_000_000_000,
    fit: "gpu_memory" as const,
    estimatedCompatible: true,
    compatible: true,
    inventorySignature: "b".repeat(64),
    certificationState: "approved_revision" as const,
    certificationLevel: "approved_revision" as const,
    usageGate: "purchase" as const,
    probeId: "00000000-0000-4000-8000-000000000001",
    resourceProfile: profile,
  };
  return {
    schemaVersion: "qual-hardware-execution-environment/2.0.0",
    detectedAt: "2026-07-23T18:00:00.000Z",
    platform: "win32",
    architecture: "x64",
    supported: true,
    readiness: level === "exact_perceptrum" ? "ready_full" : "ready_diagnostic",
    evidenceLevel: level,
    environmentSignature: "e".repeat(64),
    runtimeIdentity: {
      llamaServerPath: "C:\\llama-server.exe",
      llamaServerSha256: "f".repeat(64),
      llamaServerVersion: "fixture",
      backend: "cuda",
      deviceId: "CUDA0",
      deviceName: "NVIDIA",
      driverVersion: "600",
    },
    components: [{
      id: "native-benchmark",
      name: "Benchmark nativo do Qual Hardware",
      purpose: "Diagnóstico genérico",
      status: "installed",
      origin: "built_in_proxy",
      path: null,
      version: "1.0.0",
      sha256: null,
      selfTest: "passed",
      capabilities: ["cpu", "memory"],
      impact: "Diagnóstico disponível.",
      instruction: "Nenhuma ação necessária.",
      downloadLinkId: null,
      diagnosticOnly: true,
    }],
    missingRequiredComponentIds: ["ffmpeg"],
    warnings: ["Stack exata ausente."],
    ...(qwenCertified ? {
      qwenModelSelection: {
        schemaVersion: "qual-hardware-qwen-vision-selection/2.0.0" as const,
        mode: "automatic" as const,
        certificationContractSha256: "c".repeat(64),
        systemMemoryBudgetBytes: 10_000_000_000,
        acceleratorMemoryBudgetBytes: 8_000_000_000,
        effectiveMemoryBudgetBytes: 8_000_000_000,
        recommendedCoreModelId: candidate.id,
        recommendedCoreMaxModelId: candidate.id,
        selectedCoreModelId: candidate.id,
        selectedCoreMaxModelId: candidate.id,
        candidates: [candidate],
        warnings: [],
      },
    } : {}),
    externalDownloadsPerformed: false,
  };
}

function legacyStatus(): CalibrationRuntimeStatus {
  return {
    schemaVersion: "qual-hardware-calibration-runtime-status/1.0.0",
    kernelVersion: "qual-hardware-calibration-kernel/4.0.0",
    authorityCommit: "d918faa0ecd6a9906b711039e5d89f78e0536c44",
    platform: "win32",
    architecture: "x64",
    featureMode: "diagnostic",
    manifestApproved: false,
    runtimeAssetsVerified: false,
    readyForQuickTest: false,
    readyForFullQualification: false,
    manifestHash: "a".repeat(64),
    contracts: [],
    assets: [],
    reasons: [],
  };
}

describe("execution environment", () => {
  it("exposes only the signed local catalog of official links", () => {
    expect(DEPENDENCY_DOWNLOAD_LINKS.length).toBeGreaterThan(5);
    expect(DEPENDENCY_DOWNLOAD_LINKS.every((item) => item.url.startsWith("https://"))).toBe(true);
    expect(dependencyDownloadLink("ffmpeg-official")?.url).toBe("https://ffmpeg.org/download.html");
    expect(dependencyDownloadLink("https://malicious.invalid/installer.exe")).toBeNull();
    expect(dependencyDownloadLink("../ffmpeg-official")).toBeNull();
  });

  it("keeps a generic benchmark diagnostic until Qwen passes the functional probe", async () => {
    const status = await runtimeStatusFromExecutionEnvironment(environment("generic_native"), legacyStatus());
    expect(status.readyForQuickTest).toBe(false);
    expect(status.readyForFullQualification).toBe(false);
    expect(status.manifestApproved).toBe(false);
    expect(status.environmentEvidenceLevel).toBe("generic_native");
    expect(status.environmentProvenance?.missingRequiredComponentIds).toEqual(["ffmpeg"]);
    expect(status.reasons).toContain("evidence-level:generic_native");
  });

  it("enables the qualification gate only for an exact isolated Perceptrum worker", async () => {
    const exact = environment("exact_perceptrum", true);
    exact.missingRequiredComponentIds = [];
    const status = await runtimeStatusFromExecutionEnvironment(exact, legacyStatus());
    expect(status.featureMode).toBe("full");
    expect(status.readyForFullQualification).toBe(true);
    expect(status.manifestApproved).toBe(true);
    expect(status.environmentSignature).toBe(exact.environmentSignature);
  });
});
