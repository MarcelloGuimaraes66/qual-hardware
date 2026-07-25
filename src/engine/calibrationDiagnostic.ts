import {
  CALIBRATION_DIAGNOSTIC_REPORT_VERSION,
  type CalibrationCapacityBoundary,
  type CalibrationDiagnosticReportModel,
  type CalibrationPlan,
  type CalibrationStage,
  type CalibrationWorkloadProfile,
  type LocalCalibrationRun,
} from "../shared/types.js";
import { calibrationOperatorFinding } from "../server/calibrationOutcome.js";
import type { CalibrationKernelDiagnosticPayload } from "../server/calibrationKernelProtocol.js";

const STAGE_LABELS: Record<CalibrationStage, string> = {
  rtsp_ingest: "Recepção RTSP",
  video_decode: "Decodificação de vídeo",
  bgr_processing: "Conversão e processamento de imagem",
  video_encode: "Codificação de vídeo",
  disk_write: "Escrita em disco",
  disk_read: "Leitura em disco",
  frame_extraction: "Extração de frames",
  local_inference: "Inferência local",
  memory_bandwidth: "Memória",
  network_ingest: "Rede",
  job_scheduler: "Agendador de Jobs, Steps e Agents",
  intelligence_scheduler: "Agendador de inteligência",
  database_persistence: "Banco de dados",
  dashboard_queries: "Consultas e dashboard",
  thermal_sustain: "Sustentação térmica",
};

function compositionFor(
  profile: CalibrationWorkloadProfile | null,
  cameras: number,
): CalibrationCapacityBoundary["searchTrace"][number]["composition"] {
  if (!profile || cameras < 1) return [];
  const raw = profile.cameraGroups.map((group, groupIndex) => ({
    groupIndex,
    groupName: typeof group.name === "string" && group.name.trim()
      ? group.name.trim()
      : `Grupo de câmeras ${groupIndex + 1}`,
    exact: cameras * group.sharePpm / 1_000_000,
    cameras: Math.floor(cameras * group.sharePpm / 1_000_000),
    video: group.storage.storeVideo || group.agents.some((agent) => agent.inputType === "video"),
  }));
  let remaining = cameras - raw.reduce((sum, item) => sum + item.cameras, 0);
  for (const item of [...raw].sort((a, b) =>
    (b.exact - b.cameras) - (a.exact - a.cameras) || a.groupIndex - b.groupIndex)) {
    if (remaining-- <= 0) break;
    item.cameras += 1;
  }
  return raw.map((item) => ({
    groupIndex: item.groupIndex,
    groupName: item.groupName,
    cameras: item.cameras,
    videoCameras: item.video ? item.cameras : 0,
    frameCameras: item.video ? 0 : item.cameras,
  }));
}

function requestedOutcome(run: LocalCalibrationRun): CalibrationDiagnosticReportModel["requested"]["rawTrialOutcome"] {
  const boundary = run.capacityBoundary;
  if (!boundary) return "not_tested";
  return boundary.searchTrace.filter((item) =>
    item.cameraCount === boundary.seedCameraCount && item.outcome !== "infrastructure_error").at(-1)?.outcome ?? "not_tested";
}

function validity(run: LocalCalibrationRun): CalibrationDiagnosticReportModel["validity"] {
  if (run.mode === "qualification" && run.runtimeTrust?.commercialQualificationAllowed) return "commercial";
  if (run.mode === "validation") return "engineering";
  return "diagnostic";
}

function quantity(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function cpuDescription(sockets: number, physicalCores: number, logicalCores: number): string {
  return `${quantity(sockets, "processador físico", "processadores físicos")}, ${quantity(physicalCores, "núcleo", "núcleos")} e ${quantity(logicalCores, "thread", "threads")} por servidor`;
}

function componentNameForOperator(value: string): string {
  return value.replace(/perceptrum/gi, "pipeline local").trim();
}

function componentVersionForOperator(value: string | null): string | null {
  if (!value?.trim()) return null;
  if (/perceptrum/i.test(value)) return "autoteste aprovado";
  return value.replace(/\s+/g, " ").trim();
}

function componentForOperator(name: string, version: string | null): string {
  const visibleName = componentNameForOperator(name);
  const visibleVersion = componentVersionForOperator(version);
  return `${visibleName}${visibleVersion ? ` (${visibleVersion})` : ""}`;
}

function stageExplanationPt(stage: LocalCalibrationRun["stages"][number]): string {
  if (stage.evidenceStatus === "measured") return stage.reason ?? "Etapa medida durante a carga selecionada.";
  if (stage.stage === "rtsp_ingest") {
    return "A recepção local de vídeo foi exercitada, mas esta etapa não produziu evidência física suficiente para homologação.";
  }
  if (stage.stage === "network_ingest") {
    return "O tráfego local foi exercitado, mas a capacidade e o duplex do enlace físico externo não puderam ser comprovados nesta sessão.";
  }
  if (stage.stage === "thermal_sustain") {
    return "O sistema operacional não forneceu medição validada de temperatura e redução térmica para esta sessão.";
  }
  return stage.reason ?? "Etapa sem evidência física suficiente nesta execução.";
}

export function buildCalibrationDiagnosticReport(
  run: LocalCalibrationRun,
  profile: CalibrationWorkloadProfile | null,
): CalibrationDiagnosticReportModel {
  const boundary = run.capacityBoundary;
  const safe = run.capacityRecommendation?.safeCameraCount ?? run.overallSafeCameraCapacity;
  const seed = boundary?.seedCameraCount ?? profile?.cameraGroups.reduce((sum, group) =>
    sum + Math.round(group.sharePpm / 1_000_000), 0) ?? 0;
  const conclusion = run.executionHealth?.conclusion ??
    (run.executionHealth?.infrastructureErrors.length ? "inconclusive"
      : safe === null ? "inconclusive" : seed <= safe ? "approved" : "not_approved");
  const rawOutcome = requestedOutcome(run);
  const infrastructureCodes = run.executionHealth?.infrastructureErrors ?? [];
  const capacityCodes = boundary?.searchTrace
    .filter((item) => item.outcome === "capacity_fail")
    .flatMap((item) => item.failureCode ? [item.failureCode] : []) ?? [];
  const validationCodes = run.tierResults
    ?.filter((item) => item.passed === false)
    .flatMap((item) => item.failures ?? []) ?? [];
  const qualityCodes = run.qualityGate?.failures ?? [];
  const rawFindingCodes = [...new Set([
    ...infrastructureCodes,
    ...capacityCodes,
    ...validationCodes,
    ...qualityCodes,
  ])];
  const measuredMediaBoundary = rawFindingCodes.some((code) =>
    code.toLowerCase().includes("media_concurrency_capacity_exhausted"));
  const findingCodes = rawFindingCodes.filter((code) =>
    !(measuredMediaBoundary &&
      code.toLowerCase().includes("exact_concurrent_camera_load_not_executed")));
  const reportValidity = validity(run);
  const findings = findingCodes.map((code) => ({
    severity: infrastructureCodes.includes(code) ? "error" as const : "warning" as const,
    code,
    ...calibrationOperatorFinding(code),
  })).filter((finding, index, all) => all.findIndex((candidate) =>
    candidate.severity === finding.severity &&
    candidate.titlePt === finding.titlePt &&
    candidate.consequencePt === finding.consequencePt &&
    candidate.actionPt === finding.actionPt) === index)
    .map((finding) => reportValidity === "engineering" &&
      finding.titlePt === "Este resultado tem validade diagnóstica."
      ? { ...finding, titlePt: "Este resultado tem validade de engenharia." }
      : finding);
  const activeServers = safe && safe > 0 ? Math.ceil(seed / safe) : null;
  const reserveServers = activeServers === null ? null
    : activeServers <= 9 ? 1 : Math.max(2, Math.ceil(activeServers * 0.1));
  const bottleneckStage = run.bottleneck ?? run.limitingSubsystems?.[0] ?? null;
  const environmentEvidenceLevel = run.environmentProvenance?.evidenceLevel ??
    (run.capacityRecommendation?.basis === "generic_native_estimate" ? "generic_native" : "inventory_only");
  const measurementKind = environmentEvidenceLevel === "generic_native" ? "estimated" as const
    : environmentEvidenceLevel === "inventory_only" ? "inventory_only" as const : "real" as const;
  const methodLabelPt = environmentEvidenceLevel === "exact_perceptrum"
    ? "Pipeline local compatível executado em processo isolado"
    : environmentEvidenceLevel === "compatible_local_stack"
      ? run.rtspEvidence?.certificationLevel === "functional_simulator"
        ? "Stack local com recepção RTSP/TCP autenticada e decodificação real"
        : "Stack local compatível e submetida a autotestes"
      : environmentEvidenceLevel === "generic_native"
        ? "Benchmark nativo genérico incorporado ao Qual Hardware"
        : "Somente inventário do equipamento";
  const environmentComponents = run.environmentProvenance?.components ?? [];
  return {
    schemaVersion: CALIBRATION_DIAGNOSTIC_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    runId: run.id,
    title: "Relatório de diagnóstico do Qual Hardware",
    conclusion,
    validity: reportValidity,
    requested: {
      cameras: seed,
      rawTrialOutcome: rawOutcome,
      operationallyApproved: conclusion === "inconclusive" ? null : conclusion === "approved",
      composition: boundary?.searchTrace.find((item) => item.cameraCount === seed)?.composition ??
        compositionFor(profile, seed),
    },
    capacity: {
      safeCameras: safe,
      safeComposition: safe === null ? [] : compositionFor(profile, safe),
      highestPassingCameras: boundary?.highestPassingCameraCount ?? null,
      firstFailingCameras: boundary?.firstFailingCameraCount ?? null,
      maximumAttemptedCameras: boundary?.maximumAttemptedCameraCount ??
        run.capacityRecommendation?.maximumTestedCameraCount ?? run.maxTestedTier ?? seed,
      bound: boundary?.bound ?? "inconclusive",
      testedAboveRequested: (boundary?.maximumAttemptedCameraCount ?? seed) > seed,
    },
    hardware: {
      cpu: run.fingerprint.cpuModel,
      sockets: run.fingerprint.cpuPackages?.length ?? 1,
      physicalCores: run.fingerprint.physicalCores,
      logicalCores: run.fingerprint.logicalCores,
      ramBytes: run.fingerprint.ramBytes,
      gpus: (run.computeEvidence && "devices" in run.computeEvidence ? run.computeEvidence.devices : []).map((device) => ({
        id: device.deviceId,
        name: device.deviceName,
        classification: device.classification,
        vramBytes: device.peakVramBytes,
        receivedLoad: device.receivedLoad,
        telemetryMeasured: device.telemetryMeasured,
      })),
      storage: `${run.fingerprint.storageModel} · ${run.fingerprint.filesystem}`,
      networkLinks: run.physicalNetworkLinks ?? [],
      operatingSystem: `${run.fingerprint.operatingSystem} ${run.fingerprint.operatingSystemVersion}`,
    },
    bottleneck: {
      stage: bottleneckStage,
      labelPt: bottleneckStage ? STAGE_LABELS[bottleneckStage] : "Não determinado",
      explanationPt: bottleneckStage
        ? `Este foi o primeiro subsistema a limitar a carga ou a apresentar a menor margem mensurável.`
        : "A execução não produziu evidência suficiente para determinar um gargalo.",
    },
    searchTrace: boundary?.searchTrace ?? [],
    stages: run.stages.map((stage) => ({
      stage: stage.stage,
      labelPt: STAGE_LABELS[stage.stage],
      evidence: stage.evidenceStatus ?? "legacy",
      safeCameraCapacity: stage.safeCameraCapacity,
      utilizationPercent: stage.peakUtilizationPercent,
      explanationPt: stageExplanationPt(stage),
    })),
    fleetPlan: {
      status: safe && safe > 0
        ? (measurementKind === "real" && activeServers === 1 ? "measured" : "planning_only")
        : "blocked",
      projectCameras: seed,
      safeCamerasPerServer: safe,
      activeServers,
      reserveServers,
      totalServers: activeServers === null || reserveServers === null ? null : activeServers + reserveServers,
      cpuDescription: cpuDescription(run.fingerprint.cpuPackages?.length ?? 1, run.fingerprint.physicalCores, run.fingerprint.logicalCores),
      gpusPerServer: run.fingerprint.gpuDevices?.filter((gpu) => gpu.computeEligible || gpu.mediaEligible).length ??
        run.fingerprint.gpuCount,
      ramBytesPerServer: run.fingerprint.ramBytes,
      explanationPt: safe && safe > 0
        ? measurementKind === "estimated"
          ? "O número de servidores usa uma estimativa conservadora deste computador. Ele orienta planejamento, mas exige validação física antes da compra."
        : activeServers === 1
          ? "A configuração corresponde à máquina medida. A reserva indicada é operacional e não aumenta a capacidade homologada do nó."
          : "O número de servidores usa a capacidade segura medida por nó. Um projeto com vários nós permanece planejamento até um piloto de cluster comprovar rede, armazenamento, balanceamento e recuperação."
        : "Não é possível dimensionar servidores enquanto a capacidade desta máquina estiver inconclusiva.",
    },
    findings: findings.length > 0 ? findings : [{
      severity: "information",
      code: "no_blocking_finding",
      titlePt: "Nenhuma falha bloqueante foi registrada.",
      consequencePt: "O resultado pode ser interpretado dentro do nível de validade informado.",
      actionPt: "Use a capacidade segura, e não o maior valor bruto aprovado, para o planejamento.",
    }],
    methodology: [
      "A quantidade informada é uma semente: a busca aumenta ou reduz a carga automaticamente.",
      "Falhas de infraestrutura são repetidas uma vez e nunca são usadas como fronteira de capacidade.",
      "A capacidade segura aplica 20% de margem ao maior valor sustentável, respeita o menor limite medido entre os subsistemas e pode ser reduzida novamente quando o pico de 120% não passa.",
      "VÍDEO FULL e FRAME mantêm RTSP e decodificação de base; FRAME extrai uma imagem no intervalo do Agent e evita o clipe de vídeo quando não há gravação, por isso sua análise é significativamente mais leve.",
      "A conclusão vale somente para o perfil de codecs, resolução, FPS, taxa de bits, Agents, modelos, versão do aplicativo e ambiente registrados.",
      ...(run.rtspEvidence ? [
        `O ensaio RTSP abriu ${run.rtspEvidence.completedSessions} de ${run.rtspEvidence.plannedSessions} sessões planejadas, recebeu ${run.rtspEvidence.payloadMbps.toFixed(2)} Mbps no loopback e decodificou ${run.rtspEvidence.framesDecoded} de ${run.rtspEvidence.framesPlanned} frames planejados.`,
        `O pico de RAM acima da linha de base das fases RTSP foi ${
          run.rtspEvidence.peakMemoryDeltaBytes === null
            ? "indisponível"
            : `${(run.rtspEvidence.peakMemoryDeltaBytes / 1024 ** 2).toFixed(1)} MiB`
        }. Como o endereço é 127.0.0.1, o teste não mede placa, cabo, switch nem tráfego físico de rede.`,
      ] : []),
      measurementKind === "estimated"
        ? "O benchmark nativo é uma estimativa diagnóstica: ele orienta planejamento, mas não substitui a qualificação física completa da carga de produção."
        : "O método e todos os componentes efetivamente usados estão identificados na evidência técnica.",
    ],
    technicalEvidence: {
      workloadProfileId: run.workloadProfileId ?? null,
      workloadSignature: run.workloadProfileSignature ?? null,
      runtimeManifestHash: run.runtimeManifestHash ?? null,
      environmentSignature: run.environmentSignature ?? null,
      environmentEvidenceLevel,
      methodLabelPt,
      measurementKind,
      componentsFound: environmentComponents.filter((item) => item.status === "installed")
        .map((item) => componentForOperator(item.name, item.version)),
      componentsMissing: environmentComponents.filter((item) =>
        item.status === "missing" || item.status === "incompatible")
        .map((item) => `${componentNameForOperator(item.name)} — ${item.status === "missing" ? "ausente" : "incompatível"}`),
      authoritySnapshotHash: run.perceptrumAuthority?.behaviorSnapshotSha256 ?? null,
      externalRequestCount: 0,
    },
  };
}

export function buildFailedCalibrationDiagnosticReport(
  diagnostic: CalibrationKernelDiagnosticPayload,
  plan: CalibrationPlan,
): CalibrationDiagnosticReportModel {
  const seed = plan.discovery.seedCameraCount ?? plan.scenario.totalCameras;
  const fingerprint = diagnostic.fingerprint;
  const trialResults = diagnostic.tierResults.filter((item) => item.repetition === null);
  const searchTrace: CalibrationDiagnosticReportModel["searchTrace"] = trialResults.map((item, index) => ({
    cameraCount: item.tier,
    passed: item.outcome === "infrastructure_error" ? null : item.passed,
    outcome: item.outcome ?? (item.passed ? "pass" : "capacity_fail"),
    attempt: index + 1,
    phase: index === 0 ? "seed" : "expand",
    durationMs: Math.max(0, Date.parse(item.completedAt) - Date.parse(item.startedAt)),
    failureCode: item.failures[0] ?? null,
    retryOfAttempt: null,
    composition: item.composition ?? compositionFor(plan.workloadProfile, item.tier),
  }));
  const attemptedTier = diagnostic.lastProgress?.tier ?? seed;
  if (!searchTrace.some((item) => item.cameraCount === attemptedTier && item.failureCode === diagnostic.error)) {
    searchTrace.push({
      cameraCount: attemptedTier,
      passed: null,
      outcome: diagnostic.status === "cancelled" ? "cancelled" : "infrastructure_error",
      attempt: diagnostic.lastProgress?.attempt ?? searchTrace.length + 1,
      phase: searchTrace.length === 0 ? "seed" : "expand",
      durationMs: Math.max(0, Date.parse(diagnostic.completedAt) - Date.parse(diagnostic.createdAt)),
      failureCode: diagnostic.error,
      retryOfAttempt: null,
      composition: compositionFor(plan.workloadProfile, attemptedTier),
    });
  }
  const maximumAttempted = Math.max(seed, ...searchTrace.map((item) => item.cameraCount));
  const gpuDevices = fingerprint?.gpuDevices ?? [];
  const found = [
    diagnostic.runtimeSummary?.mediaAvailable ? "Processamento de vídeo" : null,
    diagnostic.runtimeSummary?.rtspAvailable ? "Gerador de câmeras" : null,
    diagnostic.runtimeSummary?.localInferenceAvailable ? "Análise local" : null,
  ].filter((item): item is string => item !== null);
  const missing = [
    diagnostic.runtimeSummary && !diagnostic.runtimeSummary.mediaAvailable ? "Processamento de vídeo" : null,
    diagnostic.runtimeSummary && !diagnostic.runtimeSummary.rtspAvailable ? "Gerador de câmeras" : null,
    diagnostic.runtimeSummary && !diagnostic.runtimeSummary.localInferenceAvailable ? "Análise local" : null,
  ].filter((item): item is string => item !== null);
  const finding = calibrationOperatorFinding(diagnostic.error);
  return {
    schemaVersion: CALIBRATION_DIAGNOSTIC_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    runId: diagnostic.runId,
    title: "Relatório de diagnóstico do Qual Hardware",
    conclusion: "inconclusive",
    validity: plan.mode === "validation" ? "engineering" : "diagnostic",
    requested: {
      cameras: seed,
      rawTrialOutcome: diagnostic.status === "cancelled" ? "cancelled" : "infrastructure_error",
      operationallyApproved: null,
      composition: compositionFor(plan.workloadProfile, seed),
    },
    capacity: {
      safeCameras: null,
      safeComposition: [],
      highestPassingCameras: null,
      firstFailingCameras: null,
      maximumAttemptedCameras: maximumAttempted,
      bound: "inconclusive",
      testedAboveRequested: maximumAttempted > seed,
    },
    hardware: {
      cpu: fingerprint?.cpuModel ?? "Não identificado antes da interrupção",
      sockets: fingerprint?.cpuPackages?.length ?? 0,
      physicalCores: fingerprint?.physicalCores ?? 0,
      logicalCores: fingerprint?.logicalCores ?? 0,
      ramBytes: fingerprint?.ramBytes ?? 0,
      gpus: gpuDevices.map((device) => ({
        id: device.id,
        name: device.name,
        classification: device.classification,
        vramBytes: device.vramBytes,
        receivedLoad: false,
        telemetryMeasured: false,
      })),
      storage: fingerprint ? `${fingerprint.storageModel} · ${fingerprint.filesystem}` : "Não medido",
      networkLinks: [],
      operatingSystem: fingerprint
        ? `${fingerprint.operatingSystem} ${fingerprint.operatingSystemVersion}`
        : "Não identificado antes da interrupção",
    },
    bottleneck: {
      stage: null,
      labelPt: "Não determinado",
      explanationPt: "A falha ocorreu antes de existir evidência válida para identificar o primeiro recurso limitante.",
    },
    searchTrace,
    stages: [],
    fleetPlan: {
      status: "blocked",
      projectCameras: seed,
      safeCamerasPerServer: null,
      activeServers: null,
      reserveServers: null,
      totalServers: null,
      cpuDescription: fingerprint
        ? cpuDescription(fingerprint.cpuPackages?.length ?? 1, fingerprint.physicalCores, fingerprint.logicalCores)
        : "Configuração não consolidada",
      gpusPerServer: gpuDevices.filter((device) => device.computeEligible || device.mediaEligible).length,
      ramBytesPerServer: fingerprint?.ramBytes ?? 0,
      explanationPt: "A execução ficou inconclusiva. Nenhuma quantidade de servidores deve ser derivada deste ensaio.",
    },
    findings: [{
      severity: diagnostic.status === "cancelled" ? "warning" : "error",
      code: diagnostic.error,
      ...finding,
    }],
    methodology: [
      "O ensaio foi encerrado antes de concluir a busca dinâmica de capacidade.",
      "Falhas de infraestrutura não são transformadas em limite de câmeras.",
      "Nenhuma capacidade segura, maior carga aprovada ou primeira carga reprovada foi inventada.",
      "A composição VÍDEO FULL e FRAME foi preservada para permitir uma nova execução comparável.",
    ],
    technicalEvidence: {
      workloadProfileId: diagnostic.workloadProfileId,
      workloadSignature: diagnostic.workloadProfileSignature,
      runtimeManifestHash: diagnostic.runtimeManifestHash,
      environmentSignature: null,
      environmentEvidenceLevel: "inventory_only",
      methodLabelPt: "Execução interrompida antes da consolidação das medições",
      measurementKind: "inventory_only",
      componentsFound: found.map((item) => componentNameForOperator(item)),
      componentsMissing: missing.map((item) => componentNameForOperator(item)),
      authoritySnapshotHash: null,
      externalRequestCount: 0,
    },
  };
}
