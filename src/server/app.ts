import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import { buildRecommendations, CapacityError } from "../engine/capacity.js";
import { buildCapacityPredictions, createCalibrationPlan, type CalibrationPredictionCompatibility } from "../engine/calibration.js";
import { buildHistoricalComponentBuilds, deriveComponentCatalog, validateBuildCompatibility } from "../engine/componentCatalog.js";
import { calibrationPolicyHash } from "../engine/calibrationProfile.js";
import { buildProcurementGate, componentStages, isPublicObservationEligible } from "../engine/evidence.js";
import { withProcurementSpecifications } from "../engine/procurementSpecifications.js";
import { specificationCoverage, withTechnicalSpecification } from "../engine/technicalSpecifications.js";
import {
  benchmarkMetricsSchema,
  calibrationPlanRequestSchema,
  calibrationSessionRequestSchema,
  localCalibrationRunSchema,
  scenarioCreateSchema,
  scenarioUpdateSchema,
} from "../shared/schemas.js";
import type { BenchmarkMetrics, CapacityRecommendation, CalibrationCheckpoint, CalibrationDeviceIdentity, CalibrationImportBatch, CalibrationImportItem, CalibrationResumeStatus, CalibrationSessionRecord, ComponentBuild, LocalCalibrationRun, QhcalPackage, RecommendationAlternative } from "../shared/types.js";
import type { HardwareNodeTemplate } from "../shared/types.js";
import { AUTONOMOUS_LOCAL_CALIBRATION_VERSION, PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT } from "../shared/types.js";
import { createBenchmarkManifest, evidenceValidatesRecommendation, nonceMatches, validateBenchmark } from "./benchmark.js";
import { CatalogUpdateService } from "./catalogUpdates.js";
import { jsonReport, pdfReport, xlsxReport } from "./reports.js";
import { procurementAnnexDocx, procurementAnnexJson, procurementAnnexPdf } from "./procurementAnnex.js";
import { technicalCadernoPdf } from "./technicalCadernoPdf.js";
import { technicalCadernoDocx } from "./technicalCadernoDocx.js";
import { findForbiddenBenchmarkData, findForbiddenCalibrationData, safeError } from "./security.js";
import { RevisionConflictError, type PlannerStore } from "./store.js";
import {
  assertAutonomousCalibrationSessionContract,
  authorizeCalibrationSession,
  calibrationPayloadSha256,
  createInternalCalibrationSession,
  findPersistedCalibration,
  normalizeCalibrationProgress,
  publicCalibrationSession,
  legacyCalibrationPayloadSha256,
  resolveCalibrationDirectory,
  type DesktopCalibrationBridge,
} from "./calibrationSessions.js";
import { CalibrationKernelService, type CalibrationKernelPort } from "./calibrationKernelService.js";
import { calibrationHardwareDigest, calibrationHardwareMatchesTemplate, detectCalibrationHardware } from "./calibrationHardware.js";
import {
  CalibrationExchangeService,
  exchangeDigest,
  QHCAL_MIME,
  QHCALSET_MAX_COMPRESSED_BYTES,
  QHCALSET_MIME,
  type CalibrationPrivateKeyProtection,
} from "./calibrationExchange.js";

const manifestRequestSchema = z.object({
  recommendationId: z.string().uuid(),
  gpuDriver: z.string().min(1).max(120),
  slaInferenceLatencyMs: z.number().positive().max(3_600_000).default(10_000),
});
const compareRequestSchema = z.object({ scenarioIds: z.array(z.string().uuid()).min(2).max(10) });
const catalogConfigurationSchema = z.object({
  remoteUrl: z.string().max(2_048).nullable(),
  publicKeyPem: z.string().min(1).max(16_384),
});
const reportPolicies = ["minimum", "recommended", "n_plus_one"] as const;

function fingerprintMatchesTemplate(run: LocalCalibrationRun, template: HardwareNodeTemplate): boolean {
  return calibrationHardwareMatchesTemplate(run.fingerprint, template);
}

export async function recommendationEligibleRuns(
  store: PlannerStore,
  runs: LocalCalibrationRun[],
  evidencePolicyEnabled = true,
): Promise<LocalCalibrationRun[]> {
  if (!evidencePolicyEnabled) return [];
  const [provenance, devices, hardware] = await Promise.all([
    store.listCalibrationRunProvenance(), store.listCalibrationDeviceIdentities(), store.getCatalog(),
  ]);
  const provenanceByRun = new Map(provenance.map((item) => [item.runId, item]));
  const trustedDevices = new Set(devices.filter((item) => item.trust === "trusted").map((item) => item.id));
  const mappedHardware = new Set(hardware.map((item) => item.id));
  return runs.filter((run) => {
    if (!run.fingerprint.hardwareTemplateId || !mappedHardware.has(run.fingerprint.hardwareTemplateId)) return false;
    const source = provenanceByRun.get(run.id);
    return !source || (source.trustedAtImport && trustedDevices.has(source.deviceId));
  });
}

export async function refreshPredictions(
  store: PlannerStore,
  compatibility: CalibrationPredictionCompatibility,
  evidencePolicyEnabled = true,
) {
  const [hardware, runs, observations, storedComponents] = await Promise.all([
    store.getCatalog(), store.listCalibrationRuns(), store.listBenchmarkObservations(), store.listCatalogComponents(),
  ]);
  const predictions = buildCapacityPredictions(
    hardware,
    await recommendationEligibleRuns(store, runs, evidencePolicyEnabled),
    observations,
    compatibility,
  );
  await store.savePredictions(predictions);
  const derived = deriveComponentCatalog(hardware);
  const components = [...new Map([...derived.components, ...storedComponents].map((item) => [item.id, item])).values()];
  const builds = buildHistoricalComponentBuilds(hardware, components, observations, runs).map((candidate) => {
    const prediction = predictions.find((item) => item.hardwareTemplateId === candidate.hardwareTemplateId);
    return validateBuildCompatibility({
      ...candidate,
      procurementGate: buildProcurementGate(candidate.coverage, prediction?.status ?? "reference_only"),
    }, components);
  });
  await store.saveComponentBuilds(builds);
  return predictions;
}

function applicationResourcePath(...segments: string[]): string {
  const root = process.env.QUAL_HARDWARE_RESOURCE_ROOT ?? process.cwd();
  return resolve(root, ...segments);
}

function currentEvidence(
  recommendations: CapacityRecommendation[],
  evidence: Awaited<ReturnType<PlannerStore["listBenchmarkEvidence"]>>,
): CapacityRecommendation[] {
  return recommendations.map((recommendation) => evidenceValidatesRecommendation(recommendation, evidence) ? {
    ...recommendation,
    confidence: "validated",
    evidence: [...recommendation.evidence, ...evidence.filter(({ manifest, result }) => result.passed &&
      manifest.targetHardware.cpuModel === recommendation.primary.hardware.cpuModel &&
      manifest.targetHardware.gpuModel === recommendation.primary.hardware.gpuModel).map(({ manifest }) => `benchmark:${manifest.id}`)],
  } : recommendation);
}

function withComponentBuilds(recommendations: CapacityRecommendation[], builds: ComponentBuild[]): CapacityRecommendation[] {
  const byHardware = new Map(builds.filter((build) => build.hardwareTemplateId).map((build) => [build.hardwareTemplateId!, build]));
  const decorate = (alternative: RecommendationAlternative): RecommendationAlternative => {
    const bom = byHardware.get(alternative.hardware.id);
    if (!bom) return alternative;
    return {
      ...alternative,
      bom,
      stagePredictions: alternative.calibration?.stagePredictions ?? [],
      coverage: bom.coverage,
      procurementGate: bom.procurementGate,
      procurementEligibility: bom.procurementGate.eligibility,
      warnings: [...new Set([...alternative.warnings, ...bom.procurementGate.reasons])],
    };
  };
  return recommendations.map((recommendation) => ({
    ...recommendation,
    primary: decorate(recommendation.primary),
    alternatives: recommendation.alternatives.map(decorate),
  }));
}

function reportRecommendationSet(
  selected: CapacityRecommendation,
  stored: CapacityRecommendation[],
): CapacityRecommendation[] {
  const selectedTime = Date.parse(selected.generatedAt);
  return reportPolicies.map((policy) => {
    if (policy === selected.policy) return selected;
    return stored
      .filter((item) => item.scenarioRevision === selected.scenarioRevision && item.policy === policy)
      .sort((left, right) => Math.abs(Date.parse(left.generatedAt) - selectedTime) - Math.abs(Date.parse(right.generatedAt) - selectedTime))[0];
  }).filter((item): item is CapacityRecommendation => Boolean(item));
}

export interface ApplicationOptions {
  desktopBridge?: Pick<DesktopCalibrationBridge, "openPath">;
  documentsDirectory?: string;
  fetchImpl?: typeof fetch;
  calibrationKernel?: CalibrationKernelPort;
  calibrationTemporaryRoot?: string;
  calibrationEvidenceDirectory?: string;
  calibrationIdentityDirectory?: string;
  calibrationPrivateKeyProtection?: CalibrationPrivateKeyProtection;
  resourceRoot?: string;
  appVersion?: string;
  calibrationFeatures?: Partial<{
    resume: boolean;
    exchange: boolean;
    evidencePolicy: boolean;
  }>;
}

export function createApp(
  store: PlannerStore,
  catalogUpdates = new CatalogUpdateService(store),
  options: ApplicationOptions = {},
): Hono {
  const app = new Hono();
  const volatileCalibrationTokens = new Map<string, string>();
  const resourceRoot = options.resourceRoot ?? process.env.QUAL_HARDWARE_RESOURCE_ROOT ?? process.cwd();
  const applicationVersion = options.appVersion ?? "0.1.0";
  const calibrationFeatures = {
    resume: options.calibrationFeatures?.resume ?? process.env.QUAL_HARDWARE_CALIBRATION_RESUME !== "0",
    exchange: options.calibrationFeatures?.exchange ?? process.env.QUAL_HARDWARE_CALIBRATION_EXCHANGE !== "0",
    evidencePolicy: options.calibrationFeatures?.evidencePolicy ?? process.env.QUAL_HARDWARE_CALIBRATION_EVIDENCE_POLICY !== "0",
  };
  const calibrationEvidenceDirectory = options.calibrationEvidenceDirectory ??
    join(options.documentsDirectory ?? process.cwd(), "Qual Hardware", "Calibracoes");
  const calibrationDirectoryOptions = { calibrationDirectory: calibrationEvidenceDirectory };
  const legacyCalibrationDirectoryOptions = options.documentsDirectory ? { documentsDirectory: options.documentsDirectory } : {};
  const calibrationKernel = options.calibrationKernel ?? new CalibrationKernelService({
    temporaryRoot: options.calibrationTemporaryRoot ?? join(tmpdir(), "qual-hardware-calibration"),
    evidenceDirectory: calibrationEvidenceDirectory,
    resourceRoot,
    appVersion: applicationVersion,
  });
  const calibrationExchange = new CalibrationExchangeService({
    identityDirectory: options.calibrationIdentityDirectory ??
      join(options.documentsDirectory ?? process.cwd(), "Qual Hardware", "Identidade"),
    evidenceDirectory: calibrationEvidenceDirectory,
    appVersion: applicationVersion,
    ...(options.calibrationPrivateKeyProtection
      ? { privateKeyProtection: options.calibrationPrivateKeyProtection }
      : {}),
  });
  async function effectiveCalibrationRuntimeStatus() {
    const status = await calibrationKernel.runtimeStatus();
    if (store.calibrationExtensionReady) return status;
    return {
      ...status,
      readyForQuickTest: false,
      readyForFullQualification: false,
      reasons: [...new Set([...status.reasons, "calibration-database-extension:unavailable"])],
    };
  }
  async function refreshCompatiblePredictions() {
    const status = await effectiveCalibrationRuntimeStatus();
    return refreshPredictions(store, {
      kernelVersion: status.kernelVersion,
      runtimeManifestHash: status.manifestHash,
    }, calibrationFeatures.evidencePolicy);
  }

  async function preparePortableCalibrationResult(
    run: LocalCalibrationRun,
    workloadProfile: CalibrationSessionRecord["plan"]["workloadProfile"],
  ) {
    const identity = await calibrationExchange.localIdentity();
    const exported = await calibrationExchange.exportRun(run, workloadProfile);
    return { identity, exported };
  }

  async function recordPortableCalibrationResult(
    prepared: Awaited<ReturnType<typeof preparePortableCalibrationResult>>,
  ): Promise<void> {
    const { identity, exported } = prepared;
    await store.saveCalibrationDeviceIdentity(identity);
    await recordCalibrationExportEvent(exported);
  }

  async function recordCalibrationExportEvent(
    exported: Awaited<ReturnType<CalibrationExchangeService["exportRun"]>>,
  ): Promise<void> {
    await store.saveCalibrationExportEvent({
      id: randomUUID(), format: "qhcal", runIds: [exported.package.run.id], packageDigest: exported.packageDigest,
      sizeBytes: exported.bytes.byteLength, createdAt: new Date().toISOString(),
    });
  }

  let portableRecoveryPromise: Promise<{ recoveredFiles: string[]; recoveryErrors: string[] }> | null = null;
  async function performPortableCalibrationRecovery(): Promise<{ recoveredFiles: string[]; recoveryErrors: string[] }> {
    if (!calibrationFeatures.exchange) return { recoveredFiles: [], recoveryErrors: [] };
    const [runs, sessions, provenance, exportEvents] = await Promise.all([
      store.listCalibrationRuns(), store.listCalibrationSessions(), store.listCalibrationRunProvenance(),
      store.listCalibrationExportEvents(),
    ]);
    const importedRunIds = new Set(provenance.map((item) => item.runId));
    const exportedRunIds = new Set(exportEvents.flatMap((item) => item.format === "qhcal" ? item.runIds : []));
    const sessionByPlan = new Map(sessions.map((session) => [session.planId, session]));
    const recovered: string[] = [];
    const errors: string[] = [];
    for (const run of runs) {
      if (importedRunIds.has(run.id) || run.schemaVersion !== AUTONOMOUS_LOCAL_CALIBRATION_VERSION) continue;
      const sourceSession = sessionByPlan.get(run.planId);
      if (!sourceSession) continue;
      try {
        const prepared = await preparePortableCalibrationResult(run, sourceSession.plan.workloadProfile);
        if (prepared.exported.created || !exportedRunIds.has(run.id)) {
          await recordPortableCalibrationResult(prepared);
        }
        if (prepared.exported.created) recovered.push(prepared.exported.fileName);
      } catch (error) {
        errors.push(`${run.id}:${safeError(error)}`);
      }
    }
    return { recoveredFiles: recovered, recoveryErrors: errors };
  }

  function recoverMissingPortableCalibrationResults(): Promise<{ recoveredFiles: string[]; recoveryErrors: string[] }> {
    portableRecoveryPromise ??= performPortableCalibrationRecovery().finally(() => {
      portableRecoveryPromise = null;
    });
    return portableRecoveryPromise;
  }
  app.use("*", async (context, next) => {
    await next();
    context.header("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'");
    context.header("Referrer-Policy", "no-referrer");
    context.header("X-Frame-Options", "DENY");
  });

  async function assertAutonomousRunMatchesSession(run: LocalCalibrationRun, session: CalibrationSessionRecord): Promise<void> {
    if (run.schemaVersion !== AUTONOMOUS_LOCAL_CALIBRATION_VERSION) return;
    const runtimeStatus = await effectiveCalibrationRuntimeStatus();
    assertAutonomousCalibrationSessionContract(run, session, runtimeStatus);
  }

  async function acceptCalibrationResult(session: CalibrationSessionRecord, raw: unknown, bytesTemporary = 0): Promise<CalibrationSessionRecord> {
    const findings = findForbiddenCalibrationData(raw);
    if (findings.length) throw new Error(`privacy_contract_violation:${findings.join(",")}`);
    const rawRun = raw as LocalCalibrationRun;
    if (rawRun?.artifact && calibrationPayloadSha256(rawRun) !== rawRun.artifact.payloadSha256 && legacyCalibrationPayloadSha256(rawRun) !== rawRun.artifact.payloadSha256) {
      throw new Error("calibration_artifact_checksum_mismatch");
    }
    const run = localCalibrationRunSchema.parse(raw) as LocalCalibrationRun;
    if (run.planId !== session.planId) throw new Error("calibration_plan_mismatch");
    await assertAutonomousRunMatchesSession(run, session);
    if (run.fingerprint.hardwareTemplateId) {
      const target = (await store.getCatalog()).find((item) => item.id === run.fingerprint.hardwareTemplateId);
      if (!target) throw new Error("calibration_hardware_not_in_catalog");
      if (!fingerprintMatchesTemplate(run, target)) throw new Error("calibration_hardware_fingerprint_mismatch");
    }
    const [hardware, existingRuns, observations, storedComponents] = await Promise.all([
      store.getCatalog(), store.listCalibrationRuns(), store.listBenchmarkObservations(), store.listCatalogComponents(),
    ]);
    const runtimeStatus = await effectiveCalibrationRuntimeStatus();
    const eligibleExistingRuns = await recommendationEligibleRuns(
      store,
      existingRuns.filter((item) => item.id !== run.id),
      calibrationFeatures.evidencePolicy,
    );
    const predictions = buildCapacityPredictions(
      hardware,
      calibrationFeatures.evidencePolicy ? [run, ...eligibleExistingRuns] : [],
      observations,
      { kernelVersion: runtimeStatus.kernelVersion, runtimeManifestHash: runtimeStatus.manifestHash },
    );
    const portableResult = run.schemaVersion === AUTONOMOUS_LOCAL_CALIBRATION_VERSION
      ? await preparePortableCalibrationResult(run, session.plan.workloadProfile)
      : null;
    await store.commitCalibrationRun(run, predictions);
    if (portableResult) await recordPortableCalibrationResult(portableResult);
    const derived = deriveComponentCatalog(hardware);
    const components = [...new Map([...derived.components, ...storedComponents].map((item) => [item.id, item])).values()];
    const builds = buildHistoricalComponentBuilds(hardware, components, observations, [run, ...existingRuns]).map((candidate) => {
      const prediction = predictions.find((item) => item.hardwareTemplateId === candidate.hardwareTemplateId &&
        item.workloadProfileId === run.workloadProfileId);
      return validateBuildCompatibility({
        ...candidate,
        procurementGate: buildProcurementGate(candidate.coverage, prediction?.status ?? "reference_only"),
      }, components);
    });
    await store.saveComponentBuilds(builds);
    const completed: CalibrationSessionRecord = {
      ...session,
      state: "finalizing",
      completedAt: null,
      progress: normalizeCalibrationProgress({ ...(session.progress ?? {}), stage: "cleanup", phase: "finalizing", percent: 98,
        overallPercent: 98, bytesTemporary, message: "Resultado confirmado; removendo os arquivos temporários da sessão." }),
      result: run,
      cleanup: { ...(session.cleanup ?? {
        schemaVersion: "qual-hardware-calibration-cleanup/1.0.0" as const,
        bytesTemporary: 0, bytesRemoved: 0, attempts: 0, remainingBytes: 0, updatedAt: new Date().toISOString(), error: null,
      }), state: "pending", bytesTemporary, remainingBytes: bytesTemporary, updatedAt: new Date().toISOString() },
      error: null,
    };
    await store.saveCalibrationSession(completed);
    return completed;
  }

  async function reconcileCalibrationSession(session: CalibrationSessionRecord): Promise<CalibrationSessionRecord> {
    const terminalCleanupPending = session.tokenHash === "internal" && !calibrationKernel.isActive(session.id) &&
      ["pending", "cleaning", "failed"].includes(session.cleanup?.state ?? "not_started");
    if (terminalCleanupPending && ["completed", "cancelled", "failed", "interrupted"].includes(session.state)) {
      const cleanup = await calibrationKernel.retryCleanup(session.id, session.state === "interrupted",
        session.cleanup?.bytesRemoved ?? session.progress?.bytesRemoved ?? 0);
      const recovered: CalibrationSessionRecord = {
        ...session,
        cleanup,
        progress: normalizeCalibrationProgress({
          ...(session.progress ?? { updatedAt: new Date().toISOString() }),
          stage: cleanup.state === "completed" ? session.state : "cleanup_failed",
          percent: cleanup.state === "completed" ? 100 : 99,
          bytesTemporary: cleanup.bytesTemporary,
          bytesRemoved: cleanup.bytesRemoved,
          message: cleanup.state === "completed"
            ? "Temporários pendentes da execução anterior foram removidos com segurança."
            : "A limpeza segura dos temporários da execução anterior continua pendente.",
        }),
        error: cleanup.state === "completed" && session.error === "calibration_cleanup_failed" ? null : session.error,
      };
      await store.saveCalibrationSession(recovered);
      return recovered;
    }
    if (["completed", "cancelled", "failed", "interrupted", "expired"].includes(session.state)) return session;
    if (session.tokenHash === "internal" && !calibrationKernel.isActive(session.id) &&
      ["launching", "preflight", "discovering", "qualifying", "finalizing", "running", "cancelling"].includes(session.state)) {
      const recovery = await calibrationKernel.recoverInterruptedSession(session);
      const interrupted: CalibrationSessionRecord = {
        ...session,
        state: "interrupted",
        completedAt: new Date().toISOString(),
        progress: normalizeCalibrationProgress({ ...(session.progress ?? { updatedAt: new Date().toISOString() }), stage: "interrupted", phase: "interrupted", percent: recovery.cleanup.state === "completed" ? 100 : 99,
          bytesTemporary: recovery.cleanup.bytesTemporary, bytesRemoved: recovery.cleanup.bytesRemoved,
          message: recovery.cleanup.state === "completed" ? "Execução interrompida; diagnóstico preservado e temporários removidos com segurança." : "Execução interrompida; diagnóstico preservado e limpeza temporária pendente." }),
        cleanup: recovery.cleanup,
        diagnostic: recovery.diagnostic,
        error: "calibration_session_interrupted",
      };
      await store.saveCalibrationSession(interrupted);
      return interrupted;
    }
    if (session.tokenHash === "internal") return session;
    const persisted = await findPersistedCalibration(session.planId, legacyCalibrationDirectoryOptions);
    if (persisted) {
      try {
        return await acceptCalibrationResult(session, persisted.result);
      } catch (error) {
        const failed = { ...session, state: "failed" as const, error: safeError(error) };
        await store.saveCalibrationSession(failed);
        return failed;
      }
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      const expired = { ...session, state: "expired" as const, error: "calibration_session_expired" };
      await store.saveCalibrationSession(expired);
      return expired;
    }
    return session;
  }
  void store.listCalibrationSessions()
    .then((sessions) => Promise.all(sessions.map(reconcileCalibrationSession)))
    .catch((error: unknown) => console.error("calibration_cleanup_recovery_failed", safeError(error)));
  void recoverMissingPortableCalibrationResults()
    .catch((error: unknown) => console.error("calibration_portable_result_recovery_failed", safeError(error)));

  async function startCalibrationKernelSession(
    launching: CalibrationSessionRecord,
    targetHardware: HardwareNodeTemplate | null,
    resumeCheckpoint?: CalibrationCheckpoint,
  ): Promise<void> {
    await calibrationKernel.start({
      sessionId: launching.id,
      plan: launching.plan,
      targetHardware,
      advancedTelemetry: launching.advancedTelemetry,
      ...(resumeCheckpoint ? { resumeCheckpoint } : {}),
    }, {
      onProgress: async (progress) => {
        const current = await store.getCalibrationSession(launching.id);
        if (!current) return;
        if (["cancelling", "cancelled", "failed", "interrupted", "finalizing", "completed"].includes(current.state)) return;
        const state = progress.phase === "preflight" ? "preflight" as const
          : progress.phase === "discovery" ? "discovering" as const
          : ["warmup", "ramp", "sustained", "surge"].includes(progress.phase ?? "") ? "qualifying" as const
          : "running" as const;
        await store.saveCalibrationSession({ ...current, state, progress: normalizeCalibrationProgress(progress), error: null });
      },
      onCheckpoint: async (checkpoint) => {
        await store.saveCalibrationCheckpoint(checkpoint);
      },
      onResult: async (result, bytesTemporary) => {
        const current = await store.getCalibrationSession(launching.id);
        if (!current) throw new Error("calibration_session_not_found");
        await acceptCalibrationResult(current, result, bytesTemporary);
      },
      onCleanupStarted: async () => {
        const current = await store.getCalibrationSession(launching.id);
        if (!current) return;
        const bytesTemporary = current.cleanup?.bytesTemporary ?? current.progress?.bytesTemporary ?? 0;
        await store.saveCalibrationSession({
          ...current,
          cleanup: {
            ...(current.cleanup ?? {
              schemaVersion: "qual-hardware-calibration-cleanup/1.0.0" as const,
              bytesTemporary, bytesRemoved: 0, attempts: 0, remainingBytes: bytesTemporary,
              updatedAt: new Date().toISOString(), error: null,
            }),
            state: "cleaning",
            updatedAt: new Date().toISOString(),
          },
          progress: normalizeCalibrationProgress({
            ...(current.progress ?? {}), stage: "cleanup", phase: "cleanup", percent: 99,
            message: "Evidência preservada; limpeza segura dos temporários iniciada.",
          }),
        });
      },
      onCompleted: async (cleanup) => {
        const current = await store.getCalibrationSession(launching.id);
        if (!current) return;
        const cleaned = cleanup.state === "completed";
        await store.saveCalibrationSession({
          ...current,
          state: cleaned ? "completed" : "finalizing",
          completedAt: cleaned ? new Date().toISOString() : null,
          cleanup,
          progress: normalizeCalibrationProgress({
            ...(current.progress ?? {}), stage: cleaned ? "completed" : "cleanup_failed",
            phase: cleaned ? "completed" : "cleanup", percent: cleaned ? 100 : 99,
            phasePercent: cleaned ? 100 : 99, bytesTemporary: cleanup.bytesTemporary,
            bytesRemoved: cleanup.bytesRemoved, estimatedRemainingSeconds: cleaned ? 0 : null,
            estimatedCompletionAt: null,
            message: cleaned
              ? `Resultado salvo; ${cleanup.bytesRemoved} bytes temporários removidos.`
              : "Resultado salvo; a limpeza dos temporários precisa ser repetida.",
          }),
          error: cleaned ? null : cleanup.error,
        });
      },
      onCancelled: async (cleanup, diagnostic) => {
        const current = await store.getCalibrationSession(launching.id);
        if (!current) return;
        await store.saveCalibrationSession({
          ...current, state: "cancelled", completedAt: new Date().toISOString(), cleanup,
          ...(diagnostic ? { diagnostic } : {}),
          progress: normalizeCalibrationProgress({
            ...(current.progress ?? {}), stage: "cancelled", phase: "cancelled",
            percent: cleanup.state === "completed" ? 100 : 99,
            phasePercent: cleanup.state === "completed" ? 100 : 99,
            bytesTemporary: cleanup.bytesTemporary, bytesRemoved: cleanup.bytesRemoved,
            estimatedRemainingSeconds: 0, estimatedCompletionAt: null,
            message: cleanup.state === "completed" ? "Teste cancelado e temporários removidos." : "Teste cancelado; limpeza temporária pendente.",
          }),
          error: cleanup.error,
        });
      },
      onFailed: async (error, cleanup, diagnostic) => {
        const current = await store.getCalibrationSession(launching.id);
        if (!current) return;
        await store.saveCalibrationSession({
          ...current, state: "failed", completedAt: new Date().toISOString(), cleanup,
          ...(diagnostic ? { diagnostic } : {}),
          progress: normalizeCalibrationProgress({
            ...(current.progress ?? {}), stage: "failed", phase: "failed",
            percent: cleanup.state === "completed" ? 100 : 99,
            phasePercent: cleanup.state === "completed" ? 100 : 99,
            bytesTemporary: cleanup.bytesTemporary, bytesRemoved: cleanup.bytesRemoved,
            estimatedRemainingSeconds: 0, estimatedCompletionAt: null,
            message: cleanup.state === "completed" ? "Teste encerrado com erro; temporários removidos." : "Teste encerrado com erro; limpeza temporária pendente.",
          }),
          error,
        });
      },
    });
  }

  async function calibrationResumeStatus(session: CalibrationSessionRecord): Promise<CalibrationResumeStatus> {
    const checkpoints = await store.listCalibrationCheckpoints(session.id);
    const checkpoint = checkpoints[0] ?? null;
    const incompatibilities: string[] = [];
    if (!calibrationFeatures.resume) incompatibilities.push("calibration_resume_feature_disabled");
    if (!["cancelled", "failed", "interrupted"].includes(session.state)) incompatibilities.push("source_session_not_resumable");
    if (!checkpoint) incompatibilities.push("compatible_checkpoint_not_found");
    if (calibrationKernel.hasActiveSession()) incompatibilities.push("another_calibration_is_running");
    if (catalogUpdates.refreshing) incompatibilities.push("catalog_refresh_is_running");
    if (checkpoint) {
      const [detected, runtime] = await Promise.all([detectCalibrationHardware(), effectiveCalibrationRuntimeStatus()]);
      const localModel = session.plan.scenario.cameraGroups.flatMap((group) => group.agents)
        .find((agent) => agent.model.startsWith("aiq-"))?.model ?? "local-stub";
      const modelAssetId = localModel.endsWith("-max") ? "qwen-core-max-gguf" : "qwen-core-gguf";
      const current = {
        hardwareDigest: calibrationHardwareDigest(detected),
        operatingSystem: detected.operatingSystem,
        operatingSystemVersion: detected.operatingSystemVersion,
        gpuDriver: detected.gpuDriver,
        workloadProfileSignature: session.plan.workloadProfile.signature,
        targetBuildHash: session.plan.workloadProfile.targetBuildHash,
        kernelVersion: runtime.kernelVersion,
        runtimeManifestHash: runtime.manifestHash,
        modelHash: runtime.assets.find((asset) => asset.id === modelAssetId && asset.status === "verified")?.sha256 ?? null,
        calibrationPolicyHash: calibrationPolicyHash(session.plan),
        appVersion: applicationVersion,
      };
      for (const key of Object.keys(checkpoint.compatibility) as Array<keyof typeof checkpoint.compatibility>) {
        if (checkpoint.compatibility[key] !== current[key]) incompatibilities.push(`compatibility_changed:${key}`);
      }
      if (!runtime.readyForQuickTest) incompatibilities.push("calibration_runtime_not_ready");
      if (session.mode === "full" && !runtime.readyForFullQualification) incompatibilities.push("calibration_runtime_not_ready_for_full");
    }
    return {
      resumable: incompatibilities.length === 0,
      sourceSessionId: session.id,
      checkpoint,
      incompatibilities: [...new Set(incompatibilities)],
      qualificationWillRestart: true,
    };
  }
  app.use("/api/*", async (context, next) => {
    const length = Number(context.req.header("content-length") ?? "0");
    const maximumLength = context.req.path === "/api/calibration-imports"
      ? QHCALSET_MAX_COMPRESSED_BYTES : context.req.path === "/api/catalog/import" ||
      context.req.path === "/api/evidence/import" || context.req.path === "/api/calibrations/import"
      ? 10_500_000 : 2_000_000;
    if (length > maximumLength) return context.json({ error: "payload_too_large" }, 413);
    context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    return next();
  });

  app.get("/api/health", (context) => context.json({ status: "ok", storage: store.storageKind }));
  app.get("/api/calibrations/features", (context) => context.json(calibrationFeatures));
  app.get("/api/contract", async (context) => {
    const file = applicationResourcePath("contracts", "perceptrum-workload-v2.json");
    return context.json(JSON.parse(await readFile(file, "utf8")) as unknown);
  });
  app.get("/api/scenarios", async (context) => context.json(await store.listScenarios()));
  app.post("/api/scenarios/compare", async (context) => {
    const request = compareRequestSchema.parse(await context.req.json());
    const comparisons = [];
    for (const id of request.scenarioIds) {
      const scenario = await store.getScenario(id);
      if (!scenario) return context.json({ error: "scenario_not_found", id }, 404);
      const stored = (await store.listRecommendations(id)).filter((item) => item.scenarioRevision === scenario.revision);
      const recommendations = stored.length ? stored : withComponentBuilds(buildRecommendations(
        id, scenario.revision, scenario.scenario, await store.getCatalog(), await store.getQuotes(), false,
        catalogUpdates.status.catalogVersion, await refreshCompatiblePredictions()), await store.listComponentBuilds());
      comparisons.push({ scenario, recommendations: withProcurementSpecifications(scenario.scenario, recommendations, await store.listCatalogComponents(), await store.listBenchmarkObservations()) });
    }
    return context.json({ schemaVersion: "capacity-scenario-comparison/1.0.0", comparisons });
  });
  app.post("/api/scenarios", async (context) => {
    const parsed = scenarioCreateSchema.parse(await context.req.json());
    return context.json(await store.createScenario(parsed.scenario), 201);
  });
  app.get("/api/scenarios/:id", async (context) => {
    const record = await store.getScenario(context.req.param("id"));
    return record ? context.json(record) : context.json({ error: "scenario_not_found" }, 404);
  });
  app.patch("/api/scenarios/:id", async (context) => {
    const parsed = scenarioUpdateSchema.parse(await context.req.json());
    return context.json(await store.updateScenario(context.req.param("id"), parsed.expectedRevision, parsed.scenario));
  });
  app.post("/api/scenarios/:id/duplicate", async (context) => {
    const record = await store.duplicateScenario(context.req.param("id"));
    return record ? context.json(record, 201) : context.json({ error: "scenario_not_found" }, 404);
  });
  app.post("/api/scenarios/:id/recommendations", async (context) => {
    const scenario = await store.getScenario(context.req.param("id"));
    if (!scenario) return context.json({ error: "scenario_not_found" }, 404);
    const recommendations = withComponentBuilds(buildRecommendations(
      scenario.id, scenario.revision, scenario.scenario, await store.getCatalog(), await store.getQuotes(), false,
      catalogUpdates.status.catalogVersion, await refreshCompatiblePredictions()), await store.listComponentBuilds());
    const withEvidence = currentEvidence(recommendations, await store.listBenchmarkEvidence(scenario.id, scenario.revision));
    const withProcurement = withProcurementSpecifications(scenario.scenario, withEvidence, await store.listCatalogComponents(), await store.listBenchmarkObservations());
    await store.saveRecommendations(withProcurement);
    return context.json(withProcurement, 201);
  });
  app.get("/api/scenarios/:id/recommendations", async (context) => context.json(await store.listRecommendations(context.req.param("id"))));
  app.get("/api/catalog/hardware", async (context) => context.json(await store.getCatalog()));
  app.get("/api/catalog/components", async (context) => context.json(await store.listCatalogComponents()));
  app.get("/api/catalog/components/:id/specifications", async (context) => {
    const component = (await store.listCatalogComponents()).find((item) => item.id === context.req.param("id"));
    return component ? context.json(withTechnicalSpecification(component).technicalSpecification) : context.json({ error: "component_not_found" }, 404);
  });
  app.get("/api/catalog/components/:id/specifications/history", async (context) => {
    const component = (await store.listCatalogComponents()).find((item) => item.id === context.req.param("id"));
    return component ? context.json(await store.listComponentSpecificationHistory(component.id)) : context.json({ error: "component_not_found" }, 404);
  });
  app.get("/api/catalog/specifications/coverage", async (context) => context.json(specificationCoverage(await store.listCatalogComponents())));
  app.get("/api/recommendations/:id/procurement-competition", async (context) => {
    const recommendation = await store.getRecommendation(context.req.param("id"));
    if (!recommendation) return context.json({ error: "recommendation_not_found" }, 404);
    return context.json({
      recommendationId: recommendation.id,
      options: [recommendation.primary, ...recommendation.alternatives].map((option) => ({
        optionId: option.id,
        procurementEligibility: option.procurementEligibility,
        neutralSpecificationStatus: option.procurementNeutralSpecification?.status ?? "unavailable",
        assessment: option.marketCompetitionAssessment ?? null,
      })),
    });
  });
  app.get("/api/catalog/builds", async (context) => context.json(await store.listComponentBuilds()));
  app.get("/api/catalog/builds/:id", async (context) => {
    const build = await store.getComponentBuild(context.req.param("id"));
    return build ? context.json(build) : context.json({ error: "component_build_not_found" }, 404);
  });
  app.get("/api/catalog/quotes", async (context) => context.json(await store.getQuotes()));
  app.get("/api/catalog/status", (context) => context.json(catalogUpdates.status));
  app.get("/api/catalog/sources", async (context) => context.json(await store.listCatalogSources()));
  app.get("/api/catalog/publications", async (context) => context.json(await store.listCatalogPublications()));
  app.get("/api/catalog/update-runs", async (context) => context.json(await store.listCatalogUpdateRuns()));
  app.post("/api/catalog/refresh", async (context) => {
    if (calibrationKernel.hasActiveSession()) return context.json({ error: "catalog_refresh_blocked_during_calibration" }, 409);
    if (!catalogUpdates.status.remoteUpdateConfigured) return context.json({ error: "catalog_update_not_configured" }, 503);
    const status = await catalogUpdates.refresh();
    await refreshCompatiblePredictions();
    return context.json(status);
  });
  app.post("/api/catalog/configure", async (context) => {
    const configuration = catalogConfigurationSchema.parse(await context.req.json());
    try {
      return context.json(await catalogUpdates.configure(configuration));
    } catch (error) {
      return context.json({ error: safeError(error) }, 422);
    }
  });
  app.post("/api/catalog/import", async (context) => {
    try {
      const status = await catalogUpdates.importSignedSnapshot(await context.req.text());
      await refreshCompatiblePredictions();
      return context.json(status);
    } catch (error) {
      return context.json({ error: safeError(error) }, 422);
    }
  });

  app.get("/api/calibrations", async (context) => context.json(await store.listCalibrationRuns()));
  app.get("/api/calibrations/:id/export", async (context) => {
    if (!calibrationFeatures.exchange) return context.json({ error: "calibration_exchange_feature_disabled" }, 503);
    const run = (await store.listCalibrationRuns()).find((item) => item.id === context.req.param("id"));
    if (!run) return context.json({ error: "calibration_run_not_found" }, 404);
    const sourceSession = (await store.listCalibrationSessions()).find((session) => session.planId === run.planId);
    let exported: Awaited<ReturnType<CalibrationExchangeService["exportRun"]>>;
    if (sourceSession) {
      const prepared = await preparePortableCalibrationResult(run, sourceSession.plan.workloadProfile);
      await recordPortableCalibrationResult(prepared);
      exported = prepared.exported;
    } else {
      exported = await calibrationExchange.exportRun(run, null);
      await recordCalibrationExportEvent(exported);
    }
    context.header("Content-Type", QHCAL_MIME);
    context.header("Content-Disposition", `attachment; filename="${exported.fileName}"`);
    context.header("X-Calibration-Package-Sha256", exported.packageDigest);
    return context.body(new Uint8Array(exported.bytes));
  });
  app.get("/api/calibration-devices", async (context) => context.json(await store.listCalibrationDeviceIdentities()));
  app.post("/api/calibration-devices/:id/trust", async (context) => {
    const identity = await store.setCalibrationDeviceTrust(context.req.param("id"), "trusted");
    await refreshCompatiblePredictions();
    return context.json(identity);
  });
  app.post("/api/calibration-devices/:id/revoke", async (context) => {
    const identity = await store.setCalibrationDeviceTrust(context.req.param("id"), "revoked");
    await refreshCompatiblePredictions();
    return context.json(identity);
  });
  app.post("/api/calibration-imports", async (context) => {
    if (!calibrationFeatures.exchange) return context.json({ error: "calibration_exchange_feature_disabled" }, 503);
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    const parsed = await calibrationExchange.parseAny(bytes);
    const nowIso = new Date().toISOString();
    const batchId = randomUUID();
    const [existingRuns, existingDevices, hardware] = await Promise.all([
      store.listCalibrationRuns(), store.listCalibrationDeviceIdentities(), store.getCatalog(),
    ]);
    const existingById = new Map(existingRuns.map((run) => [run.id, { run, digest: exchangeDigest(run) }]));
    const devicesById = new Map(existingDevices.map((identity) => [identity.id, identity]));
    const packageByRun = new Map<string, QhcalPackage>();
    const identities = new Map<string, CalibrationDeviceIdentity>();
    const items: CalibrationImportItem[] = [];
    let pendingTrust = false;
    for (const packageValue of parsed.packages) {
      const packageDigest = exchangeDigest(packageValue);
      const previousInPackage = packageByRun.get(packageValue.run.id);
      if (previousInPackage) {
        items.push({ id: randomUUID(), batchId, runId: packageValue.run.id, packageDigest, status:
          exchangeDigest(previousInPackage) === packageDigest ? "duplicate" : "conflict",
        reason: exchangeDigest(previousInPackage) === packageDigest ? "duplicate_inside_package" : "run_id_collision_inside_package", recordedAt: nowIso });
        continue;
      }
      packageByRun.set(packageValue.run.id, packageValue);
      const findings = findForbiddenCalibrationData(packageValue.run);
      if (findings.length) {
        items.push({ id: randomUUID(), batchId, runId: packageValue.run.id, packageDigest, status: "invalid",
          reason: `privacy_contract_violation:${findings.join(",")}`, recordedAt: nowIso });
        continue;
      }
      const known = devicesById.get(packageValue.device.id);
      if (known && known.publicKeyPem !== packageValue.device.publicKeyPem) {
        items.push({ id: randomUUID(), batchId, runId: packageValue.run.id, packageDigest, status: "conflict",
          reason: "calibration_device_key_changed", recordedAt: nowIso });
        continue;
      }
      const identity: CalibrationDeviceIdentity = known ?? {
        id: packageValue.device.id, publicKeyPem: packageValue.device.publicKeyPem, shortCode: packageValue.device.shortCode,
        trust: "pending", protection: "imported_public_key", firstSeenAt: nowIso, updatedAt: nowIso,
      };
      identities.set(identity.id, identity);
      if (identity.trust === "pending") pendingTrust = true;
      const existing = existingById.get(packageValue.run.id);
      if (existing) {
        items.push({ id: randomUUID(), batchId, runId: packageValue.run.id, packageDigest,
          status: existing.digest === packageValue.runDigest ? "duplicate" : "conflict",
          reason: existing.digest === packageValue.runDigest ? "already_imported" : "run_id_digest_conflict", recordedAt: nowIso });
        continue;
      }
      const mappedTemplate = packageValue.run.fingerprint.hardwareTemplateId
        ? hardware.find((item) => item.id === packageValue.run.fingerprint.hardwareTemplateId)
        : null;
      const mapped = Boolean(mappedTemplate && fingerprintMatchesTemplate(packageValue.run, mappedTemplate));
      const status: CalibrationImportItem["status"] = identity.trust === "pending" ? "pending_trust"
        : identity.trust === "revoked" || !mapped ? "diagnostic" : "imported";
      items.push({ id: randomUUID(), batchId, runId: packageValue.run.id, packageDigest, status,
        reason: identity.trust === "pending" ? "device_confirmation_required"
          : identity.trust === "revoked" ? "device_revoked"
            : !mapped ? "unmapped_measured_system" : null, recordedAt: nowIso });
    }
    const batch = (completedAt: string): CalibrationImportBatch => ({
      id: batchId, format: parsed.format, createdAt: nowIso, completedAt, totalItems: items.length,
      importedItems: items.filter((item) => item.status === "imported").length,
      diagnosticItems: items.filter((item) => item.status === "diagnostic").length,
      duplicateItems: items.filter((item) => item.status === "duplicate").length,
      conflictItems: items.filter((item) => item.status === "conflict").length,
      invalidItems: items.filter((item) => item.status === "invalid").length,
      pendingTrustItems: items.filter((item) => item.status === "pending_trust").length,
    });
    if (pendingTrust) {
      const pendingBatch = batch(new Date().toISOString());
      await store.commitCalibrationImport({ batch: pendingBatch, items, deviceIdentities: [...identities.values()], runs: [], predictions: [] });
      return context.json({ error: "calibration_device_confirmation_required", batch: pendingBatch,
        devices: [...identities.values()].filter((identity) => identity.trust === "pending") }, 409);
    }
    if (context.req.query("preview") === "1") {
      return context.json({ preview: true, batch: batch(new Date().toISOString()), devices: [...identities.values()] });
    }
    const importableItems = new Map(items.filter((item) => item.status === "imported" || item.status === "diagnostic")
      .map((item) => [item.runId, item]));
    const imported = [...packageByRun.values()].filter((packageValue) => importableItems.has(packageValue.run.id));
    const eligibleImported = imported.filter((packageValue) => importableItems.get(packageValue.run.id)?.status === "imported")
      .map((packageValue) => packageValue.run);
    const runtime = await effectiveCalibrationRuntimeStatus();
    const existingEligible = await recommendationEligibleRuns(store, existingRuns, calibrationFeatures.evidencePolicy);
    const predictions = buildCapacityPredictions(hardware,
      calibrationFeatures.evidencePolicy ? [...eligibleImported, ...existingEligible] : [],
      await store.listBenchmarkObservations(), { kernelVersion: runtime.kernelVersion, runtimeManifestHash: runtime.manifestHash });
    const completedBatch = batch(new Date().toISOString());
    for (const packageValue of imported) await calibrationExchange.persistImportedPackage(packageValue);
    await store.commitCalibrationImport({
      batch: completedBatch,
      items,
      deviceIdentities: [...identities.values()],
      runs: imported.map((packageValue) => ({
        run: packageValue.run,
        workloadProfile: packageValue.workloadProfile,
        provenance: {
          runId: packageValue.run.id, source: parsed.format, deviceId: packageValue.device.id,
          packageDigest: exchangeDigest(packageValue), trustedAtImport: identities.get(packageValue.device.id)?.trust === "trusted",
          importedAt: nowIso,
        },
      })),
      predictions,
    });
    return context.json({ batch: completedBatch, predictions, importedRuns: imported.map((item) => item.run.id) }, 201);
  });
  app.post("/api/calibration-collections/export", async (context) => {
    if (!calibrationFeatures.exchange) return context.json({ error: "calibration_exchange_feature_disabled" }, 503);
    const requested = await context.req.json().catch(() => ({})) as { runIds?: unknown };
    const runIds = Array.isArray(requested.runIds) ? requested.runIds.filter((item): item is string => typeof item === "string") : [];
    const runs = (await store.listCalibrationRuns()).filter((run) => runIds.length === 0 || runIds.includes(run.id));
    if (runs.length > 10_000) return context.json({ error: "calibration_collection_result_limit_exceeded" }, 413);
    const identity = await calibrationExchange.localIdentity();
    await store.saveCalibrationDeviceIdentity(identity);
    const sessions = await store.listCalibrationSessions();
    const profilesByPlan = new Map(sessions.map((session) => [session.planId, session.plan.workloadProfile]));
    const packages = await Promise.all(runs.map(async (run) =>
      (await calibrationExchange.exportRun(run, profilesByPlan.get(run.planId) ?? null)).package));
    const exported = await calibrationExchange.exportCollection(packages);
    const createdAt = new Date().toISOString();
    await store.saveCalibrationExportEvent({ id: randomUUID(), format: "qhcalset", runIds: runs.map((run) => run.id),
      packageDigest: exported.packageDigest, sizeBytes: exported.bytes.byteLength, createdAt });
    await store.saveCalibrationCollectionSnapshot({ id: exported.collection.collectionId, packageDigest: exported.packageDigest,
      resultCount: runs.length, runIds: runs.map((run) => run.id), createdAt });
    context.header("Content-Type", QHCALSET_MIME);
    context.header("Content-Disposition", `attachment; filename="${exported.fileName}"`);
    context.header("X-Calibration-Package-Sha256", exported.packageDigest);
    return context.body(new Uint8Array(exported.bytes));
  });
  app.get("/api/calibration-collection/status", async (context) => {
    const [runs, devices] = await Promise.all([store.listCalibrationRuns(), store.listCalibrationDeviceIdentities()]);
    const eligible = await recommendationEligibleRuns(store, runs, calibrationFeatures.evidencePolicy);
    const platformCounts = Object.fromEntries(["windows", "ubuntu", "macos"].map((platform) =>
      [platform, runs.filter((run) => run.fingerprint.operatingSystem === platform).length]).filter(([, count]) => Number(count) > 0));
    return context.json({
      runs: runs.length,
      measuredSystems: new Set(runs.map((run) => run.fingerprint.hostnameHash)).size,
      distinctConfigurations: new Set(runs.map((run) => calibrationHardwareDigest(run.fingerprint))).size,
      trustedDevices: devices.filter((identity) => identity.trust === "trusted").length,
      pendingDevices: devices.filter((identity) => identity.trust === "pending").length,
      revokedDevices: devices.filter((identity) => identity.trust === "revoked").length,
      platforms: platformCounts,
      profiles: new Set(runs.map((run) => run.workloadProfileId).filter(Boolean)).size,
      purchaseEligibleRuns: eligible.filter((run) => run.qualityGate?.eligibleForCapacityExtrapolation === true).length,
      diagnosticRuns: runs.filter((run) => !eligible.includes(run) || run.qualityGate?.eligibleForCapacityExtrapolation !== true).length,
    });
  });
  app.get("/api/predictions", async (context) => context.json(await store.listPredictions()));
  app.get("/api/evidence", async (context) => context.json(await store.listBenchmarkObservations()));
  app.get("/api/evidence/components", async (context) => context.json(await store.listHardwareComponents()));
  app.get("/api/evidence/coverage", async (context) => {
    await refreshCompatiblePredictions();
    const builds = await store.listComponentBuilds();
    return context.json({
      schemaVersion: "qual-hardware-evidence-coverage/1.0.0",
      generatedAt: new Date().toISOString(),
      buildCount: builds.length,
      procurementEligibleBuildCount: builds.filter((build) => build.procurementGate.eligibility === "eligible").length,
      builds: builds.map((build) => ({ id: build.id, name: build.name, hardwareTemplateId: build.hardwareTemplateId, coverage: build.coverage, procurementGate: build.procurementGate })),
    });
  });
  app.get("/api/evidence/components/:id", async (context) => {
    const component = (await store.listCatalogComponents()).find((item) => item.id === context.req.param("id"));
    if (!component) return context.json({ error: "component_not_found" }, 404);
    const observations = (await store.listBenchmarkObservations()).filter((item) =>
      item.componentId === component.id || item.componentIds?.includes(component.id),
    );
    const builds = (await store.listComponentBuilds()).filter((build) => build.items.some((item) => item.componentId === component.id));
    return context.json({
      component,
      stages: componentStages(component),
      eligibleObservations: observations.filter(isPublicObservationEligible),
      referenceObservations: observations.filter((item) => !isPublicObservationEligible(item)),
      builds: builds.map((build) => ({ id: build.id, name: build.name, procurementGate: build.procurementGate })),
    });
  });
  app.get("/api/calibrations/status", async (context) => context.json({
    schemaVersion: "qual-hardware-calibration-status/1.0.0",
    calibrationRuns: (await store.listCalibrationRuns()).length,
    publicObservations: (await store.listBenchmarkObservations()).length,
    predictions: (await store.listPredictions()).length,
    localOnly: true,
    inferenceProvider: "aiq_local",
  }));
  app.post("/api/calibrations/plans", async (context) => {
    const request = calibrationPlanRequestSchema.parse(await context.req.json());
    const recommendation = await store.getRecommendation(request.recommendationId);
    if (!recommendation) return context.json({ error: "recommendation_not_found" }, 404);
    const scenario = await store.getScenario(recommendation.scenarioId);
    if (!scenario || scenario.revision !== recommendation.scenarioRevision) {
      return context.json({ error: "recommendation_revision_is_not_current" }, 409);
    }
    if (request.targetHardwareTemplateId && !(await store.getCatalog()).some((item) => item.id === request.targetHardwareTemplateId)) {
      return context.json({ error: "calibration_hardware_not_in_catalog" }, 422);
    }
    return context.json(createCalibrationPlan(scenario.scenario, request.mode, request.targetHardwareTemplateId), 201);
  });
  app.get("/api/calibration-sessions", async (context) => {
    const sessions = await Promise.all((await store.listCalibrationSessions()).map(reconcileCalibrationSession));
    return context.json(sessions.map(publicCalibrationSession));
  });
  app.get("/api/calibration-sessions/directory", async (context) => {
    const recovery = await recoverMissingPortableCalibrationResults();
    return context.json({ directory: await resolveCalibrationDirectory(calibrationDirectoryOptions), ...recovery });
  });
  app.get("/api/calibrations/runtime-status", async (context) => context.json(await effectiveCalibrationRuntimeStatus()));
  app.get("/api/calibrations/hardware-status", async (context) => context.json(await detectCalibrationHardware()));
  app.get("/api/capacity-assessments", async (context) => {
    const hardwareTemplateId = context.req.query("hardwareTemplateId");
    const workloadProfileId = context.req.query("workloadProfileId");
    return context.json((await store.listCapacityAssessments()).filter((assessment) =>
      (!hardwareTemplateId || assessment.hardwareTemplateId === hardwareTemplateId) &&
      (!workloadProfileId || assessment.workloadProfileId === workloadProfileId)));
  });
  app.post("/api/calibration-sessions", async (context) => {
    const request = calibrationSessionRequestSchema.parse(await context.req.json());
    if (catalogUpdates.refreshing) {
      return context.json({ error: "calibration_blocked_during_catalog_refresh" }, 409);
    }
    const recommendation = await store.getRecommendation(request.recommendationId);
    if (!recommendation) return context.json({ error: "recommendation_not_found" }, 404);
    const scenario = await store.getScenario(recommendation.scenarioId);
    if (!scenario || scenario.revision !== recommendation.scenarioRevision) {
      return context.json({ error: "recommendation_revision_is_not_current" }, 409);
    }
    if (request.targetHardwareTemplateId && !(await store.getCatalog()).some((item) => item.id === request.targetHardwareTemplateId)) {
      return context.json({ error: "calibration_hardware_not_in_catalog" }, 422);
    }
    const runtimeStatus = await effectiveCalibrationRuntimeStatus();
    if (!runtimeStatus.readyForQuickTest) {
      return context.json({ error: "calibration_feature_disabled", runtimeStatus }, 503);
    }
    if (request.mode === "full" && scenario.scenario.perceptrumBuildHash !== PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT) {
      return context.json({ error: "calibration_perceptrum_build_not_supported", supportedBuild: PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT }, 409);
    }
    if (request.mode === "full" && !runtimeStatus.readyForFullQualification) {
      return context.json({ error: "calibration_runtime_not_ready_for_full", runtimeStatus }, 503);
    }
    if (request.mode === "full" && runtimeStatus.manifestApproved && !request.targetHardwareTemplateId) {
      return context.json({ error: "calibration_target_hardware_required_for_full" }, 422);
    }
    const catalog = await store.getCatalog();
    const advancedTelemetry = request.mode === "full" || request.advancedTelemetry;
    const targetHardware = request.targetHardwareTemplateId
      ? catalog.find((item) => item.id === request.targetHardwareTemplateId) ?? null : null;
    const plan = createCalibrationPlan(scenario.scenario, request.mode, request.targetHardwareTemplateId);
    const created = createInternalCalibrationSession({
      plan,
      recommendationId: recommendation.id,
      scenarioId: scenario.id,
      advancedTelemetry,
    });
    const launching: CalibrationSessionRecord = {
      ...created,
      state: "launching",
      launchedAt: new Date().toISOString(),
      progress: normalizeCalibrationProgress({ stage: "launching", phase: "launching", percent: 0,
        message: "Iniciando o Qual Hardware Calibration Kernel." }),
    };
    await store.saveCalibrationSession(launching);
    try {
      await startCalibrationKernelSession(launching, targetHardware);
      return context.json({ session: publicCalibrationSession(launching), delivery: "internal" }, 201);
    } catch (error) {
      const failed: CalibrationSessionRecord = { ...launching, state: "failed", completedAt: new Date().toISOString(), error: safeError(error) };
      await store.saveCalibrationSession(failed);
      return context.json({ error: "calibration_kernel_launch_failed", detail: safeError(error), session: publicCalibrationSession(failed) }, 503);
    }
  });
  app.get("/api/calibration-sessions/:id", async (context) => {
    const session = await store.getCalibrationSession(context.req.param("id"));
    if (!session) return context.json({ error: "calibration_session_not_found" }, 404);
    return context.json(publicCalibrationSession(await reconcileCalibrationSession(session)));
  });
  app.get("/api/calibration-sessions/:id/resume-status", async (context) => {
    const session = await store.getCalibrationSession(context.req.param("id"));
    if (!session) return context.json({ error: "calibration_session_not_found" }, 404);
    return context.json(await calibrationResumeStatus(session));
  });
  app.post("/api/calibration-sessions/:id/resume", async (context) => {
    const source = await store.getCalibrationSession(context.req.param("id"));
    if (!source) return context.json({ error: "calibration_session_not_found" }, 404);
    const status = await calibrationResumeStatus(source);
    if (!status.resumable || !status.checkpoint) return context.json({ error: "calibration_resume_incompatible", ...status }, 409);
    const createdAt = new Date().toISOString();
    const plan = { ...structuredClone(source.plan), id: randomUUID(), createdAt };
    const created = createInternalCalibrationSession({
      plan,
      recommendationId: source.recommendationId,
      scenarioId: source.scenarioId,
      advancedTelemetry: source.advancedTelemetry,
      now: new Date(createdAt),
    });
    const launching: CalibrationSessionRecord = {
      ...created,
      state: "launching",
      launchedAt: createdAt,
      progress: normalizeCalibrationProgress({ stage: "launching", phase: "launching", percent: 0,
        message: "Retomando do último checkpoint compatível; a qualificação comercial reiniciará na repetição 1." }),
    };
    await store.saveCalibrationSession(launching);
    await store.saveCalibrationSessionLineage({
      id: randomUUID(), parentSessionId: source.id, childSessionId: launching.id,
      checkpointId: status.checkpoint.id, createdAt,
    });
    const targetHardware = plan.targetHardwareTemplateId
      ? (await store.getCatalog()).find((item) => item.id === plan.targetHardwareTemplateId) ?? null : null;
    try {
      await startCalibrationKernelSession(launching, targetHardware, status.checkpoint);
      return context.json({ session: publicCalibrationSession(launching), delivery: "internal", resumedFrom: source.id }, 201);
    } catch (error) {
      const failed = { ...launching, state: "failed" as const, completedAt: new Date().toISOString(), error: safeError(error) };
      await store.saveCalibrationSession(failed);
      return context.json({ error: "calibration_kernel_resume_failed", detail: safeError(error), session: publicCalibrationSession(failed) }, 503);
    }
  });
  app.post("/api/calibration-sessions/:id/cancel", async (context) => {
    const session = await store.getCalibrationSession(context.req.param("id"));
    if (!session) return context.json({ error: "calibration_session_not_found" }, 404);
    if (session.state === "cancelling") return context.json(publicCalibrationSession(session), 202);
    if (!["launching", "preflight", "discovering", "qualifying", "running", "cancelling"].includes(session.state)) {
      return context.json(publicCalibrationSession(session));
    }
    if (!calibrationKernel.isActive(session.id)) {
      return context.json(publicCalibrationSession(await reconcileCalibrationSession(session)));
    }
    try {
      const cancelling: CalibrationSessionRecord = {
        ...session,
        state: "cancelling",
        progress: normalizeCalibrationProgress({ ...(session.progress ?? {}), stage: "cancelling", phase: "cancelling",
          message: "Interrompendo com segurança e salvando o diagnóstico parcial." }),
        error: null,
      };
      await store.saveCalibrationSession(cancelling);
      await calibrationKernel.cancel(session.id);
      return context.json(publicCalibrationSession(cancelling), 202);
    } catch (error) {
      return context.json({ error: safeError(error) }, 409);
    }
  });
  app.post("/api/calibration-sessions/:id/retry-cleanup", async (context) => {
    const session = await store.getCalibrationSession(context.req.param("id"));
    if (!session) return context.json({ error: "calibration_session_not_found" }, 404);
    if (session.cleanup?.state !== "failed" && session.state !== "finalizing" && session.state !== "interrupted") {
      return context.json({ error: "calibration_cleanup_not_pending" }, 409);
    }
    const cleanup = await calibrationKernel.retryCleanup(session.id, session.state === "interrupted",
      session.cleanup?.bytesRemoved ?? session.progress?.bytesRemoved ?? 0);
    const cleaned = cleanup.state === "completed";
    const updated: CalibrationSessionRecord = {
      ...session,
      state: cleaned && session.result ? "completed" : session.state,
      completedAt: cleaned ? new Date().toISOString() : session.completedAt,
      cleanup,
      progress: normalizeCalibrationProgress({ ...(session.progress ?? { updatedAt: new Date().toISOString() }), stage: cleaned ? "completed" : "cleanup_failed",
        phase: cleaned ? "completed" : "cleanup",
        percent: cleaned ? 100 : 99, bytesTemporary: cleanup.bytesTemporary, bytesRemoved: cleanup.bytesRemoved,
        message: cleaned ? "Limpeza temporária concluída." : "A limpeza temporária continua pendente." }),
      error: cleaned ? null : cleanup.error,
    };
    await store.saveCalibrationSession(updated);
    return context.json(publicCalibrationSession(updated), cleaned ? 200 : 409);
  });
  app.get("/api/calibration-sessions/:id/plan", async (context) => {
    const session = await store.getCalibrationSession(context.req.param("id"));
    if (!session) return context.json({ error: "calibration_session_not_found" }, 404);
    try {
      authorizeCalibrationSession(session, context.req.header("authorization"));
      const running: CalibrationSessionRecord = {
        ...session,
        state: "running",
        launchedAt: session.launchedAt ?? new Date().toISOString(),
        progress: { stage: "preparing", percent: 1, message: "Plano recebido pelo Perceptrum.", updatedAt: new Date().toISOString() },
        error: null,
      };
      await store.saveCalibrationSession(running);
      return context.json({ plan: running.plan, advancedTelemetry: running.advancedTelemetry });
    } catch (error) {
      return context.json({ error: safeError(error) }, /token/.test(safeError(error)) ? 403 : 409);
    }
  });
  app.post("/api/calibration-sessions/:id/progress", async (context) => {
    const session = await store.getCalibrationSession(context.req.param("id"));
    if (!session) return context.json({ error: "calibration_session_not_found" }, 404);
    try {
      authorizeCalibrationSession(session, context.req.header("authorization"));
      const raw = await context.req.json();
      const running: CalibrationSessionRecord = {
        ...session,
        state: "running",
        progress: normalizeCalibrationProgress((raw as { progress?: unknown }).progress ?? raw),
        error: null,
      };
      await store.saveCalibrationSession(running);
      return context.json({ ok: true });
    } catch (error) {
      return context.json({ error: safeError(error) }, /token/.test(safeError(error)) ? 403 : 409);
    }
  });
  app.post("/api/calibration-sessions/:id/result", async (context) => {
    const session = await store.getCalibrationSession(context.req.param("id"));
    if (!session) return context.json({ error: "calibration_session_not_found" }, 404);
    try {
      authorizeCalibrationSession(session, context.req.header("authorization"));
      const raw = await context.req.json();
      const completed = await acceptCalibrationResult(session, (raw as { result?: unknown }).result ?? raw);
      volatileCalibrationTokens.delete(session.id);
      return context.json({ session: publicCalibrationSession(completed), predictions: await store.listPredictions() }, 201);
    } catch (error) {
      return context.json({ error: safeError(error) }, /token/.test(safeError(error)) ? 403 : 422);
    }
  });
  app.post("/api/calibration-sessions/:id/cancelled", async (context) => {
    const session = await store.getCalibrationSession(context.req.param("id"));
    if (!session) return context.json({ error: "calibration_session_not_found" }, 404);
    try {
      authorizeCalibrationSession(session, context.req.header("authorization"));
      const raw = await context.req.json() as { progress?: unknown; artifact?: { fileName?: unknown; payloadSha256?: unknown } };
      const progress = normalizeCalibrationProgress(raw.progress);
      const fileName = typeof raw.artifact?.fileName === "string" ? raw.artifact.fileName.slice(0, 240) : "diagnóstico parcial";
      const cancelled: CalibrationSessionRecord = {
        ...session,
        state: "cancelled",
        completedAt: new Date().toISOString(),
        progress: { ...progress, stage: "cancelled", message: `Teste interrompido; ${fileName} foi preservado somente para diagnóstico.` },
        result: null,
        error: null,
      };
      await store.saveCalibrationSession(cancelled);
      volatileCalibrationTokens.delete(session.id);
      return context.json({ session: publicCalibrationSession(cancelled) });
    } catch (error) {
      return context.json({ error: safeError(error) }, /token/.test(safeError(error)) ? 403 : 422);
    }
  });
  app.post("/api/calibration-sessions/open-directory", async (context) => {
    const recovery = await recoverMissingPortableCalibrationResults();
    const directory = await resolveCalibrationDirectory(calibrationDirectoryOptions);
    await mkdir(directory, { recursive: true });
    if (options.desktopBridge?.openPath) await options.desktopBridge.openPath(directory);
    return context.json({ directory, ...recovery });
  });
  app.post("/api/calibrations/import", async (context) => {
    if (!store.calibrationExtensionReady) return context.json({ error: "calibration_extension_unavailable" }, 503);
    const raw = await context.req.json();
    const findings = findForbiddenCalibrationData(raw);
    if (findings.length) return context.json({ error: "privacy_contract_violation", findings }, 422);
    const rawRun = raw as LocalCalibrationRun;
    if (rawRun?.artifact && calibrationPayloadSha256(rawRun) !== rawRun.artifact.payloadSha256 && legacyCalibrationPayloadSha256(rawRun) !== rawRun.artifact.payloadSha256) {
      return context.json({ error: "calibration_artifact_checksum_mismatch" }, 422);
    }
    const run = localCalibrationRunSchema.parse(raw) as LocalCalibrationRun;
    if (run.schemaVersion === AUTONOMOUS_LOCAL_CALIBRATION_VERSION) {
      const session = (await store.listCalibrationSessions()).find((candidate) => candidate.planId === run.planId);
      if (!session) return context.json({ error: "autonomous_calibration_recovery_requires_known_session" }, 409);
      try {
        await assertAutonomousRunMatchesSession(run, session);
      } catch (error) {
        return context.json({ error: safeError(error) }, 422);
      }
    }
    if (run.fingerprint.hardwareTemplateId) {
      const target = (await store.getCatalog()).find((item) => item.id === run.fingerprint.hardwareTemplateId);
      if (!target) return context.json({ error: "calibration_hardware_not_in_catalog" }, 422);
      if (!fingerprintMatchesTemplate(run, target)) {
        return context.json({ error: "calibration_hardware_fingerprint_mismatch", targetHardwareTemplateId: target.id }, 422);
      }
    }
    await store.saveCalibrationRun(run);
    const predictions = await refreshCompatiblePredictions();
    return context.json({ run, predictions }, 201);
  });
  app.post("/api/evidence/import", async (context) => {
    try {
      const snapshot = await catalogUpdates.importSignedEvidenceSnapshot(await context.req.text());
      const predictions = await refreshCompatiblePredictions();
      return context.json({ snapshot, predictions }, 201);
    } catch (error) {
      return context.json({ error: safeError(error) }, 422);
    }
  });
  app.post("/api/predictions/recalculate", async (context) => context.json(await refreshCompatiblePredictions(), 201));

  app.post("/api/benchmarks/manifests", async (context) => {
    const request = manifestRequestSchema.parse(await context.req.json());
    const recommendation = await store.getRecommendation(request.recommendationId);
    if (!recommendation) return context.json({ error: "recommendation_not_found" }, 404);
    const scenario = await store.getScenario(recommendation.scenarioId);
    if (!scenario || scenario.revision !== recommendation.scenarioRevision) return context.json({ error: "recommendation_revision_is_not_current" }, 409);
    const origin = process.env.PUBLIC_BASE_URL ?? new URL(context.req.url).origin;
    const manifest = createBenchmarkManifest(scenario, recommendation, origin, request.gpuDriver, request.slaInferenceLatencyMs);
    await store.saveManifest(manifest);
    return context.json(manifest, 201);
  });
  app.post("/api/benchmarks/:id/results", async (context) => {
    const manifest = await store.getManifest(context.req.param("id"));
    if (!manifest) return context.json({ error: "manifest_not_found" }, 404);
    if (await store.getBenchmarkResult(manifest.id)) return context.json({ error: "benchmark_challenge_already_used" }, 409);
    const nonce = context.req.header("x-benchmark-nonce") ?? "";
    if (!nonceMatches(manifest.nonce, nonce)) return context.json({ error: "invalid_benchmark_nonce" }, 403);
    const raw = await context.req.json();
    const findings = findForbiddenBenchmarkData(raw);
    if (findings.length) return context.json({ error: "privacy_contract_violation", findings }, 422);
    const metrics = benchmarkMetricsSchema.parse(raw) as BenchmarkMetrics;
    const result = validateBenchmark(manifest, metrics);
    await store.saveBenchmarkResult(result);
    return context.json(result, result.passed ? 201 : 422);
  });

  app.get("/api/recommendations/:id/export/:format", async (context) => {
    const recommendation = await store.getRecommendation(context.req.param("id"));
    if (!recommendation) return context.json({ error: "recommendation_not_found" }, 404);
    const scenario = await store.getScenario(recommendation.scenarioId);
    if (!scenario) return context.json({ error: "scenario_not_found" }, 404);
    const recommendations = reportRecommendationSet(recommendation, await store.listRecommendations(recommendation.scenarioId));
    if (recommendations.length !== reportPolicies.length) return context.json({ error: "recommendation_set_incomplete" }, 409);
    const format = context.req.param("format");
    const components = await store.listCatalogComponents();
    const [benchmarkObservations, builds] = await Promise.all([store.listBenchmarkObservations(), store.listComponentBuilds()]);
    const reportContext = {
      scenario,
      recommendations: withProcurementSpecifications(scenario.scenario, recommendations, components, benchmarkObservations),
      components,
      builds,
      benchmarkObservations,
    };
    let body: Buffer;
    let contentType: string;
    let filename: string;
    if (format === "json") { body = jsonReport(reportContext); contentType = "application/json; charset=utf-8"; filename = "qual-hardware-relatorio-comercial-e-neutro.json"; }
    else if (format === "xlsx") { body = await xlsxReport(reportContext); contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; filename = "qual-hardware-relatorio-comercial-e-neutro.xlsx"; }
    else if (format === "pdf") { body = await pdfReport(reportContext); contentType = "application/pdf"; filename = "qual-hardware-recomendacoes.pdf"; }
    else if (format === "technical-pdf") { body = await technicalCadernoPdf(reportContext); contentType = "application/pdf"; filename = "qual-hardware-caderno-tecnico-detalhado.pdf"; }
    else if (format === "technical-docx") { body = await technicalCadernoDocx(reportContext); contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; filename = "qual-hardware-caderno-tecnico-detalhado.docx"; }
    else if (format === "tr-json") { body = procurementAnnexJson(reportContext); contentType = "application/json; charset=utf-8"; filename = "qual-hardware-anexo-tecnico-neutro.json"; }
    else if (format === "tr-pdf") { body = await procurementAnnexPdf(reportContext); contentType = "application/pdf"; filename = "qual-hardware-anexo-tecnico-neutro.pdf"; }
    else if (format === "tr-docx") { body = await procurementAnnexDocx(reportContext); contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; filename = "qual-hardware-anexo-tecnico-neutro.docx"; }
    else return context.json({ error: "unsupported_export_format" }, 404);
    context.header("Content-Type", contentType);
    context.header("Content-Disposition", `attachment; filename="${filename}"`);
    context.header("Content-Length", String(body.byteLength));
    if (process.env.REPORT_STORAGE_DIR) {
      const reportDirectory = resolve(process.env.REPORT_STORAGE_DIR);
      await mkdir(reportDirectory, { recursive: true });
      await writeFile(resolve(reportDirectory, `${recommendation.id}-${filename}`), body);
    }
    return context.body(Uint8Array.from(body));
  });

  app.post("/api/internal/catalog/collect", async (context) => {
    const configured = process.env.ADMIN_TOKEN;
    if (!configured) return context.json({ error: "admin_operations_disabled" }, 503);
    if (!nonceMatches(configured, context.req.header("x-admin-token") ?? "")) return context.json({ error: "forbidden" }, 403);
    const jobId = await store.enqueue("collect_prices", { requestedAt: new Date().toISOString() });
    return context.json({ jobId, status: "queued" }, 202);
  });

  app.onError((error, context) => {
    if (error instanceof z.ZodError) return context.json({ error: "validation_error", issues: error.issues }, 422);
    if (error instanceof RevisionConflictError) return context.json({ error: "revision_conflict", currentRevision: error.currentRevision }, 409);
    if (error instanceof CapacityError) return context.json({ error: "capacity_error", message: error.message, details: error.details }, 422);
    if (error instanceof SyntaxError) return context.json({ error: "invalid_json" }, 400);
    const detail = safeError(error);
    if (/calibration_(?:package|collection).*(?:size|limit)_exceeded|payload_too_large/.test(detail)) {
      return context.json({ error: detail }, 413);
    }
    if (/^calibration_(?:package|collection|run|workload_profile|system_identity|device_identity)_/.test(detail)) {
      return context.json({ error: detail }, /conflict|key_changed/.test(detail) ? 409 : 422);
    }
    console.error(error);
    return context.json({ error: "internal_error", message: detail }, 500);
  });

  const webRoot = applicationResourcePath("dist", "web");
  app.use("/*", serveStatic({ root: webRoot }));
  app.get("/*", serveStatic({ root: webRoot, path: "index.html" }));
  return app;
}
