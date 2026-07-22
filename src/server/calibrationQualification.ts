import type { CalibrationPhaseMetric, CalibrationRepetitionResult } from "../shared/types.js";
import { REQUIRED_CALIBRATION_STAGES } from "../engine/calibration.js";
import type { PipelinePhaseMeasurement } from "./calibrationPipeline.js";
import { REQUIRED_CALIBRATION_COMPUTE_MODES } from "./calibrationCompute.js";

export interface CalibrationQualificationInput {
  mode: "quick" | "full";
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
): number {
  const variabilities: number[] = [];
  for (const phase of phaseNames) {
    for (const computeMode of REQUIRED_CALIBRATION_COMPUTE_MODES) {
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
  const requiredMeasurementCount = input.phaseNames.length * 3 * REQUIRED_CALIBRATION_COMPUTE_MODES.length;
  const hasThreeRepetitions = input.repetitions.length === 3;
  const qualifiedMeasurements = hasThreeRepetitions && input.measurements.length >= requiredMeasurementCount
    ? input.measurements.slice(-requiredMeasurementCount)
    : [];
  const completeMeasurementSet = qualifiedMeasurements.length === requiredMeasurementCount &&
    input.phaseNames.every((phase) => REQUIRED_CALIBRATION_COMPUTE_MODES.every((computeMode) =>
      qualifiedMeasurements.filter((item) => item.phase === phase && item.computeMode === computeMode).length === 3));
  const repetitionsPassed = hasThreeRepetitions && input.repetitions.every((item) =>
    item.passed && item.tier === input.selectedTier && item.safeCameraCapacity === input.selectedTier);
  const repeatVariabilityPercent = Math.max(
    repetitionVariability(input.repetitions),
    measurementVariability(qualifiedMeasurements, input.phaseNames),
  );
  const exactConcurrencyComplete = completeMeasurementSet && qualifiedMeasurements.every((item) =>
    item.exactCameraConcurrency && item.actualConcurrentMediaPipelines === item.tier);
  const requiredStagesComplete = completeMeasurementSet && qualifiedMeasurements.every((item) =>
    REQUIRED_CALIBRATION_STAGES.every((stage) => item.measuredStages.includes(stage)));
  const workloadContractsComplete = completeMeasurementSet && qualifiedMeasurements.every((item) =>
    item.databaseOperations > 0 && item.dashboardQueries > 0 && item.completedJobRuns > 0 &&
    item.completedStepRuns > 0 && item.completedIntelligenceJobs > 0 &&
    item.processedCameraCount === item.tier && item.failures.length === 0);
  const pipelineComplete = input.mediaAvailable && input.rtspAvailable && input.localInferenceAvailable &&
    completeMeasurementSet && requiredStagesComplete && workloadContractsComplete &&
    qualifiedMeasurements.every((item) => item.mediaMeasured && item.rtspMeasured && item.localInferenceMeasured);
  const resourceTelemetryComplete = completeMeasurementSet && qualifiedMeasurements.every((item) =>
    item.cpuUtilizationPercent !== null && item.memoryUsedBytes !== null &&
    item.memoryBytesPerSecond !== null && item.temporaryBytesFreeBeforePhase !== null);
  const gpuTelemetryComplete = completeMeasurementSet && qualifiedMeasurements.every((item) =>
    item.computeMode === "cpu_only" || (item.hardwareTelemetry.gpuUtilizationPercent !== null &&
    item.hardwareTelemetry.gpuMemoryUsedBytes !== null));
  const computeModesComplete = completeMeasurementSet &&
    qualifiedMeasurements.filter((item) => item.computeMode === "cpu_only").every((item) =>
      item.cpuWorkloadMeasured && item.inferenceBackend === "cpu" && item.inferenceDeviceId === "none") &&
    qualifiedMeasurements.filter((item) => item.computeMode === "gpu_accelerated").every((item) =>
      item.cpuWorkloadMeasured && item.gpuInferenceMeasured && item.gpuMediaMeasured &&
      item.inferenceBackend !== "cpu" && item.inferenceBackend !== "unavailable" &&
      item.inferenceDeviceId !== "none" && item.inferenceDeviceId !== "unavailable");
  const combinedCpuGpuComplete = completeMeasurementSet &&
    qualifiedMeasurements.filter((item) => item.computeMode === "gpu_accelerated")
      .every((item) => item.combinedCpuGpuMeasured);
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
    ...(input.mode !== "full" ? ["quick_test_is_diagnostic"] : []),
    ...(!input.runtimeReady ? ["packaged_runtime_not_qualified"] : []),
    ...(!input.authorityAndProfileExact ? ["authority_or_workload_profile_mismatch"] : []),
    ...(!input.mediaAvailable || !input.rtspAvailable ? ["approved_offline_media_runtime_unavailable"] : []),
    ...(!input.localInferenceAvailable ? ["approved_local_inference_assets_unavailable"] : []),
    ...(!input.cpuInferenceAvailable ? ["cpu_only_inference_backend_unavailable"] : []),
    ...(!input.gpuInferenceAvailable ? ["gpu_inference_backend_unavailable"] : []),
    ...(!input.gpuMediaAvailable ? ["gpu_media_backend_unavailable"] : []),
    ...(input.externalRequestCount !== 0 || input.openAiRequestCount !== 0 ? ["external_network_request_detected"] : []),
    ...(input.timeScale !== 1 ? ["accelerated_development_run"] : []),
    ...(!hasThreeRepetitions ? ["three_repetitions_not_completed"] : []),
    ...(hasThreeRepetitions && !repetitionsPassed ? ["qualification_repetition_failed"] : []),
    ...(!completeMeasurementSet ? ["qualifying_measurements_incomplete"] : []),
    ...(!exactConcurrencyComplete ? ["exact_camera_concurrency_not_executed"] : []),
    ...(!pipelineComplete ? ["production_pipeline_incomplete"] : []),
    ...(!resourceTelemetryComplete ? ["cpu_memory_or_disk_guardrail_unavailable"] : []),
    ...(!gpuTelemetryComplete ? ["gpu_or_vram_guardrail_unavailable"] : []),
    ...(!computeModesComplete ? ["cpu_and_gpu_compute_modes_incomplete"] : []),
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
