import type {
  ComponentSpecificationCompleteness,
  ComponentTechnicalSpecification,
  HardwareComponent,
  HardwareComponentKind,
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
    field("physical_cores", "Nucleos fisicos", "number", "nucleos", true, roles("dimensioning", "procurement"), ["physicalCores", "cores"]),
    field("threads", "Threads", "number", "threads", true, roles("dimensioning", "procurement"), ["logicalCores", "threadCount"]),
    field("base_clock_ghz", "Frequencia base", "number", "GHz", false, roles("dimensioning", "procurement"), ["baseClockGhz", "baseFrequencyGhz"]),
    field("max_clock_ghz", "Frequencia turbo maxima", "number", "GHz", false, roles("dimensioning", "procurement"), ["maxClockGhz", "turboClockGhz"]),
    field("cache_mb", "Cache total", "number", "MB", false, roles("dimensioning", "procurement"), ["cacheMb", "l3CacheMb"]),
    field("base_power_watts", "Potencia base", "number", "W", true, roles("compatibility", "procurement"), ["tdpWatts", "processorBasePowerWatts"]),
    field("turbo_power_watts", "Potencia maxima em turbo", "number", "W", false, roles("compatibility", "procurement"), ["maximumTurboPowerWatts"]),
    field("socket", "Soquete", "string", null, true, roles("compatibility", "procurement"), [], "socket"),
    field("process_nm", "Processo de fabricacao", "number", "nm", false, roles("informational"), ["processNm", "lithographyNm"]),
    field("maximum_temperature_c", "Temperatura maxima", "number", "C", false, roles("compatibility", "procurement"), ["tjunctionC", "maximumTemperatureC"]),
    field("memory_type", "Tipo de memoria suportado", "string", null, true, roles("compatibility", "procurement"), [], "memoryType"),
    field("memory_channels", "Canais de memoria", "number", "canais", true, roles("compatibility", "dimensioning"), [], "memoryChannels"),
    field("maximum_memory_gb", "Memoria maxima", "number", "GB", false, roles("compatibility", "procurement"), [], "maximumMemoryGb"),
    field("ecc_support", "Suporte a ECC", "boolean", null, true, roles("compatibility", "procurement"), [], "ecc"),
    field("pcie_generation", "Geracao PCI Express", "number", null, true, roles("compatibility", "procurement"), [], "pcieGeneration"),
    field("pcie_lanes", "Lanes PCI Express", "number", "lanes", false, roles("compatibility", "procurement"), ["pcieLanes"]),
    field("integrated_gpu", "GPU integrada", "string", null, false, roles("informational", "compatibility"), ["igpu"]),
    field("integrated_npu", "NPU integrada", "string", null, false, roles("informational", "compatibility"), ["npu"]),
  ],
  gpu: [
    field("architecture", "Arquitetura", "string", null, true, roles("compatibility", "procurement"), ["gpuArchitecture"]),
    field("compute_units", "Unidades de processamento", "number", "unidades", false, roles("dimensioning", "procurement"), ["cudaCores", "streamProcessors", "executionUnits"]),
    field("vram_gb", "Memoria de video", "number", "GB", true, roles("dimensioning", "procurement"), ["vramGb", "memoryGb"]),
    field("memory_type", "Tipo de memoria de video", "string", null, true, roles("dimensioning", "procurement"), ["vramType"]),
    field("memory_bus_bits", "Barramento de memoria", "number", "bits", false, roles("dimensioning", "procurement"), ["memoryBusBits"]),
    field("memory_bandwidth_gbps", "Largura de banda da memoria", "number", "GB/s", true, roles("dimensioning", "procurement"), ["memoryBandwidthGbps"]),
    field("pcie_generation", "Geracao PCI Express", "number", null, true, roles("compatibility", "procurement"), [], "pcieGeneration"),
    field("continuous_power_watts", "Potencia grafica", "number", "W", true, roles("compatibility", "procurement"), ["tbpWatts", "tdpWatts"], "continuousPowerWatts"),
    field("power_connectors", "Conectores de alimentacao", "string", null, true, roles("compatibility", "procurement"), ["powerConnectors"]),
    field("length_mm", "Comprimento", "number", "mm", true, roles("compatibility", "procurement"), [], "lengthMm"),
    field("slots_wide", "Espessura em slots", "number", "slots", true, roles("compatibility", "procurement"), [], "slotsWide"),
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

export function componentTechnicalSpecification(component: HardwareComponent, generatedAt = component.updatedAt ?? new Date().toISOString()): ComponentTechnicalSpecification {
  if (component.technicalSpecification?.schemaVersion === COMPONENT_TECHNICAL_SPECIFICATION_VERSION) return component.technicalSpecification;
  const definitions = [...(PROFILE_FIELDS[component.kind] ?? []), ...commonLifecycle.filter((candidate) => !(PROFILE_FIELDS[component.kind] ?? []).some((item) => item.code === candidate.code))];
  const official = Boolean(component.evidence?.length);
  const usedRawKeys = new Set<string>();
  const fields: TechnicalSpecificationField[] = definitions.map((definition) => {
    const raw = rawValue(component, definition);
    if (raw) usedRawKeys.add(normalizedKey(raw.label));
    const value = raw ? scalar(raw.value, definition.valueType) : null;
    const hasValue = value !== null;
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
    };
  });
  for (const [label, raw] of Object.entries(component.specifications)) {
    if (usedRawKeys.has(normalizedKey(label)) || raw === null) continue;
    const valueType: TechnicalSpecificationValueType = typeof raw === "number" ? "number" : typeof raw === "boolean" ? "boolean" : "string";
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
    });
  }
  return {
    schemaVersion: COMPONENT_TECHNICAL_SPECIFICATION_VERSION,
    componentId: component.id,
    specificationVersion: component.specificationVersion ?? "legacy-v1",
    generatedAt,
    fields,
    completeness: completeness(fields),
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
