import type {
  CalibrationStage,
  CalibrationStatus,
  EvidenceCoverageStage,
  EvidenceCoverageSummary,
  HardwareComponent,
  LocalCalibrationRun,
  ProcurementGate,
  PublicBenchmarkObservation,
} from "../shared/types.js";
import { WORKLOAD_CONTRACT_VERSION } from "../shared/types.js";

export const REQUIRED_EVIDENCE_STAGES: CalibrationStage[] = [
  "rtsp_ingest", "video_decode", "bgr_processing", "video_encode", "disk_write", "disk_read",
  "frame_extraction", "local_inference", "memory_bandwidth", "network_ingest", "job_scheduler",
  "intelligence_scheduler", "database_persistence", "dashboard_queries", "thermal_sustain",
];

/** Stages without a trustworthy public substitute must always be proven by Perceptrum itself. */
export const PHYSICAL_ONLY_STAGES = new Set<CalibrationStage>([
  "job_scheduler", "intelligence_scheduler", "database_persistence", "dashboard_queries", "thermal_sustain",
]);

const REJECTED_QUALITY_FLAGS = new Set([
  "anonymous", "overclock", "incomplete_configuration", "missing_driver", "missing_power",
  "incompatible_version", "marketing_only", "unverified", "synthetic_projection",
  "incomplete_reproducibility_metadata", "model_not_aiq",
  "model_not_perceptrum_aiq",
]);

export function isPublicObservationEligible(observation: PublicBenchmarkObservation): boolean {
  if (observation.eligibility === "rejected" || observation.eligibility === "reference_only") return false;
  if (observation.sourceTier > 2 || observation.reproducible !== true) return false;
  if (!observation.benchmarkSuiteId || !observation.metricName || !observation.evidenceLocator) return false;
  if (!/^[0-9a-f]{64}$/i.test(observation.rawArtifactSha256 ?? "")) return false;
  if ((observation.qualityFlags ?? []).some((flag) => REJECTED_QUALITY_FLAGS.has(flag))) return false;
  if (observation.stage === "local_inference" && /blender/i.test(observation.benchmarkName)) return false;
  if (observation.stage === "local_inference" && !/aiq|qwen|mlperf/i.test(
    `${observation.benchmarkName} ${observation.profileId} ${observation.configuration}`,
  )) return false;
  return true;
}

export function isPhysicalAnchorEligible(run: LocalCalibrationRun): boolean {
  if (run.workloadContractVersion !== WORKLOAD_CONTRACT_VERSION || (run.mode !== "qualification" && run.mode !== "full")) return false;
  if (run.executionMode !== "production_pipeline" || run.developmentOnly === true) return false;
  if (run.externalRequestCount !== 0 || run.openAiRequestCount !== 0) return false;
  if (run.pipelineEvidence?.complete !== true || run.qualityGate?.eligibleForCapacityExtrapolation !== true) return false;
  if (run.pipelineEvidence.concurrentWithLoad !== true) return false;
  if (!["warmup", "ramp", "sustained", "surge"].every((phase) =>
    run.pipelineEvidence?.phaseCoverage?.some((item) => item.phase === phase && item.completedProbeCount > 0))) return false;
  return REQUIRED_EVIDENCE_STAGES.every((stage) => {
    const metric = run.stages.find((candidate) => candidate.stage === stage);
    return metric?.evidenceStatus === "measured" && (metric.safeCameraCapacity ?? 0) > 0;
  });
}

export function componentStages(component: HardwareComponent): CalibrationStage[] {
  switch (component.kind) {
    case "cpu": return ["bgr_processing", "frame_extraction", "job_scheduler"];
    case "gpu": return ["video_decode", "video_encode", "local_inference"];
    case "memory":
    case "memory_kit": return ["memory_bandwidth"];
    case "storage":
    case "storage_os": return ["disk_read", "disk_write", "database_persistence", "dashboard_queries"];
    case "storage_retention": return ["disk_read", "disk_write"];
    case "network":
    case "nic": return ["rtsp_ingest", "network_ingest"];
    case "cooling":
    case "chassis":
    case "psu": return ["thermal_sustain"];
    case "system":
    case "oem_system":
    case "rack_configuration": return ["intelligence_scheduler", "database_persistence", "dashboard_queries", "thermal_sustain"];
    default: return [];
  }
}

export interface CoverageInput {
  hardwareTemplateId: string | null;
  components: HardwareComponent[];
  observations: PublicBenchmarkObservation[];
  calibrationRuns: LocalCalibrationRun[];
}

export function buildEvidenceCoverage(input: CoverageInput): EvidenceCoverageSummary {
  const componentIds = new Set(input.components.map((component) => component.id));
  const componentByStage = new Map<CalibrationStage, string[]>();
  for (const component of input.components) {
    for (const stage of componentStages(component)) {
      const current = componentByStage.get(stage) ?? [];
      current.push(component.id);
      componentByStage.set(stage, current);
    }
  }
  const eligibleRuns = input.calibrationRuns.filter(isPhysicalAnchorEligible).filter((run) =>
    input.hardwareTemplateId === null || run.fingerprint.hardwareTemplateId === input.hardwareTemplateId,
  );
  const stages: EvidenceCoverageStage[] = REQUIRED_EVIDENCE_STAGES.map((stage) => {
    const candidates = input.observations.filter((observation) => {
      if (observation.stage !== stage) return false;
      const linked = new Set([observation.componentId, ...(observation.componentIds ?? [])].filter((id): id is string => Boolean(id)));
      const componentMatch = linked.size === 0 || [...linked].some((id) => componentIds.has(id));
      const hardwareMatch = input.hardwareTemplateId === null || observation.hardwareTemplateId === input.hardwareTemplateId;
      return componentMatch && hardwareMatch;
    });
    const eligible = candidates.filter(isPublicObservationEligible);
    const anchors = eligibleRuns.filter((run) => run.stages.some((metric) => metric.stage === stage && metric.evidenceStatus === "measured"));
    const distinctAnchorConfigurations = new Set(anchors.map((run) => run.fingerprint.hardwareTemplateId).filter(Boolean)).size;
    const publicRequired = !PHYSICAL_ONLY_STAGES.has(stage);
    const covered = distinctAnchorConfigurations >= 3 && (!publicRequired || eligible.length > 0);
    const reasons: string[] = [];
    if (distinctAnchorConfigurations < 3) reasons.push(`São necessárias 3 configurações físicas distintas; existem ${distinctAnchorConfigurations}.`);
    if (publicRequired && eligible.length === 0) reasons.push("Não existe benchmark público elegível e comparável para este estágio.");
    return {
      stage,
      required: true,
      componentIds: [...new Set(componentByStage.get(stage) ?? [])],
      eligibleObservationIds: eligible.map((item) => item.id),
      referenceObservationIds: candidates.filter((item) => !isPublicObservationEligible(item)).map((item) => item.id),
      physicalAnchorRunIds: anchors.map((run) => run.id),
      covered,
      reasons,
    };
  });
  const coveredStageCount = stages.filter((stage) => stage.covered).length;
  const eligibleObservationIds = new Set(stages.flatMap((stage) => stage.eligibleObservationIds));
  const referenceObservationIds = new Set(stages.flatMap((stage) => stage.referenceObservationIds));
  return {
    requiredStageCount: stages.length,
    coveredStageCount,
    percent: Math.round((coveredStageCount / stages.length) * 10_000) / 100,
    complete: coveredStageCount === stages.length,
    eligibleObservationCount: eligibleObservationIds.size,
    referenceObservationCount: referenceObservationIds.size,
    physicalAnchorCount: new Set(eligibleRuns.map((run) => run.fingerprint.hardwareTemplateId).filter(Boolean)).size,
    stages,
  };
}

export function buildProcurementGate(coverage: EvidenceCoverageSummary, status: CalibrationStatus = "reference_only"): ProcurementGate {
  const exactComplete = status === "validated_local" && coverage.stages.every((stage) => stage.physicalAnchorRunIds.length >= 1);
  const highConfidence = status === "validated_local" || status === "extrapolated_high";
  const eligible = exactComplete || status === "extrapolated_high";
  const reasons = eligible ? [] : coverage.stages.flatMap((stage) => stage.reasons.map((reason) => `${stage.stage}: ${reason}`));
  if (!highConfidence) reasons.unshift(`Estado de evidência '${status}' não libera aquisição.`);
  return {
    eligibility: eligible ? "eligible" : status === "extrapolated_medium" ? "planning_only" : "blocked",
    status: eligible ? "apt_for_procurement" : status === "extrapolated_medium" ? "planning" : "blocked",
    reasons: [...new Set(reasons)],
    comparablePhysicalAnchors: coverage.physicalAnchorCount,
    requiredPhysicalAnchors: status === "validated_local" ? 1 : 3,
    completeStageCoverage: eligible || coverage.complete,
  };
}
