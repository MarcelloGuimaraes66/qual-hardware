import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import type {
  CalibrationHardwarePreflight,
  QwenVisionModelCandidate,
  QwenVisionModelFit,
  QwenVisionModelSelection,
} from "../shared/types.js";

export const QWEN_VISION_SELECTION_VERSION = "qual-hardware-qwen-vision-selection/1.0.0" as const;

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const SYSTEM_MEMORY_FRACTION = 0.68;
const ACCELERATOR_MEMORY_FRACTION = 0.80;
const RUNTIME_SIZE_MULTIPLIER = 1.18;
const RUNTIME_FIXED_RESERVE_BYTES = 768 * MIB;

export interface QwenVisionDiscoveredFile {
  path: string;
  sizeBytes: number;
  modifiedMs?: number;
}

export interface QwenVisionSelectionPreference {
  mode: "automatic" | "manual";
  coreModelId?: string | null;
  coreMaxModelId?: string | null;
}

interface QwenVisionFileDescriptor extends QwenVisionDiscoveredFile {
  path: string;
  fileName: string;
  parameterBillions: number;
  quantization: string;
  kind: "model" | "projector";
}

const quantizationRanks: Readonly<Record<string, number>> = Object.freeze({
  F32: 100,
  F16: 90,
  BF16: 88,
  Q8_0: 80,
  Q6_K: 70,
  Q5_K_M: 64,
  Q5_K_S: 62,
  Q4_K_M: 54,
  Q4_K_S: 52,
  Q4_1: 50,
  Q4_0: 48,
  Q3_K_M: 40,
  Q2_K: 30,
});
const automaticModelQuantizationRanks: Readonly<Record<string, number>> = Object.freeze({
  Q4_K_M: 1_000,
  Q4_K_S: 950,
  Q5_K_M: 900,
  Q5_K_S: 875,
  Q6_K: 850,
  Q8_0: 800,
  Q4_1: 750,
  Q4_0: 725,
  Q3_K_M: 650,
  Q2_K: 600,
  F16: 500,
  BF16: 475,
  F32: 400,
});

function quantization(fileName: string): string {
  const match = fileName.toUpperCase().match(/(?:^|[-_.])(Q\d(?:_[A-Z0-9]+)*|F16|F32|BF16)(?:[-_.]|$)/);
  return match?.[1] ?? "UNKNOWN";
}

export function qwenVisionFileDescriptor(file: QwenVisionDiscoveredFile): QwenVisionFileDescriptor | null {
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0) return null;
  const path = resolve(file.path);
  const fileName = basename(path);
  const match = fileName.match(/qwen3[-_.]?vl[-_.]?(\d+(?:\.\d+)?)b(?:[-_.]|$)/i);
  if (!match?.[1]) return null;
  const parameterBillions = Number(match[1]);
  if (!Number.isFinite(parameterBillions) || parameterBillions <= 0) return null;
  return {
    path,
    fileName,
    sizeBytes: file.sizeBytes,
    parameterBillions,
    quantization: quantization(fileName),
    kind: /mmproj/i.test(fileName) ? "projector" : "model",
  };
}

function projectorRank(projector: QwenVisionFileDescriptor): number {
  if (projector.quantization === "Q8_0") return 1_000;
  return quantizationRanks[projector.quantization] ?? 0;
}

function runtimeMemoryBytes(modelBytes: number, projectorBytes: number): number {
  return Math.ceil((modelBytes + projectorBytes) * RUNTIME_SIZE_MULTIPLIER + RUNTIME_FIXED_RESERVE_BYTES);
}

function cpuParameterLimit(physicalCores: number): number {
  if (physicalCores < 6) return 2.5;
  if (physicalCores < 10) return 4.5;
  if (physicalCores < 16) return 8.5;
  return Number.POSITIVE_INFINITY;
}

function hardwareBudgets(hardware: CalibrationHardwarePreflight): {
  systemMemoryBudgetBytes: number;
  acceleratorMemoryBudgetBytes: number | null;
  effectiveMemoryBudgetBytes: number;
  computeAcceleratorAvailable: boolean;
  sharedMemoryAccelerator: boolean;
} {
  const systemMemoryBudgetBytes = Math.max(0, Math.floor(hardware.ramBytes * SYSTEM_MEMORY_FRACTION));
  const computeDevices = (hardware.gpuDevices ?? []).filter((device) =>
    device.computeEligible && device.inferenceBackend !== "unavailable");
  const knownVramBytes = Math.max(
    hardware.gpuVramBytes ?? 0,
    ...computeDevices.map((device) => device.vramBytes ?? 0),
  );
  const sharedMemoryAccelerator = hardware.operatingSystem === "macos" ||
    (computeDevices.length > 0 && knownVramBytes === 0);
  const acceleratorMemoryBudgetBytes = knownVramBytes > 0 && !sharedMemoryAccelerator
    ? Math.floor(knownVramBytes * ACCELERATOR_MEMORY_FRACTION)
    : null;
  return {
    systemMemoryBudgetBytes,
    acceleratorMemoryBudgetBytes,
    effectiveMemoryBudgetBytes: acceleratorMemoryBudgetBytes === null
      ? systemMemoryBudgetBytes
      : Math.min(systemMemoryBudgetBytes, acceleratorMemoryBudgetBytes),
    computeAcceleratorAvailable: computeDevices.length > 0 || hardware.gpuCount > 0,
    sharedMemoryAccelerator,
  };
}

function candidateFit(input: {
  projector: QwenVisionFileDescriptor | null;
  estimatedMemoryBytes: number;
  parameterBillions: number;
  hardware: CalibrationHardwarePreflight;
  budgets: ReturnType<typeof hardwareBudgets>;
}): { fit: QwenVisionModelFit; compatible: boolean } {
  if (!input.projector) return { fit: "missing_projector", compatible: false };
  if (input.estimatedMemoryBytes > input.budgets.effectiveMemoryBudgetBytes) {
    return { fit: "insufficient_memory", compatible: false };
  }
  if (!input.budgets.computeAcceleratorAvailable &&
      input.parameterBillions > cpuParameterLimit(input.hardware.physicalCores)) {
    return { fit: "compute_limited", compatible: false };
  }
  if (input.budgets.acceleratorMemoryBudgetBytes !== null) return { fit: "gpu_memory", compatible: true };
  if (input.budgets.sharedMemoryAccelerator) return { fit: "shared_memory", compatible: true };
  return { fit: "system_memory", compatible: true };
}

function modelId(modelPath: string, projectorPath: string | null): string {
  return createHash("sha256").update(`${modelPath}\0${projectorPath ?? ""}`).digest("hex").slice(0, 24);
}

function modelQuality(left: QwenVisionModelCandidate, right: QwenVisionModelCandidate): number {
  return right.parameterBillions - left.parameterBillions ||
    (automaticModelQuantizationRanks[right.quantization] ?? 0) -
      (automaticModelQuantizationRanks[left.quantization] ?? 0) ||
    right.modelSizeBytes - left.modelSizeBytes ||
    left.modelPath.localeCompare(right.modelPath);
}

export function selectQwenVisionModels(
  files: QwenVisionDiscoveredFile[],
  hardware: CalibrationHardwarePreflight,
  preference: QwenVisionSelectionPreference = { mode: "automatic" },
): QwenVisionModelSelection {
  const descriptors = files.map(qwenVisionFileDescriptor)
    .filter((item): item is QwenVisionFileDescriptor => item !== null);
  const models = descriptors.filter((item) => item.kind === "model");
  const projectors = descriptors.filter((item) => item.kind === "projector");
  const budgets = hardwareBudgets(hardware);
  const candidates = models.map((model): QwenVisionModelCandidate => {
    const projector = projectors
      .filter((item) => item.parameterBillions === model.parameterBillions)
      .sort((left, right) =>
        Number(dirname(right.path) === dirname(model.path)) - Number(dirname(left.path) === dirname(model.path)) ||
        projectorRank(right) - projectorRank(left) ||
        left.sizeBytes - right.sizeBytes ||
        left.path.localeCompare(right.path))[0] ?? null;
    const estimatedMemoryBytes = runtimeMemoryBytes(model.sizeBytes, projector?.sizeBytes ?? 0);
    const suitability = candidateFit({
      projector,
      estimatedMemoryBytes,
      parameterBillions: model.parameterBillions,
      hardware,
      budgets,
    });
    return {
      id: modelId(model.path, projector?.path ?? null),
      family: "Qwen3-VL",
      modelPath: model.path,
      modelFileName: model.fileName,
      modelSizeBytes: model.sizeBytes,
      projectorPath: projector?.path ?? null,
      projectorFileName: projector?.fileName ?? null,
      projectorSizeBytes: projector?.sizeBytes ?? null,
      parameterBillions: model.parameterBillions,
      quantization: model.quantization,
      estimatedMemoryBytes,
      ...suitability,
    };
  }).sort(modelQuality);
  const compatible = candidates.filter((candidate) => candidate.compatible);
  const recommendedCore = compatible.filter((candidate) => candidate.parameterBillions <= 2.5)[0] ??
    [...compatible].sort((left, right) => left.parameterBillions - right.parameterBillions ||
      modelQuality(left, right))[0] ?? null;
  const recommendedCoreMax = compatible[0] ?? null;
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const manualCore = preference.coreModelId ? candidateById.get(preference.coreModelId) ?? null : null;
  const manualCoreMax = preference.coreMaxModelId ? candidateById.get(preference.coreMaxModelId) ?? null : null;
  const manualValid = preference.mode === "manual" && Boolean(manualCore?.compatible && manualCoreMax?.compatible);
  const selectedCore = manualValid ? manualCore : recommendedCore;
  const selectedCoreMax = manualValid ? manualCoreMax : recommendedCoreMax;
  const warnings = [
    ...(models.length === 0 ? ["qwen3_vl_models_not_found"] : []),
    ...(models.length > 0 && compatible.length === 0 ? ["qwen3_vl_models_incompatible_with_detected_hardware"] : []),
    ...(preference.mode === "manual" && !manualValid ? ["manual_qwen_selection_restored_to_automatic"] : []),
    ...(selectedCore && selectedCoreMax && selectedCore.id === selectedCoreMax.id
      ? ["same_qwen_model_selected_for_core_and_core_max"] : []),
  ];
  return {
    schemaVersion: QWEN_VISION_SELECTION_VERSION,
    mode: manualValid ? "manual" : "automatic",
    systemMemoryBudgetBytes: budgets.systemMemoryBudgetBytes,
    acceleratorMemoryBudgetBytes: budgets.acceleratorMemoryBudgetBytes,
    effectiveMemoryBudgetBytes: budgets.effectiveMemoryBudgetBytes,
    recommendedCoreModelId: recommendedCore?.id ?? null,
    recommendedCoreMaxModelId: recommendedCoreMax?.id ?? null,
    selectedCoreModelId: selectedCore?.id ?? null,
    selectedCoreMaxModelId: selectedCoreMax?.id ?? null,
    candidates,
    warnings,
  };
}
