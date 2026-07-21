import type {
  ComponentSpecificationCompleteness,
  ComponentTechnicalSpecification,
  HardwareComponent,
  HardwareComponentKind,
  ManufacturerSpecificationObservation,
  TechnicalSpecificationField,
  TechnicalSpecificationRole,
  TechnicalSpecificationValueType,
} from "../shared/types.js";
import { COMPONENT_TECHNICAL_SPECIFICATION_VERSION } from "../shared/types.js";

interface FieldDefinition {
  code: string;
  labelPt: string;
  valueType: TechnicalSpecificationValueType;
  unit: string | null;
  required: boolean;
  roles: TechnicalSpecificationRole[];
  aliases: string[];
  compatibilityKey: keyof NonNullable<HardwareComponent["compatibility"]> | undefined;
}

const roles = (...values: TechnicalSpecificationRole[]): TechnicalSpecificationRole[] => values;
const field = (
  code: string,
  labelPt: string,
  valueType: TechnicalSpecificationValueType,
  unit: string | null,
  required: boolean,
  fieldRoles: TechnicalSpecificationRole[],
  aliases: string[] = [],
  compatibilityKey?: FieldDefinition["compatibilityKey"],
): FieldDefinition => ({ code, labelPt, valueType, unit, required, roles: fieldRoles, aliases: [code, ...aliases], compatibilityKey });

const commonLifecycle = [
  field("warranty_years", "Garantia do fabricante", "number", "anos", false, roles("procurement", "informational"), ["warrantyYears", "warranty"]),
];

const PROFILE_FIELDS: Partial<Record<HardwareComponentKind, FieldDefinition[]>> = {
  cpu: [
    field("architecture", "Arquitetura", "string", null, true, roles("compatibility", "procurement"), ["microarchitecture"]),
    field("physical_cores", "Núcleos físicos", "number", "núcleos", true, roles("dimensioning", "procurement"), ["physicalCores", "cores", "total cores"]),
    field("threads", "Threads", "number", "threads", true, roles("dimensioning", "procurement"), ["logicalCores", "threadCount"]),
    field("performance_cores", "Núcleos de desempenho (P-cores)", "number", "núcleos", false, roles("dimensioning", "procurement"), ["performance cores", "p-core count"]),
    field("efficient_cores", "Núcleos de eficiência (E-cores)", "number", "núcleos", false, roles("dimensioning", "procurement"), ["efficient cores", "e-core count"]),
    field("base_clock_ghz", "Frequência base", "number", "GHz", false, roles("dimensioning", "procurement"), ["baseClockGhz", "baseFrequencyGhz", "processor base frequency"]),
    field("max_clock_ghz", "Frequência turbo máxima", "number", "GHz", false, roles("dimensioning", "procurement"), ["maxClockGhz", "turboClockGhz", "max turbo frequency"]),
    field("performance_core_base_clock_ghz", "Frequência base dos P-cores", "number", "GHz", false, roles("dimensioning", "procurement"), ["performance-core base frequency", "p-core base frequency"]),
    field("performance_core_max_clock_ghz", "Frequência turbo dos P-cores", "number", "GHz", false, roles("dimensioning", "procurement"), ["performance-core max turbo frequency", "p-core max turbo frequency"]),
    field("efficient_core_base_clock_ghz", "Frequência base dos E-cores", "number", "GHz", false, roles("dimensioning", "procurement"), ["efficient-core base frequency", "e-core base frequency"]),
    field("efficient_core_max_clock_ghz", "Frequência turbo dos E-cores", "number", "GHz", false, roles("dimensioning", "procurement"), ["efficient-core max turbo frequency", "e-core max turbo frequency"]),
    field("l1_cache", "Cache L1", "string", null, false, roles("informational", "dimensioning"), ["l1 cache"]),
    field("l2_cache_mb", "Cache L2", "number", "MB", false, roles("dimensioning", "procurement"), ["total l2 cache", "l2 cache"]),
    field("l3_cache_mb", "Cache L3 compartilhado", "number", "MB", false, roles("dimensioning", "procurement"), ["cache", "intel smart cache", "l3 cache", "cacheMb", "l3CacheMb"]),
    field("base_power_watts", "Potência base", "number", "W", true, roles("compatibility", "procurement"), ["tdpWatts", "processorBasePowerWatts", "processor base power"]),
    field("turbo_power_watts", "Potência máxima em turbo", "number", "W", false, roles("compatibility", "procurement"), ["maximumTurboPowerWatts", "maximum turbo power"]),
    field("socket", "Soquete", "string", null, true, roles("compatibility", "procurement"), [], "socket"),
    field("process_nm", "Processo de fabricação", "number", "nm", false, roles("informational"), ["processNm", "lithographyNm", "lithography"]),
    field("package", "Encapsulamento", "string", null, false, roles("compatibility", "informational"), ["package specifications", "package"]),
    field("maximum_temperature_c", "Temperatura máxima de junção", "number", "°C", false, roles("compatibility", "procurement"), ["tjunctionC", "maximumTemperatureC", "tjunction"]),
    field("memory_type", "Tipo de memória suportado", "string", null, true, roles("compatibility", "procurement"), ["memory types"], "memoryType"),
    field("maximum_memory_speed", "Velocidade máxima oficial de memória", "string", null, false, roles("compatibility", "dimensioning", "procurement"), ["max memory speed"]),
    field("memory_channels", "Canais de memória", "number", "canais", true, roles("compatibility", "dimensioning"), ["max # of memory channels"], "memoryChannels"),
    field("maximum_memory_gb", "Memória máxima", "number", "GB", false, roles("compatibility", "procurement"), ["max memory size", "max memory size (dependent on memory type)"], "maximumMemoryGb"),
    field("ecc_support", "Suporte a ECC", "boolean", null, true, roles("compatibility", "procurement"), [], "ecc"),
    field("pcie_generation", "Geração PCI Express", "number", null, true, roles("compatibility", "procurement"), ["pci express revision"], "pcieGeneration"),
    field("pcie_lanes", "Pistas PCI Express", "number", "pistas", false, roles("compatibility", "procurement"), ["pcieLanes", "max # of pci express lanes"]),
    field("pcie_configurations", "Configurações PCI Express", "string", null, false, roles("compatibility", "procurement"), ["pci express configurations"]),
    field("dmi_lanes", "Interconexão com chipset", "string", null, false, roles("compatibility", "informational"), ["dmi revision", "dmi lanes"]),
    field("integrated_gpu", "GPU integrada", "string", null, false, roles("informational", "compatibility"), ["igpu"]),
    field("integrated_npu", "NPU integrada", "string", null, false, roles("informational", "compatibility"), ["npu"]),
    field("npu_tops", "Capacidade declarada da NPU", "number", "TOPS", false, roles("informational", "dimensioning"), ["npu peak tops", "intel ai boost npu"]),
    field("instruction_set_extensions", "Extensões do conjunto de instruções", "string", null, false, roles("compatibility", "informational", "procurement"), ["instruction set extensions"]),
    field("virtualization", "Tecnologias de virtualização", "string", null, false, roles("compatibility", "procurement"), ["virtualization technology"]),
    field("security_technologies", "Tecnologias de segurança", "string", null, false, roles("compatibility", "procurement"), ["security & reliability", "security technologies"]),
  ],
  gpu: [
    field("architecture", "Arquitetura", "string", null, true, roles("compatibility", "procurement"), ["gpuArchitecture"]),
    field("compute_units", "Unidades de processamento", "number", "unidades", false, roles("dimensioning", "procurement"), ["cudaCores", "streamProcessors", "executionUnits"]),
    field("vram_gb", "Memoria de video", "number", "GB", true, roles("dimensioning", "procurement"), ["vramGb", "memoryGb"]),
    field("memory_type", "Tipo de memoria de video", "string", null, true, roles("dimensioning", "procurement"), ["vramType"]),
    field("memory_bus_bits", "Barramento de memoria", "number", "bits", false, roles("dimensioning", "procurement"), ["memoryBusBits"]),
    field("memory_bandwidth_gbps", "Largura de banda da memória", "number", "GB/s", true, roles("dimensioning", "procurement"), ["memoryBandwidthGbps"]),
    field("boost_clock_ghz", "Frequência de aceleração", "number", "GHz", false, roles("dimensioning", "procurement"), ["boost clock"]),
    field("tensor_core_generation", "Geração dos núcleos tensoriais", "string", null, false, roles("dimensioning", "procurement"), ["tensor cores"]),
    field("tensor_performance_tops", "Desempenho de IA declarado", "number", "AI TOPS", false, roles("dimensioning", "informational"), ["ai tops"]),
    field("ray_tracing_core_generation", "Geração dos núcleos de ray tracing", "string", null, false, roles("informational"), ["ray tracing cores", "rt cores"]),
    field("pcie_generation", "Geracao PCI Express", "number", null, true, roles("compatibility", "procurement"), [], "pcieGeneration"),
    field("continuous_power_watts", "Potencia grafica", "number", "W", true, roles("compatibility", "procurement"), ["tbpWatts", "tdpWatts"], "continuousPowerWatts"),
    field("power_connectors", "Conectores de alimentacao", "string", null, true, roles("compatibility", "procurement"), ["powerConnectors"]),
    field("length_mm", "Comprimento", "number", "mm", true, roles("compatibility", "procurement"), [], "lengthMm"),
    field("slots_wide", "Espessura em slots", "number", "slots", true, roles("compatibility", "procurement"), [], "slotsWide"),
    field("dimensions_mm", "Dimensões físicas", "string", "mm", false, roles("compatibility", "procurement"), ["card dimensions"]),
    field("video_decode", "Codecs de decodificacao", "string", null, true, roles("compatibility", "dimensioning", "procurement"), ["decodeCodecs", "supportedCodecs"]),
    field("video_encode", "Codecs de codificacao", "string", null, true, roles("compatibility", "dimensioning", "procurement"), ["encodeCodecs"]),
    field("acceleration_backends", "Backends de aceleracao", "string", null, true, roles("compatibility", "procurement"), ["backends"], "accelerationBackends"),
    field("supported_operating_systems", "Sistemas operacionais suportados", "string", null, true, roles("compatibility", "procurement"), ["operatingSystems"], "operatingSystems"),
  ],
  motherboard: [
    field("socket", "Soquete", "string", null, true, roles("compatibility", "procurement"), [], "socket"),
    field("chipset", "Chipset", "string", null, true, roles("compatibility", "procurement"), ["chipsets"], "chipsets"),
    field("minimum_bios", "Versao minima de BIOS", "string", null, false, roles("compatibility", "procurement"), [], "minimumBios"),
    field("form_factor", "Formato", "string", null, true, roles("compatibility", "procurement"), ["formFactor"]),
    field("memory_type", "Tipo de memoria", "string", null, true, roles("compatibility", "procurement"), [], "memoryType"),
    field("memory_slots", "Slots de memoria", "number", "slots", true, roles("compatibility", "procurement"), ["memorySlots"]),
    field("maximum_memory_gb", "Memoria maxima", "number", "GB", true, roles("compatibility", "procurement"), [], "maximumMemoryGb"),
    field("ecc_support", "Suporte a ECC", "boolean", null, true, roles("compatibility", "procurement"), [], "ecc"),
    field("pcie_generation", "Geracao PCI Express", "number", null, true, roles("compatibility", "procurement"), [], "pcieGeneration"),
    field("pcie_slots", "Slots PCI Express", "string", null, true, roles("compatibility", "procurement"), ["pcieSlots"]),
    field("pcie_bifurcation", "Bifurcacao PCI Express", "string", null, false, roles("compatibility"), ["pcieBifurcation"]),
    field("m2_slots", "Slots M.2", "number", "slots", true, roles("compatibility", "procurement"), ["m2Slots"]),
    field("sata_ports", "Portas SATA", "number", "portas", false, roles("compatibility", "procurement"), ["sataPorts"]),
    field("network_interfaces", "Interfaces de rede integradas", "string", null, true, roles("compatibility", "procurement"), ["networkInterfaces"]),
    field("tpm", "Modulo de plataforma confiavel", "string", null, false, roles("procurement"), ["tpm"]),
  ],
  memory_kit: [
    field("capacity_gb", "Capacidade total", "number", "GB", true, roles("dimensioning", "procurement"), ["capacityGb"]),
    field("module_count", "Quantidade de modulos", "number", "modulos", true, roles("compatibility", "procurement"), ["modules"]),
    field("memory_type", "Tecnologia", "string", null, true, roles("compatibility", "procurement"), ["type"], "memoryType"),
    field("speed_mtps", "Taxa de transferencia", "number", "MT/s", true, roles("dimensioning", "procurement"), ["speedMtps"]),
    field("ecc", "Correcao de erros ECC", "boolean", null, true, roles("compatibility", "procurement"), [], "ecc"),
    field("module_format", "Formato do modulo", "string", null, true, roles("compatibility", "procurement"), ["dimmType"]),
    field("rank", "Organizacao de ranks", "string", null, false, roles("compatibility"), ["ranks"]),
    field("cas_latency", "Latencia CAS", "number", "ciclos", false, roles("dimensioning", "procurement"), ["casLatency"]),
    field("voltage", "Tensao", "number", "V", false, roles("compatibility", "procurement"), ["voltage"]),
  ],
  storage_os: [],
  storage_retention: [],
  nic: [
    field("link_speed_gbps", "Velocidade nominal", "number", "Gbps", true, roles("dimensioning", "procurement"), ["speedGbps"]),
    field("port_count", "Quantidade de portas", "number", "portas", true, roles("compatibility", "procurement"), ["ports"]),
    field("media", "Meio fisico", "string", null, true, roles("compatibility", "procurement"), ["mediaType"]),
    field("host_interface", "Interface com o sistema", "string", null, true, roles("compatibility", "procurement"), ["interface"]),
    field("rss", "Receive Side Scaling", "boolean", null, false, roles("dimensioning", "procurement"), ["rss"]),
    field("offloads", "Recursos de offload", "string", null, false, roles("dimensioning", "procurement"), ["offloads"]),
    field("maximum_mtu", "MTU maximo", "number", "bytes", false, roles("compatibility", "procurement"), ["maximumMtu"]),
    field("rdma", "Suporte a RDMA", "boolean", null, false, roles("compatibility", "procurement"), ["rdma"]),
    field("supported_operating_systems", "Sistemas operacionais suportados", "string", null, true, roles("compatibility", "procurement"), ["operatingSystems"], "operatingSystems"),
  ],
  psu: [
    field("continuous_power_watts", "Potencia continua", "number", "W", true, roles("compatibility", "procurement"), ["powerWatts"], "continuousPowerWatts"),
    field("efficiency_rating", "Certificacao de eficiencia", "string", null, true, roles("procurement"), ["efficiency"]),
    field("input_range", "Faixa de entrada", "string", null, false, roles("compatibility", "procurement"), ["inputVoltage"]),
    field("power_connectors", "Conectores fornecidos", "string", null, true, roles("compatibility", "procurement"), ["connectors"]),
    field("transient_power_watts", "Capacidade transitoria", "number", "W", false, roles("compatibility", "procurement"), [], "transientPowerWatts"),
    field("atx_version", "Versao da especificacao ATX", "string", null, false, roles("compatibility", "procurement"), ["atxVersion"]),
    field("protections", "Protecoes eletricas", "string", null, true, roles("procurement"), ["protections"]),
  ],
  cooling: [
    field("cooling_type", "Tipo de refrigeracao", "string", null, true, roles("compatibility", "procurement"), ["type"]),
    field("supported_sockets", "Soquetes suportados", "string", null, true, roles("compatibility", "procurement"), ["sockets"]),
    field("cooling_capacity_watts", "Capacidade termica declarada", "number", "W", true, roles("compatibility", "procurement"), ["tdpWatts"], "coolingCapacityWatts"),
    field("airflow_cfm", "Fluxo de ar", "number", "CFM", false, roles("dimensioning", "procurement"), ["airflowCfm"]),
    field("noise_dba", "Ruido maximo", "number", "dBA", false, roles("procurement"), ["noiseDba"]),
    field("dimensions_mm", "Dimensoes", "string", "mm", true, roles("compatibility", "procurement"), ["dimensions"]),
  ],
  chassis: [
    field("form_factor", "Formato do chassi", "string", null, true, roles("compatibility", "procurement"), ["formFactor"]),
    field("supported_motherboards", "Formatos de placa-mae", "string", null, true, roles("compatibility", "procurement"), ["motherboardSupport"]),
    field("maximum_gpu_length_mm", "Comprimento maximo de GPU", "number", "mm", true, roles("compatibility", "procurement"), ["maxGpuLengthMm"]),
    field("maximum_gpu_slots", "Espessura maxima de GPU", "number", "slots", true, roles("compatibility", "procurement"), ["maxGpuSlots"]),
    field("drive_bays", "Baias de armazenamento", "string", null, true, roles("compatibility", "procurement"), ["driveBays"]),
    field("expansion_slots", "Slots de expansao", "number", "slots", true, roles("compatibility", "procurement"), ["expansionSlots"]),
    field("fan_support", "Suporte a ventiladores", "string", null, true, roles("compatibility", "procurement"), ["fanSupport"]),
    field("radiator_support", "Suporte a radiadores", "string", null, false, roles("compatibility", "procurement"), ["radiatorSupport"]),
    field("dimensions_mm", "Dimensoes externas", "string", "mm", true, roles("compatibility", "procurement"), ["dimensions"]),
    field("rack_units", "Unidades de rack", "number", "U", false, roles("compatibility", "procurement"), ["rackUnits"]),
  ],
  oem_system: [
    field("exact_bom", "Configuracao exata de fabrica", "string", null, true, roles("compatibility", "procurement"), ["bom"]),
    field("expansion", "Capacidade de expansao", "string", null, true, roles("compatibility", "procurement"), ["expansion"]),
    field("redundancy", "Recursos de redundancia", "string", null, false, roles("procurement"), ["redundancy"]),
    field("remote_management", "Gerenciamento remoto", "string", null, false, roles("procurement"), ["management"]),
    field("hot_swap", "Componentes hot-swap", "string", null, false, roles("compatibility", "procurement"), ["hotSwap"]),
    field("maximum_power_watts", "Potencia maxima", "number", "W", true, roles("compatibility", "procurement"), ["powerWatts"]),
    field("dimensions_mm", "Dimensoes", "string", "mm", true, roles("compatibility", "procurement"), ["dimensions"]),
    field("support_years", "Suporte do fabricante", "number", "anos", true, roles("procurement", "informational"), ["supportYears"]),
    field("certifications", "Certificacoes", "string", null, false, roles("procurement"), ["certifications"]),
  ],
  rack_configuration: [
    field("rack_units", "Unidades de rack", "number", "U", true, roles("compatibility", "procurement"), ["rackUnits"]),
    field("node_count", "Quantidade de nos", "number", "nos", true, roles("dimensioning", "procurement"), ["nodeCount"]),
    field("power_redundancy", "Redundancia de energia", "string", null, true, roles("procurement"), ["powerRedundancy"]),
    field("network_redundancy", "Redundancia de rede", "string", null, true, roles("procurement"), ["networkRedundancy"]),
  ],
};

const storageFields: FieldDefinition[] = [
  field("capacity_gb", "Capacidade nominal", "number", "GB", true, roles("dimensioning", "procurement"), ["capacityGb"]),
  field("interface", "Interface", "string", null, true, roles("compatibility", "procurement"), ["hostInterface"]),
  field("protocol", "Protocolo", "string", null, true, roles("compatibility", "procurement"), ["protocol"]),
  field("form_factor", "Formato", "string", null, true, roles("compatibility", "procurement"), ["formFactor"]),
  field("sequential_read_mbps", "Leitura sequencial", "number", "MB/s", true, roles("dimensioning", "procurement"), ["readMbps", "sequentialReadMbps"]),
  field("sequential_write_mbps", "Escrita sequencial", "number", "MB/s", true, roles("dimensioning", "procurement"), ["writeMbps", "sequentialWriteMbps"]),
  field("random_read_iops", "Leitura aleatoria", "number", "IOPS", true, roles("dimensioning", "procurement"), ["randomReadIops"]),
  field("random_write_iops", "Escrita aleatoria", "number", "IOPS", true, roles("dimensioning", "procurement"), ["randomWriteIops"]),
  field("latency_us", "Latencia declarada", "number", "us", false, roles("dimensioning", "procurement"), ["latencyUs"]),
  field("endurance_tbw", "Endurance", "number", "TBW", true, roles("dimensioning", "procurement"), ["tbw"]),
  field("endurance_dwpd", "Gravacoes completas por dia", "number", "DWPD", false, roles("dimensioning", "procurement"), ["dwpd"]),
  field("power_loss_protection", "Protecao contra perda de energia", "boolean", null, false, roles("procurement"), ["plp"]),
  field("hardware_encryption", "Criptografia por hardware", "string", null, false, roles("procurement"), ["encryption"]),
];
PROFILE_FIELDS.storage_os = storageFields;
PROFILE_FIELDS.storage_retention = storageFields;
PROFILE_FIELDS.storage = storageFields;

function normalizedKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function scalar(value: unknown, type: TechnicalSpecificationValueType): string | number | boolean | null {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (type === "number") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const tokens = value.match(/[-+]?\d+(?:[.,]\d+)?/g) ?? [];
      if (tokens.length !== 1) return null;
      const token = tokens[0]!;
      const canonical = /^[-+]?\d{1,3},\d{3}$/.test(token) ? token.replace(",", "") : token.replace(",", ".");
      const parsed = Number(canonical);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && /^(true|yes|sim|1)$/i.test(value.trim())) return true;
    if (typeof value === "string" && /^(false|no|nao|não|0)$/i.test(value.trim())) return false;
    return null;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    return !normalized || /^(not[_ -]?published|unavailable|unknown|n\/?a|null)$/i.test(normalized) ? null : normalized;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function rawValue(component: HardwareComponent, definition: FieldDefinition): { label: string; value: unknown } | null {
  const candidates = new Set(definition.aliases.map(normalizedKey));
  for (const [label, value] of Object.entries(component.specifications)) {
    if (candidates.has(normalizedKey(label))) return { label, value };
  }
  if (definition.code === "architecture") return { label: "architecture", value: component.architecture };
  const compatibilityValue = definition.compatibilityKey ? component.compatibility?.[definition.compatibilityKey] : undefined;
  return compatibilityValue === undefined || compatibilityValue === null ? null : { label: String(definition.compatibilityKey), value: compatibilityValue };
}

function completeness(fields: TechnicalSpecificationField[]): ComponentSpecificationCompleteness {
  const required = fields.filter((item) => item.required);
  const published = required.filter((item) => item.status === "published" && item.confidence === "official");
  const missingRequiredFieldCodes = required.filter((item) => item.status !== "published" || item.confidence !== "official").map((item) => item.code);
  const conflictingFieldCodes = fields.filter((item) => item.status === "conflicting").map((item) => item.code);
  const percent = required.length ? Math.round((published.length / required.length) * 10_000) / 100 : 0;
  const complete = missingRequiredFieldCodes.length === 0 && conflictingFieldCodes.length === 0;
  const reasons = [
    ...(missingRequiredFieldCodes.length ? [`Campos oficiais obrigatorios ausentes: ${missingRequiredFieldCodes.join(", ")}.`] : []),
    ...(conflictingFieldCodes.length ? [`Campos oficiais conflitantes: ${conflictingFieldCodes.join(", ")}.`] : []),
  ];
  return {
    requiredFieldCount: required.length,
    publishedRequiredFieldCount: published.length,
    missingRequiredFieldCodes,
    conflictingFieldCodes,
    percent,
    complete,
    procurementReady: complete,
    reasons,
  };
}

const SECTION_LABELS: Record<string, string> = {
  identity: "Identificação e ciclo de vida",
  topology: "Topologia e frequências",
  cache: "Estrutura de memória cache",
  memory: "Memória e interconexão",
  io: "Controladores de I/O e expansão",
  acceleration: "Aceleradores e processamento",
  physical: "Construção, encapsulamento e dimensões",
  power_thermal: "Alimentação e limites térmicos",
  software_security: "Software, instruções e segurança",
  video: "Codificação e decodificação de vídeo",
  performance: "Características de desempenho publicadas",
  compatibility: "Compatibilidade",
  lifecycle: "Garantia e ciclo de vida",
  other: "Informações adicionais do fabricante",
};

function sectionCodeFor(kind: HardwareComponentKind, code: string): string {
  if (/warranty|launch|market|support_years|certification/.test(code)) return "lifecycle";
  if (/architecture|product|collection|code_name|processor_number|sku|mpn|exact_bom/.test(code)) return "identity";
  if (/core|thread|clock|frequency/.test(code)) return "topology";
  if (/cache/.test(code)) return "cache";
  if (/memory|ecc|rank|channel|dimm|voltage|latency_cas|bandwidth/.test(code)) return "memory";
  if (/pcie|lane|dmi|slot|m2|sata|interface|port|mtu|rdma|rss|offload/.test(code)) return "io";
  if (/gpu|npu|compute|tops|tensor|cuda|opencl|vulkan|directx|backend/.test(code)) return "acceleration";
  if (/decode|encode|codec|display|video/.test(code)) return "video";
  if (/power|temperature|thermal|cooling|airflow|noise|transient|efficiency/.test(code)) return "power_thermal";
  if (/dimension|length|height|width|slot|socket|process|lithography|package|form_factor|chassis|rack/.test(code)) return "physical";
  if (/instruction|virtual|security|encryption|tpm|operating_system|driver|firmware|bios/.test(code)) return "software_security";
  if (/read|write|iops|throughput|endurance|capacity|speed/.test(code)) return kind === "storage_os" || kind === "storage_retention" ? "performance" : "compatibility";
  return "other";
}

function sectionFor(kind: HardwareComponentKind, code: string): { code: string; labelPt: string } {
  const sectionCode = sectionCodeFor(kind, code);
  return { code: sectionCode, labelPt: SECTION_LABELS[sectionCode] ?? SECTION_LABELS.other! };
}

function evidenceForObservation(observation: ManufacturerSpecificationObservation) {
  return {
    sourceId: observation.sourceId,
    url: observation.sourceUrl,
    retrievedAt: observation.retrievedAt,
    evidenceLocator: observation.evidenceLocator,
    rawArtifactSha256: observation.rawArtifactSha256,
    licensePolicy: observation.licensePolicy,
  };
}

function observationRank(observation: ManufacturerSpecificationObservation): number {
  return observation.authority === "official_sku" ? 40
    : observation.authority === "official_family" ? 30
      : observation.authority === "official_matrix" ? 20 : 10;
}

function valueKey(observation: ManufacturerSpecificationObservation): string {
  return JSON.stringify([observation.normalizedValue, observation.normalizedUnit]);
}

function resolveObservations(observations: ManufacturerSpecificationObservation[], generatedAt: string): {
  status: "resolved" | "ambiguous" | "conflicting" | "rejected";
  selected: ManufacturerSpecificationObservation | null;
  rationale: string;
} {
  const latestBySource = new Map<string, ManufacturerSpecificationObservation>();
  for (const observation of observations) {
    const current = latestBySource.get(observation.sourceId);
    if (!current || Date.parse(observation.retrievedAt) > Date.parse(current.retrievedAt)) latestBySource.set(observation.sourceId, observation);
  }
  const candidates = [...latestBySource.values()].sort((left, right) => observationRank(right) - observationRank(left) || Date.parse(right.retrievedAt) - Date.parse(left.retrievedAt));
  const highestRank = candidates.length ? observationRank(candidates[0]!) : 0;
  const strongest = candidates.filter((candidate) => observationRank(candidate) === highestRank);
  if (!strongest.length) return { status: "rejected", selected: null, rationale: `Nenhuma observação utilizável em ${generatedAt}.` };
  const distinct = new Set(strongest.map(valueKey));
  if (distinct.size > 1) {
    return { status: "conflicting", selected: null, rationale: "Fontes de mesma autoridade apresentam valores incompatíveis; nenhuma foi escolhida silenciosamente." };
  }
  const selected = strongest[0]!;
  if (selected.authority === "secondary_reference") {
    return { status: "ambiguous", selected, rationale: "Valor secundário preservado somente como referência; não satisfaz requisito oficial." };
  }
  return {
    status: "resolved",
    selected,
    rationale: selected.authority === "official_sku"
      ? "Observação oficial do SKU exato selecionada."
      : `Observação ${selected.authority} herdada explicitamente para o componente.`,
  };
}

export function componentTechnicalSpecification(component: HardwareComponent, generatedAt = component.updatedAt ?? new Date().toISOString()): ComponentTechnicalSpecification {
  if (component.technicalSpecification?.schemaVersion === COMPONENT_TECHNICAL_SPECIFICATION_VERSION) return component.technicalSpecification;
  const definitions = [...(PROFILE_FIELDS[component.kind] ?? []), ...commonLifecycle.filter((candidate) => !(PROFILE_FIELDS[component.kind] ?? []).some((item) => item.code === candidate.code))];
  // Evidence attached only to the component cannot prove the origin of every
  // individual value. v9 promotes a value to official only through an
  // immutable ManufacturerSpecificationObservation for that field.
  const official = false;
  const usedRawKeys = new Set<string>();
  const fields: TechnicalSpecificationField[] = definitions.map((definition) => {
    const raw = rawValue(component, definition);
    if (raw) usedRawKeys.add(normalizedKey(raw.label));
    const value = raw ? scalar(raw.value, definition.valueType) : null;
    const hasValue = value !== null;
    const section = sectionFor(component.kind, definition.code);
    return {
      code: definition.code,
      labelPt: definition.labelPt,
      valueType: definition.valueType,
      value,
      unit: definition.unit,
      originalLabel: raw?.label ?? null,
      originalValue: raw ? scalar(raw.value, definition.valueType) : null,
      status: hasValue ? (official ? "published" : "ambiguous") : "not_published",
      required: definition.required,
      roles: definition.roles,
      sourceEvidence: official ? component.evidence ?? [] : [],
      confidence: official ? "official" : hasValue ? "derived_legacy" : "unverified",
      normalizationRule: raw ? `legacy-alias:${raw.label}->${definition.code}` : null,
      sectionCode: section.code,
      sectionLabelPt: section.labelPt,
      displayOrder: definitions.indexOf(definition),
      resolution: {
        status: hasValue ? "ambiguous" : "not_published",
        selectedObservationId: null,
        observationIds: [],
        rationale: hasValue ? "Valor legado sem evidência oficial no nível do campo." : "O fabricante não publicou este campo nas evidências disponíveis.",
        resolvedAt: generatedAt,
      },
    };
  });
  for (const [label, raw] of Object.entries(component.specifications)) {
    if (usedRawKeys.has(normalizedKey(label)) || raw === null) continue;
    const valueType: TechnicalSpecificationValueType = typeof raw === "number" ? "number" : typeof raw === "boolean" ? "boolean" : "string";
    const section = sectionFor(component.kind, `manufacturer_extension.${normalizedKey(label) || "field"}`);
    fields.push({
      code: `manufacturer_extension.${normalizedKey(label) || "field"}`,
      labelPt: label,
      valueType,
      value: scalar(raw, valueType),
      unit: null,
      originalLabel: label,
      originalValue: scalar(raw, valueType),
      status: official ? "published" : "ambiguous",
      required: false,
      roles: ["informational"],
      sourceEvidence: official ? component.evidence ?? [] : [],
      confidence: official ? "official" : "derived_legacy",
      normalizationRule: "manufacturer-extension-preserved",
      sectionCode: section.code,
      sectionLabelPt: section.labelPt,
      displayOrder: definitions.length + fields.length,
      resolution: {
        status: "ambiguous",
        selectedObservationId: null,
        observationIds: [],
        rationale: "Extensão legada preservada sem promoção a fato oficial.",
        resolvedAt: generatedAt,
      },
    });
  }
  return {
    schemaVersion: COMPONENT_TECHNICAL_SPECIFICATION_VERSION,
    componentId: component.id,
    specificationVersion: component.specificationVersion ?? "legacy-v1",
    generatedAt,
    fields,
    completeness: completeness(fields),
    observations: [],
  };
}

export function componentTechnicalSpecificationFromObservations(
  component: HardwareComponent,
  observations: ManufacturerSpecificationObservation[],
  generatedAt = new Date().toISOString(),
): ComponentTechnicalSpecification {
  const { technicalSpecification: _technicalSpecification, ...componentWithoutTechnicalSpecification } = component;
  const baseline = componentTechnicalSpecification(componentWithoutTechnicalSpecification, generatedAt);
  const relevant = observations.filter((observation) => observation.componentId === component.id);
  const byField = new Map<string, ManufacturerSpecificationObservation[]>();
  for (const observation of relevant) {
    const current = byField.get(observation.fieldCode) ?? [];
    current.push(observation);
    byField.set(observation.fieldCode, current);
  }
  const definitions = new Map(baseline.fields.map((field) => [field.code, field]));
  for (const observation of relevant) {
    if (definitions.has(observation.fieldCode)) continue;
    definitions.set(observation.fieldCode, {
      code: observation.fieldCode,
      labelPt: observation.originalLabel,
      valueType: observation.valueType,
      value: null,
      unit: observation.normalizedUnit,
      originalLabel: observation.originalLabel,
      originalValue: observation.originalValue,
      status: "not_published",
      required: false,
      roles: ["informational"],
      sourceEvidence: [],
      confidence: "unverified",
      normalizationRule: null,
      sectionCode: observation.sectionCode,
      sectionLabelPt: observation.sectionLabelPt,
      displayOrder: observation.displayOrder,
    });
  }
  const fields = [...definitions.values()].map((field): TechnicalSpecificationField => {
    const candidates = byField.get(field.code) ?? [];
    if (!candidates.length) return field;
    const resolved = resolveObservations(candidates, generatedAt);
    const selected = resolved.selected;
    const status = resolved.status === "resolved" ? "published" : resolved.status;
    const fallbackSection = sectionFor(component.kind, field.code);
    return {
      ...field,
      value: selected?.normalizedValue ?? null,
      unit: selected?.normalizedUnit ?? field.unit,
      originalLabel: selected?.originalLabel ?? field.originalLabel,
      originalValue: selected?.originalValue ?? null,
      status,
      sourceEvidence: candidates.map(evidenceForObservation),
      confidence: resolved.status === "resolved" ? "official" : "unverified",
      normalizationRule: selected ? `${selected.parserId}@${selected.parserVersion}` : null,
      sectionCode: selected?.sectionCode ?? field.sectionCode ?? fallbackSection.code,
      sectionLabelPt: selected?.sectionLabelPt ?? field.sectionLabelPt ?? fallbackSection.labelPt,
      displayOrder: selected?.displayOrder ?? field.displayOrder ?? 100_000,
      resolution: {
        status: resolved.status,
        selectedObservationId: selected?.id ?? null,
        observationIds: candidates.map((candidate) => candidate.id),
        rationale: resolved.rationale,
        resolvedAt: generatedAt,
      },
    };
  }).sort((left, right) => (left.displayOrder ?? 100_000) - (right.displayOrder ?? 100_000) || left.code.localeCompare(right.code));
  return {
    schemaVersion: COMPONENT_TECHNICAL_SPECIFICATION_VERSION,
    componentId: component.id,
    specificationVersion: `observed-${generatedAt}`,
    generatedAt,
    fields,
    completeness: completeness(fields),
    observations: relevant,
  };
}

export function withTechnicalSpecification(component: HardwareComponent, generatedAt?: string): HardwareComponent {
  return { ...component, technicalSpecification: componentTechnicalSpecification(component, generatedAt) };
}

export interface SpecificationCoverageSummary {
  schemaVersion: "qual-hardware-component-specification-coverage/1.0.0";
  generatedAt: string;
  componentCount: number;
  procurementReadyCount: number;
  averageCompletenessPercent: number;
  byKind: Array<{ kind: HardwareComponentKind; componentCount: number; procurementReadyCount: number; averageCompletenessPercent: number; missingFieldCodes: string[] }>;
}

export function specificationCoverage(components: HardwareComponent[], generatedAt = new Date().toISOString()): SpecificationCoverageSummary {
  const enriched = components.map((item) => withTechnicalSpecification(item, generatedAt));
  const kinds = [...new Set(enriched.map((item) => item.kind))].sort();
  const average = (items: HardwareComponent[]): number => items.length
    ? Math.round(items.reduce((sum, item) => sum + (item.technicalSpecification?.completeness.percent ?? 0), 0) / items.length * 100) / 100
    : 0;
  return {
    schemaVersion: "qual-hardware-component-specification-coverage/1.0.0",
    generatedAt,
    componentCount: enriched.length,
    procurementReadyCount: enriched.filter((item) => item.technicalSpecification?.completeness.procurementReady).length,
    averageCompletenessPercent: average(enriched),
    byKind: kinds.map((kind) => {
      const items = enriched.filter((item) => item.kind === kind);
      return {
        kind,
        componentCount: items.length,
        procurementReadyCount: items.filter((item) => item.technicalSpecification?.completeness.procurementReady).length,
        averageCompletenessPercent: average(items),
        missingFieldCodes: [...new Set(items.flatMap((item) => item.technicalSpecification?.completeness.missingRequiredFieldCodes ?? []))].sort(),
      };
    }),
  };
}

export function fieldDefinitionsForKind(kind: HardwareComponentKind): ReadonlyArray<Pick<FieldDefinition, "code" | "labelPt" | "valueType" | "unit" | "required" | "roles">> {
  return (PROFILE_FIELDS[kind] ?? []).map(({ code, labelPt, valueType, unit, required, roles: fieldRoles }) => ({ code, labelPt, valueType, unit, required, roles: fieldRoles }));
}
