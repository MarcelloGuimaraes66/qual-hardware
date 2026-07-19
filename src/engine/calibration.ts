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
  CALIBRATION_PLAN_VERSION,
  CAPACITY_PREDICTION_VERSION,
  WORKLOAD_CONTRACT_VERSION,
} from "../shared/types.js";

export const REQUIRED_CALIBRATION_STAGES: CalibrationStage[] = [
  "rtsp_ingest",
  "video_decode",
  "bgr_processing",
  "video_encode",
  "disk_write",
  "disk_read",
  "local_inference",
  "memory_bandwidth",
  "network_ingest",
  "thermal_sustain",
];

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

function calibrationRunEligible(run: LocalCalibrationRun): boolean {
  return run.mode === "full" && run.executionMode === "production_pipeline" &&
    run.developmentOnly !== true &&
    run.pipelineEvidence?.complete === true && run.qualityGate?.eligibleForCapacityExtrapolation === true &&
    run.externalRequestCount === 0 && run.openAiRequestCount === 0 &&
    run.phases.every((phase) => phase.outOfMemoryCount === 0 && phase.queueGrowthPerMinute <= 0.05 && phase.inferenceSuccessRate >= 0.99);
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
): Contribution[] {
  const targets = observations.filter((item) => item.hardwareTemplateId === target.id && item.stage === stage);
  const contributions: Contribution[] = [];
  for (const run of runs) {
    if (run.id === excludedRunId || !run.fingerprint.hardwareTemplateId || !calibrationRunEligible(run)) continue;
    const measured = run.stages.find((item) => item.stage === stage);
    if (!measured || measured.safeCameraCapacity === null || measured.safeCameraCapacity <= 0) continue;
    const anchors = observations.filter((item) => item.hardwareTemplateId === run.fingerprint.hardwareTemplateId && item.stage === stage);
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
): StageErrorProfile {
  const eligibleRuns = runs.filter(calibrationRunEligible);
  const absoluteErrors: number[] = [];
  const overpredictions: number[] = [];
  for (const heldOut of eligibleRuns) {
    const target = catalog.find((item) => item.id === heldOut.fingerprint.hardwareTemplateId);
    const measured = heldOut.stages.find((item) => item.stage === stage)?.safeCameraCapacity ?? 0;
    if (!target || measured <= 0) continue;
    const contributions = contributionsFor(target, stage, eligibleRuns, observations, heldOut.id);
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
): number {
  let unsafe = 0;
  for (const heldOut of runs.filter(calibrationRunEligible)) {
    const hardwareId = heldOut.fingerprint.hardwareTemplateId;
    const target = catalog.find((item) => item.id === hardwareId);
    if (!target) continue;
    for (const metric of heldOut.stages) {
      const contributions = contributionsFor(target, metric.stage, runs, observations, heldOut.id);
      if (contributions.length === 0) continue;
      const confidence = confidenceFor(target, contributions);
      const profile = stageErrorProfile(runs, catalog, observations, metric.stage);
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
  return {
    schemaVersion: CALIBRATION_PLAN_VERSION,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    mode,
    executionMode: quick ? "readiness" : "production_pipeline",
    workloadContractVersion: WORKLOAD_CONTRACT_VERSION,
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
          { name: "sustained", durationSeconds: 2400, loadPercent: 100 },
          { name: "surge", durationSeconds: 600, loadPercent: 120 },
        ],
    sourceProfiles: scenario.cameraGroups.map((group) => ({ ...group.source })),
    // The currently packaged AiQ/Qwen Core path is fixed to one effective
    // inference FPS. RTSP source FPS remains independent and is preserved in
    // each source profile. Future local backends may add further values here.
    requestedInferenceFps: [1],
    instructions: [
      "Execute this plan with the Perceptrum desktop calibration runner on the computer being measured.",
      "The runner must use synthetic RTSP streams and AiQ/Qwen on 127.0.0.1 only.",
      "Do not include camera credentials, captured media, host names or personal data in the result.",
      "Import the resulting .qhcal.json file into Qual Hardware on any supported desktop.",
    ],
  };
}

export function buildCapacityPredictions(
  catalog: HardwareNodeTemplate[],
  runs: LocalCalibrationRun[],
  observations: PublicBenchmarkObservation[],
): CapacityPrediction[] {
  const unsafeCount = leaveOneOutUnsafeCount(runs, catalog, observations);
  const errorProfiles = new Map(REQUIRED_CALIBRATION_STAGES.map((stage) => [stage, stageErrorProfile(runs, catalog, observations, stage)]));
  return catalog.map((target) => {
    const exactRuns = runs
      .filter((run) => run.fingerprint.hardwareTemplateId === target.id &&
        (run.overallSafeCameraCapacity ?? 0) > 0 &&
        calibrationRunEligible(run))
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
    const exact = exactRuns[0];
    if (exact) {
      return {
        schemaVersion: CAPACITY_PREDICTION_VERSION,
        id: randomUUID(),
        hardwareTemplateId: target.id,
        generatedAt: new Date().toISOString(),
        status: "validated_local",
        confidenceClass: "A",
        safeCameraMinimum: Math.floor((exact.overallSafeCameraCapacity ?? 0) * 0.9),
        safeCameraMaximum: Math.floor(exact.overallSafeCameraCapacity ?? 0),
        bottleneck: exact.bottleneck,
        reservePercent: 10,
        exactCalibrationRunId: exact.id,
        stagePredictions: [],
        leaveOneOutUnsafeOverestimateCount: unsafeCount,
        reasons: ["Exact hardware fingerprint has a completed local Perceptrum calibration."],
      } satisfies CapacityPrediction;
    }

    const stagePredictions: StagePrediction[] = [];
    let overallClass: Exclude<CalibrationConfidenceClass, "none"> = "A";
    for (const stage of REQUIRED_CALIBRATION_STAGES) {
      const contributions = contributionsFor(target, stage, runs, observations);
      if (contributions.length === 0) continue;
      let confidence = confidenceFor(target, contributions);
      if (unsafeCount > 0 && confidence === "A") confidence = "B";
      if (confidence === "C") overallClass = "C";
      else if (confidence === "B" && overallClass === "A") overallClass = "B";
      const errorProfile = errorProfiles.get(stage) ?? { maximumOverpredictionPercent: 0, repeatVariabilityPercent: 0, medianAbsoluteErrorPercent: null };
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

    const requiredCoverage = REQUIRED_CALIBRATION_STAGES.filter((stage) =>
      stage !== "disk_read" && stage !== "memory_bandwidth",
    );
    const covered = new Set(stagePredictions.map((item) => item.stage));
    const complete = requiredCoverage.every((stage) => covered.has(stage));
    if (!complete || stagePredictions.length === 0) overallClass = "C";
    const bottleneckPrediction = [...stagePredictions].sort((left, right) => left.safeCameraCapacity - right.safeCameraCapacity)[0];
    const reservePercent = stagePredictions.length
      ? Math.max(...stagePredictions.map((item) => item.reservePercent))
      : RESERVE_BY_CLASS[overallClass];
    const status = overallClass === "A"
      ? "extrapolated_high"
      : overallClass === "B" ? "extrapolated_medium" : "reference_only";
    return {
      schemaVersion: CAPACITY_PREDICTION_VERSION,
      id: randomUUID(),
      hardwareTemplateId: target.id,
      generatedAt: new Date().toISOString(),
      status,
      confidenceClass: overallClass,
      safeCameraMinimum: bottleneckPrediction ? Math.max(0, Math.floor(bottleneckPrediction.safeCameraCapacity * 0.9)) : null,
      safeCameraMaximum: bottleneckPrediction?.safeCameraCapacity ?? null,
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
        : ["Public or eligible physical anchor coverage is incomplete; this machine is reference-only."],
    } satisfies CapacityPrediction;
  });
}
