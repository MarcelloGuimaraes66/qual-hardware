const ERROR_MESSAGES: Record<string, string> = {
  calibration_perceptrum_build_not_supported: "O perfil de software desta carga não é compatível com a qualificação solicitada.",
  calibration_perceptrum_build_mismatch: "O perfil de software medido não corresponde ao perfil registrado no plano.",
  planning_only: "planejamento pendente de validação física",
  single_node_validated: "validado em servidor único",
  historical_template: "modelo histórico",
  reference_only: "somente referência",
  no_coverage: "sem cobertura",
  n_plus_one: "N+1",
  ten_percent_minimum_two: "10% de reserva, com mínimo de dois servidores",
  completed: "concluída sem erro de infraestrutura",
  completed_with_errors: "concluída com erros de infraestrutura",
  exact: "limite exato confirmado",
  at_least: "capacidade mínima comprovada",
  interval: "capacidade dentro de uma faixa",
  inconclusive: "inconclusivo",
  uncertain: "faixa incerta",
  measured: "medido",
  unavailable: "indisponível",
  legacy: "evidência histórica",
  missing: "ausente",
  passed: "aprovado",
  failed: "reprovado",
  compute: "processamento",
  media_only: "somente vídeo",
  display_only: "somente exibição",
  quick_is_not_commercial_evidence: "O diagnóstico rápido não constitui homologação comercial.",
  packaged_runtime_not_qualified: "O conjunto de componentes usado ainda não possui qualificação comercial.",
  authority_or_workload_profile_mismatch: "A assinatura da carga ou do ambiente não corresponde a uma evidência comercial aprovada.",
  three_repetitions_not_completed: "As três repetições exigidas para homologação não foram concluídas.",
  qualifying_measurements_incomplete: "As medições exigidas para homologação estão incompletas.",
  exact_camera_concurrency_not_executed: "A concorrência exata de câmeras não foi comprovada.",
  production_pipeline_incomplete: "A comprovação técnica completa da carga está incompleta.",
  cpu_memory_or_disk_guardrail_unavailable: "Faltou comprovar ao menos um limite de CPU, memória ou disco.",
  gpu_or_vram_guardrail_unavailable: "Faltou comprovar ao menos um limite de GPU ou memória de vídeo.",
  automatic_production_compute_plan_incomplete: "O plano automático de uso dos processadores está incompleto.",
  combined_cpu_gpu_load_incomplete: "A carga combinada de CPU e GPU não foi comprovada.",
  approved_thermal_guardrail_unavailable: "A sustentação térmica não foi comprovada.",
  physical_network_link_specification_unavailable: "A capacidade física do enlace de rede não foi comprovada.",
  repetition_capacity_variability_exceeded: "A variação entre repetições ficou acima do limite permitido.",
  eligible_gpu_load_coverage_incomplete: "Nem todas as GPUs elegíveis receberam carga e telemetria individual.",
  local_inference_represented_by_built_in_compute_proxy: "A inferência local foi estimada pelo benchmark interno.",
  exact_concurrent_camera_load_not_executed: "A concorrência exata de câmeras não foi executada.",
  blocked: "bloqueado",
  eligible: "apto",
  adequate: "adequada",
  limited: "limitada",
  restricted: "restrita",
  active: "ativo",
  reserve: "reserva",
  standby: "reserva",
  dedicated: "memória dedicada",
  unified: "memória unificada",
  shared: "memória compartilhada",
  workstation: "estação de trabalho",
  desktop: "computador de mesa",
  laptop: "notebook",
  mini_pc: "minicomputador",
  rack_server: "servidor em rack",
  server: "servidor",
  windows: "Windows",
  ubuntu: "Ubuntu",
  macos: "macOS",
  current: "geração atual",
  previous: "geração anterior",
  two_generations_back: "duas gerações anteriores",
  gpuVramGb: "memória de vídeo (VRAM)",
  cpuCores: "núcleos de CPU",
  ramGb: "memória RAM",
  localAiqSlots: "análises locais simultâneas",
  gpuDecode1080p30Streams: "decodificação de vídeo pela GPU",
  diskCapacityTb: "capacidade de armazenamento",
  diskWriteMbps: "gravação em disco",
  diskReadMbps: "leitura em disco",
  memoryBandwidthGbps: "largura de banda da memória",
  lanGbps: "rede local",
  internetUploadMbps: "envio pela internet",
  rtsp_ingest: "recepção RTSP",
  video_decode: "decodificação de vídeo",
  bgr_processing: "processamento de imagem",
  video_encode: "codificação de vídeo",
  disk_write: "gravação em disco",
  disk_read: "leitura em disco",
  frame_extraction: "extração de quadros",
  local_inference: "inferência local",
  memory_bandwidth: "largura de banda da memória",
  network_ingest: "recepção pela rede",
  job_scheduler: "agendamento de tarefas",
  intelligence_scheduler: "agendamento de análises",
  database_persistence: "persistência dos resultados",
  dashboard_queries: "consultas do painel",
  thermal_sustain: "sustentação térmica",
  procurement_neutral_specification_blocked: "A especificação técnica ainda não pode ser usada para aquisição.",
  planning_only_not_approved_for_hardware_acquisition: "A configuração serve para planejamento, mas ainda não está aprovada para aquisição.",
  multi_node_design_is_planning_only_until_cluster_validation: "O projeto com vários servidores exige validação física do conjunto.",
  physical_calibration_or_comparable_public_evidence_required: "É necessária calibração física ou evidência pública diretamente comparável.",
  reference_price_estimate_purchase_quote_required: "Os preços são estimativas; obtenha uma cotação itemizada antes da aquisição.",
};

export function visibleText(value: string): string {
  const known = ERROR_MESSAGES[value];
  if (known) return known;
  const neutral = value
    .replace(/evidence-level:generic_native/gi, "método: benchmark interno genérico")
    .replace(/component:qwen-vl-4b-mmproj:missing_or_incompatible/gi, "projetor visual do modelo AiQ Core Max ausente ou incompatível")
    .replace(/perceptrum-workload/gi, "qual-hardware-workload")
    .replace(/perceptrum[-_ ]build/gi, "perfil de software")
    .replace(/perceptrum[-_ ]gpu/gi, "aceleração por GPU")
    .replace(/perceptrum/gi, "pipeline local")
    .replace(/\bplanning only\b/gi, "planejamento pendente de validação física")
    .replace(/\breference only\b/gi, "somente referência")
    .replace(/\bhistorical template\b/gi, "modelo histórico")
    .replace(/\bMain camera group\b/gi, "Grupo principal de câmeras")
    .replace(/\bCamera profile (\d+)\b/gi, "Perfil de câmeras $1")
    .replace(/\bno coverage\b/gi, "sem cobertura")
    .replace(/\bn plus one\b/gi, "N+1")
    .replace(/\bprocurement neutral specification blocked\b/gi, "a especificação técnica ainda não pode ser usada para aquisição")
    .replace(/\bnot approved for hardware acquisition\b/gi, "não aprovada para aquisição")
    .replace(/\bblocked\b/gi, "bloqueado")
    .replace(/\bactive\b/gi, "ativo")
    .replace(/\breserve\b/gi, "reserva")
    .replace(/\bstandby\b/gi, "reserva");
  const stageTranslations: Array<[RegExp, string]> = [
    [/\brtsp ingest\b/gi, "recepção RTSP"],
    [/\bvideo decode\b/gi, "decodificação de vídeo"],
    [/\bbgr processing\b/gi, "processamento de imagem"],
    [/\bvideo encode\b/gi, "codificação de vídeo"],
    [/\bdisk write\b/gi, "gravação em disco"],
    [/\bdisk read\b/gi, "leitura em disco"],
    [/\bframe extraction\b/gi, "extração de quadros"],
    [/\blocal inference\b/gi, "inferência local"],
    [/\bmemory bandwidth\b/gi, "largura de banda da memória"],
    [/\bnetwork ingest\b/gi, "recepção pela rede"],
    [/\bjob scheduler\b/gi, "agendamento de tarefas"],
    [/\bintelligence scheduler\b/gi, "agendamento de análises"],
    [/\bdatabase persistence\b/gi, "persistência dos resultados"],
    [/\bdashboard queries\b/gi, "consultas do painel"],
    [/\bthermal sustain\b/gi, "sustentação térmica"],
  ];
  const translated = stageTranslations.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), neutral);
  const direct = ERROR_MESSAGES[translated] ?? ERROR_MESSAGES[translated.replaceAll(" ", "_")];
  return direct ?? translated;
}
