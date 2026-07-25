import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import type {
  CalibrationHardwarePreflight,
  QwenModelProbeResult,
  QwenVisionModelCandidate,
  QwenVisionModelFit,
  QwenVisionModelSelection,
} from "../shared/types.js";
import { QWEN_VISION_SELECTION_VERSION } from "../shared/types.js";

export { QWEN_VISION_SELECTION_VERSION };

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

export interface QwenVisionCertificationContext {
  contractSha256: string;
  probes: QwenModelProbeResult[];
  hardwareSignature?: string;
  llamaServerSha256?: string | null;
  backend?: QwenModelProbeResult["backend"];
  deviceId?: string | null;
  driverVersion?: string | null;
  now?: Date;
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
  if (/-\d{5}-of-\d{5}(?:[-_.]|$)/i.test(fileName)) return null;
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

function inventorySignature(model: QwenVisionFileDescriptor, projector: QwenVisionFileDescriptor | null): string {
  return createHash("sha256").update(JSON.stringify({
    family: "Qwen3-VL",
    model: {
      path: model.path,
      sizeBytes: model.sizeBytes,
      modifiedMs: model.modifiedMs ?? null,
    },
    projector: projector ? {
      path: projector.path,
      sizeBytes: projector.sizeBytes,
      modifiedMs: projector.modifiedMs ?? null,
    } : null,
  })).digest("hex");
}

function matchingProbe(
  candidateId: string,
  candidateInventorySignature: string,
  context: QwenVisionCertificationContext | undefined,
): QwenModelProbeResult | null {
  if (!context) return null;
  const now = (context.now ?? new Date()).getTime();
  const latest = context.probes
    .filter((probe) =>
      probe.candidateId === candidateId &&
      probe.inventorySignature === candidateInventorySignature &&
      probe.contractSha256 === context.contractSha256 &&
      (!context.hardwareSignature || probe.hardwareSignature === context.hardwareSignature) &&
      (!context.llamaServerSha256 || probe.llamaServerSha256 === context.llamaServerSha256) &&
      (!context.backend || probe.backend === context.backend) &&
      (context.deviceId === undefined || probe.deviceId === context.deviceId) &&
      (context.driverVersion === undefined || probe.driverVersion === context.driverVersion))
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0] ?? null;
  if (latest?.status === "passed" &&
      (latest.expiresAt === null || Date.parse(latest.expiresAt) <= now)) {
    return { ...latest, status: "stale" };
  }
  return latest;
}

function modelQuality(left: QwenVisionModelCandidate, right: QwenVisionModelCandidate): number {
  return right.parameterBillions - left.parameterBillions ||
    (automaticModelQuantizationRanks[right.quantization] ?? 0) -
      (automaticModelQuantizationRanks[left.quantization] ?? 0) ||
    projectorRankFromCandidate(right) - projectorRankFromCandidate(left) ||
    right.modelSizeBytes - left.modelSizeBytes ||
    left.modelPath.localeCompare(right.modelPath);
}

function projectorRankFromCandidate(candidate: QwenVisionModelCandidate): number {
  if (!candidate.projectorFileName) return -1;
  const projectorQuantization = quantization(candidate.projectorFileName);
  if (projectorQuantization === "Q8_0") return 1_000;
  return quantizationRanks[projectorQuantization] ?? 0;
}

export function selectQwenVisionModels(
  files: QwenVisionDiscoveredFile[],
  hardware: CalibrationHardwarePreflight,
  preference: QwenVisionSelectionPreference = { mode: "automatic" },
  certification?: QwenVisionCertificationContext,
): QwenVisionModelSelection {
  const descriptors = files.map(qwenVisionFileDescriptor)
    .filter((item): item is QwenVisionFileDescriptor => item !== null);
  const models = descriptors.filter((item) => item.kind === "model");
  const projectors = descriptors.filter((item) => item.kind === "projector");
  const budgets = hardwareBudgets(hardware);
  const candidates = models.flatMap((model): QwenVisionModelCandidate[] => {
    const matchingProjectors = projectors
      .filter((item) => item.parameterBillions === model.parameterBillions)
      .sort((left, right) =>
        Number(dirname(right.path) === dirname(model.path)) - Number(dirname(left.path) === dirname(model.path)) ||
        projectorRank(right) - projectorRank(left) ||
        left.sizeBytes - right.sizeBytes ||
        left.path.localeCompare(right.path));
    const pairs: Array<QwenVisionFileDescriptor | null> = matchingProjectors.length > 0
      ? matchingProjectors : [null];
    return pairs.map((projector): QwenVisionModelCandidate => {
    const estimatedMemoryBytes = runtimeMemoryBytes(model.sizeBytes, projector?.sizeBytes ?? 0);
    const suitability = candidateFit({
      projector,
      estimatedMemoryBytes,
      parameterBillions: model.parameterBillions,
      hardware,
      budgets,
    });
    const id = modelId(model.path, projector?.path ?? null);
    const candidateInventorySignature = inventorySignature(model, projector);
    const probe = matchingProbe(id, candidateInventorySignature, certification);
    const probePassed = probe?.status === "passed";
    const compatible = suitability.compatible && probePassed && probe.resourceProfile !== null;
    const certificationState = probe?.status === "queued" || probe?.status === "running"
      ? "testing"
      : probe?.status === "passed"
        ? probe.certificationLevel === "approved_revision" ? "approved_revision" : "validated_locally"
        : probe?.status === "failed" || probe?.status === "cancelled"
          ? "incompatible"
          : probe?.status === "stale"
            ? "outdated"
            : "not_tested";
    return {
      id,
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
      fit: suitability.fit,
      estimatedCompatible: suitability.compatible,
      compatible,
      inventorySignature: candidateInventorySignature,
      certificationState,
      certificationLevel: probe?.certificationLevel ?? "none",
      usageGate: compatible ? probe?.usageGate ?? "blocked" : "blocked",
      probeId: probe?.id ?? null,
      resourceProfile: compatible ? probe?.resourceProfile ?? null : null,
    };
    });
  }).sort(modelQuality);
  const compatible = candidates.filter((candidate) => candidate.compatible);
  const estimatedCompatible = candidates.filter((candidate) => candidate.estimatedCompatible);
  const recommendedCore = estimatedCompatible.filter((candidate) => candidate.parameterBillions <= 2.5)[0] ??
    [...estimatedCompatible].sort((left, right) => left.parameterBillions - right.parameterBillions ||
      modelQuality(left, right))[0] ?? null;
  const recommendedCoreMax = estimatedCompatible[0] ?? null;
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const manualCore = preference.coreModelId ? candidateById.get(preference.coreModelId) ?? null : null;
  const manualCoreMax = preference.coreMaxModelId ? candidateById.get(preference.coreMaxModelId) ?? null : null;
  const manualValid = preference.mode === "manual" && Boolean(manualCore?.compatible && manualCoreMax?.compatible);
  const selectedCore = manualValid ? manualCore : compatible.find((candidate) => candidate.id === recommendedCore?.id) ?? null;
  const selectedCoreMax = manualValid ? manualCoreMax : compatible.find((candidate) => candidate.id === recommendedCoreMax?.id) ?? null;
  const warnings = [
    ...(models.length === 0 ? ["qwen3_vl_models_not_found"] : []),
    ...(models.length > 0 && compatible.length === 0 ? ["qwen3_vl_models_incompatible_with_detected_hardware"] : []),
    ...(estimatedCompatible.length > 0 && compatible.length === 0 ? ["qwen3_vl_functional_probe_required"] : []),
    ...(preference.mode === "manual" && !manualValid ? ["manual_qwen_selection_restored_to_automatic"] : []),
    ...(selectedCore && selectedCoreMax && selectedCore.id === selectedCoreMax.id
      ? ["same_qwen_model_selected_for_core_and_core_max"] : []),
  ];
  return {
    schemaVersion: QWEN_VISION_SELECTION_VERSION,
    mode: manualValid ? "manual" : "automatic",
    certificationContractSha256: certification?.contractSha256 ?? "",
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
