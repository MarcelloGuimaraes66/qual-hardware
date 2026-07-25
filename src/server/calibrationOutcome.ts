import type { CalibrationProbeOutcome } from "../shared/types.js";

const INFRASTRUCTURE_CODES = [
  "unavailable",
  "not_measured",
  "sensor_unavailable",
  "pipeline_incomplete",
  "exact_concurrent_camera_load_not_executed",
  "not_all_camera_runtime_contracts_exercised",
  "preflight",
  "runtime_",
  "manifest",
  "signature",
  "checksum",
  "invalid argument",
  "could not open encoder",
  "failed to initialize",
  "server_exit",
  "start_timeout",
  "response_payload",
  "external_network",
  "not_qualified",
];

const CAPACITY_CODES = [
  "below_99_5_percent",
  "latency_exceeded",
  "queue_growth",
  "out_of_memory",
  "oom",
  "utilization_exceeded",
  "thermal_throttling",
  "physical_network_capacity_below",
  "disk_reserve_violated",
  "timeout",
  "media_concurrency_capacity_exhausted",
];

export function isCalibrationInfrastructureFailure(code: string): boolean {
  const value = code.toLowerCase();
  if (value.includes("media_concurrency_capacity_exhausted")) return false;
  if (["server_start_timeout", "calibration_process_timeout", "process_failed", "process_exit", "runtime_unavailable",
    "qwen_unavailable", "manifest", "signature", "checksum", "preflight"].some((token) =>
    value.includes(token))) return true;
  if (CAPACITY_CODES.some((token) => value.includes(token))) return false;
  return INFRASTRUCTURE_CODES.some((token) => value.includes(token));
}

export function calibrationInfrastructureFailures(failures: string[]): string[] {
  const measuredMediaBoundary = failures.some((failure) =>
    failure.toLowerCase().includes("media_concurrency_capacity_exhausted"));
  return failures.filter((failure) => {
    if (measuredMediaBoundary &&
        failure.toLowerCase().includes("exact_concurrent_camera_load_not_executed")) return false;
    return isCalibrationInfrastructureFailure(failure);
  });
}

export function classifyCalibrationProbe(failures: string[]): CalibrationProbeOutcome {
  if (failures.length === 0) return "pass";
  return calibrationInfrastructureFailures(failures).length > 0 ? "infrastructure_error" : "capacity_fail";
}

export interface CalibrationOperatorFinding {
  titlePt: string;
  consequencePt: string;
  actionPt: string;
}

export function calibrationOperatorFinding(code: string): CalibrationOperatorFinding {
  const value = code.toLowerCase();
  if (value.includes("functional_rtsp_simulator_not_qualified") ||
      value.includes("external_rtsp_simulator")) {
    return {
      titlePt: "A recepção RTSP real não foi certificada.",
      consequencePt: "O teste interno ainda pode diagnosticar CPU, GPU e disco, mas não pode afirmar que a máquina suporta as sessões RTSP solicitadas nem liberar uma compra.",
      actionPt: "Inicie o Simulador de RTSP com admin/admin, confirme uma porta 554, 5541, 5542 ou seguinte e use um vídeo com codec, resolução, FPS e taxa de bits iguais ao cenário. Depois verifique o ambiente e repita o teste.",
    };
  }
  if (value.includes("calibration_worker_exit") || value.includes("calibration_worker_crash")) {
    return {
      titlePt: "O processo isolado de calibração foi encerrado inesperadamente.",
      consequencePt: "A execução ficou inconclusiva e esse encerramento não representa o limite de câmeras da máquina.",
      actionPt: "Reinicie o aplicativo e repita o ensaio. Se o encerramento voltar a ocorrer, use o relatório de diagnóstico para identificar a fase e a carga em que aconteceu.",
    };
  }
  if ([
    "_is_not_commercial_evidence",
    "packaged_runtime_not_qualified",
    "authority_or_workload_profile_mismatch",
    "three_repetitions_not_completed",
    "qualifying_measurements_incomplete",
    "exact_camera_concurrency_not_executed",
    "production_pipeline_incomplete",
    "automatic_production_compute_plan_incomplete",
    "combined_cpu_gpu_load_incomplete",
    "repetition_capacity_variability_exceeded",
    "isolated_gpu_scaling_evidence_incomplete",
    "eligible_gpu_load_coverage_incomplete",
  ].some((token) => value.includes(token))) {
    return {
      titlePt: "Este resultado tem validade diagnóstica.",
      consequencePt: "A capacidade estimada orienta planejamento, mas ainda não homologa a compra do equipamento.",
      actionPt: "Use o número como referência conservadora e conclua a validação física exigida antes de uma decisão de aquisição.",
    };
  }
  if (value.includes("approved_thermal_guardrail_unavailable")) {
    return {
      titlePt: "A sustentação térmica não pôde ser comprovada.",
      consequencePt: "O sensor aprovado de temperatura ou redução térmica não estava disponível. Isso não significa que a máquina tenha superaquecido.",
      actionPt: "Mantenha energia e ventilação adequadas e use uma validação com telemetria térmica compatível antes de homologar a compra.",
    };
  }
  if (value.includes("physical_network_link_specification_unavailable")) {
    return {
      titlePt: "A capacidade física da rede não foi comprovada.",
      consequencePt: "O tráfego local foi medido, mas o enlace externo não forneceu velocidade e duplex verificáveis. Isso não prova que a rede seja insuficiente.",
      actionPt: "Para homologação, conecte uma interface cabeada full-duplex e confirme margem mínima de 20% sobre a carga calculada.",
    };
  }
  if (value.includes("cpu_memory_or_disk_guardrail_unavailable") ||
      value.includes("gpu_or_vram_guardrail_unavailable") ||
      value.includes("loaded_gpu_individual_telemetry_incomplete") ||
      value.includes("telemetry") || value.includes("sensor")) {
    return {
      titlePt: "Parte da telemetria necessária à homologação ficou indisponível.",
      consequencePt: "O diagnóstico pode estimar capacidade, mas não comprova todos os sensores e limites individuais exigidos para compra.",
      actionPt: "Consulte os componentes marcados como não medidos e repita uma validação compatível antes de homologar a configuração.",
    };
  }
  if (value.includes("media_concurrency_capacity_exhausted")) {
    return {
      titlePt: "A carga simultânea de vídeo atingiu o limite medido.",
      consequencePt: "O pipeline de mídia não concluiu todos os fluxos simultâneos nesse nível de câmeras.",
      actionPt: "Use a capacidade segura indicada no relatório ou distribua a carga entre mais servidores.",
    };
  }
  if (value.includes("exact_concurrent_camera_load_not_executed") ||
      value.includes("exact_camera_concurrency_not_executed")) {
    return {
      titlePt: "A carga simultânea não pôde ser concluída nesse nível.",
      consequencePt: "Esse nível ficou acima da concorrência que o pipeline conseguiu comprovar durante o ensaio.",
      actionPt: "Use a capacidade segura indicada no relatório e consulte o gargalo registrado para essa tentativa.",
    };
  }
  if (value.includes("calibration_process_timeout")) {
    return {
      titlePt: "Um componente interno não terminou dentro do tempo de segurança.",
      consequencePt: "A execução foi interrompida como falha de infraestrutura. Esse evento não representa o limite de câmeras da máquina.",
      actionPt: "Feche programas que estejam consumindo muitos recursos e repita o diagnóstico. Se o problema continuar, consulte o nome do componente indicado nos detalhes técnicos.",
    };
  }
  if (value.includes("nvenc") || value.includes("encoder") || value.includes("gpu_media")) {
    return {
      titlePt: "O codificador de vídeo da GPU não conseguiu iniciar.",
      consequencePt: "A quantidade máxima de câmeras não pôde ser determinada com este caminho de mídia.",
      actionPt: "Verifique o driver da GPU. Se a aplicação validar o caminho por CPU, repita usando a alocação automática.",
    };
  }
  if (value.includes("qwen") || value.includes("llama") || value.includes("local_inference")) {
    return {
      titlePt: "O modelo local de análise não concluiu a validação.",
      consequencePt: "A capacidade de inferência local ficou inconclusiva e não pode justificar uma compra.",
      actionPt: "Confirme os modelos encontrados na verificação do ambiente, feche outros programas que usam a GPU e execute novamente o diagnóstico rápido.",
    };
  }
  if (value.includes("network")) {
    return {
      titlePt: "A rede não apresentou margem suficiente para a carga.",
      consequencePt: "Mesmo que CPU e GPU suportem a análise, o enlace pode perder ou atrasar streams.",
      actionPt: "Use uma conexão cabeada full-duplex com capacidade superior à carga indicada no relatório.",
    };
  }
  if (value.includes("queue") || value.includes("latency") || value.includes("below_99_5")) {
    return {
      titlePt: "A carga ultrapassou a capacidade operacional observada.",
      consequencePt: "Filas, perdas ou atrasos aumentaram além do limite aceito.",
      actionPt: "Use a capacidade segura indicada ou uma configuração com mais recursos.",
    };
  }
  if (value.includes("thermal") || value.includes("throttl")) {
    return {
      titlePt: "A máquina reduziu desempenho por temperatura.",
      consequencePt: "A carga não pode ser considerada sustentável de forma contínua.",
      actionPt: "Melhore refrigeração, energia e ventilação antes de repetir o ensaio.",
    };
  }
  return {
    titlePt: "O ensaio encontrou uma condição que exige revisão.",
    consequencePt: "O resultado não deve ser usado isoladamente para decidir uma compra.",
    actionPt: "Consulte a evidência técnica recolhida e repita o diagnóstico após corrigir a causa informada.",
  };
}
