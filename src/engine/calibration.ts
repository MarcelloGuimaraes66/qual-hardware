import { randomUUID } from "node:crypto";
import type {
  CalibrationConfidenceClass,
  CalibrationPlan,
  CalibrationStage,
  CapacityPrediction,
  CapacityScenario,
  HardwareNodeTemplate,
  LocalCalibrationRun,
  OperatingSystemFamily,
  PublicBenchmarkObservation,
  StagePrediction,
} from "../shared/types.js";
import {
  AUTONOMOUS_LOCAL_CALIBRATION_VERSION,
  CALIBRATION_PLAN_VERSION,
  CALIBRATION_KERNEL_VERSION,
  PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT,
  CAPACITY_PREDICTION_VERSION,
  WORKLOAD_CONTRACT_VERSION,
} from "../shared/types.js";
import { buildCalibrationWorkloadProfile, runWorkloadProfileId } from "./calibrationProfile.js";
import { isPublicObservationEligible, REQUIRED_EVIDENCE_STAGES } from "./evidence.js";

export const REQUIRED_CALIBRATION_STAGES: CalibrationStage[] = REQUIRED_EVIDENCE_STAGES;

const RESERVE_BY_CLASS: Record<Exclude<CalibrationConfidenceClass, "none">, number> = {
  A: 20,
  B: 30,
  C: 40,
};

function templateOperatingSystem(template: HardwareNodeTemplate): OperatingSystemFamily {
  return template.operatingSystemFamily ?? (template.cpuVendor === "apple" ? "macos" : "windows");
}

function comparableBenchmark(
  target: PublicBenchmarkObservation,
  anchor: PublicBenchmarkObservation,
): boolean {
  return target.stage === anchor.stage &&
    target.profileId === anchor.profileId &&
    target.benchmarkName === anchor.benchmarkName &&
    target.benchmarkVersion === anchor.benchmarkVersion &&
    target.unit === anchor.unit &&
    target.higherIsBetter === anchor.higherIsBetter &&
    (!target.componentKind || !anchor.componentKind || target.componentKind === anchor.componentKind);
}

function benchmarkRatio(target: PublicBenchmarkObservation, anchor: PublicBenchmarkObservation): number {
  if (!comparableBenchmark(target, anchor)) return Number.NaN;
  return target.higherIsBetter ? target.score / anchor.score : anchor.score / target.score;
}

export interface CalibrationPredictionCompatibility {
  kernelVersion: string;
  runtimeManifestHash: string;
}

function calibrationRunEligible(
  run: LocalCalibrationRun,
  compatibility?: CalibrationPredictionCompatibility,
): boolean {
  const covered = new Map(run.stages.map((stage) => [stage.stage, stage]));
  const pipelineProof = run.pipelineEvidence;
  const compute = run.computeEvidence;
  const repetitions = run.repetitions ?? [];
  const capacities = repetitions.map((item) => item.safeCameraCapacity).filter((value) => value > 0);
  const variability = capacities.length === 3
    ? (Math.max(...capacities) - Math.min(...capacities)) / Math.max(1, [...capacities].sort((a, b) => a - b)[1]!) * 100
    : Number.POSITIVE_INFINITY;
  return run.schemaVersion === AUTONOMOUS_LOCAL_CALIBRATION_VERSION &&
    (!compatibility || (run.kernelVersion === compatibility.kernelVersion &&
      run.runtimeManifestHash === compatibility.runtimeManifestHash)) &&
    run.kernelVersion === CALIBRATION_KERNEL_VERSION &&
    run.compatiblePerceptrumCommit === PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT &&
    run.fingerprint.perceptrumBuildHash === PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT &&
    run.workloadProfileId === `workload:${run.workloadProfileSignature}` &&
    run.workloadContractVersion === WORKLOAD_CONTRACT_VERSION &&
    run.mode === "full" && run.executionMode === "production_pipeline" &&
    run.developmentOnly !== true &&
    run.runtimeProvenance?.manifestApproved === true &&
    pipelineProof?.complete === true &&
    pipelineProof.jobSchedulerExecuted === true &&
    pipelineProof.jobRuntimeExecuted === true &&
    pipelineProof.jobStepRunsPersisted === true &&
    pipelineProof.databaseWritesPersisted === true &&
    pipelineProof.intelligenceSchedulerExecuted === true &&
    pipelineProof.dashboardQueriesExecuted === true &&
    pipelineProof.concurrentWithLoad === true &&
    compute?.requiredModes.join(",") === "cpu_only,gpu_accelerated" &&
    compute.cpu.measured && compute.cpu.safeCameraCapacity !== null &&
    compute.gpu.inferenceMeasured && compute.gpu.mediaMeasured && compute.gpu.utilizationMeasured &&
    compute.gpu.inferenceBackend !== "unavailable" && compute.gpu.mediaBackend !== "unavailable" &&
    compute.gpu.deviceId !== null && compute.gpu.safeCameraCapacity !== null &&
    compute.combined.measured && compute.combined.safeCameraCapacity !== null &&
    run.overallSafeCameraCapacity !== null && run.overallSafeCameraCapacity === Math.min(
      compute.cpu.safeCameraCapacity, compute.gpu.safeCameraCapacity, compute.combined.safeCameraCapacity,
    ) &&
    ["warmup", "ramp", "sustained", "surge"].every((phase) =>
      pipelineProof.phaseCoverage?.some((item) => item.phase === phase && item.completedProbeCount > 0)) &&
    run.qualityGate?.eligibleForCapacityExtrapolation === true &&
    run.externalRequestCount === 0 && run.openAiRequestCount === 0 &&
    Boolean(run.workloadProfileId && run.workloadProfileSignature && run.kernelVersion && run.runtimeManifestHash) &&
    repetitions.length === 3 && repetitions.every((item) => item.passed) && variability <= 10 &&
    (run.repeatVariabilityPercent ?? Number.POSITIVE_INFINITY) <= 10 &&
    REQUIRED_CALIBRATION_STAGES.every((stage) => {
      const evidence = covered.get(stage);
      return evidence?.evidenceStatus === "measured" &&
        evidence.safeCameraCapacity !== null && evidence.safeCameraCapacity > 0;
    }) &&
    run.phases.map((phase) => phase.name).join(",") === "warmup,ramp,sustained,surge" &&
    run.phases.every((phase) => phase.outOfMemoryCount === 0 &&
      phase.queueGrowthPerMinute <= 0 &&
      phase.inferenceSuccessRate >= 0.995 &&
      phase.frameDeliveryRate !== undefined && phase.frameDeliveryRate >= 0.995 &&
      phase.p99InferenceLatencyMs !== undefined &&
      (phase.inferenceIntervalMs !== undefined || phase.inferenceIntervalSeconds !== undefined) &&
      phase.p99InferenceLatencyMs < (phase.inferenceIntervalMs ?? (phase.inferenceIntervalSeconds ?? 0) * 1_000) * 0.75);
}

function compatibleAnchor(
  target: HardwareNodeTemplate,
  run: LocalCalibrationRun,
): "strong" | "weak" {
  const fingerprint = run.fingerprint;
  const samePlatform = fingerprint.operatingSystem === templateOperatingSystem(target);
  const sameFormFactor = fingerprint.formFactor === target.kind;
  const targetCpuArchitecture = target.cpuArchitecture?.toLowerCase();
  const targetGpuArchitecture = target.gpuArchitecture?.toLowerCase();
  const sameCpuVendor = fingerprint.cpuModel.toLowerCase().includes(target.cpuVendor);
  const sameGpuVendor = fingerprint.gpuModel.toLowerCase().includes(target.gpuVendor);
  const sameCpuArchitecture = !targetCpuArchitecture || fingerprint.cpuArchitecture.toLowerCase().includes(targetCpuArchitecture);
  const sameGpuArchitecture = !targetGpuArchitecture || fingerprint.gpuArchitecture.toLowerCase().includes(targetGpuArchitecture);
  return samePlatform && sameFormFactor && sameCpuVendor && sameGpuVendor && sameCpuArchitecture && sameGpuArchitecture ? "strong" : "weak";
}

interface Contribution {
  run: LocalCalibrationRun;
  ratio: number;
  rawCapacity: number;
  sourceUrl: string;
  profileId: string;
}

function contributionsFor(
  target: HardwareNodeTemplate,
  stage: CalibrationStage,
  runs: LocalCalibrationRun[],
  observations: PublicBenchmarkObservation[],
  excludedRunId?: string,
  workloadProfileId?: string,
): Contribution[] {
  const targets = observations.filter((item) => item.hardwareTemplateId === target.id && item.stage === stage && isPublicObservationEligible(item));
  const contributions: Contribution[] = [];
  for (const run of runs) {
    if (run.id === excludedRunId || !run.fingerprint.hardwareTemplateId || !calibrationRunEligible(run) ||
      (workloadProfileId && runWorkloadProfileId(run) !== workloadProfileId)) continue;
    const measured = run.stages.find((item) => item.stage === stage);
    if (!measured || measured.safeCameraCapacity === null || measured.safeCameraCapacity <= 0) continue;
    const anchors = observations.filter((item) => item.hardwareTemplateId === run.fingerprint.hardwareTemplateId && item.stage === stage && isPublicObservationEligible(item));
    for (const targetObservation of targets) {
      const anchor = anchors.find((item) => comparableBenchmark(targetObservation, item));
      if (!anchor) continue;
      const ratio = benchmarkRatio(targetObservation, anchor);
      if (!Number.isFinite(ratio) || ratio <= 0) continue;
      contributions.push({
        run,
        ratio,
        rawCapacity: measured.safeCameraCapacity * ratio,
        sourceUrl: targetObservation.sourceUrl,
        profileId: targetObservation.profileId,
      });
      break;
    }
  }
  return contributions;
}

function confidenceFor(target: HardwareNodeTemplate, contributions: Contribution[]): Exclude<CalibrationConfidenceClass, "none"> {
  const distinctRuns = new Map(contributions.map((item) => [item.run.id, item.run])).values();
  const runs = [...distinctRuns];
  const strong = runs.filter((run) => compatibleAnchor(target, run) === "strong");
  const strongHardware = new Set(strong.map((run) => run.fingerprint.hardwareTemplateId));
  if (strong.length >= 3 && strongHardware.size >= 3) return "A";
  if (strong.length >= 2 && strongHardware.size >= 2) return "B";
  return "C";
}

interface StageErrorProfile {
  maximumOverpredictionPercent: number;
  repeatVariabilityPercent: number;
  medianAbsoluteErrorPercent: number | null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2 : ordered[middle] ?? null;
}

function stageErrorProfile(
  runs: LocalCalibrationRun[],
  catalog: HardwareNodeTemplate[],
  observations: PublicBenchmarkObservation[],
  stage: CalibrationStage,
  workloadProfileId: string,
): StageErrorProfile {
  const eligibleRuns = runs.filter((run) => calibrationRunEligible(run) && runWorkloadProfileId(run) === workloadProfileId);
  const absoluteErrors: number[] = [];
  const overpredictions: number[] = [];
  for (const heldOut of eligibleRuns) {
    const target = catalog.find((item) => item.id === heldOut.fingerprint.hardwareTemplateId);
    const measured = heldOut.stages.find((item) => item.stage === stage)?.safeCameraCapacity ?? 0;
    if (!target || measured <= 0) continue;
    const contributions = contributionsFor(target, stage, eligibleRuns, observations, heldOut.id, workloadProfileId);
    if (!contributions.length) continue;
    const predicted = Math.min(...contributions.map((item) => item.rawCapacity));
    const errorPercent = Math.abs(predicted - measured) * 100 / measured;
    absoluteErrors.push(errorPercent);
    overpredictions.push(Math.max(0, (predicted - measured) * 100 / measured));
  }
  const repeatVariabilities: number[] = [];
  const byHardware = new Map<string, number[]>();
  for (const run of eligibleRuns) {
    const hardwareId = run.fingerprint.hardwareTemplateId;
    const capacity = run.stages.find((item) => item.stage === stage)?.safeCameraCapacity ?? 0;
    if (!hardwareId || capacity <= 0) continue;
    byHardware.set(hardwareId, [...(byHardware.get(hardwareId) ?? []), capacity]);
  }
  for (const values of byHardware.values()) {
    if (values.length < 2) continue;
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    repeatVariabilities.push(average > 0 ? (Math.max(...values) - Math.min(...values)) * 100 / average : 0);
  }
  return {
    maximumOverpredictionPercent: Math.max(0, ...overpredictions),
    repeatVariabilityPercent: Math.max(0, ...repeatVariabilities),
    medianAbsoluteErrorPercent: median(absoluteErrors),
  };
}

function effectiveReserve(confidence: Exclude<CalibrationConfidenceClass, "none">, profile: StageErrorProfile): number {
  return Math.min(70, Math.max(
    RESERVE_BY_CLASS[confidence],
    Math.ceil(profile.maximumOverpredictionPercent),
    Math.ceil(profile.repeatVariabilityPercent),
  ));
}

function leaveOneOutUnsafeCount(
  runs: LocalCalibrationRun[],
  catalog: HardwareNodeTemplate[],
  observations: PublicBenchmarkObservation[],
  workloadProfileId: string,
): number {
  let unsafe = 0;
  for (const heldOut of runs.filter((run) => calibrationRunEligible(run) && runWorkloadProfileId(run) === workloadProfileId)) {
    const hardwareId = heldOut.fingerprint.hardwareTemplateId;
    const target = catalog.find((item) => item.id === hardwareId);
    if (!target) continue;
    for (const metric of heldOut.stages) {
      const contributions = contributionsFor(target, metric.stage, runs, observations, heldOut.id, workloadProfileId);
      if (contributions.length === 0) continue;
      const confidence = confidenceFor(target, contributions);
      const profile = stageErrorProfile(runs, catalog, observations, metric.stage, workloadProfileId);
      const safe = Math.floor(Math.min(...contributions.map((item) => item.rawCapacity)) * (1 - effectiveReserve(confidence, profile) / 100));
      if (metric.safeCameraCapacity !== null && safe > metric.safeCameraCapacity) unsafe += 1;
    }
  }
  return unsafe;
}

export function createCalibrationPlan(
  scenario: CapacityScenario,
  mode: "quick" | "full",
  targetHardwareTemplateId: string | null = null,
): CalibrationPlan {
  const quick = mode === "quick";
  const workloadProfile = buildCalibrationWorkloadProfile(scenario);
  return {
    schemaVersion: CALIBRATION_PLAN_VERSION,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    mode,
    executionMode: quick ? "readiness" : "production_pipeline",
    workloadContractVersion: WORKLOAD_CONTRACT_VERSION,
    kernelVersion: CALIBRATION_KERNEL_VERSION,
    strategy: "adaptive",
    workloadProfile,
    cameraTiers: [1, 4, 8, 16, 32, 64, 128, 256, 512, 1_024, 2_048, 4_096],
    discovery: { stabilizationSeconds: 30, sampleSeconds: 90 },
    qualification: { repetitions: 3, cooldownSeconds: 600, maximumVariabilityPercent: 10 },
    targetHardwareTemplateId,
    scenario: { ...scenario, workloadContractVersion: WORKLOAD_CONTRACT_VERSION },
    localOnly: true,
    rtspOrigin: "rtsp://127.0.0.1",
    aiqOrigin: "http://127.0.0.1",
    inferenceProvider: "aiq_local",
    phases: quick
      ? [
          { name: "warmup", durationSeconds: 120, loadPercent: 100 },
          { name: "sustained", durationSeconds: 300, loadPercent: 100 },
          { name: "surge", durationSeconds: 180, loadPercent: 120 },
        ]
      : [
          { name: "warmup", durationSeconds: 600, loadPercent: 100 },
          { name: "ramp", durationSeconds: 1200, loadPercent: 100 },
          { name: "sustained", durationSeconds: 1200, loadPercent: 100 },
          { name: "surge", durationSeconds: 600, loadPercent: 120 },
        ],
    sourceProfiles: scenario.cameraGroups.map((group) => ({ ...group.source })),
    // The currently packaged AiQ/Qwen Core path is fixed to one effective
    // inference FPS. RTSP source FPS remains independent and is preserved in
    // each source profile. Future local backends may add further values here.
    requestedInferenceFps: [1],
    instructions: [
      "Execute this plan only with the internal Qual Hardware Calibration Kernel.",
      "The kernel must use synthetic RTSP-equivalent streams and local AiQ/Qwen assets on 127.0.0.1 only.",
      "Do not include camera credentials, captured media, host names or personal data in the result.",
      "Persist aggregate evidence before deleting the session-owned temporary workspace.",
    ],
  };
}

export function buildCapacityPredictions(
  catalog: HardwareNodeTemplate[],
  runs: LocalCalibrationRun[],
  observations: PublicBenchmarkObservation[],
  compatibility?: CalibrationPredictionCompatibility,
): CapacityPrediction[] {
  const scopedRuns = compatibility
    ? runs.filter((run) => run.kernelVersion === compatibility.kernelVersion &&
      run.runtimeManifestHash === compatibility.runtimeManifestHash)
    : runs;
  const profiles = [...new Set(scopedRuns.filter((run) => Boolean(run.workloadProfileId)).map(runWorkloadProfileId))];
  const profileIds = profiles.length ? profiles : ["legacy-unscoped"];
  const unsafeCounts = new Map(profileIds.map((profileId) => [profileId, leaveOneOutUnsafeCount(scopedRuns, catalog, observations, profileId)]));
  const errorProfiles = new Map(profileIds.map((profileId) => [profileId,
    new Map(REQUIRED_CALIBRATION_STAGES.map((stage) => [stage, stageErrorProfile(scopedRuns, catalog, observations, stage, profileId)])),
  ]));
  return catalog.flatMap((target) => profileIds.map((workloadProfileId) => {
    const unsafeCount = unsafeCounts.get(workloadProfileId) ?? 0;
    const exactRuns = scopedRuns
      .filter((run) => run.fingerprint.hardwareTemplateId === target.id &&
        (run.overallSafeCameraCapacity ?? 0) > 0 &&
        calibrationRunEligible(run) && runWorkloadProfileId(run) === workloadProfileId)
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
    const exact = [...exactRuns].sort((left, right) =>
      (left.overallSafeCameraCapacity ?? Number.POSITIVE_INFINITY) -
      (right.overallSafeCameraCapacity ?? Number.POSITIVE_INFINITY) ||
      right.completedAt.localeCompare(left.completedAt))[0];
    if (exact) {
      return {
        schemaVersion: CAPACITY_PREDICTION_VERSION,
        id: randomUUID(),
        hardwareTemplateId: target.id,
        workloadProfileId,
        targetBuildHash: exact.fingerprint.perceptrumBuildHash,
        kernelVersion: exact.kernelVersion ?? null,
        runtimeManifestHash: exact.runtimeManifestHash ?? null,
        generatedAt: new Date().toISOString(),
        status: "validated_local",
        procurementEligibility: "eligible",
        confidenceClass: "A",
        safeCameraMinimum: Math.floor((exact.overallSafeCameraCapacity ?? 0) * 0.9),
        safeCameraMaximum: Math.floor(exact.overallSafeCameraCapacity ?? 0),
        bottleneck: exact.bottleneck,
        reservePercent: 20,
        exactCalibrationRunId: exact.id,
        stagePredictions: [],
        leaveOneOutUnsafeOverestimateCount: unsafeCount,
        reasons: [
          "Exact hardware fingerprint has a completed autonomous Qual Hardware calibration for this workload and build.",
          exactRuns.length > 1
            ? `The safe limit is the lowest observed across ${exactRuns.length} compatible exact runs.`
            : "One complete exact run is sufficient for this exact configuration; the three-distinct-system rule applies only to extrapolation.",
        ],
      } satisfies CapacityPrediction;
    }

    const stagePredictions: StagePrediction[] = [];
    let overallClass: Exclude<CalibrationConfidenceClass, "none"> = "A";
    for (const stage of REQUIRED_CALIBRATION_STAGES) {
      const contributions = contributionsFor(target, stage, scopedRuns, observations, undefined, workloadProfileId);
      if (contributions.length === 0) continue;
      let confidence = confidenceFor(target, contributions);
      if (unsafeCount > 0 && confidence === "A") confidence = "B";
      if (confidence === "C") overallClass = "C";
      else if (confidence === "B" && overallClass === "A") overallClass = "B";
      const errorProfile = errorProfiles.get(workloadProfileId)?.get(stage) ?? { maximumOverpredictionPercent: 0, repeatVariabilityPercent: 0, medianAbsoluteErrorPercent: null };
      const reservePercent = effectiveReserve(confidence, errorProfile);
      const rawCameraCapacity = Math.min(...contributions.map((item) => item.rawCapacity));
      stagePredictions.push({
        stage,
        profileId: contributions[0]?.profileId ?? "unknown",
        anchorRunIds: [...new Set(contributions.map((item) => item.run.id))],
        anchorHardwareIds: [...new Set(contributions.map((item) => item.run.fingerprint.hardwareTemplateId).filter((item): item is string => Boolean(item)))],
        ratios: contributions.map((item) => item.ratio),
        rawCameraCapacity,
        safeCameraCapacity: Math.max(0, Math.floor(rawCameraCapacity * (1 - reservePercent / 100))),
        reservePercent,
        empiricalOverpredictionPercent: errorProfile.maximumOverpredictionPercent,
        repeatVariabilityPercent: errorProfile.repeatVariabilityPercent,
        ...(errorProfile.medianAbsoluteErrorPercent === null ? {} : { medianAbsoluteErrorPercent: errorProfile.medianAbsoluteErrorPercent }),
        sourceUrls: [...new Set(contributions.map((item) => item.sourceUrl))],
      });
    }

    const requiredCoverage = REQUIRED_CALIBRATION_STAGES;
    const covered = new Set(stagePredictions.map((item) => item.stage));
    const complete = requiredCoverage.every((stage) => covered.has(stage));
    if (!complete || stagePredictions.length === 0) overallClass = "C";
    const bottleneckPrediction = [...stagePredictions].sort((left, right) => left.safeCameraCapacity - right.safeCameraCapacity)[0];
    const reservePercent = stagePredictions.length
      ? Math.max(...stagePredictions.map((item) => item.reservePercent))
      : RESERVE_BY_CLASS[overallClass];
    if (unsafeCount > 0 && overallClass === "A") overallClass = "B";
    const status = overallClass === "A"
      ? "extrapolated_high"
      : overallClass === "B" ? "extrapolated_medium" : "reference_only";
    const procurementEligibility = status === "extrapolated_high"
      ? "eligible"
      : status === "extrapolated_medium" ? "planning_only" : "blocked";
    const safeCameraMaximum = status === "reference_only" ? null : bottleneckPrediction?.safeCameraCapacity ?? null;
    const missingStages = requiredCoverage.filter((stage) => !covered.has(stage));
    return {
      schemaVersion: CAPACITY_PREDICTION_VERSION,
      id: randomUUID(),
      hardwareTemplateId: target.id,
      workloadProfileId,
      targetBuildHash: scopedRuns.find((run) => runWorkloadProfileId(run) === workloadProfileId)?.fingerprint.perceptrumBuildHash ?? null,
      kernelVersion: scopedRuns.find((run) => runWorkloadProfileId(run) === workloadProfileId)?.kernelVersion ?? null,
      runtimeManifestHash: scopedRuns.find((run) => runWorkloadProfileId(run) === workloadProfileId)?.runtimeManifestHash ?? null,
      generatedAt: new Date().toISOString(),
      status,
      procurementEligibility,
      confidenceClass: overallClass,
      safeCameraMinimum: safeCameraMaximum === null ? null : Math.max(0, Math.floor(safeCameraMaximum * 0.9)),
      safeCameraMaximum,
      bottleneck: bottleneckPrediction?.stage ?? null,
      reservePercent,
      exactCalibrationRunId: null,
      stagePredictions,
      leaveOneOutUnsafeOverestimateCount: unsafeCount,
      medianAbsoluteErrorPercent: median(stagePredictions
        .map((item) => item.medianAbsoluteErrorPercent)
        .filter((value): value is number => value !== undefined)),
      reasons: complete
        ? [
            "Stage-specific ratios use the conservative minimum across comparable physical anchors.",
            `The effective reserve is the largest of the class floor, empirical overprediction and repeat variability (${reservePercent}%).`,
          ]
        : [
            "Public or eligible physical anchor coverage is incomplete; this machine is reference-only and blocked for acquisition.",
            `Missing stage evidence: ${missingStages.join(", ") || "comparable physical anchors"}.`,
          ],
    } satisfies CapacityPrediction;
  }));
}
