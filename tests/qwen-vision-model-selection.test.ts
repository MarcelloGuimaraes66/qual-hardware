import { describe, expect, it } from "vitest";
import type {
  CalibrationHardwarePreflight,
  QwenModelProbeResult,
  QwenVisionModelSelection,
} from "../src/shared/types.js";
import {
  qwenVisionFileDescriptor,
  selectQwenVisionModels,
  type QwenVisionDiscoveredFile,
} from "../src/server/qwenVisionModelSelection.js";

const GIB = 1024 ** 3;

function hardware(input: {
  operatingSystem?: CalibrationHardwarePreflight["operatingSystem"];
  ramGb?: number;
  physicalCores?: number;
  vramGb?: number | null;
} = {}): CalibrationHardwarePreflight {
  const operatingSystem = input.operatingSystem ?? "windows";
  const vramBytes = input.vramGb === null ? null : (input.vramGb ?? 32) * GIB;
  return {
    schemaVersion: "qual-hardware-calibration-hardware/2.0.0",
    detectedAt: "2026-07-24T22:46:00.000Z",
    cpuModel: operatingSystem === "macos" ? "Apple M4" : "Intel Core i9",
    cpuArchitecture: operatingSystem === "macos" ? "arm64" : "x64",
    physicalCores: input.physicalCores ?? 24,
    logicalCores: (input.physicalCores ?? 24) * 2,
    gpuModel: operatingSystem === "macos" ? "Apple GPU" : "NVIDIA GeForce RTX",
    gpuDriver: operatingSystem === "macos" ? "Metal" : "600.00",
    gpuArchitecture: operatingSystem === "macos" ? "Apple GPU" : "NVIDIA CUDA",
    gpuCount: 1,
    gpuVramBytes: vramBytes,
    ramBytes: (input.ramGb ?? 64) * GIB,
    operatingSystem,
    operatingSystemVersion: "test",
    formFactor: "workstation",
    gpuDevices: [{
      id: "gpu:0",
      uuid: null,
      pciBusId: null,
      index: 0,
      name: operatingSystem === "macos" ? "Apple GPU" : "NVIDIA GeForce RTX",
      vendor: operatingSystem === "macos" ? "apple" : "nvidia",
      driver: operatingSystem === "macos" ? "Metal" : "600.00",
      architecture: operatingSystem === "macos" ? "Apple GPU" : "NVIDIA CUDA",
      inferenceBackend: operatingSystem === "macos" ? "metal" : "cuda",
      mediaBackend: operatingSystem === "macos" ? "videotoolbox" : "cuda_nvenc",
      classification: "compute",
      vramBytes,
      numaNodeId: null,
      computeEligible: true,
      mediaEligible: true,
      encodeSupported: true,
      decodeSupported: true,
      reason: "fixture",
    }],
    networkLinks: [],
  };
}

function modelFiles(include8b = false): QwenVisionDiscoveredFile[] {
  return [
    { path: "C:\\models\\2b\\Qwen3VL-2B-Instruct-Q4_K_M.gguf", sizeBytes: 1_107_409_952 },
    { path: "C:\\models\\2b\\mmproj-Qwen3VL-2B-Instruct-F16.gguf", sizeBytes: 850_000_000 },
    { path: "C:\\models\\2b\\mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf", sizeBytes: 445_053_216 },
    { path: "C:\\models\\4b\\Qwen3-VL-4B-Instruct-Q4_K_M.gguf", sizeBytes: 2_497_281_664 },
    { path: "C:\\models\\4b\\mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf", sizeBytes: 453_974_304 },
    ...(include8b ? [
      { path: "C:\\models\\8b\\Qwen3VL-8B-Instruct-Q4_K_M.gguf", sizeBytes: 5_200_000_000 },
      { path: "C:\\models\\8b\\mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf", sizeBytes: 520_000_000 },
    ] : []),
  ];
}

const CONTRACT_SHA256 = "a".repeat(64);

function passedProbe(
  candidate: QwenVisionModelSelection["candidates"][number],
  index: number,
  level: QwenModelProbeResult["certificationLevel"] = "approved_revision",
): QwenModelProbeResult {
  return {
    schemaVersion: "qual-hardware-qwen-model-probe/1.0.0",
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    candidateId: candidate.id,
    inventorySignature: candidate.inventorySignature,
    stackSignature: String(index).padStart(64, "b"),
    status: "passed",
    certificationLevel: level,
    usageGate: level === "approved_revision" ? "purchase" : "planning_only",
    approvedRevisionId: level === "approved_revision" ? `fixture-${index}` : null,
    contractSha256: CONTRACT_SHA256,
    modelSha256: "c".repeat(64),
    projectorSha256: "d".repeat(64),
    llamaServerSha256: "e".repeat(64),
    llamaServerVersion: "fixture",
    llamaServerPath: "C:\\llama\\llama-server.exe",
    backend: "cuda",
    deviceId: "CUDA0",
    deviceName: "NVIDIA GeForce RTX",
    hardwareSignature: "f".repeat(64),
    driverVersion: "600.00",
    platform: "win32",
    architecture: "x64",
    challenges: [],
    concurrency: { attempted: true, passed: true, maxValidatedParallelism: 2 },
    resourceProfile: {
      staticEstimateBytes: candidate.estimatedMemoryBytes,
      peakRamParallel1Bytes: 1_000_000,
      peakVramParallel1Bytes: candidate.estimatedMemoryBytes,
      peakRamParallel2Bytes: 1_200_000,
      peakVramParallel2Bytes: candidate.estimatedMemoryBytes + 256 * 1024 ** 2,
      baseRequirementBytes: candidate.estimatedMemoryBytes,
      incrementalSlotBytes: 256 * 1024 ** 2,
      maxValidatedParallelism: 2,
      safeAvailableMemoryFraction: 0.75,
      sequentialLatencyMs: [10, 11, 12],
      concurrentLatencyMs: [20, 21],
    },
    failureCode: null,
    message: "passed",
    startedAt: "2026-07-24T00:00:00.000Z",
    completedAt: "2026-07-24T00:01:00.000Z",
    expiresAt: "2099-07-24T00:01:00.000Z",
  };
}

function certifiedSelection(
  files: QwenVisionDiscoveredFile[],
  detectedHardware: CalibrationHardwarePreflight,
): QwenVisionModelSelection {
  const inventory = selectQwenVisionModels(files, detectedHardware, { mode: "automatic" }, {
    contractSha256: CONTRACT_SHA256,
    probes: [],
  });
  return selectQwenVisionModels(files, detectedHardware, { mode: "automatic" }, {
    contractSha256: CONTRACT_SHA256,
    probes: inventory.candidates.map((candidate, index) => passedProbe(candidate, index)),
  });
}

describe("Qwen3-VL hardware-aware selection", () => {
  it("rejects a text-only Qwen model even when its size looks supported", () => {
    expect(qwenVisionFileDescriptor({
      path: "C:\\models\\Qwen3-4B-Q4_K_M.gguf",
      sizeBytes: 2_400_000_000,
    })).toBeNull();
    expect(qwenVisionFileDescriptor({
      path: "C:\\models\\Qwen3VL-4B-Q4_K_M.gguf",
      sizeBytes: 2_400_000_000,
    })?.parameterBillions).toBe(4);
    expect(qwenVisionFileDescriptor({
      path: "C:\\models\\Qwen3VL-4B-Q4_K_M-00001-of-00002.gguf",
      sizeBytes: 1_200_000_000,
    })).toBeNull();
    expect(qwenVisionFileDescriptor({
      path: "C:\\models\\Qwen3VL-4B-Q4_K_M.gguf",
      sizeBytes: 2_400_000_000,
    })?.fileName).toBe("Qwen3VL-4B-Q4_K_M.gguf");
    expect(qwenVisionFileDescriptor({
      path: "/models/Qwen3VL-4B-Q4_K_M.gguf",
      sizeBytes: 2_400_000_000,
    })?.fileName).toBe("Qwen3VL-4B-Q4_K_M.gguf");
  });

  it("never selects a model from filename and memory estimates alone", () => {
    const selection = selectQwenVisionModels(modelFiles(), hardware(), { mode: "automatic" }, {
      contractSha256: CONTRACT_SHA256,
      probes: [],
    });
    expect(selection.recommendedCoreModelId).not.toBeNull();
    expect(selection.selectedCoreModelId).toBeNull();
    expect(selection.selectedCoreMaxModelId).toBeNull();
    expect(selection.candidates.every((candidate) => !candidate.compatible)).toBe(true);
    expect(selection.warnings).toContain("qwen3_vl_functional_probe_required");
  });

  it("invalidates a passed probe after its 30-day cache expires", () => {
    const inventory = selectQwenVisionModels(modelFiles(), hardware(), { mode: "automatic" }, {
      contractSha256: CONTRACT_SHA256,
      probes: [],
    });
    const probes = inventory.candidates.map((candidate, index) => ({
      ...passedProbe(candidate, index),
      expiresAt: "2026-08-01T00:00:00.000Z",
    }));
    const stale = selectQwenVisionModels(modelFiles(), hardware(), { mode: "automatic" }, {
      contractSha256: CONTRACT_SHA256,
      probes,
      now: new Date("2026-08-02T00:00:00.000Z"),
    });
    expect(stale.selectedCoreModelId).toBeNull();
    expect(stale.candidates.some((candidate) => candidate.certificationState === "outdated")).toBe(true);
  });

  it("pairs each model with the matching projector and prefers Q8_0", () => {
    const selection = certifiedSelection(modelFiles(), hardware());
    const core = selection.candidates.find((candidate) => candidate.id === selection.selectedCoreModelId);
    const coreMax = selection.candidates.find((candidate) => candidate.id === selection.selectedCoreMaxModelId);
    expect(core?.parameterBillions).toBe(2);
    expect(core?.projectorFileName).toContain("Q8_0");
    expect(coreMax?.parameterBillions).toBe(4);
  });

  it("uses the largest safe installed model for Core Max on a high-memory GPU", () => {
    const selection = certifiedSelection(modelFiles(true), hardware({ vramGb: 32, ramGb: 64 }));
    const core = selection.candidates.find((candidate) => candidate.id === selection.selectedCoreModelId);
    const coreMax = selection.candidates.find((candidate) => candidate.id === selection.selectedCoreMaxModelId);
    expect(core?.parameterBillions).toBe(2);
    expect(coreMax?.parameterBillions).toBe(8);
    expect(coreMax?.fit).toBe("gpu_memory");
  });

  it("prefers the calibrated Q4_K_M model when a larger quantization also fits", () => {
    const files = [
      ...modelFiles(),
      { path: "C:\\models\\4b\\Qwen3VL-4B-Instruct-F16.gguf", sizeBytes: 8_400_000_000 },
    ];
    const selection = certifiedSelection(files, hardware({ vramGb: 32, ramGb: 64 }));
    const coreMax = selection.candidates.find((candidate) => candidate.id === selection.selectedCoreMaxModelId);
    expect(coreMax?.modelFileName).toContain("Q4_K_M");
  });

  it("downgrades both slots to 2B when a 4 GB GPU cannot safely load 4B", () => {
    const selection = certifiedSelection(modelFiles(), hardware({ vramGb: 4, ramGb: 16, physicalCores: 8 }));
    const core = selection.candidates.find((candidate) => candidate.id === selection.selectedCoreModelId);
    const coreMax = selection.candidates.find((candidate) => candidate.id === selection.selectedCoreMaxModelId);
    expect(core?.parameterBillions).toBe(2);
    expect(coreMax?.parameterBillions).toBe(2);
    expect(selection.candidates.find((candidate) => candidate.parameterBillions === 4)?.fit).toBe("insufficient_memory");
    expect(selection.warnings).toContain("same_qwen_model_selected_for_core_and_core_max");
  });

  it("uses unified memory on macOS with the same portable GGUF files", () => {
    const selection = certifiedSelection(modelFiles(), hardware({
      operatingSystem: "macos",
      ramGb: 16,
      physicalCores: 10,
      vramGb: null,
    }));
    const coreMax = selection.candidates.find((candidate) => candidate.id === selection.selectedCoreMaxModelId);
    expect(coreMax?.parameterBillions).toBe(4);
    expect(coreMax?.fit).toBe("shared_memory");
    expect(selection.acceleratorMemoryBudgetBytes).toBeNull();
  });

  it("selects the same portable GGUF inventory on Ubuntu", () => {
    const selection = certifiedSelection(modelFiles(), hardware({
      operatingSystem: "ubuntu",
      ramGb: 32,
      physicalCores: 12,
      vramGb: 8,
    }));
    const coreMax = selection.candidates.find((candidate) => candidate.id === selection.selectedCoreMaxModelId);
    expect(coreMax?.modelFileName).toBe("Qwen3-VL-4B-Instruct-Q4_K_M.gguf");
    expect(coreMax?.fit).toBe("gpu_memory");
  });

  it("honors a valid manual pair and safely restores automatic mode when it disappears", () => {
    const automatic = certifiedSelection(modelFiles(), hardware());
    const two = automatic.candidates.find((candidate) => candidate.parameterBillions === 2)!;
    const four = automatic.candidates.find((candidate) => candidate.parameterBillions === 4)!;
    const certification = {
      contractSha256: CONTRACT_SHA256,
      probes: automatic.candidates.map((candidate, index) => passedProbe(candidate, index)),
    };
    const manual = selectQwenVisionModels(modelFiles(), hardware(), {
      mode: "manual",
      coreModelId: four.id,
      coreMaxModelId: two.id,
    }, certification);
    expect(manual.mode).toBe("manual");
    expect(manual.selectedCoreModelId).toBe(four.id);
    expect(manual.selectedCoreMaxModelId).toBe(two.id);

    const restored = selectQwenVisionModels(modelFiles().filter((file) => !file.path.includes("\\4b\\")), hardware(), {
      mode: "manual",
      coreModelId: four.id,
      coreMaxModelId: two.id,
    }, certification);
    expect(restored.mode).toBe("automatic");
    expect(restored.warnings).toContain("manual_qwen_selection_restored_to_automatic");
  });
});
