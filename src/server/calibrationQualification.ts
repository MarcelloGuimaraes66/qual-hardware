import type {
  CalibrationComputeMode,
  CalibrationMode,
  CalibrationPhaseMetric,
  CalibrationRepetitionResult,
} from "../shared/types.js";
import { REQUIRED_CALIBRATION_STAGES } from "../engine/calibration.js";
import type { PipelinePhaseMeasurement } from "./calibrationPipeline.js";

export interface CalibrationQualificationInput {
  mode: CalibrationMode;
  runtimeReady: boolean;
  authorityAndProfileExact: boolean;
  timeScale: number;
  selectedTier: number;
  phaseNames: CalibrationPhaseMetric["name"][];
  mediaAvailable: boolean;
  rtspAvailable: boolean;
  localInferenceAvailable: boolean;
  cpuInferenceAvailable: boolean;
  gpuInferenceAvailable: boolean;
  gpuMediaAvailable: boolean;
  localInferenceRequired: boolean;
  primaryComputeMode: CalibrationComputeMode;
  externalRequestCount: number;
  openAiRequestCount: number;
  measurements: PipelinePhaseMeasurement[];
  repetitions: CalibrationRepetitionResult[];
}

export interface CalibrationQualificationResult {
  eligible: boolean;
  failures: string[];
  qualifiedMeasurements: PipelinePhaseMeasurement[];
  repeatVariabilityPercent: number;
  pipelineComplete: boolean;
  exactConcurrencyComplete: boolean;
  resourceTelemetryComplete: boolean;
  gpuTelemetryComplete: boolean;
  approvedThermalTelemetryComplete: boolean;
  physicalNetworkSpecificationComplete: boolean;
  physicalNetworkCapacityComplete: boolean;
  computeModesComplete: boolean;
  combinedCpuGpuComplete: boolean;
}

/**
 * Selects the measurements that prove the final technical capacity.
 *
 * Adaptive discovery is expected to stop on the first tier that exceeds the
 * hardware limit. A timeout or queue failure at that upper tier is capacity
 * evidence, not an infrastructure failure in the lower tier that subsequently
 * completes every validation phase. Commercial qualification already exposes
 * its exact three-repetition set through `qualifiedMeasurements`; validation
 * uses the final successful repetition, while quick diagnostics retain their
 * discovery measurements at the selected operational tier.
 */
export function selectTechnicalCalibrationMeasurements(
  input: CalibrationQualificationInput,
  qualification: CalibrationQualificationResult,
): PipelinePhaseMeasurement[] {
  if (qualification.qualifiedMeasurements.length > 0) return qualification.qualifiedMeasurements;
  const completeSuccessfulRepetitionSet = input.repetitions.length > 0 && input.repetitions.every((item) =>
    item.passed && item.tier === input.selectedTier && item.safeCameraCapacity === input.selectedTier);
  const measurementsPerRepetition = input.phaseNames.length;
  const expectedMeasurements = input.repetitions.length * measurementsPerRepetition;
  if (completeSuccessfulRepetitionSet && expectedMeasurements > 0 && input.measurements.length >= expectedMeasurements) {
    return input.measurements.slice(-expectedMeasurements);
  }
  const successfulSelectedTier = input.measurements.filter((item) =>
    item.computeMode === input.primaryComputeMode &&
    item.failures.length === 0 &&
    item.tier <= input.selectedTier);
  if (successfulSelectedTier.length === 0) return [];
  const finalValidation = input.phaseNames.flatMap((phase) => {
    const candidates = successfulSelectedTier.filter((item) => item.phase === phase);
    return candidates.length > 0 ? [candidates.at(-1)!] : [];
  });
  return finalValidation.length > 0 ? finalValidation : successfulSelectedTier.slice(-1);
}

export function technicalPhaseCoverageComplete(input: {
  mode: CalibrationMode;
  phaseNames: CalibrationPhaseMetric["name"][];
  primaryComputeMode: CalibrationComputeMode;
  measurements: PipelinePhaseMeasurement[];
  highestMeasuredPassingCapacity: number | null;
}): boolean {
  if (input.highestMeasuredPassingCapacity === null) return false;
  const passed = (measurement: PipelinePhaseMeasurement): boolean =>
    measurement.computeMode === input.primaryComputeMode && measurement.failures.length === 0;
  const requiredPhases = input.mode === "quick"
    ? input.phaseNames.filter((phase) => phase !== "surge")
    : input.phaseNames;
  const configuredPhasesComplete = requiredPhases.every((phase) =>
    input.measurements.some((measurement) => measurement.phase === phase && passed(measurement)));
  if (configuredPhasesComplete) return true;
  return input.mode === "quick" && input.measurements.some((measurement) =>
    measurement.phase === "discovery" && passed(measurement));
}

export function quickDiagnosticSafeCameraCapacity(input: {
  selectedTier: number;
  primaryComputeMode: CalibrationComputeMode;
  phases: Array<{ name: CalibrationPhaseMetric["name"]; loadPercent: number }>;
  measurements: PipelinePhaseMeasurement[];
}): number | null {
  const primary = input.measurements.filter((measurement) =>
    measurement.computeMode === input.primaryComputeMode);
  const requiredSteadyPhases = input.phases.filter((phase) =>
    phase.name !== "surge" && phase.loadPercent <= 100);
  if (!requiredSteadyPhases.every((phase) =>
    primary.some((measurement) => measurement.phase === phase.name && measurement.failures.length === 0))) {
    return null;
  }
  const successfulSteadyTiers = primary
    .filter((measurement) => measurement.phase !== "discovery" &&
      measurement.phase !== "surge" && measurement.failures.length === 0)
    .map((measurement) => measurement.tier);
  if (successfulSteadyTiers.length === 0) return null;
  const steadyTier = Math.min(input.selectedTier, Math.max(...successfulSteadyTiers));
  const failedSurgeLoads = input.phases
    .filter((phase) => phase.name === "surge" && phase.loadPercent > 100 &&
      primary.some((measurement) => measurement.phase === phase.name && measurement.failures.length > 0))
    .map((phase) => phase.loadPercent);
  if (failedSurgeLoads.length === 0) return steadyTier;
  return Math.max(1, Math.floor(steadyTier * 100 / Math.max(...failedSurgeLoads)));
}

function repetitionVariability(repetitions: CalibrationRepetitionResult[]): number {
  const capacities = repetitions.map((item) => item.safeCameraCapacity).filter((value) => value > 0);
  if (capacities.length !== 3) return 100;
  const ordered = [...capacities].sort((left, right) => left - right);
  const median = ordered[1] ?? 0;
  return (Math.max(...capacities) - Math.min(...capacities)) / Math.max(1, median) * 100;
}

function rangeVariability(values: number[]): number {
  if (values.length !== 3) return 100;
  const ordered = [...values].sort((left, right) => left - right);
  const median = ordered[1] ?? 0;
  return (Math.max(...values) - Math.min(...values)) / Math.max(0.000_001, Math.abs(median)) * 100;
}

function measurementVariability(
  measurements: PipelinePhaseMeasurement[],
  phaseNames: CalibrationPhaseMetric["name"][],
  primaryComputeMode: CalibrationComputeMode,
): number {
  const variabilities: number[] = [];
  for (const phase of phaseNames) {
    for (const computeMode of [primaryComputeMode]) {
      const samples = measurements.filter((item) => item.phase === phase && item.computeMode === computeMode);
      if (samples.length !== 3) return 100;
      const metrics: number[][] = [
        samples.flatMap((item) => item.p99InferenceLatencyMs === null ? [] : [item.p99InferenceLatencyMs]),
        samples.flatMap((item) => item.cpuUtilizationPercent === null ? [] : [item.cpuUtilizationPercent.p95]),
        ...(computeMode === "gpu_accelerated" ? [samples.flatMap((item) => item.hardwareTelemetry.gpuUtilizationPercent === null
          ? [] : [item.hardwareTelemetry.gpuUtilizationPercent.p95])] : []),
        samples.flatMap((item) => item.memoryBytesPerSecond === null ? [] : [item.memoryBytesPerSecond]),
        samples.flatMap((item) => item.p95DatabaseLatencyMs === null ? [] : [item.p95DatabaseLatencyMs]),
        samples.flatMap((item) => item.p95DashboardLatencyMs === null ? [] : [item.p95DashboardLatencyMs]),
        samples.map((item) => item.framesDecoded / Math.max(1, item.framesPlanned)),
        samples.map((item) => item.framesInferred / Math.max(1, item.inferencesPlanned)),
      ];
      variabilities.push(...metrics.map(rangeVariability));
    }
  }
  return Math.max(0, ...variabilities);
}

export function evaluateCalibrationQualification(
  input: CalibrationQualificationInput,
): CalibrationQualificationResult {
  const requiredMeasurementCount = input.phaseNames.length * 3;
  const hasThreeRepetitions = input.repetitions.length === 3;
  const qualifiedMeasurements = hasThreeRepetitions && input.measurements.length >= requiredMeasurementCount
    ? input.measurements.slice(-requiredMeasurementCount)
    : [];
  const completeMeasurementSet = qualifiedMeasurements.length === requiredMeasurementCount &&
    input.phaseNames.every((phase) =>
      qualifiedMeasurements.filter((item) =>
        item.phase === phase && item.computeMode === input.primaryComputeMode).length === 3);
  const repetitionsPassed = hasThreeRepetitions && input.repetitions.every((item) =>
    item.passed && item.tier === input.selectedTier && item.safeCameraCapacity === input.selectedTier);
  const repeatVariabilityPercent = Math.max(
    repetitionVariability(input.repetitions),
    measurementVariability(qualifiedMeasurements, input.phaseNames, input.primaryComputeMode),
  );
  const exactConcurrencyComplete = completeMeasurementSet && qualifiedMeasurements.every((item) =>
    item.exactCameraConcurrency && item.actualConcurrentMediaPipelines === item.tier);
  const requiredStagesComplete = completeMeasurementSet && qualifiedMeasurements.every((item) =>
    REQUIRED_CALIBRATION_STAGES.every((stage) => item.measuredStages.includes(stage)));
  const workloadContractsComplete = completeMeasurementSet && qualifiedMeasurements.every((item) =>
    item.databaseOperations > 0 && item.dashboardQueries > 0 && item.completedJobRuns > 0 &&
    item.completedStepRuns > 0 && item.completedIntelligenceJobs > 0 &&
    item.processedCameraCount === item.tier && item.failures.length === 0);
  const pipelineComplete = input.mediaAvailable && input.rtspAvailable &&
    (!input.localInferenceRequired || input.localInferenceAvailable) &&
    completeMeasurementSet && requiredStagesComplete && workloadContractsComplete &&
    qualifiedMeasurements.every((item) =>
      item.mediaMeasured && item.rtspMeasured &&
      (!input.localInferenceRequired || item.localInferenceMeasured));
  const resourceTelemetryComplete = completeMeasurementSet && qualifiedMeasurements.every((item) =>
    item.cpuUtilizationPercent !== null && item.memoryUsedBytes !== null &&
    item.memoryBytesPerSecond !== null && item.temporaryBytesFreeBeforePhase !== null);
  const gpuTelemetryComplete = completeMeasurementSet && qualifiedMeasurements.every((item) =>
    item.computeMode === "cpu_only" || (item.hardwareTelemetry.gpuUtilizationPercent !== null &&
    item.hardwareTelemetry.gpuMemoryUsedBytes !== null));
  const computeModesComplete = completeMeasurementSet && qualifiedMeasurements.every((item) => {
    if (!item.cpuWorkloadMeasured || item.computeMode !== input.primaryComputeMode) return false;
    if (input.primaryComputeMode === "cpu_only") {
      return !input.localInferenceRequired ||
        (item.inferenceBackend === "cpu" && item.inferenceDeviceId === "none");
    }
    const inferenceSatisfied = !input.localInferenceRequired ||
      (item.gpuInferenceMeasured && item.inferenceBackend !== "cpu" &&
        item.inferenceBackend !== "unavailable" && item.inferenceDeviceId !== "none" &&
        item.inferenceDeviceId !== "unavailable");
    return inferenceSatisfied && item.mediaMeasured;
  });
  const combinedCpuGpuComplete = completeMeasurementSet &&
    (input.primaryComputeMode === "cpu_only" ||
      qualifiedMeasurements.every((item) => item.combinedCpuGpuMeasured));
  const approvedThermalTelemetryComplete = completeMeasurementSet && qualifiedMeasurements.every((item) =>
    item.hardwareTelemetry.provider === "approved-telemetry-probe" &&
    item.hardwareTelemetry.thermalThrottlePercent !== null &&
    item.hardwareTelemetry.thermalThrottlePercent.peak === 0 &&
    (item.hardwareTelemetry.gpuTemperatureCelsius !== null ||
      item.hardwareTelemetry.cpuTemperatureCelsius !== null));
  const physicalNetworkSpecificationComplete = completeMeasurementSet && qualifiedMeasurements.every((item) =>
    item.physicalNetworkLinkVerified && item.physicalNetworkCapacityMbps !== null &&
    item.physicalNetworkUsableMbps !== null);
  const physicalNetworkCapacityComplete = physicalNetworkSpecificationComplete &&
    qualifiedMeasurements.every((item) =>
      item.physicalNetworkUsableMbps !== null && item.networkIngressMbps <= item.physicalNetworkUsableMbps);
  const failures = [...new Set([
    ...(input.mode !== "qualification" ? [`${input.mode}_is_not_commercial_evidence`] : []),
    ...(!input.runtimeReady ? ["packaged_runtime_not_qualified"] : []),
    ...(!input.authorityAndProfileExact ? ["authority_or_workload_profile_mismatch"] : []),
    ...(!input.mediaAvailable || !input.rtspAvailable ? ["approved_offline_media_runtime_unavailable"] : []),
    ...(input.localInferenceRequired && !input.localInferenceAvailable
      ? ["approved_local_inference_assets_unavailable"] : []),
    ...(input.localInferenceRequired && input.primaryComputeMode === "cpu_only" && !input.cpuInferenceAvailable
      ? ["cpu_only_inference_backend_unavailable"] : []),
    ...(input.localInferenceRequired && input.primaryComputeMode === "gpu_accelerated" && !input.gpuInferenceAvailable
      ? ["gpu_inference_backend_unavailable"] : []),
    ...(input.externalRequestCount !== 0 || input.openAiRequestCount !== 0 ? ["external_network_request_detected"] : []),
    ...(input.timeScale !== 1 ? ["accelerated_development_run"] : []),
    ...(!hasThreeRepetitions ? ["three_repetitions_not_completed"] : []),
    ...(hasThreeRepetitions && !repetitionsPassed ? ["qualification_repetition_failed"] : []),
    ...(!completeMeasurementSet ? ["qualifying_measurements_incomplete"] : []),
    ...(!exactConcurrencyComplete ? ["exact_camera_concurrency_not_executed"] : []),
    ...(!pipelineComplete ? ["production_pipeline_incomplete"] : []),
    ...(!resourceTelemetryComplete ? ["cpu_memory_or_disk_guardrail_unavailable"] : []),
    ...(!gpuTelemetryComplete ? ["gpu_or_vram_guardrail_unavailable"] : []),
    ...(!computeModesComplete ? ["automatic_production_compute_plan_incomplete"] : []),
    ...(!combinedCpuGpuComplete ? ["combined_cpu_gpu_load_incomplete"] : []),
    ...(!approvedThermalTelemetryComplete ? ["approved_thermal_guardrail_unavailable"] : []),
    ...(!physicalNetworkSpecificationComplete ? ["physical_network_link_specification_unavailable"] : []),
    ...(physicalNetworkSpecificationComplete && !physicalNetworkCapacityComplete
      ? ["physical_network_capacity_below_20_percent_reserve"] : []),
    ...(repeatVariabilityPercent > 10 ? ["repetition_capacity_variability_exceeded"] : []),
  ])];
  return {
    eligible: failures.length === 0,
    failures,
    qualifiedMeasurements,
    repeatVariabilityPercent,
    pipelineComplete,
    exactConcurrencyComplete,
    resourceTelemetryComplete,
    gpuTelemetryComplete,
    approvedThermalTelemetryComplete,
    physicalNetworkSpecificationComplete,
    physicalNetworkCapacityComplete,
    computeModesComplete,
    combinedCpuGpuComplete,
  };
}
