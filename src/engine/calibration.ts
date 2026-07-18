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
    target.higherIsBetter && anchor.higherIsBetter;
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
    if (run.id === excludedRunId || !run.fingerprint.hardwareTemplateId) continue;
    const measured = run.stages.find((item) => item.stage === stage);
    if (!measured || measured.safeCameraCapacity <= 0) continue;
    const anchors = observations.filter((item) => item.hardwareTemplateId === run.fingerprint.hardwareTemplateId && item.stage === stage);
    for (const targetObservation of targets) {
      const anchor = anchors.find((item) => comparableBenchmark(targetObservation, item));
      if (!anchor) continue;
      const ratio = targetObservation.score / anchor.score;
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
  if (strong.length >= 2) return "A";
  if (strong.length >= 1) return "B";
  return "C";
}

function leaveOneOutUnsafeCount(
  runs: LocalCalibrationRun[],
  catalog: HardwareNodeTemplate[],
  observations: PublicBenchmarkObservation[],
): number {
  let unsafe = 0;
  for (const heldOut of runs) {
    const hardwareId = heldOut.fingerprint.hardwareTemplateId;
    const target = catalog.find((item) => item.id === hardwareId);
    if (!target) continue;
    for (const metric of heldOut.stages) {
      const contributions = contributionsFor(target, metric.stage, runs, observations, heldOut.id);
      if (contributions.length === 0) continue;
      const confidence = confidenceFor(target, contributions);
      const safe = Math.floor(Math.min(...contributions.map((item) => item.rawCapacity)) * (1 - RESERVE_BY_CLASS[confidence] / 100));
      if (safe > metric.safeCameraCapacity) unsafe += 1;
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
  return catalog.map((target) => {
    const exactRuns = runs
      .filter((run) => run.fingerprint.hardwareTemplateId === target.id &&
        run.overallSafeCameraCapacity > 0 &&
        run.externalRequestCount === 0 && run.openAiRequestCount === 0 &&
        run.phases.every((phase) => phase.outOfMemoryCount === 0 && phase.queueGrowthPerMinute <= 0.05 && phase.inferenceSuccessRate >= 0.99))
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
        safeCameraMinimum: Math.floor(exact.overallSafeCameraCapacity * 0.9),
        safeCameraMaximum: Math.floor(exact.overallSafeCameraCapacity),
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
      const reservePercent = RESERVE_BY_CLASS[confidence];
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
    const reservePercent = RESERVE_BY_CLASS[overallClass];
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
      reasons: complete
        ? ["Stage-specific ratios use the conservative minimum across comparable physical anchors."]
        : ["Public or physical anchor coverage is incomplete; this machine is reference-only."],
    } satisfies CapacityPrediction;
  });
}
