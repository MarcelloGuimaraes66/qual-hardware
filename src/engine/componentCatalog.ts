import { createHash } from "node:crypto";
import type {
  ComponentBuild,
  ComponentBuildItem,
  HardwareComponent,
  HardwareComponentKind,
  HardwareNodeTemplate,
  LocalCalibrationRun,
  PublicBenchmarkObservation,
} from "../shared/types.js";
import { COMPONENT_BUILD_VERSION } from "../shared/types.js";
import { buildEvidenceCoverage, buildProcurementGate } from "./evidence.js";

function slug(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function canonicalComponentId(kind: HardwareComponentKind, manufacturer: string, mpn: string): string {
  return `${kind}:${slug(manufacturer)}:${slug(mpn)}`;
}

function manufacturerFor(template: HardwareNodeTemplate): string {
  if (/^apple\b/i.test(template.name)) return "Apple";
  if (/^asus\b|\brog\b/i.test(template.name)) return "ASUS";
  if (/^dell\b/i.test(template.name)) return "Dell";
  if (/^hp\b|^hpe\b/i.test(template.name)) return "HPE";
  if (/^lenovo\b/i.test(template.name)) return "Lenovo";
  if (/^acer\b/i.test(template.name)) return "Acer";
  if (/^msi\b/i.test(template.name)) return "MSI";
  if (/^gigabyte\b|^aorus\b/i.test(template.name)) return "Gigabyte";
  if (/^supermicro\b/i.test(template.name)) return "Supermicro";
  return "Reference Design";
}

function component(
  kind: HardwareComponentKind,
  manufacturer: string,
  mpn: string,
  architecture: string,
  specifications: HardwareComponent["specifications"],
  template: HardwareNodeTemplate,
  compatibility: HardwareComponent["compatibility"] = {},
): HardwareComponent {
  const sourceUrls = [...new Set(template.sources.map((source) => source.url))];
  return {
    id: canonicalComponentId(kind, manufacturer, mpn),
    kind,
    manufacturer,
    sku: mpn,
    canonicalMpn: mpn,
    aliases: [mpn],
    architecture,
    generation: template.generation,
    marketState: "reference_only",
    inventoryState: "discovered_inventory",
    specificationVersion: "historical-template-v1",
    specifications,
    compatibility,
    sourceUrls,
  };
}

export interface CatalogDerivation {
  components: HardwareComponent[];
  buildItemsByHardware: Map<string, ComponentBuildItem[]>;
}

/**
 * Converts every historical system into a complete, queryable component set.
 * Derived entries remain discovered/reference-only until exact official
 * specifications and benchmark evidence qualify them.
 */
export function deriveComponentCatalog(hardware: HardwareNodeTemplate[]): CatalogDerivation {
  const components = new Map<string, HardwareComponent>();
  const buildItemsByHardware = new Map<string, ComponentBuildItem[]>();
  for (const template of hardware) {
    const oem = manufacturerFor(template);
    const operatingSystems = [template.operatingSystemFamily];
    const accelerationBackends = template.gpuVendor === "nvidia" ? ["cuda"]
      : template.gpuVendor === "apple" ? ["metal"]
        : template.gpuVendor === "intel" ? ["onevpl", "openvino"] : ["amf", "rocm"];
    const definitions: Array<{ value: HardwareComponent; role: ComponentBuildItem["role"] }> = [
      { value: component("cpu", template.cpuVendor, template.cpuModel, template.cpuArchitecture ?? "undisclosed", {
        physicalCores: template.physicalCores, sustainedComputeFactor: template.sustainedComputeFactor ?? null,
      }, template, { operatingSystems }), role: "compute" },
      { value: component("gpu", template.gpuVendor, template.gpuModel, template.gpuArchitecture ?? "undisclosed", {
        count: template.gpuCount, vramGbTotal: template.gpuVramGbTotal, decode1080p30Streams: template.gpuDecode1080p30Streams,
      }, template, { supportedCodecs: ["h264", "h265"], operatingSystems, accelerationBackends }), role: "acceleration" },
      { value: component("motherboard", oem, template.motherboard, "platform", {
        description: template.motherboard, ecc: template.ecc,
      }, template, { ecc: template.ecc, operatingSystems, oemLocked: oem !== "Reference Design" }), role: "platform" },
      { value: component("memory_kit", oem, `${template.id}-${template.ramGb}gb-memory`, template.memoryArchitecture, {
        capacityGb: template.ramGb, ecc: template.ecc, architecture: template.memoryArchitecture,
      }, template, { ecc: template.ecc, operatingSystems }), role: "memory" },
      { value: component("storage_os", oem, template.storageModel, "nvme", {
        usableStorageTb: template.usableStorageTb, sustainedWriteMbps: template.diskWriteMbps,
      }, template, { operatingSystems }), role: "operating_storage" },
      { value: component("storage_retention", oem, `${template.storageModel}-retention`, "nvme-or-array", {
        usableStorageTb: template.usableStorageTb, sustainedWriteMbps: template.diskWriteMbps,
      }, template, { operatingSystems }), role: "retention_storage" },
      { value: component("nic", oem, `${template.id}-${template.nicGbps}gbe`, "ethernet", {
        sustainedLinkGbps: template.nicGbps,
      }, template, { operatingSystems }), role: "network" },
      { value: component("psu", oem, template.powerSupply, "power", { description: template.powerSupply }, template, {
        operatingSystems,
      }), role: "power" },
      { value: component("cooling", oem, template.cooling, "thermal", {
        description: template.cooling, thermalClass: template.thermalClass ?? null,
      }, template, { operatingSystems }), role: "cooling" },
      { value: component("chassis", oem, template.chassis, template.thermalClass ?? "system", {
        description: template.chassis, formFactor: template.kind,
      }, template, { operatingSystems, oemLocked: oem !== "Reference Design" }), role: "chassis" },
      { value: component(template.kind === "rack" ? "rack_configuration" : "oem_system", oem, template.id, template.chassis, {
        name: template.name, operatingSystem: template.operatingSystemFamily, expansionScore: template.expansionScore,
      }, template, { operatingSystems, oemLocked: oem !== "Reference Design" }), role: "oem_system" },
    ];
    const items: ComponentBuildItem[] = [];
    for (const definition of definitions) {
      const existing = components.get(definition.value.id);
      if (!existing || existing.sourceUrls.length < definition.value.sourceUrls.length) components.set(definition.value.id, definition.value);
      items.push({ componentId: definition.value.id, kind: definition.value.kind, quantity: definition.value.kind === "gpu" ? Math.max(1, template.gpuCount) : 1, role: definition.role, required: true });
    }
    buildItemsByHardware.set(template.id, items);
  }
  return { components: [...components.values()].sort((left, right) => left.id.localeCompare(right.id)), buildItemsByHardware };
}

function buildId(template: HardwareNodeTemplate, items: ComponentBuildItem[]): string {
  const digest = createHash("sha256").update(JSON.stringify(items)).digest("hex").slice(0, 16);
  return `build:${template.id}:${digest}`;
}

export function buildHistoricalComponentBuilds(
  hardware: HardwareNodeTemplate[],
  components: HardwareComponent[],
  observations: PublicBenchmarkObservation[],
  runs: LocalCalibrationRun[],
): ComponentBuild[] {
  const derived = deriveComponentCatalog(hardware);
  const byId = new Map(components.map((item) => [item.id, item]));
  for (const item of derived.components) if (!byId.has(item.id)) byId.set(item.id, item);
  return hardware.map((template) => {
    const items = derived.buildItemsByHardware.get(template.id) ?? [];
    const buildComponents = items.map((item) => byId.get(item.componentId)).filter((item): item is HardwareComponent => Boolean(item));
    const coverage = buildEvidenceCoverage({ hardwareTemplateId: template.id, components: buildComponents, observations, calibrationRuns: runs });
    const sourceUrls = [...new Set(buildComponents.flatMap((item) => item.sourceUrls))];
    return {
      schemaVersion: COMPONENT_BUILD_VERSION,
      id: buildId(template, items),
      kind: template.name.startsWith("Apple") || template.name.startsWith("ASUS") ? "oem_exact" : "historical_template",
      name: template.name,
      hardwareTemplateId: template.id,
      operatingSystem: template.operatingSystemFamily,
      items,
      compatibility: [{
        compatible: true,
        code: "historical_template_preserved",
        message: "A composição histórica foi preservada; especificações e evidências ainda precisam qualificar cada item para aquisição.",
        componentIds: items.map((item) => item.componentId),
        sourceUrls,
      }],
      coverage,
      procurementGate: buildProcurementGate(coverage, "reference_only"),
      sourceUrls,
      createdAt: new Date(0).toISOString(),
    } satisfies ComponentBuild;
  });
}

export function validateBuildCompatibility(build: ComponentBuild, components: HardwareComponent[]): ComponentBuild {
  const byId = new Map(components.map((component) => [component.id, component]));
  const decisions = [...build.compatibility];
  const componentForRole = (role: ComponentBuildItem["role"]): HardwareComponent | null => {
    const item = build.items.find((candidate) => candidate.role === role);
    return item ? byId.get(item.componentId) ?? null : null;
  };
  const reject = (code: string, message: string, involved: Array<HardwareComponent | null>) => {
    const known = involved.filter((item): item is HardwareComponent => Boolean(item));
    decisions.push({
      compatible: false,
      code,
      message,
      componentIds: known.map((item) => item.id),
      sourceUrls: [...new Set(known.flatMap((item) => item.sourceUrls))],
    });
  };
  const numberValue = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
  const missing = build.items.filter((item) => !byId.has(item.componentId));
  if (missing.length) decisions.push({ compatible: false, code: "missing_component", message: "A BOM referencia componentes ausentes.", componentIds: missing.map((item) => item.componentId), sourceUrls: [] });
  const operatingSystemMismatch = build.items.map((item) => byId.get(item.componentId)).filter((item): item is HardwareComponent => Boolean(item))
    .filter((component) => component.compatibility?.operatingSystems?.length && !component.compatibility.operatingSystems.includes(build.operatingSystem));
  if (operatingSystemMismatch.length) decisions.push({
    compatible: false, code: "operating_system_incompatible", message: `Componentes não suportam ${build.operatingSystem}.`,
    componentIds: operatingSystemMismatch.map((item) => item.id), sourceUrls: operatingSystemMismatch.flatMap((item) => item.sourceUrls),
  });
  const hasRequiredKinds = new Set(build.items.filter((item) => item.required).map((item) => item.role));
  const requiredRoles: ComponentBuildItem["role"][] = ["compute", "acceleration", "platform", "memory", "operating_storage", "retention_storage", "network", "power", "cooling", "chassis"];
  const absentRoles = requiredRoles.filter((role) => !hasRequiredKinds.has(role));
  if (absentRoles.length) decisions.push({ compatible: false, code: "incomplete_bom", message: `BOM incompleta: ${absentRoles.join(", ")}.`, componentIds: [], sourceUrls: [] });

  const cpu = componentForRole("compute");
  const gpu = componentForRole("acceleration");
  const motherboard = componentForRole("platform");
  const memory = componentForRole("memory");
  const operatingStorage = componentForRole("operating_storage");
  const retentionStorage = componentForRole("retention_storage");
  const nic = componentForRole("network");
  const psu = componentForRole("power");
  const cooling = componentForRole("cooling");
  const chassis = componentForRole("chassis");

  if (cpu && motherboard) {
    const cpuSocket = cpu.compatibility?.socket;
    const motherboardSocket = motherboard.compatibility?.socket;
    if (!cpuSocket || !motherboardSocket) reject("socket_evidence_missing", "Socket da CPU e da plataforma precisa de especificação oficial exata.", [cpu, motherboard]);
    else if (cpuSocket !== motherboardSocket) reject("socket_incompatible", `Socket ${cpuSocket} da CPU não corresponde a ${motherboardSocket} da plataforma.`, [cpu, motherboard]);
  }
  if (memory && motherboard) {
    const memoryType = memory.compatibility?.memoryType;
    const boardMemoryType = motherboard.compatibility?.memoryType;
    const capacityGb = numberValue(memory.specifications.capacityGb);
    const maximumGb = motherboard.compatibility?.maximumMemoryGb ?? null;
    if (!memoryType || !boardMemoryType || capacityGb === null || maximumGb === null) {
      reject("memory_compatibility_evidence_missing", "Tipo, capacidade máxima, canais e ECC da memória precisam estar comprovados.", [memory, motherboard]);
    } else {
      if (memoryType !== boardMemoryType) reject("memory_type_incompatible", `${memoryType} não corresponde a ${boardMemoryType}.`, [memory, motherboard]);
      if (capacityGb > maximumGb) reject("memory_capacity_exceeded", `${capacityGb} GB excedem o limite de ${maximumGb} GB da plataforma.`, [memory, motherboard]);
      if (memory.compatibility?.ecc === true && motherboard.compatibility?.ecc !== true) reject("ecc_incompatible", "O kit ECC exige plataforma com suporte ECC comprovado.", [memory, motherboard]);
    }
  }
  if (gpu && motherboard) {
    const gpuQuantity = build.items.find((item) => item.role === "acceleration")?.quantity ?? 1;
    const lanesRequired = gpu.compatibility?.pcieLanesRequired;
    const lanesAvailable = numberValue(motherboard.specifications.pcieLanesAvailable);
    if (lanesRequired === null || lanesRequired === undefined || lanesAvailable === null || gpu.compatibility?.pcieGeneration == null || motherboard.compatibility?.pcieGeneration == null) {
      reject("pcie_evidence_missing", "Geração, lanes, slots e dimensões PCIe precisam estar comprovados para todas as GPUs.", [gpu, motherboard]);
    } else if (lanesRequired * gpuQuantity > lanesAvailable) {
      reject("pcie_lanes_exceeded", `${gpuQuantity} GPU(s) exigem ${lanesRequired * gpuQuantity} lanes e a plataforma declara ${lanesAvailable}.`, [gpu, motherboard]);
    }
    const codecs = new Set(gpu.compatibility?.supportedCodecs ?? []);
    if (!codecs.has("h264") || !codecs.has("h265")) reject("codec_support_incomplete", "A GPU precisa comprovar decode/encode H.264 e H.265 no backend selecionado.", [gpu]);
  }
  if (cpu && gpu && psu) {
    const cpuPower = cpu.compatibility?.continuousPowerWatts;
    const gpuPower = gpu.compatibility?.continuousPowerWatts;
    const supplyPower = psu.compatibility?.continuousPowerWatts;
    const gpuQuantity = build.items.find((item) => item.role === "acceleration")?.quantity ?? 1;
    if (cpuPower == null || gpuPower == null || supplyPower == null) {
      reject("power_evidence_missing", "Potência contínua e transitória da CPU, GPU e fonte precisam estar comprovadas.", [cpu, gpu, psu]);
    } else {
      const required = (cpuPower + gpuPower * gpuQuantity) * 1.25;
      if (supplyPower < required) reject("power_reserve_insufficient", `A fonte entrega ${supplyPower} W e a reserva mínima calculada exige ${Math.ceil(required)} W.`, [cpu, gpu, psu]);
    }
  }
  if (cpu && gpu && cooling) {
    const cpuPower = cpu.compatibility?.continuousPowerWatts;
    const gpuPower = gpu.compatibility?.continuousPowerWatts;
    const coolingWatts = cooling.compatibility?.coolingCapacityWatts;
    if (cpuPower == null || gpuPower == null || coolingWatts == null) reject("thermal_capacity_evidence_missing", "Capacidade térmica sustentada do conjunto completo precisa estar comprovada.", [cpu, gpu, cooling]);
  }
  if (gpu && chassis) {
    if (gpu.compatibility?.lengthMm == null || gpu.compatibility?.slotsWide == null ||
        numberValue(chassis.specifications.maximumGpuLengthMm) === null || numberValue(chassis.specifications.maximumGpuSlotsWide) === null) {
      reject("chassis_fit_evidence_missing", "Comprimento, altura e largura da GPU precisam ser compatíveis com o chassi.", [gpu, chassis]);
    }
  }
  for (const storage of [operatingStorage, retentionStorage]) {
    if (!storage) continue;
    if (numberValue(storage.specifications.sustainedWriteMbps) === null || numberValue(storage.specifications.enduranceTbw) === null) {
      reject("storage_endurance_evidence_missing", "SSD precisa declarar gravação sustentada, latência/IOPS e endurance para o papel atribuído.", [storage]);
    }
  }
  if (nic && numberValue(nic.specifications.sustainedLinkGbps) === null) {
    reject("nic_capacity_evidence_missing", "A NIC precisa declarar capacidade sustentada e suporte do sistema operacional.", [nic]);
  }
  const compatible = decisions.every((decision) => decision.compatible);
  return {
    ...build,
    compatibility: decisions,
    procurementGate: compatible ? build.procurementGate : {
      ...build.procurementGate,
      eligibility: "blocked",
      status: "blocked",
      reasons: [...build.procurementGate.reasons, ...decisions.filter((decision) => !decision.compatible).map((decision) => decision.message)],
    },
  };
}
