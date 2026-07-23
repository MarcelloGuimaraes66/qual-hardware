import type { ReactElement } from "react";
import type { LocalCalibrationRun, TelemetryMetricSummary } from "../shared/types.js";

type Language = "pt" | "en";

const STAGE_LABELS: Record<string, { pt: string; en: string }> = {
  rtsp_ingest: { pt: "Recepção RTSP", en: "RTSP ingest" }, video_decode: { pt: "Decodificação", en: "Video decode" },
  bgr_processing: { pt: "Conversão BGR e movimento", en: "BGR and motion" }, video_encode: { pt: "Codificação e clipes", en: "Encoding and clips" },
  disk_write: { pt: "Escrita sustentada no SSD", en: "Sustained SSD write" }, disk_read: { pt: "Leitura sustentada no SSD", en: "Sustained SSD read" },
  frame_extraction: { pt: "Extração e mosaico de quadros", en: "Frame extraction and mosaic" }, local_inference: { pt: "Inferência AiQ/Qwen local", en: "Local AiQ/Qwen inference" },
  memory_bandwidth: { pt: "Largura de banda da memória", en: "Memory bandwidth" }, network_ingest: { pt: "Transporte de rede", en: "Network transport" },
  job_scheduler: { pt: "Jobs, Steps e Agents", en: "Jobs, Steps and Agents" }, intelligence_scheduler: { pt: "Scheduler de Intelligence", en: "Intelligence scheduler" },
  database_persistence: { pt: "Persistência e eventos", en: "Persistence and events" }, dashboard_queries: { pt: "Dashboard e consultas", en: "Dashboard and queries" },
  thermal_sustain: { pt: "Sustentação térmica", en: "Thermal sustain" },
};

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Não medido";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let number = value;
  let unit = 0;
  while (number >= 1024 && unit < units.length - 1) { number /= 1024; unit += 1; }
  return `${number.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
}

function formatMetric(metric: TelemetryMetricSummary | null | undefined, suffix = "%"): string {
  return metric ? `${metric.average.toFixed(1)}${suffix} média · ${metric.p95.toFixed(1)}${suffix} p95 · ${metric.peak.toFixed(1)}${suffix} pico` : "Não medido";
}

function formatByteMetric(metric: TelemetryMetricSummary | null | undefined): string {
  return metric ? `${formatBytes(metric.average)} média · ${formatBytes(metric.p95)} p95 · ${formatBytes(metric.peak)} pico` : "Não medido";
}

function validation(result: LocalCalibrationRun): "diagnostic" | "anchor_approved" | "invalid" {
  return result.qualityGate?.validationStatus ?? (result.qualityGate?.eligibleForCapacityExtrapolation ? "anchor_approved" : "diagnostic");
}

export function CalibrationResultPanel({
  result,
  directory,
  lang,
  onOpenDirectory,
  onRecalculate,
  onExport,
}: {
  result: LocalCalibrationRun;
  directory: string;
  lang: Language;
  onOpenDirectory: () => void;
  onRecalculate: () => void;
  onExport: () => void;
}): ReactElement {
  const status = validation(result);
  const separator = directory.includes("\\") ? "\\" : "/";
  const compactArtifactPath = result.artifact
    ? `${directory.replace(/[\\/]+$/, "")}${separator}${result.artifact.fileName}`
    : directory;
  const portableArtifactPath = `${directory.replace(/[\\/]+$/, "")}${separator}${result.id}.qhcal`;
  const readableSummaryPath = `${directory.replace(/[\\/]+$/, "")}${separator}${result.id}-resumo.txt`;
  const safeCapacity = result.overallSafeCameraCapacity === null
    ? (lang === "pt" ? "não validada" : "not validated")
    : Math.floor(result.overallSafeCameraCapacity);
  const verdict = status === "anchor_approved"
    ? (lang === "pt" ? `Esta calibração completa mediu o pipeline de produção e foi aprovada como âncora local. A capacidade segura observada foi de ${safeCapacity} câmeras, limitada primeiro por ${result.bottleneck}.` : `This full production-pipeline calibration is an approved local anchor with ${safeCapacity} safe cameras, first limited by ${result.bottleneck}.`)
    : status === "invalid"
      ? (lang === "pt" ? `O ensaio terminou, mas não pode justificar uma compra. As falhas abaixo precisam ser corrigidas antes de usar esta máquina como âncora.` : "The run finished but cannot support a purchase. Resolve the failures before using it as an anchor.")
      : result.capacityRecommendation?.safeCameraCount
        ? (lang === "pt"
          ? `A validação técnica terminou e recomenda com margem ${result.capacityRecommendation.safeCameraCount} câmeras para esta configuração. A confiança comercial do runtime é informada separadamente e não bloqueia a medição técnica.`
          : `Technical validation completed and conservatively recommends ${result.capacityRecommendation.safeCameraCount} cameras for this configuration. Runtime commercial trust is reported separately and does not block the technical measurement.`)
        : (lang === "pt" ? `Este resultado é diagnóstico. Ele mostra o comportamento real deste computador, mas ainda não produziu medições suficientes para recomendar uma capacidade.` : "This diagnostic describes the computer but did not yet produce enough evidence for a capacity recommendation.");
  const overall = result.resourceSummaries?.find((item) => item.phase === "sustained") ?? result.resourceSummaries?.at(-1);
  const cpuOverall = result.resourceSummaries?.find((item) => item.phase === "sustained" && item.computeMode === "cpu_only") ?? overall;
  const gpuOverall = result.resourceSummaries?.find((item) => item.phase === "sustained" && item.computeMode === "gpu_accelerated") ?? overall;
  const compute = result.computeEvidence;
  const computeDevices = compute && "devices" in compute ? compute.devices : [];
  const boundary = result.capacityBoundary;
  const resultKind = result.schemaVersion.endsWith("4.0.0") || result.schemaVersion.endsWith("3.0.0")
    ? (lang === "pt" ? "NÚCLEO AUTÔNOMO CPU + GPU" : "AUTONOMOUS CPU + GPU KERNEL")
    : result.schemaVersion.endsWith("2.0.0") ? "PIPELINE INTEGRAL"
      : result.schemaVersion.endsWith("1.1.0") ? "TELEMETRIA" : "LEGADO";

  return <section className="calibration-result" aria-labelledby="calibration-result-title">
    <div className="calibration-result-heading"><div><span>RESULTADO / {resultKind}</span><h3 id="calibration-result-title">{lang === "pt" ? "Resultado da calibração" : "Calibration result"}</h3></div><b className={`calibration-verdict ${status}`}>{status === "anchor_approved" ? (lang === "pt" ? "Âncora aprovada" : "Approved anchor") : status === "invalid" ? (lang === "pt" ? "Teste inválido" : "Invalid test") : (lang === "pt" ? "Diagnóstico" : "Diagnostic")}</b></div>
    <p className="calibration-natural-verdict">{verdict}</p>
    {result.executionHealth && <div className={`info-box ${result.executionHealth.status === "completed" ? "success" : "warning"}`}><b>{lang === "pt" ? "Saúde da execução" : "Execution health"}: {result.executionHealth.status}</b><span>{result.executionHealth.infrastructureErrors.length === 0 ? (lang === "pt" ? "Nenhum erro de infraestrutura foi registrado." : "No infrastructure error was recorded.") : result.executionHealth.infrastructureErrors.join(" · ")}</span></div>}
    <div className="calibration-result-grid">
      <div><span>{lang === "pt" ? "Capacidade segura" : "Safe capacity"}</span><b>{safeCapacity} {result.overallSafeCameraCapacity === null ? "" : lang === "pt" ? "câmeras" : "cameras"}</b><small>{lang === "pt" ? "margem conservadora aplicada" : "conservative reserve applied"}</small></div>
      <div><span>{lang === "pt" ? "Primeiro gargalo" : "First bottleneck"}</span><b>{result.bottleneck}</b><small>{result.mode === "qualification" || result.mode === "full" ? "6–7 h" : result.mode === "validation" ? "60 min" : "10 min"}</small></div>
      <div><span>FPS RTSP</span><b>{result.measuredSourceFps.toFixed(2)} / {result.requestedSourceFps}</b><small>{lang === "pt" ? "recebido / solicitado por câmera" : "received / requested per camera"}</small></div>
      <div><span>FPS AiQ</span><b>{result.effectiveInferenceFps.toFixed(2)} / {result.requestedInferenceFps}</b><small>{lang === "pt" ? "processado / solicitado ao modelo" : "processed / requested by model"}</small></div>
    </div>
    {boundary && <div className="calibration-result-grid capacity-boundary-grid">
      <div><span>{lang === "pt" ? "Carga informada (semente)" : "Entered load (seed)"}</span><b>{boundary.seedCameraCount} {lang === "pt" ? "câmeras" : "cameras"}</b><small>{lang === "pt" ? "ponto inicial, nunca o teto" : "starting point, never the ceiling"}</small></div>
      <div><span>{lang === "pt" ? "Maior carga aprovada" : "Highest passing load"}</span><b>{boundary.highestPassingCameraCount ?? "—"}</b><small>{lang === "pt" ? "limite bruto observado" : "observed raw boundary"}</small></div>
      <div><span>{lang === "pt" ? "Primeira carga reprovada" : "First failing load"}</span><b>{boundary.firstFailingCameraCount ?? "—"}</b><small>{boundary.adjacentBoundaryConfirmed ? (lang === "pt" ? "fronteira adjacente repetida" : "repeated adjacent boundary") : (lang === "pt" ? "fronteira ainda não adjacente" : "boundary not yet adjacent")}</small></div>
      <div><span>{lang === "pt" ? "Tipo de limite" : "Boundary type"}</span><b>{boundary.bound}</b><small>{boundary.bound === "at_least" ? (lang === "pt" ? `gerador chegou a ${boundary.generatorLimit}; não é máximo da máquina` : `generator reached ${boundary.generatorLimit}; not the machine maximum`) : boundary.nonMonotonic ? (lang === "pt" ? "resultado oscilante; exige repetição" : "unstable result; repetition required") : (lang === "pt" ? "classificação auditável" : "auditable classification")}</small></div>
    </div>}
    <div className="fps-explanation"><b>{lang === "pt" ? "Os FPS são duas cargas diferentes" : "FPS values are different workloads"}</b><span>{lang === "pt" ? "RTSP mede quadros recebidos e decodificados. AiQ mede somente os quadros extraídos e realmente apresentados ao Qwen local. Um valor não substitui o outro." : "RTSP measures received and decoded frames. AiQ measures only frames actually extracted and presented to local Qwen. One does not replace the other."}</span></div>
    <div className="calibration-hardware-grid">
      <div><span>CPU</span><b>{result.fingerprint.cpuModel}</b><small>{result.fingerprint.physicalCores}C / {result.fingerprint.logicalCores}T · {formatMetric(cpuOverall?.cpuUtilizationPercent)}</small></div>
      <div><span>GPU</span><b>{result.fingerprint.gpuModel}</b><small>{result.fingerprint.gpuCount} GPU · {formatBytes(result.fingerprint.gpuVramBytes ?? result.fingerprint.unifiedMemoryBytes)} · {formatMetric(gpuOverall?.gpuUtilizationPercent)}</small></div>
      <div><span>RAM</span><b>{formatBytes(result.fingerprint.ramBytes)}</b><small>{formatByteMetric(overall?.memoryUsedBytes)}</small></div>
      <div><span>SSD / SO</span><b>{result.fingerprint.storageModel}</b><small>{result.fingerprint.filesystem} · {result.fingerprint.operatingSystem} {result.fingerprint.operatingSystemVersion}</small></div>
    </div>
    {compute && <div className="calibration-compute-grid">
      <div><span>CPU ONLY</span><b className={`evidence-state ${compute.cpu.measured ? "measured" : "failed"}`}>{compute.cpu.measured ? (lang === "pt" ? "medida" : "measured") : (lang === "pt" ? "incompleta" : "incomplete")}</b><small>{compute.cpu.backend} · {compute.cpu.device}<br />{compute.cpu.safeCameraCapacity ?? "—"} {lang === "pt" ? "câmeras seguras" : "safe cameras"}</small></div>
      <div><span>GPU ACCELERATED</span><b className={`evidence-state ${compute.gpu.inferenceMeasured && compute.gpu.mediaMeasured ? "measured" : "failed"}`}>{compute.gpu.inferenceBackend} · {compute.gpu.mediaBackend}</b><small>{compute.gpu.deviceName ?? compute.gpu.deviceId ?? (lang === "pt" ? "dispositivo não comprovado" : "device not proven")}<br />{compute.gpu.safeCameraCapacity ?? "—"} {lang === "pt" ? "câmeras seguras" : "safe cameras"}{!compute.gpu.utilizationMeasured ? (lang === "pt" ? " · sensor de utilização indisponível" : " · utilization sensor unavailable") : ""}</small></div>
      <div><span>CPU + GPU</span><b className={`evidence-state ${compute.combined.measured ? "measured" : "failed"}`}>{compute.combined.measured ? (lang === "pt" ? "concorrência comprovada" : "concurrency proven") : (lang === "pt" ? "não comprovada" : "not proven")}</b><small>{compute.combined.safeCameraCapacity ?? "—"} {lang === "pt" ? "câmeras seguras" : "safe cameras"} · {compute.combined.measurementCount} {lang === "pt" ? "medições" : "measurements"}</small></div>
    </div>}
    {computeDevices.length > 0 && <details className="calibration-sensors" open><summary>{lang === "pt" ? "Carga e telemetria por GPU detectada" : "Load and telemetry for every detected GPU"}</summary>{computeDevices.map((device) => <div key={device.deviceId}><span className={`evidence-state ${device.receivedLoad && device.telemetryMeasured ? "measured" : "failed"}`}>{device.classification}</span><b>{device.deviceName}</b><small>{device.inferenceBackend} / {device.mediaBackend} · {device.requestCount} requests · {device.safeCameraCapacity ?? "—"} {lang === "pt" ? "câmeras seguras" : "safe cameras"} · {device.receivedLoad ? (lang === "pt" ? "carga recebida" : "load received") : (lang === "pt" ? "sem carga" : "no load")} · {device.telemetryMeasured ? (lang === "pt" ? "telemetria individual" : "individual telemetry") : (lang === "pt" ? "telemetria ausente" : "telemetry missing")}</small></div>)}</details>}
    {(result.fingerprint.cpuPackages?.length || result.fingerprint.processorGroups?.length || result.fingerprint.numaNodes?.length) ? <details className="calibration-sensors"><summary>{lang === "pt" ? "Topologia de CPU, grupos e NUMA" : "CPU, processor group, and NUMA topology"}</summary>
      <div><span>SOCKETS</span><b>{result.fingerprint.cpuPackages?.length ?? 1}</b><small>{result.fingerprint.cpuPackages?.map((item) => `${item.model}: ${item.physicalCores}C/${item.logicalCores}T`).join(" · ")}</small></div>
      <div><span>GROUPS</span><b>{result.fingerprint.processorGroups?.length ?? 1}</b><small>{result.fingerprint.processorGroups?.map((item) => `G${item.id}: ${item.logicalProcessorCount}T`).join(" · ")}</small></div>
      <div><span>NUMA</span><b>{result.fingerprint.numaNodes?.length ?? 1}</b><small>{result.fingerprint.numaNodes?.map((item) => `N${item.id}: ${item.logicalProcessorCount}T / ${formatBytes(item.memoryBytes)}`).join(" · ")}</small></div>
    </details> : null}
    {result.phases.length > 0 && <div className="calibration-phases"><h4>{lang === "pt" ? "Fases do teste" : "Test phases"}</h4>{result.phases.map((phase) => <div key={phase.name}><span>{phase.name}</span><div><i style={{ width: `${Math.min(100, phase.loadPercent / 1.2)}%` }} /></div><b>{phase.loadPercent}% · {(phase.inferenceSuccessRate * 100).toFixed(1)}% AiQ · {((phase.frameDeliveryRate ?? 0) * 100).toFixed(1)}% RTSP</b></div>)}</div>}
    <div className="calibration-table-wrap"><table className="calibration-stage-table"><thead><tr><th>{lang === "pt" ? "Etapa real" : "Real stage"}</th><th>{lang === "pt" ? "Evidência" : "Evidence"}</th><th>{lang === "pt" ? "Capacidade" : "Capacity"}</th><th>p95</th><th>{lang === "pt" ? "Utilização" : "Utilization"}</th></tr></thead><tbody>{result.stages.map((stage) => <tr key={stage.stage}><td><b>{STAGE_LABELS[stage.stage]?.[lang] ?? stage.stage}</b><small>{stage.stage}</small></td><td><span className={`evidence-state ${stage.evidenceStatus ?? "legacy"}`}>{stage.evidenceStatus ?? (lang === "pt" ? "não medido nesta versão" : "not measured in this version")}</span><small>{stage.reason ?? stage.measurementSource}</small></td><td>{stage.safeCameraCapacity === null ? "—" : `${stage.safeCameraCapacity.toFixed(1)} ${lang === "pt" ? "câmeras" : "cameras"}`}</td><td>{stage.p95LatencyMs === null ? "—" : `${stage.p95LatencyMs.toFixed(1)} ms`}</td><td>{stage.peakUtilizationPercent === null ? "—" : `${stage.peakUtilizationPercent.toFixed(1)}%`}</td></tr>)}</tbody></table></div>
    {result.pipelineEvidence && <details className="calibration-sensors" open><summary>{lang === "pt" ? "Comprovação do pipeline de produção" : "Production pipeline proof"}</summary>{[
      ["jobSchedulerExecuted", lang === "pt" ? "Scheduler de Jobs executado" : "Job scheduler executed"],
      ["jobRuntimeExecuted", lang === "pt" ? "Jobs, Steps e Agents executados" : "Jobs, Steps and Agents executed"],
      ["jobStepRunsPersisted", lang === "pt" ? "Execuções dos Steps persistidas" : "Step runs persisted"],
      ["databaseWritesPersisted", lang === "pt" ? "Eventos e gravações persistidos" : "Events and writes persisted"],
      ["intelligenceSchedulerExecuted", lang === "pt" ? "Intelligence real executado" : "Real Intelligence executed"],
      ["dashboardQueriesExecuted", lang === "pt" ? "Dashboard e consultas executados" : "Dashboard and queries executed"],
    ].map((item) => { const [key, label] = item as [string, string]; const measured = result.pipelineEvidence?.[key] === true; return <div key={key}><span className={`evidence-state ${measured ? "measured" : "failed"}`}>{measured ? "measured" : "missing"}</span><b>{label}</b><small>{measured ? (lang === "pt" ? "comprovado no resultado" : "proven in result") : (lang === "pt" ? "ausente; bloqueia compra" : "missing; blocks purchase")}</small></div>; })}</details>}
    {result.telemetryCapabilities && <details className="calibration-sensors"><summary>{lang === "pt" ? "Sensores e capacidades de telemetria" : "Telemetry sensors and capabilities"}</summary>{result.telemetryCapabilities.map((item) => <div key={item.id}><span className={`evidence-state ${item.status}`}>{item.status}</span><b>{item.id}</b><small>{item.provider}{item.reason ? ` · ${item.reason}` : ""}</small></div>)}</details>}
    {(result.qualityGate?.failures.length || result.qualityGate?.warnings.length) ? <div className="calibration-findings">{result.qualityGate?.failures.map((item) => <div className="failure" key={item}>✕ {item}</div>)}{result.qualityGate?.warnings.map((item) => <div className="warning" key={item}>△ {item}</div>)}</div> : null}
    <div className="calibration-artifact"><span>{lang === "pt" ? "Pacote portátil assinado criado automaticamente" : "Signed portable package created automatically"}</span><code>{portableArtifactPath}</code><small>{lang === "pt" ? "Resumo legível" : "Readable summary"}: {readableSummaryPath}<br />{lang === "pt" ? "Evidência compacta" : "Compact evidence"}: {compactArtifactPath} · SHA-256: {result.artifact?.payloadSha256 ?? "—"}</small></div>
    <div className="catalog-actions"><button className="primary" type="button" onClick={onOpenDirectory}>{lang === "pt" ? "Abrir pasta do resultado" : "Open result folder"}</button><button className="secondary" type="button" onClick={() => void navigator.clipboard.writeText(portableArtifactPath)}>{lang === "pt" ? "Copiar caminho" : "Copy path"}</button><button className="secondary" type="button" onClick={onExport}>{lang === "pt" ? "Baixar outra cópia .qhcal" : "Download another .qhcal copy"}</button><button className="secondary" type="button" onClick={onRecalculate}>{lang === "pt" ? "Recalcular recomendações" : "Recalculate recommendations"}</button></div>
    <details className="calibration-json"><summary>{lang === "pt" ? "Ver JSON completo" : "View complete JSON"}</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
  </section>;
}
