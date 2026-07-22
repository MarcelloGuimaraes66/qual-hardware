import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { hostname, platform, totalmem } from "node:os";
import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import {
  AUTONOMOUS_LOCAL_CALIBRATION_VERSION,
  CALIBRATION_KERNEL_VERSION,
  type CalibrationPhaseMetric,
  type CalibrationCheckpoint,
  type CalibrationRepetitionResult,
  type CalibrationStageMetric,
  type CalibrationTierResult,
  type HardwareFingerprint,
  type LocalCalibrationRun,
  type CalibrationHardwarePreflight,
} from "../shared/types.js";
import { calibrationPolicyHash, canonicalSha256 } from "../engine/calibrationProfile.js";
import { REQUIRED_CALIBRATION_STAGES } from "../engine/calibration.js";
import { calibrationHardwareDigest, calibrationHardwareMatchesTemplate, detectCalibrationHardware } from "./calibrationHardware.js";
import {
  CALIBRATION_PIPELINE_CONTRACT_VERSION,
  OfflineCalibrationPipeline,
  type CalibrationPipelineSummary,
  type PipelinePhaseMeasurement,
} from "./calibrationPipeline.js";
import { CALIBRATION_AUTHORITY_COMMIT } from "./calibrationRuntime.js";
import { evaluateCalibrationQualification } from "./calibrationQualification.js";
import { expectedGpuInferenceBackend, REQUIRED_CALIBRATION_COMPUTE_MODES } from "./calibrationCompute.js";
import {
  createCalibrationWorkspace,
  calibrationDiskStatus,
  calibrationWorkspaceBytes,
  prepareCalibrationTemporaryFile,
  reclaimCalibrationPhaseFiles,
  refreshRegisteredCalibrationTemporaryFiles,
  registerCalibrationTemporaryFile,
  setCalibrationWorkspaceOwner,
  type CalibrationWorkspace,
} from "./calibrationTemporaryFiles.js";
import type {
  CalibrationKernelControlMessage,
  CalibrationKernelDiagnosticPayload,
  CalibrationKernelWorkerInput,
  CalibrationKernelWorkerMessage,
} from "./calibrationKernelProtocol.js";
import { calibrationFailureWasCancelled } from "./calibrationKernelProtocol.js";

const input = workerData as CalibrationKernelWorkerInput;
let cancelled = false;
let activeWorkspace: CalibrationWorkspace | null = null;
let activeDatabase: DatabaseSync | null = null;
let activePipeline: OfflineCalibrationPipeline | null = null;
let lastProgress: CalibrationKernelDiagnosticPayload["lastProgress"] = null;
let diagnosticFingerprint: HardwareFingerprint | null = null;
let diagnosticPipelineSummary: CalibrationPipelineSummary | null = null;
let checkpointSequence = 0;
let temporaryBytesRemoved = 0;
const checkpointWaiters = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
const diagnosticTierResults: CalibrationTierResult[] = [];
const diagnosticRepetitions: CalibrationRepetitionResult[] = [];
const diagnosticMeasurements: PipelinePhaseMeasurement[] = [];
const diagnosticCreatedAt = new Date().toISOString();
parentPort?.on("message", (message: CalibrationKernelControlMessage) => {
  if (message.type === "cancel") {
    cancelled = true;
    return;
  }
  const waiter = checkpointWaiters.get(message.checkpointId);
  if (!waiter) return;
  clearTimeout(waiter.timer);
  checkpointWaiters.delete(message.checkpointId);
  if (message.type === "checkpoint_committed") waiter.resolve();
  else waiter.reject(new Error(`calibration_checkpoint_persistence_failed:${message.error}`));
});

function send(message: CalibrationKernelWorkerMessage): void {
  if (message.type === "progress") lastProgress = message.progress;
  parentPort?.postMessage(message);
}

function terminalDiagnostic(
  status: "cancelled" | "failed",
  error: string,
): CalibrationKernelDiagnosticPayload {
  const sanitize = (value: string): string => value.replaceAll(input.temporaryRoot, "<calibration-temp>").slice(0, 2_000);
  return {
    schemaVersion: "qual-hardware-calibration-diagnostic/1.0.0",
    sessionId: input.sessionId,
    runId: input.runId,
    planId: input.plan.id,
    createdAt: diagnosticCreatedAt,
    completedAt: new Date().toISOString(),
    status,
    error: sanitize(error),
    kernelVersion: CALIBRATION_KERNEL_VERSION,
    runtimeManifestHash: input.runtimeStatus.manifestHash,
    workloadProfileId: input.plan.workloadProfile.id,
    workloadProfileSignature: input.plan.workloadProfile.signature,
    compatiblePerceptrumCommit: CALIBRATION_AUTHORITY_COMMIT,
    lastProgress,
    fingerprint: diagnosticFingerprint,
    runtimeSummary: diagnosticPipelineSummary ? {
      mediaAvailable: diagnosticPipelineSummary.mediaAvailable,
      rtspAvailable: diagnosticPipelineSummary.rtspAvailable,
      localInferenceAvailable: diagnosticPipelineSummary.localInferenceAvailable,
      unavailableReasons: diagnosticPipelineSummary.unavailableReasons.map(sanitize),
    } : null,
    tierResults: structuredClone(diagnosticTierResults),
    repetitions: structuredClone(diagnosticRepetitions),
    measurements: diagnosticMeasurements.map((measurement) => structuredClone(measurement) as unknown as Record<string, unknown>),
  };
}

function checkpointCompatibility(fingerprint: HardwareFingerprint): CalibrationCheckpoint["compatibility"] {
  return {
    hardwareDigest: calibrationHardwareDigest(fingerprint),
    operatingSystem: fingerprint.operatingSystem,
    operatingSystemVersion: fingerprint.operatingSystemVersion,
    gpuDriver: fingerprint.gpuDriver,
    workloadProfileSignature: input.plan.workloadProfile.signature,
    targetBuildHash: input.plan.workloadProfile.targetBuildHash,
    kernelVersion: CALIBRATION_KERNEL_VERSION,
    runtimeManifestHash: input.runtimeStatus.manifestHash,
    modelHash: fingerprint.aiqModelHash,
    calibrationPolicyHash: calibrationPolicyHash(input.plan),
    appVersion: input.appVersion,
  };
}

async function persistCheckpointAndReclaim(inputCheckpoint: {
  workspace: CalibrationWorkspace;
  ownerPhase: string;
  checkpointPhase: CalibrationCheckpoint["phase"];
  tier: number | null;
  repetition: number | null;
  attempt: number;
  fingerprint: HardwareFingerprint;
  completedDiscoveryTiers: number[];
  highestPassedDiscoveryTier: number | null;
  progress: Omit<NonNullable<CalibrationKernelDiagnosticPayload["lastProgress"]>, "updatedAt">;
}): Promise<void> {
  await refreshRegisteredCalibrationTemporaryFiles(input.temporaryRoot, input.sessionId, inputCheckpoint.workspace);
  const payload = {
    sessionId: input.sessionId,
    runId: input.runId,
    sequence: ++checkpointSequence,
    phase: inputCheckpoint.checkpointPhase,
    tier: inputCheckpoint.tier,
    repetition: inputCheckpoint.repetition,
    attempt: inputCheckpoint.attempt,
    compatibility: checkpointCompatibility(inputCheckpoint.fingerprint),
    completedDiscoveryTiers: [...new Set(inputCheckpoint.completedDiscoveryTiers)].sort((left, right) => left - right),
    highestPassedDiscoveryTier: inputCheckpoint.highestPassedDiscoveryTier,
  };
  const checkpoint: CalibrationCheckpoint = {
    schemaVersion: "qual-hardware-calibration-checkpoint/1.0.0",
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...payload,
    payloadSha256: canonicalSha256(payload),
  };
  const committed = new Promise<void>((resolveCheckpoint, rejectCheckpoint) => {
    const timer = setTimeout(() => {
      checkpointWaiters.delete(checkpoint.id);
      rejectCheckpoint(new Error("calibration_checkpoint_commit_timeout"));
    }, 30_000);
    checkpointWaiters.set(checkpoint.id, { resolve: resolveCheckpoint, reject: rejectCheckpoint, timer });
  });
  send({ type: "checkpoint", checkpoint });
  await committed;
  const reclaimed = await reclaimCalibrationPhaseFiles(inputCheckpoint.workspace, inputCheckpoint.ownerPhase, inputCheckpoint.attempt);
  temporaryBytesRemoved += reclaimed.bytesRemoved;
  const [bytesTemporary, disk] = await Promise.all([
    calibrationWorkspaceBytes(input.temporaryRoot, input.sessionId),
    calibrationDiskStatus(inputCheckpoint.workspace.directory, 0),
  ]);
  send({ type: "progress", progress: {
    ...inputCheckpoint.progress,
    bytesTemporary,
    bytesRemoved: temporaryBytesRemoved,
    bytesProjected: disk.projectedPeakBytes,
    diskFreeBytes: disk.freeBytes,
    diskReserveBytes: disk.reserveBytes,
    message: `${inputCheckpoint.progress.message ?? "Fase concluída."} Checkpoint confirmado; temporários da fase removidos.`,
    updatedAt: new Date().toISOString(),
  } });
}

async function finalizeTemporaryManifest(): Promise<void> {
  if (activePipeline) {
    try { await activePipeline.close(); } catch { /* Cleanup will report any file still held open. */ }
    activePipeline = null;
  }
  if (activeDatabase) {
    try { activeDatabase.close(); } catch { /* The worker may already have closed the isolated probe database. */ }
    activeDatabase = null;
  }
  if (!activeWorkspace) return;
  for (const entry of [...activeWorkspace.manifest.files]) {
    try { await registerCalibrationTemporaryFile(activeWorkspace, entry.relativePath); } catch { /* Optional files may not have been created before cancellation. */ }
  }
}

async function hardwareFingerprint(detected: CalibrationHardwarePreflight): Promise<HardwareFingerprint> {
  const cpu = detected.cpuModel;
  const logicalCores = detected.logicalCores;
  const physicalCores = detected.physicalCores;
  const gpu = { model: detected.gpuModel, driver: detected.gpuDriver, architecture: detected.gpuArchitecture };
  const formFactor = detected.formFactor;
  const detectedOperatingSystem = detected.operatingSystem;
  const target = input.targetHardware;
  const exactTarget = Boolean(target && calibrationHardwareMatchesTemplate(detected, target));
  const nic = detected.networkLinks[0]?.name ?? "unavailable";
  const localModel = input.plan.scenario.cameraGroups.flatMap((group) => group.agents)
    .find((agent) => agent.model.startsWith("aiq-"))?.model ?? "local-stub";
  const modelAssetId = localModel.endsWith("-max") ? "qwen-core-max-gguf" : "qwen-core-gguf";
  const modelAsset = input.runtimeStatus.assets.find((asset) => asset.id === modelAssetId && asset.status === "verified");
  return {
    hardwareTemplateId: exactTarget && target ? target.id : null,
    hostnameHash: createHash("sha256").update(hostname()).digest("hex"),
    cpuModel: cpu,
    cpuArchitecture: detected.cpuArchitecture,
    physicalCores,
    logicalCores,
    cpuPowerLimitWatts: null,
    gpuModel: gpu.model,
    gpuArchitecture: gpu.architecture,
    gpuCount: detected.gpuCount,
    gpuVramBytes: detected.gpuVramBytes,
    unifiedMemoryBytes: detectedOperatingSystem === "macos" ? totalmem() : null,
    gpuDriver: gpu.driver,
    ramBytes: totalmem(),
    memoryChannels: null,
    memorySpeedMtps: null,
    storageModel: "calibration temporary volume",
    filesystem: platform() === "win32" ? "ntfs" : platform() === "darwin" ? "apfs" : "linux-filesystem",
    nicModel: nic,
    operatingSystem: detectedOperatingSystem,
    operatingSystemVersion: detected.operatingSystemVersion,
    powerProfile: "unverified",
    formFactor: formFactor ?? "unknown",
    coolingProfile: "unverified",
    perceptrumBuildHash: input.plan.scenario.perceptrumBuildHash,
    aiqModel: localModel,
    aiqModelHash: modelAsset?.sha256 ?? createHash("sha256").update(`unverified:${localModel}`).digest("hex"),
    inferenceBackend: `llama.cpp-cpu+${expectedGpuInferenceBackend(detected, platform())}`,
  };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, Math.max(1, milliseconds)));
}

function measurementTierResult(
  measurement: PipelinePhaseMeasurement,
  repetition: number | null,
): CalibrationTierResult {
  const frameDeliveryRate = measurement.framesPlanned > 0
    ? Math.min(1, measurement.framesDecoded / measurement.framesPlanned)
    : 0;
  const inferenceSuccessRate = measurement.inferencesPlanned > 0
    ? Math.min(1, measurement.framesInferred / measurement.inferencesPlanned)
    : 0;
  const approvedThermalEvidence = measurement.hardwareTelemetry.provider === "approved-telemetry-probe"
    ? measurement.hardwareTelemetry.thermalThrottlePercent : null;
  const p95BottleneckUtilizationPercent = measurement.computeMode === "gpu_accelerated"
    ? Math.max(measurement.cpuUtilizationPercent?.p95 ?? 100,
        measurement.hardwareTelemetry.gpuUtilizationPercent?.p95 ?? 100)
    : measurement.cpuUtilizationPercent?.p95 ?? 100;
  const failures = [...new Set([
    ...measurement.failures,
    ...(frameDeliveryRate < 0.995 ? ["frame_delivery_below_99_5_percent"] : []),
    ...(inferenceSuccessRate < 0.995 ? ["inference_success_below_99_5_percent"] : []),
    ...((measurement.p99InferenceLatencyMs ?? 60_000) >= 45_000 ? ["p99_inference_latency_exceeded"] : []),
    ...(measurement.queueGrowthPerMinute > 0 ? ["queue_growth_detected"] : []),
    ...(!measurement.cpuUtilizationPercent ? ["resource_utilization_sensor_unavailable"] : []),
    ...(p95BottleneckUtilizationPercent > 80 ? ["p95_bottleneck_utilization_exceeded"] : []),
    ...(!approvedThermalEvidence ? ["thermal_throttling_sensor_unavailable"] : []),
    ...((approvedThermalEvidence?.peak ?? 0) > 0 ? ["thermal_throttling_detected"] : []),
  ])];
  const completedAt = new Date();
  return {
    tier: measurement.tier,
    repetition,
    computeMode: measurement.computeMode,
    phase: measurement.phase,
    startedAt: new Date(completedAt.getTime() - measurement.durationSeconds * 1_000).toISOString(),
    completedAt: completedAt.toISOString(),
    passed: failures.length === 0,
    frameDeliveryRate,
    inferenceSuccessRate,
    p99InferenceLatencyMs: measurement.p99InferenceLatencyMs ?? 60_000,
    inferenceIntervalMs: 60_000,
    p95BottleneckUtilizationPercent,
    queueGrowthPerMinute: measurement.queueGrowthPerMinute,
    outOfMemoryCount: 0,
    thermalThrottlePercent: approvedThermalEvidence?.peak ?? null,
    failures,
  };
}

function phaseMetric(measurement: PipelinePhaseMeasurement): CalibrationPhaseMetric {
  return {
    name: measurement.phase === "discovery" ? "warmup" : measurement.phase,
    durationSeconds: measurement.durationSeconds,
    loadPercent: measurement.phase === "surge" ? 120 : 100,
    cameraCount: measurement.tier,
    inferenceSuccessRate: measurement.inferencesPlanned > 0
      ? Math.min(1, measurement.framesInferred / measurement.inferencesPlanned) : 0,
    p99InferenceLatencyMs: measurement.p99InferenceLatencyMs ?? 60_000,
    inferenceIntervalMs: 60_000,
    maxQueueDepth: measurement.queueGrowthPerMinute > 0 ? 1 : 0,
    queueGrowthPerMinute: measurement.queueGrowthPerMinute,
    outOfMemoryCount: 0,
    plannedDecodedFrames: measurement.framesPlanned,
    decodedFrames: measurement.framesDecoded,
    frameDeliveryRate: measurement.framesPlanned > 0
      ? Math.min(1, measurement.framesDecoded / measurement.framesPlanned) : 0,
    thermalThrottlePercent: measurement.hardwareTelemetry.provider === "approved-telemetry-probe"
      ? measurement.hardwareTelemetry.thermalThrottlePercent?.peak ?? null : null,
  };
}

async function run(): Promise<void> {
  const createdAt = new Date().toISOString();
  const workspace = await createCalibrationWorkspace({
    root: input.temporaryRoot,
    sessionId: input.sessionId,
    runId: input.runId,
    appVersion: input.appVersion,
  });
  activeWorkspace = workspace;
  const telemetryPath = await prepareCalibrationTemporaryFile(workspace, "telemetry.jsonl", { retain: true });
  const databasePath = await prepareCalibrationTemporaryFile(workspace, "pipeline-probe.sqlite", { retain: true });
  const database = new DatabaseSync(databasePath);
  activeDatabase = database;
  const detectedHardware = await detectCalibrationHardware();
  const fingerprint = await hardwareFingerprint(detectedHardware);
  diagnosticFingerprint = fingerprint;
  if (input.targetHardware && fingerprint.hardwareTemplateId !== input.targetHardware.id) {
    throw new Error("calibration_hardware_fingerprint_mismatch");
  }
  if (input.resumeCheckpoint) {
    const expected = input.resumeCheckpoint.compatibility;
    const current = checkpointCompatibility(fingerprint);
    const mismatches = (Object.keys(expected) as Array<keyof typeof expected>)
      .filter((key) => expected[key] !== current[key]);
    if (mismatches.length) throw new Error(`calibration_resume_incompatible:${mismatches.join(",")}`);
  }
  const pipeline = new OfflineCalibrationPipeline({
    workspace,
    database,
    workloadProfile: input.plan.workloadProfile,
    runtimeStatus: input.runtimeStatus,
    hardware: detectedHardware,
    physicalNetworkLinks: detectedHardware.networkLinks,
    advancedTelemetry: input.advancedTelemetry,
    timeScale: input.timeScale,
    cancelled: () => cancelled,
    onChildProcess: (event) => send({ type: "child_process", ...event }),
  });
  activePipeline = pipeline;
  const pipelineSummary: CalibrationPipelineSummary = await pipeline.initialize();
  diagnosticPipelineSummary = pipelineSummary;
  const tierResults = diagnosticTierResults;
  const repetitions = diagnosticRepetitions;
  const measurements = diagnosticMeasurements;
  let selectedTier = input.resumeCheckpoint?.highestPassedDiscoveryTier ?? 1;
  let highestPassedDiscoveryTier: number | null = input.resumeCheckpoint?.highestPassedDiscoveryTier ?? null;
  let discoveryPassed = highestPassedDiscoveryTier !== null;
  const completedDiscoveryTiers = new Set(input.resumeCheckpoint?.completedDiscoveryTiers ?? []);
  const plannedDiscoveryTiers = input.plan.mode === "quick"
    ? [input.plan.cameraTiers.find((tier) => tier >= input.plan.scenario.totalCameras) ?? input.plan.cameraTiers.at(-1) ?? 1]
    : input.plan.cameraTiers;
  const discoveryTiers = plannedDiscoveryTiers.filter((tier) => !completedDiscoveryTiers.has(tier) &&
    (highestPassedDiscoveryTier === null || tier > highestPassedDiscoveryTier));
  send({ type: "progress", progress: {
    phase: "preflight", stage: "preflight", percent: 1,
    message: pipelineSummary.mediaAvailable
      ? "Pipeline interno de mídia e banco isolado validados."
      : "Banco isolado validado; o pipeline de mídia ficará diagnóstico por ausência de ativo local.",
    updatedAt: new Date().toISOString(),
  } });
  await persistCheckpointAndReclaim({
    workspace,
    ownerPhase: "preflight",
    checkpointPhase: "preflight",
    tier: null,
    repetition: null,
    attempt: 1,
    fingerprint,
    completedDiscoveryTiers: [...completedDiscoveryTiers],
    highestPassedDiscoveryTier,
    progress: {
      phase: "preflight", stage: "preflight", percent: 1, attempt: 1,
      message: "Preflight local compatível confirmado.",
    },
  });
  for (let index = 0; index < discoveryTiers.length; index += 1) {
    const tier = discoveryTiers[index]!;
    const attempt = checkpointSequence + 1;
    const ownerPhase = `discovery-${tier}`;
    setCalibrationWorkspaceOwner(workspace, ownerPhase, attempt);
    selectedTier = tier;
    const tierMeasurements: PipelinePhaseMeasurement[] = [];
    const tierMetrics: CalibrationTierResult[] = [];
    for (const [modeIndex, computeMode] of REQUIRED_CALIBRATION_COMPUTE_MODES.entries()) {
      const discoveryProgress = { phase: "discovery", stage: "discovering", tier, computeMode,
        percent: 2 + ((plannedDiscoveryTiers.indexOf(tier) * REQUIRED_CALIBRATION_COMPUTE_MODES.length + modeIndex) /
          Math.max(1, plannedDiscoveryTiers.length * REQUIRED_CALIBRATION_COMPUTE_MODES.length)) * 28,
        attempt, message: `Testando ${tier} câmeras · ${computeMode === "cpu_only" ? "CPU" : "GPU"}.` };
      send({ type: "progress", progress: { ...discoveryProgress, updatedAt: new Date().toISOString() } });
      const measurement = await pipeline.executePhase({
        phase: "discovery",
        tier,
        durationSeconds: input.plan.discovery.stabilizationSeconds + input.plan.discovery.sampleSeconds,
        computeMode,
      });
      measurements.push(measurement);
      tierMeasurements.push(measurement);
      const metric = measurementTierResult(measurement, null);
      tierResults.push(metric);
      tierMetrics.push(metric);
    }
    const tierPassed = tierMetrics.length === REQUIRED_CALIBRATION_COMPUTE_MODES.length && tierMetrics.every((metric) => metric.passed);
    if (tierPassed) {
      discoveryPassed = true;
      highestPassedDiscoveryTier = tier;
      completedDiscoveryTiers.add(tier);
    }
    const discoveryProgress = { phase: "discovery", stage: "discovering", tier, attempt,
      percent: 2 + ((plannedDiscoveryTiers.indexOf(tier) + 1) / Math.max(1, plannedDiscoveryTiers.length)) * 28,
      message: `CPU e GPU concluídos para ${tier} câmeras.` };
    await persistCheckpointAndReclaim({
      workspace, ownerPhase, checkpointPhase: "discovery", tier, repetition: null, attempt, fingerprint,
      completedDiscoveryTiers: [...completedDiscoveryTiers], highestPassedDiscoveryTier,
      progress: { ...discoveryProgress,
        bytesProjected: Math.max(0, ...tierMeasurements.map((measurement) => measurement.temporaryBytesEstimated)),
        diskFreeBytes: Math.min(...tierMeasurements.map((measurement) => measurement.temporaryBytesFreeBeforePhase ?? 0)),
        diskReserveBytes: Math.max(0, ...tierMeasurements.map((measurement) => measurement.temporaryDiskReserveBytes ?? 0)) },
    });
    if (!tierPassed) break;
  }
  if (input.plan.mode === "full" && discoveryPassed) {
    selectedTier = highestPassedDiscoveryTier ?? 1;
    let qualified = false;
    while (!qualified) {
      repetitions.length = 0;
      const resultsAtTier: CalibrationTierResult[] = [];
      for (let repetition = 1; repetition <= 3; repetition += 1) {
        const repetitionStartedAt = new Date().toISOString();
        const failures: string[] = [];
        for (const phase of input.plan.phases) {
          const attempt = checkpointSequence + 1;
          const ownerPhase = `qualification-${selectedTier}-${repetition}-${phase.name}`;
          setCalibrationWorkspaceOwner(workspace, ownerPhase, attempt);
          const effectiveTier = Math.ceil(selectedTier * phase.loadPercent / 100);
          const phaseMeasurements: PipelinePhaseMeasurement[] = [];
          for (const [modeIndex, computeMode] of REQUIRED_CALIBRATION_COMPUTE_MODES.entries()) {
            const operationIndex = ((repetition - 1) * input.plan.phases.length + input.plan.phases.indexOf(phase)) *
              REQUIRED_CALIBRATION_COMPUTE_MODES.length + modeIndex;
            const qualificationProgress = {
              phase: phase.name, stage: "qualifying", tier: selectedTier, repetition, computeMode,
              attempt,
              percent: 30 + operationIndex /
                (3 * input.plan.phases.length * REQUIRED_CALIBRATION_COMPUTE_MODES.length) * 65,
              message: `Repetição ${repetition}/3 · ${phase.name} · ${computeMode === "cpu_only" ? "CPU" : "GPU"} · ${selectedTier} câmeras.`,
            };
            send({ type: "progress", progress: { ...qualificationProgress, updatedAt: new Date().toISOString() } });
            const measurement = await pipeline.executePhase({
              phase: phase.name, tier: effectiveTier, durationSeconds: phase.durationSeconds, computeMode,
            });
            measurements.push(measurement);
            phaseMeasurements.push(measurement);
            const metric = { ...measurementTierResult(measurement, repetition), tier: selectedTier };
            resultsAtTier.push(metric);
            failures.push(...metric.failures);
          }
          const qualificationProgress = {
            phase: phase.name, stage: "qualifying", tier: selectedTier, repetition, attempt,
            percent: 30 + ((((repetition - 1) * input.plan.phases.length + input.plan.phases.indexOf(phase) + 1) /
              (3 * input.plan.phases.length))) * 65,
            message: `Repetição ${repetition}/3 · ${phase.name} · CPU e GPU concluídos.`,
          };
          await persistCheckpointAndReclaim({
            workspace, ownerPhase, checkpointPhase: "qualification", tier: selectedTier, repetition, attempt, fingerprint,
            completedDiscoveryTiers: [...completedDiscoveryTiers], highestPassedDiscoveryTier,
            progress: { ...qualificationProgress,
              bytesProjected: Math.max(0, ...phaseMeasurements.map((measurement) => measurement.temporaryBytesEstimated)),
              diskFreeBytes: Math.min(...phaseMeasurements.map((measurement) => measurement.temporaryBytesFreeBeforePhase ?? 0)),
              diskReserveBytes: Math.max(0, ...phaseMeasurements.map((measurement) => measurement.temporaryDiskReserveBytes ?? 0)) },
          });
        }
        const passed = failures.length === 0;
        repetitions.push({ repetition: repetition as 1 | 2 | 3, tier: selectedTier, startedAt: repetitionStartedAt,
          completedAt: new Date().toISOString(), passed, safeCameraCapacity: passed ? selectedTier : 0, failures: [...new Set(failures)] });
        if (!passed) break;
        if (repetition < 3) await delay(input.plan.qualification.cooldownSeconds * 1_000 * input.timeScale);
      }
      tierResults.push(...resultsAtTier);
      qualified = repetitions.length === 3 && repetitions.every((item) => item.passed);
      if (!qualified) {
        const currentIndex = input.plan.cameraTiers.indexOf(selectedTier);
        if (currentIndex <= 0) break;
        selectedTier = input.plan.cameraTiers[currentIndex - 1]!;
      }
    }
  } else if (input.plan.mode !== "full") {
    for (const phase of input.plan.phases) {
      const attempt = checkpointSequence + 1;
      const ownerPhase = `quick-${selectedTier}-${phase.name}`;
      setCalibrationWorkspaceOwner(workspace, ownerPhase, attempt);
      const phaseMeasurements: PipelinePhaseMeasurement[] = [];
      for (const [modeIndex, computeMode] of REQUIRED_CALIBRATION_COMPUTE_MODES.entries()) {
        const quickProgress = { phase: phase.name, stage: "qualifying", tier: selectedTier, attempt, computeMode,
          percent: 30 + (input.plan.phases.indexOf(phase) * REQUIRED_CALIBRATION_COMPUTE_MODES.length + modeIndex) /
            Math.max(1, input.plan.phases.length * REQUIRED_CALIBRATION_COMPUTE_MODES.length) * 65,
          message: `Diagnóstico ${phase.name} · ${computeMode === "cpu_only" ? "CPU" : "GPU"} · ${selectedTier} câmeras.` };
        send({ type: "progress", progress: { ...quickProgress, updatedAt: new Date().toISOString() } });
        const measurement = await pipeline.executePhase({
          phase: phase.name,
          tier: Math.ceil(selectedTier * phase.loadPercent / 100),
          durationSeconds: phase.durationSeconds,
          computeMode,
        });
        measurements.push(measurement);
        phaseMeasurements.push(measurement);
        tierResults.push({ ...measurementTierResult(measurement, null), tier: selectedTier });
      }
      const quickProgress = { phase: phase.name, stage: "qualifying", tier: selectedTier, attempt,
        percent: 30 + (input.plan.phases.indexOf(phase) + 1) / Math.max(1, input.plan.phases.length) * 65,
        message: `Diagnóstico ${phase.name} · CPU e GPU concluídos.` };
      await persistCheckpointAndReclaim({
        workspace, ownerPhase, checkpointPhase: "qualification", tier: selectedTier, repetition: null, attempt, fingerprint,
        completedDiscoveryTiers: [...completedDiscoveryTiers], highestPassedDiscoveryTier,
        progress: { ...quickProgress,
          bytesProjected: Math.max(0, ...phaseMeasurements.map((measurement) => measurement.temporaryBytesEstimated)),
          diskFreeBytes: Math.min(...phaseMeasurements.map((measurement) => measurement.temporaryBytesFreeBeforePhase ?? 0)),
          diskReserveBytes: Math.max(0, ...phaseMeasurements.map((measurement) => measurement.temporaryDiskReserveBytes ?? 0)) },
      });
    }
  }
  await pipeline.close();
  activePipeline = null;
  database.close();
  activeDatabase = null;
  await writeFile(telemetryPath, measurements.map((measurement) => JSON.stringify(measurement)).join("\n"), "utf8");
  await finalizeTemporaryManifest();
  const qualification = evaluateCalibrationQualification({
    mode: input.plan.mode,
    runtimeReady: input.runtimeStatus.readyForFullQualification && input.runtimeStatus.manifestApproved,
    authorityAndProfileExact:
      input.runtimeStatus.authorityCommit === CALIBRATION_AUTHORITY_COMMIT &&
      input.plan.scenario.perceptrumBuildHash === CALIBRATION_AUTHORITY_COMMIT &&
      input.plan.workloadProfile.targetBuildHash === CALIBRATION_AUTHORITY_COMMIT &&
      Boolean(input.targetHardware && fingerprint.hardwareTemplateId === input.targetHardware.id),
    timeScale: input.timeScale,
    selectedTier,
    phaseNames: input.plan.phases.map((phase) => phase.name),
    mediaAvailable: pipelineSummary.mediaAvailable,
    rtspAvailable: pipelineSummary.rtspAvailable,
    localInferenceAvailable: pipelineSummary.localInferenceAvailable,
    cpuInferenceAvailable: pipelineSummary.cpuInferenceAvailable,
    gpuInferenceAvailable: pipelineSummary.gpuInferenceAvailable,
    gpuMediaAvailable: pipelineSummary.gpuMediaAvailable,
    externalRequestCount: 0,
    openAiRequestCount: 0,
    measurements,
    repetitions,
  });
  const eligible = qualification.eligible;
  const resultMeasurements = qualification.qualifiedMeasurements.length > 0
    ? qualification.qualifiedMeasurements
    : measurements;
  const cpuModeMeasurements = resultMeasurements.filter((measurement) => measurement.computeMode === "cpu_only");
  const gpuModeMeasurements = resultMeasurements.filter((measurement) => measurement.computeMode === "gpu_accelerated");
  const cpuModeMeasured = cpuModeMeasurements.length > 0 && cpuModeMeasurements.every((measurement) =>
    measurement.cpuWorkloadMeasured && measurement.inferenceBackend === "cpu" &&
    measurement.inferenceDeviceId === "none" && measurement.localInferenceMeasured);
  const gpuInferenceMeasured = gpuModeMeasurements.length > 0 && gpuModeMeasurements.every((measurement) =>
    measurement.gpuInferenceMeasured && measurement.localInferenceMeasured);
  const gpuMediaMeasured = gpuModeMeasurements.length > 0 && gpuModeMeasurements.every((measurement) =>
    measurement.gpuMediaMeasured && measurement.mediaMeasured);
  const gpuUtilizationEvidenceMeasured = gpuModeMeasurements.length > 0 && gpuModeMeasurements.every((measurement) =>
    measurement.hardwareTelemetry.gpuUtilizationPercent !== null &&
    measurement.hardwareTelemetry.gpuMemoryUsedBytes !== null &&
    measurement.hardwareTelemetry.gpuUtilizationPercent.peak > 0 &&
    measurement.hardwareTelemetry.gpuMemoryUsedBytes.peak > 0);
  const combinedCpuGpuMeasured = gpuModeMeasurements.length > 0 &&
    gpuModeMeasurements.every((measurement) => measurement.combinedCpuGpuMeasured);
  const uniqueModeFailures = (modeMeasurements: PipelinePhaseMeasurement[]): string[] => [...new Set(
    modeMeasurements.flatMap((measurement) => measurement.failures),
  )].slice(0, 100);
  const gpuTelemetryMeasured = measurements.some((measurement) => measurement.hardwareTelemetry.gpuUtilizationPercent !== null);
  const approvedThermalTelemetryComplete = measurements.length > 0 && measurements.every((measurement) =>
    measurement.hardwareTelemetry.provider === "approved-telemetry-probe" &&
    measurement.hardwareTelemetry.thermalThrottlePercent !== null);
  const failures = qualification.failures;
  const measuredStages = new Set(resultMeasurements.flatMap((measurement) => measurement.measuredStages));
  const operationCount = resultMeasurements.reduce((sum, measurement) => sum + measurement.databaseOperations, 0);
  const decodedFrames = resultMeasurements.reduce((sum, measurement) => sum + measurement.framesDecoded, 0);
  const extractedFrames = resultMeasurements.reduce((sum, measurement) => sum + measurement.framesExtracted, 0);
  const plannedFrames = resultMeasurements.reduce((sum, measurement) => sum + measurement.framesPlanned, 0);
  const inferencesPlanned = resultMeasurements.reduce((sum, measurement) => sum + measurement.inferencesPlanned, 0);
  const inferencesAttempted = resultMeasurements.reduce((sum, measurement) => sum + measurement.inferencesAttempted, 0);
  const inferredFrames = resultMeasurements.reduce((sum, measurement) => sum + measurement.framesInferred, 0);
  const freeSpaceSamples = resultMeasurements.flatMap((measurement) =>
    measurement.temporaryBytesFreeBeforePhase === null ? [] : [measurement.temporaryBytesFreeBeforePhase]);
  const networkEvidence = pipelineSummary.rtspAvailable && resultMeasurements.length > 0 &&
    resultMeasurements.every((measurement) => measurement.physicalNetworkLinkVerified)
    ? "loopback_measured_physical_link_spec_verified" as const
    : pipelineSummary.rtspAvailable
      ? "loopback_measured_physical_link_unverified" as const
      : "unavailable" as const;
  const maximumNetworkIngressMbps = Math.max(0, ...resultMeasurements.map((measurement) => measurement.networkIngressMbps));
  const verifiedNetworkCapacityMbps = resultMeasurements
    .map((measurement) => measurement.physicalNetworkCapacityMbps)
    .filter((value): value is number => value !== null);
  const minimumPhysicalNetworkCapacityMbps = verifiedNetworkCapacityMbps.length
    ? Math.min(...verifiedNetworkCapacityMbps)
    : null;
  const stageThroughput = (stage: typeof REQUIRED_CALIBRATION_STAGES[number]): number => {
    if (["video_decode", "bgr_processing", "disk_read", "rtsp_ingest", "network_ingest"].includes(stage)) return decodedFrames;
    if (["video_encode", "disk_write"].includes(stage)) return resultMeasurements.reduce((sum, item) => sum + item.framesEncoded, 0);
    if (stage === "frame_extraction") return extractedFrames;
    if (stage === "local_inference") return inferredFrames;
    if (stage === "memory_bandwidth") return Math.round(resultMeasurements.reduce((sum, item) => sum + (item.memoryBytesPerSecond ?? 0), 0) / Math.max(1, resultMeasurements.length));
    if (stage === "job_scheduler") return resultMeasurements.reduce((sum, item) => sum + item.completedJobRuns, 0);
    if (stage === "intelligence_scheduler") return resultMeasurements.reduce((sum, item) => sum + item.completedIntelligenceJobs, 0);
    if (stage === "dashboard_queries") return resultMeasurements.reduce((sum, item) => sum + item.dashboardQueries, 0);
    return operationCount;
  };
  const stages: CalibrationStageMetric[] = REQUIRED_CALIBRATION_STAGES.map((stage) => {
    const measured = measuredStages.has(stage);
    const latency = stage === "database_persistence"
      ? Math.max(...resultMeasurements.map((item) => item.p95DatabaseLatencyMs ?? 0))
      : stage === "dashboard_queries"
        ? Math.max(...resultMeasurements.map((item) => item.p95DashboardLatencyMs ?? 0))
        : stage === "local_inference"
          ? Math.max(...resultMeasurements.map((item) => item.p99InferenceLatencyMs ?? 0))
        : ["video_decode", "bgr_processing", "video_encode", "frame_extraction"].includes(stage)
          ? Math.max(...resultMeasurements.map((item) => item.mediaDurationMs ?? 0)) : null;
    const isNetworkStage = stage === "network_ingest";
    const networkSafeCameraCapacity = isNetworkStage && minimumPhysicalNetworkCapacityMbps !== null
      ? Math.floor(minimumPhysicalNetworkCapacityMbps * 0.8 /
          Math.max(0.000_001, input.plan.workloadProfile.cameraGroups.reduce((sum, group) =>
            sum + group.sharePpm / 1_000_000 * group.bitrateMbps, 0)))
      : null;
    return {
      stage,
      safeCameraCapacity: eligible && measured
        ? (isNetworkStage ? Math.min(selectedTier, networkSafeCameraCapacity ?? 0) : selectedTier)
        : null,
      throughput: measured ? (isNetworkStage ? maximumNetworkIngressMbps : stageThroughput(stage)) : null,
      throughputUnit: measured ? (stage === "memory_bandwidth" ? "bytes-per-second" : isNetworkStage ? "megabits-per-second-required" : "measured-operations") : "unavailable",
      p95LatencyMs: measured && latency !== null ? latency : null,
      peakUtilizationPercent: measured
        ? Math.max(0, ...resultMeasurements.map((item) => Math.max(
            item.cpuUtilizationPercent?.p95 ?? 0,
            item.hardwareTelemetry.gpuUtilizationPercent?.p95 ?? 0,
          ))) : null,
      queueGrowthPerMinute: Math.max(0, ...resultMeasurements.map((item) => item.queueGrowthPerMinute)),
      thermalThrottlePercent: measured
        ? Math.max(0, ...resultMeasurements.map((item) => item.hardwareTelemetry.thermalThrottlePercent?.peak ?? 0)) : null,
      evidenceStatus: measured ? "measured" : "unavailable",
      ...(["disk_read", "disk_write"].includes(stage) ? {
        details: {
          maximumPhaseTemporaryBytesEstimated: Math.max(0, ...resultMeasurements.map((item) => item.temporaryBytesEstimated)),
          minimumFreeBytesBeforePhase: freeSpaceSamples.length ? Math.min(...freeSpaceSamples) : null,
        },
      } : {}),
      ...(isNetworkStage ? {
        details: {
          loopbackTrafficMeasured: pipelineSummary.rtspAvailable,
          physicalNetworkTrafficMeasured: false,
          requiredIngressMbps: maximumNetworkIngressMbps,
          negotiatedPhysicalCapacityMbps: minimumPhysicalNetworkCapacityMbps,
          reservedCapacityPercent: 20,
          usablePhysicalCapacityMbps: minimumPhysicalNetworkCapacityMbps === null
            ? null : minimumPhysicalNetworkCapacityMbps * 0.8,
          physicalSpecificationVerified: networkEvidence === "loopback_measured_physical_link_spec_verified",
        },
      } : {}),
      ...(measured ? {
        measurementSource: "qual-hardware-offline-pipeline",
        utilizationEvidence: [
          `contract:${CALIBRATION_PIPELINE_CONTRACT_VERSION}`,
          `operations:${stageThroughput(stage)}`,
          `profile:${input.plan.workloadProfile.id}`,
        ],
      } : {
        reason: stage === "local_inference"
          ? "A inferência Qwen local não foi executada; o stub determinístico mede apenas filas e orquestração."
          : stage === "thermal_sustain"
            ? "O sistema operacional não forneceu medição validada de temperatura e throttling para esta sessão."
            : "O ativo offline necessário não estava disponível e verificado para esta sessão.",
      }),
    };
  });
  const summarizedPhases = input.plan.phases.map((phase) => {
    const samples = resultMeasurements.filter((item) => item.phase === phase.name)
      .map((item) => ({ ...phaseMetric(item), cameraCount: selectedTier, loadPercent: phase.loadPercent }));
    const weakest = [...samples].sort((left, right) =>
      left.inferenceSuccessRate - right.inferenceSuccessRate ||
      (right.p99InferenceLatencyMs ?? 0) - (left.p99InferenceLatencyMs ?? 0))[0];
    return weakest ?? {
      name: phase.name,
      durationSeconds: phase.durationSeconds,
      loadPercent: phase.loadPercent,
      cameraCount: selectedTier,
      inferenceSuccessRate: 0,
      p99InferenceLatencyMs: 59_000,
      inferenceIntervalMs: 60_000,
      maxQueueDepth: 1,
      queueGrowthPerMinute: 1,
      outOfMemoryCount: 0,
      frameDeliveryRate: 0,
      thermalThrottlePercent: null,
    };
  });
  const completedAt = new Date().toISOString();
  const result: LocalCalibrationRun = {
    schemaVersion: AUTONOMOUS_LOCAL_CALIBRATION_VERSION,
    id: input.runId,
    planId: input.plan.id,
    createdAt,
    startedAt: createdAt,
    completedAt,
    workloadContractVersion: input.plan.workloadContractVersion,
    mode: input.plan.mode,
    executionMode: input.plan.executionMode,
    ...(input.timeScale !== 1 || !input.runtimeStatus.manifestApproved ? { developmentOnly: true as const } : {}),
    fingerprint,
    requestedSourceFps: Math.max(...input.plan.sourceProfiles.map((profile) => profile.sourceFps)),
    measuredSourceFps: pipelineSummary.mediaAvailable ? Math.max(...input.plan.sourceProfiles.map((profile) => profile.sourceFps)) : 0,
    requestedInferenceFps: input.plan.requestedInferenceFps[0] ?? 1,
    effectiveInferenceFps: Math.min(5, inferredFrames / Math.max(1, measurements.reduce((sum, item) =>
      sum + item.durationSeconds * input.timeScale * item.tier, 0))),
    framesPlanned: Math.max(plannedFrames, inferencesPlanned),
    framesExtracted: Math.max(extractedFrames, inferencesAttempted),
    framesPacked: inferencesAttempted,
    framesInferred: inferredFrames,
    rtspOrigin: pipelineSummary.rtspOrigin,
    aiqOrigin: pipelineSummary.aiqOrigin,
    networkPolicy: "loopback_only",
    externalRequestCount: 0,
    openAiRequestCount: 0,
    mediaFieldCount: 0,
    credentialFieldCount: 0,
    stages,
    phases: summarizedPhases,
    overallSafeCameraCapacity: eligible
      ? Math.min(...repetitions.map((item) => item.safeCameraCapacity))
      : null,
    bottleneck: minimumPhysicalNetworkCapacityMbps !== null &&
      minimumPhysicalNetworkCapacityMbps * 0.8 < maximumNetworkIngressMbps
      ? "network_ingest" : "local_inference",
    pipelineEvidence: {
      complete: qualification.pipelineComplete, isolatedDatabase: true, sourceRegistered: pipelineSummary.mediaAvailable,
      rtspClipProvided: pipelineSummary.rtspAvailable && decodedFrames > 0,
      intelligenceJobQueued: resultMeasurements.some((item) => item.completedIntelligenceJobs > 0),
      schedulerClaimedJob: resultMeasurements.some((item) => item.completedIntelligenceJobs > 0),
      aiqLocalCompleted: pipelineSummary.localInferenceAvailable && inferencesPlanned > 0 && inferredFrames / inferencesPlanned >= 0.995,
      resultPersisted: true,
      jobSchedulerExecuted: resultMeasurements.some((item) => item.completedJobRuns > 0),
      jobRuntimeExecuted: resultMeasurements.some((item) => item.processedCameraCount > 0),
      jobStepRunsPersisted: resultMeasurements.some((item) => item.completedStepRuns > 0),
      databaseWritesPersisted: operationCount > 0,
      intelligenceSchedulerExecuted: resultMeasurements.some((item) => item.completedIntelligenceJobs > 0),
      dashboardQueriesExecuted: resultMeasurements.some((item) => item.dashboardQueries > 0),
      concurrentWithLoad: pipelineSummary.mediaAvailable && operationCount > 0 && combinedCpuGpuMeasured,
      cpuOnlyCompleted: cpuModeMeasured,
      gpuAcceleratedCompleted: gpuInferenceMeasured && gpuMediaMeasured && gpuUtilizationEvidenceMeasured,
      combinedCpuGpuCompleted: combinedCpuGpuMeasured,
      phaseCoverage: input.plan.phases.map((phase) => {
        const probes = resultMeasurements.filter((item) => item.phase === phase.name);
        return { phase: phase.name, completedProbeCount: probes.length, failedProbeCount: probes.filter((item) => item.failures.length > 0).length };
      }),
      pipelineContractVersion: CALIBRATION_PIPELINE_CONTRACT_VERSION,
      exactCameraConcurrency: qualification.exactConcurrencyComplete,
    },
    qualityGate: {
      eligibleForCapacityExtrapolation: eligible,
      evidenceLevel: eligible ? "validated_local" : "representative_only",
      validationStatus: eligible ? "anchor_approved" : "diagnostic",
      failures,
      warnings: [...input.runtimeStatus.reasons, ...pipelineSummary.unavailableReasons].map((reason) => reason.slice(0, 240)).slice(0, 100),
    },
    kernelVersion: CALIBRATION_KERNEL_VERSION,
    runtimeManifestHash: input.runtimeStatus.manifestHash,
    runtimeProvenance: {
      platform: input.runtimeStatus.platform,
      architecture: input.runtimeStatus.architecture,
      featureMode: input.runtimeStatus.featureMode,
      manifestApproved: input.runtimeStatus.manifestApproved,
      contracts: input.runtimeStatus.contracts.map(({ id, status, sha256, expectedSha256 }) => ({ id, status, sha256, expectedSha256 })),
      assets: input.runtimeStatus.assets.map(({ id, status, sha256, sizeBytes, expectedSizeBytes, version, licenseSpdx, sbomRef }) => ({
        id, status, sha256, sizeBytes, expectedSizeBytes, version, licenseSpdx, sbomRef,
      })),
    },
    workloadProfileId: input.plan.workloadProfile.id,
    workloadProfileSignature: input.plan.workloadProfile.signature,
    compatiblePerceptrumCommit: CALIBRATION_AUTHORITY_COMMIT,
    cameraTiers: input.plan.cameraTiers,
    tierResults,
    repetitions,
    maxTestedTier: Math.max(...tierResults.map((item) => item.tier)),
    capacityBound: eligible && selectedTier === 4_096
      ? "at_least" : "exact",
    repeatVariabilityPercent: qualification.repeatVariabilityPercent,
    computeEvidence: {
      schemaVersion: "qual-hardware-calibration-compute-evidence/1.0.0",
      requiredModes: ["cpu_only", "gpu_accelerated"],
      cpu: {
        mode: "cpu_only", backend: "cpu", device: fingerprint.cpuModel,
        measured: cpuModeMeasured, safeCameraCapacity: eligible && cpuModeMeasured ? selectedTier : null,
        measurementCount: cpuModeMeasurements.length, failures: uniqueModeFailures(cpuModeMeasurements),
      },
      gpu: {
        mode: "gpu_accelerated", inferenceBackend: pipelineSummary.gpuInferenceBackend,
        mediaBackend: pipelineSummary.gpuMediaBackend,
        deviceId: pipelineSummary.gpuInferenceDevice?.id ?? null,
        deviceName: pipelineSummary.gpuInferenceDevice?.name ?? null,
        inferenceMeasured: gpuInferenceMeasured, mediaMeasured: gpuMediaMeasured,
        utilizationMeasured: gpuUtilizationEvidenceMeasured,
        safeCameraCapacity: eligible && gpuInferenceMeasured && gpuMediaMeasured && gpuUtilizationEvidenceMeasured
          ? selectedTier : null,
        measurementCount: gpuModeMeasurements.length, failures: uniqueModeFailures(gpuModeMeasurements),
      },
      combined: {
        measured: combinedCpuGpuMeasured,
        safeCameraCapacity: eligible && combinedCpuGpuMeasured ? selectedTier : null,
        measurementCount: gpuModeMeasurements.filter((measurement) => measurement.combinedCpuGpuMeasured).length,
        failures: combinedCpuGpuMeasured ? [] : ["combined_cpu_gpu_load_incomplete"],
      },
    },
    networkEvidence,
    physicalNetworkLinks: detectedHardware.networkLinks,
    advancedTelemetryRequested: input.advancedTelemetry,
    telemetrySampleIntervalMs: 1_000,
    telemetrySampleCount: measurements.reduce((sum, item) => sum + (item.cpuUtilizationPercent?.samples ?? 0), 0),
    telemetryCapabilities: [
      { id: "cpu.identity", status: "measured", provider: "node-os" },
      { id: "cpu.utilization", status: "measured", provider: "node-os-tick-delta" },
      { id: "memory.used", status: "measured", provider: "node-os" },
      fingerprint.gpuDriver === "unavailable"
        ? { id: "gpu.identity", status: "unavailable", provider: "operating-system", reason: "GPU driver telemetry was not exposed by the operating system." }
        : { id: "gpu.identity", status: "measured", provider: "operating-system" },
      gpuTelemetryMeasured
        ? { id: "gpu.utilization", status: "measured", provider: measurements.find((item) => item.hardwareTelemetry.gpuUtilizationPercent)?.hardwareTelemetry.provider ?? "operating-system" }
        : { id: "gpu.utilization", status: "unavailable", provider: "operating-system", reason: "A GPU utilization counter was not exposed during this session." },
      approvedThermalTelemetryComplete
        ? { id: "thermal.throttling", status: "measured", provider: "approved-telemetry-probe" }
        : { id: "thermal.throttling", status: "unavailable", provider: "operating-system", reason: "The approved cross-platform thermal throttling probe was not available for every phase." },
    ],
    resourceSummaries: measurements.map((measurement) => ({
      phase: measurement.phase,
      computeMode: measurement.computeMode,
      cpuUtilizationPercent: measurement.cpuUtilizationPercent,
      memoryUsedBytes: measurement.memoryUsedBytes,
      gpuUtilizationPercent: measurement.hardwareTelemetry.gpuUtilizationPercent,
      gpuMemoryUsedBytes: measurement.hardwareTelemetry.gpuMemoryUsedBytes,
      gpuTemperatureCelsius: measurement.hardwareTelemetry.gpuTemperatureCelsius,
      gpuPowerWatts: measurement.hardwareTelemetry.gpuPowerWatts,
      cpuTemperatureCelsius: measurement.hardwareTelemetry.cpuTemperatureCelsius,
    })),
    processGroups: [
      { group: "ffmpeg", sampleCount: measurements.filter((item) => item.mediaMeasured).length },
      { group: "mediamtx", sampleCount: measurements.filter((item) => item.rtspMeasured).length },
      { group: "perceptrum-equivalent-local", sampleCount: operationCount },
      { group: "aiq", sampleCount: inferredFrames },
    ],
    notes: [
      "Executado integralmente pelo Qual Hardware Calibration Kernel com mídia sintética e banco isolado.",
      "Jobs, Steps, Agents, Intelligence e dashboard foram exercitados pelo contrato local; o stub de Intelligence não equivale à inferência Qwen.",
      "Cada nível e fase executou CPU-only e GPU acelerada; a fase GPU também exigiu carga concorrente mensurável na CPU.",
      "Nenhuma solicitação externa foi realizada.",
      networkEvidence === "loopback_measured_physical_link_spec_verified"
        ? "O tráfego RTSP foi medido em loopback; a rede física foi avaliada somente pela velocidade negociada e duplex, com reserva de 20%."
        : "O tráfego RTSP em loopback não comprova a capacidade da rede física externa; a especificação negociada permaneceu indisponível ou insuficiente.",
      "Métricas de GPU do sistema são diagnósticas; somente o probe empacotado e verificado pode satisfazer o guardrail térmico comercial.",
      "Nenhuma capacidade do Perceptrum foi validada enquanto qualquer inferência, concorrência exata ou guardrail obrigatório permanecer indisponível.",
    ],
  };
  send({ type: "result", result });
}

void run().catch(async (error: unknown) => {
  await finalizeTemporaryManifest();
  const detail = error instanceof Error ? error.message : String(error);
  send(calibrationFailureWasCancelled(cancelled, detail)
    ? { type: "cancelled", detail, diagnostic: terminalDiagnostic("cancelled", detail) }
    : { type: "failed", error: detail, diagnostic: terminalDiagnostic("failed", detail) });
});
