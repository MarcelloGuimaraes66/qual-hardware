import { randomUUID } from "node:crypto";
import { HARDWARE_CATALOG_VERSION } from "./catalog.js";
import { REFERENCE_FX_FROM_USD, referenceCostProfile } from "./referenceCosts.js";
import type {
  AgentLoad,
  CapacityRecommendation,
  CapacityScenario,
  EffectiveAgentLoad,
  HardwareNodeTemplate,
  NodeAllocation,
  OperatingSystemFamily,
  PriceQuote,
  PriceSummary,
  RecommendationAlternative,
  RecommendationPolicy,
  RecommendationVariant,
  ResourceDemand,
} from "../shared/types.js";
import { WORKLOAD_CONTRACT_VERSION } from "../shared/types.js";

const RESOURCE_KEYS: Array<keyof ResourceDemand> = [
  "cpuCores",
  "ramGb",
  "gpuVramGb",
  "localAiqSlots",
  "gpuDecode1080p30Streams",
  "diskCapacityTb",
  "diskWriteMbps",
  "lanGbps",
  "internetUploadMbps",
  "processThreads",
  "ffmpegProcessesPerSecond",
  "inferenceRequestsPerSecond",
];

// Disk telemetry remains in exports for benchmark observability, but storage capacity and
// throughput do not determine node count, hardware selection, headroom or bottlenecks.
const SIZING_RESOURCE_KEYS = RESOURCE_KEYS.filter((key) =>
  key !== "diskCapacityTb" && key !== "diskWriteMbps",
);

const POLICY_HEADROOM: Record<RecommendationPolicy, number> = {
  minimum: 15,
  recommended: 30,
  n_plus_one: 30,
};

export class CapacityError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message);
    this.name = "CapacityError";
  }
}

export function emptyDemand(): ResourceDemand {
  return {
    cpuCores: 0,
    ramGb: 0,
    gpuVramGb: 0,
    localAiqSlots: 0,
    gpuDecode1080p30Streams: 0,
    diskCapacityTb: 0,
    diskWriteMbps: 0,
    lanGbps: 0,
    internetUploadMbps: 0,
    processThreads: 0,
    ffmpegProcessesPerSecond: 0,
    inferenceRequestsPerSecond: 0,
  };
}

function addDemand(left: ResourceDemand, right: ResourceDemand): ResourceDemand {
  const result = emptyDemand();
  for (const key of RESOURCE_KEYS) result[key] = left[key] + right[key];
  return result;
}

function scaleDemand(demand: ResourceDemand, scale: number): ResourceDemand {
  const result = emptyDemand();
  for (const key of RESOURCE_KEYS) result[key] = demand[key] * scale;
  return result;
}

export function normalizeAgent(agent: AgentLoad): EffectiveAgentLoad {
  const normalized: EffectiveAgentLoad = { ...agent, features: { ...agent.features }, normalizedFields: [] };
  if (agent.packaging === "mosaic_3x3") {
    normalized.packaging = "mosaic_2x2";
    normalized.normalizedFields.push("packaging:mosaic_3x3→mosaic_2x2");
  }
  if (agent.model === "aiq-3.7" || agent.model === "aiq-3.7-max") {
    if (normalized.inputType !== "video") normalized.normalizedFields.push("inputType:image→video");
    if (normalized.runEverySeconds !== 10) normalized.normalizedFields.push(`runEverySeconds:${normalized.runEverySeconds}→10`);
    normalized.inputType = "video";
    normalized.runEverySeconds = 10;
  }
  if (agent.model === "opencv-portal-counter") {
    normalized.inputType = "video";
    normalized.packaging = "frame_sequence";
    normalized.modelFps = 1;
    normalized.runEverySeconds = 60;
    normalized.features.onlyCaptureOnMotion = false;
    normalized.normalizedFields.push("portal-counter-effective-contract");
  }
  return normalized;
}

interface GroupDemand {
  groupId: string;
  groupName: string;
  count: number;
  perCamera: ResourceDemand;
  warnings: string[];
}

function calculateCameraGroupDemand(group: CapacityScenario["cameraGroups"][number]): GroupDemand {
  const sourceMegapixels = (group.source.width * group.source.height) / 1_000_000;
  const normalized1080p = sourceMegapixels / 2.0736;
  const codecFactor = group.source.codec === "h265" ? 1.35 : 1;
  const motionFraction = Math.max(0, Math.min(1, group.motionPercent / 100));
  const outputWidth = Math.min(group.source.width, 1920);
  const outputHeight = Math.min(group.source.height, 1080);
  const bgrFrameGb = (outputWidth * outputHeight * 3) / 1024 ** 3;
  const bufferFrames = group.source.sourceFps * 2;
  const demand = emptyDemand();
  const warnings: string[] = [];

  demand.processThreads = 4;
  demand.ramGb = 0.12 + bgrFrameGb * bufferFrames + 4 / 1024;
  demand.lanGbps = (group.source.bitrateMbps * 1.2) / 1000;

  const decode1080p30 = normalized1080p * (group.source.sourceFps / 30) * codecFactor;
  if (group.decodeMode === "gpu") {
    demand.gpuDecode1080p30Streams = decode1080p30;
    demand.gpuVramGb += 0.3 * Math.max(1, decode1080p30);
    demand.cpuCores += 0.12 * decode1080p30;
  } else {
    demand.cpuCores += 0.48 * decode1080p30;
  }

  let activeCaptureFps = 0.1;
  let hasCore = false;
  let hasCoreMax = false;
  for (const rawAgent of group.agents) {
    const agent = normalizeAgent(rawAgent);
    warnings.push(...agent.normalizedFields.map((field) => `${group.name}/${agent.name}: ${field}`));
    const activity = agent.features.onlyCaptureOnMotion ? motionFraction : 1;
    const windowSeconds = agent.runEverySeconds <= 10 ? 10 : 60;
    const frames = agent.inputType === "image" ? 1 : Math.min(300, windowSeconds * agent.modelFps);
    const requestsPerSecond = activity / agent.runEverySeconds;
    const frameRateForRequest = frames * requestsPerSecond;
    const packagingFactor = agent.packaging === "mosaic_2x2" ? 0.7 : 1;
    const cropFactor = agent.features.croppedFrame ? 1.12 : 1;
    const regionFactor = 1 + Math.min(0.25, agent.features.regions * 0.02);
    const referenceFactor = 1 + (agent.features.faceReferences + agent.features.negativeReferences) * 0.015;
    const temporalFactor = agent.features.temporal ? 1.08 : 1;

    demand.inferenceRequestsPerSecond += requestsPerSecond;
    if (agent.inputType === "video") {
      activeCaptureFps = Math.max(activeCaptureFps, agent.modelFps);
      demand.ffmpegProcessesPerSecond += frameRateForRequest;
      demand.cpuCores +=
        frameRateForRequest * 0.055 * normalized1080p * codecFactor * packagingFactor * cropFactor * regionFactor;
      demand.ramGb += Math.min(2.5, frames * 0.00022 * normalized1080p * 1.34 * referenceFactor);
    } else {
      demand.cpuCores += requestsPerSecond * 0.08 * normalized1080p;
      demand.ramGb += 0.02 * referenceFactor;
    }

    if (agent.model === "aiq-3.7" || agent.model === "aiq-3.7-max") {
      const isMax = agent.model === "aiq-3.7-max";
      const serviceSeconds =
        (isMax ? 4 : 2.5) + frames * (agent.packaging === "mosaic_2x2" ? (isMax ? 0.055 : 0.035) : (isMax ? 0.12 : 0.075));
      const slots = requestsPerSecond * serviceSeconds * temporalFactor * referenceFactor;
      demand.localAiqSlots += slots;
      demand.gpuVramGb += slots * 5.12;
      demand.cpuCores += requestsPerSecond * 0.35 * packagingFactor;
      hasCore ||= !isMax;
      hasCoreMax ||= isMax;
    } else if (agent.model === "opencv-portal-counter") {
      demand.cpuCores += 0.75 * normalized1080p;
      demand.ramGb += 0.35;
    } else {
      const averageJpegMb = 0.16 * normalized1080p * packagingFactor;
      demand.internetUploadMbps += frameRateForRequest * averageJpegMb * 1.34 * 8;
    }
  }

  if (hasCore) demand.gpuVramGb += 0.512 / Math.max(1, group.count);
  if (hasCoreMax) demand.gpuVramGb += 0.512 / Math.max(1, group.count);

  const sampled1080p30 = normalized1080p * (activeCaptureFps / 30);
  demand.cpuCores += sampled1080p30 * 0.28;
  // Perceptrum inference media is temporary and alert media is sparse. Legacy storage
  // fields are intentionally ignored so they cannot inflate the compute recommendation.
  demand.diskWriteMbps = 0;
  demand.diskCapacityTb = 0;

  return { groupId: group.id, groupName: group.name, count: group.count, perCamera: demand, warnings };
}

function calculateFixedWorkloadDemand(scenario: CapacityScenario): ResourceDemand {
  const workloads = scenario.concurrentWorkloads;
  const demand = emptyDemand();
  demand.cpuCores += workloads.activeJobs * 0.35;
  demand.ramGb += workloads.activeJobs * 0.3;
  demand.processThreads += workloads.activeJobs * 2;
  demand.inferenceRequestsPerSecond += workloads.activeJobs * 0.1;

  demand.cpuCores += workloads.groupedJobCameras * 0.09;
  demand.ramGb += workloads.groupedJobCameras * 0.04;
  demand.internetUploadMbps += workloads.groupedJobCameras * 0.25;

  demand.cpuCores += workloads.concurrentChatSessions * 0.12;
  demand.ramGb += workloads.concurrentChatSessions * 0.08;
  demand.internetUploadMbps += workloads.concurrentChatSessions * 0.15;

  demand.cpuCores += workloads.activeSearches * 0.45;
  demand.ramGb += workloads.activeSearches * 0.35;

  demand.cpuCores += workloads.intelligenceStreams * 1.5;
  demand.ramGb += workloads.intelligenceStreams * 1.1;
  demand.gpuVramGb += workloads.intelligenceStreams * 1.5;
  demand.localAiqSlots += workloads.intelligenceStreams * 0.25;
  return demand;
}

export function calculateScenarioDemand(scenario: CapacityScenario): {
  aggregate: ResourceDemand;
  groups: GroupDemand[];
  fixed: ResourceDemand;
  warnings: string[];
} {
  const groups = scenario.cameraGroups.map(calculateCameraGroupDemand);
  const fixed = calculateFixedWorkloadDemand(scenario);
  let aggregate = fixed;
  for (const group of groups) aggregate = addDemand(aggregate, scaleDemand(group.perCamera, group.count));
  return { aggregate, groups, fixed, warnings: groups.flatMap((group) => group.warnings) };
}

function nodeCapacity(template: HardwareNodeTemplate): ResourceDemand {
  const sustainedComputeFactor = template.sustainedComputeFactor ?? 1;
  return {
    cpuCores: template.physicalCores * sustainedComputeFactor,
    ramGb: template.ramGb,
    gpuVramGb: template.gpuVramGbTotal,
    localAiqSlots: template.localAiqSlots,
    gpuDecode1080p30Streams: template.gpuDecode1080p30Streams,
    diskCapacityTb: template.usableStorageTb,
    diskWriteMbps: template.diskWriteMbps,
    lanGbps: template.nicGbps,
    internetUploadMbps: template.nicGbps * 1000,
    processThreads: 20_000,
    ffmpegProcessesPerSecond: template.ffmpegProcessesPerSecondCapacity ?? Math.max(8, template.physicalCores * 3),
    inferenceRequestsPerSecond: template.inferenceRequestsPerSecondCapacity ?? Math.max(4, template.physicalCores * 0.75),
  };
}

function operatingSystemFor(template: HardwareNodeTemplate): OperatingSystemFamily {
  if (template.operatingSystemFamily) return template.operatingSystemFamily;
  if (template.cpuVendor === "apple") return "macos";
  return template.windowsEdition.toLowerCase().includes("ubuntu") ? "ubuntu" : "windows";
}

function operatingSystemAssumption(template: HardwareNodeTemplate): string {
  const operatingSystem = operatingSystemFor(template);
  if (operatingSystem === "macos") {
    return "Apple hardware is an opt-in planning target. It requires a Perceptrum macOS/Apple Silicon port and a matching sustained benchmark; unified memory is not reported as dedicated VRAM and current local AiQ/NVIDIA decode capacity is zero.";
  }
  if (operatingSystem === "ubuntu") {
    return "Ubuntu execution has been observed on the supplied ASUS configuration, but every Ubuntu desktop/server recommendation still requires the matching Perceptrum build, drivers and sustained benchmark before validation.";
  }
  return "Windows is the current packaged workstation target; the exact CPU, GPU, driver and workload still require a matching sustained benchmark before validation.";
}

function ratioFor(demand: ResourceDemand, capacity: ResourceDemand): { key: keyof ResourceDemand; value: number } {
  let highest: { key: keyof ResourceDemand; value: number } = { key: "cpuCores", value: 0 };
  for (const key of SIZING_RESOURCE_KEYS) {
    const value = capacity[key] <= 0 ? (demand[key] > 0 ? Number.POSITIVE_INFINITY : 0) : demand[key] / capacity[key];
    if (value > highest.value) highest = { key, value };
  }
  return highest;
}

function summarizePrice(
  template: HardwareNodeTemplate,
  nodeCount: number,
  scenario: CapacityScenario,
  quotes: PriceQuote[],
): PriceSummary {
  const now = Date.now();
  const exclusions = ["taxes", "shipping", "licenses", "energy", "support", "TCO"];
  const applicable = quotes
    .filter((quote) =>
      quote.hardwareTemplateId === template.id &&
      quote.market === scenario.market &&
      quote.currency === scenario.currency &&
      quote.condition === "new" &&
      quote.inStock,
    )
    .sort((left, right) => left.amount - right.amount);
  const rawAmounts = applicable.map((quote) => quote.amount * nodeCount);
  const rawMedian = rawAmounts.length === 0 ? 0 : rawAmounts[Math.floor((rawAmounts.length - 1) / 2)] ?? 0;
  const amounts = rawAmounts.length < 3 ? rawAmounts : rawAmounts.filter((amount) =>
    amount >= rawMedian * 0.5 && amount <= rawMedian * 1.5,
  );
  const median = amounts.length === 0 ? null : amounts[Math.floor((amounts.length - 1) / 2)] ?? null;
  const independentSources = new Set(applicable.map((quote) => `${quote.seller}|${quote.url}`)).size;
  const profile = referenceCostProfile(template);
  const fx = REFERENCE_FX_FROM_USD[scenario.currency];

  const referenceComponents = profile?.components.map((component) => {
    const perNodeAmount = Math.round(component.usdPerNode * fx.rate * 100) / 100;
    const quantityPerNode = component.componentId === "gpu" ? template.gpuCount : 1;
    const integratedAllocation = template.memoryArchitecture && template.memoryArchitecture !== "dedicated"
      ? "; planning allocation inside an integrated system price, not a separately purchasable component"
      : "";
    return {
      componentId: component.componentId,
      component: component.component,
      description: `${component.componentId === "gpu" ? template.gpuModel : component.component}${integratedAllocation}`,
      quantityPerNode,
      unitAmount: Math.round(perNodeAmount / quantityPerNode * 100) / 100,
      perNodeAmount,
      projectAmount: Math.round(perNodeAmount * nodeCount * 100) / 100,
      sourceUrls: profile.sourceUrls,
    };
  }) ?? [];

  if (median !== null) {
    const referenceProjectTotal = referenceComponents.reduce((sum, component) => sum + component.projectAmount, 0);
    const scale = referenceProjectTotal > 0 ? median / referenceProjectTotal : 1;
    const allocatedComponents = referenceComponents.map((component) => ({
      ...component,
      unitAmount: Math.round(component.unitAmount * scale * 100) / 100,
      perNodeAmount: Math.round(component.perNodeAmount * scale * 100) / 100,
      projectAmount: Math.round(component.projectAmount * scale * 100) / 100,
      sourceUrls: [...new Set(applicable.map((quote) => quote.url))],
    }));
    return {
      currency: scenario.currency,
      confidence: independentSources === 1 ? "low" : "medium",
      basis: "market_quotes",
      observedAt: applicable.map((quote) => quote.observedAt).sort().at(-1) ?? null,
      knownSubtotal: median,
      minimum: amounts[0] ?? null,
      median,
      maximum: amounts.at(-1) ?? null,
      quotationRequired: false,
      quoteCount: applicable.length,
      staleQuoteCount: applicable.filter((quote) => now - Date.parse(quote.observedAt) > 72 * 60 * 60 * 1000).length,
      sourceUrls: [...new Set(applicable.map((quote) => quote.url))],
      componentEstimates: allocatedComponents,
      exclusions,
    };
  }

  if (profile && referenceComponents.length) {
    const referenceTotal = Math.round(referenceComponents.reduce((sum, component) => sum + component.projectAmount, 0) * 100) / 100;
    return {
      currency: scenario.currency,
      confidence: "low",
      basis: "reference_estimate",
      observedAt: profile.observedAt,
      knownSubtotal: referenceTotal,
      minimum: Math.round(referenceTotal * 0.9 * 100) / 100,
      median: referenceTotal,
      maximum: Math.round(referenceTotal * 1.15 * 100) / 100,
      quotationRequired: true,
      quoteCount: 0,
      staleQuoteCount: 0,
      sourceUrls: [...new Set([...profile.sourceUrls, fx.sourceUrl])],
      componentEstimates: referenceComponents,
      exclusions,
    };
  }

  return {
    currency: scenario.currency,
    confidence: "none",
    basis: "quotation_required",
    observedAt: null,
    knownSubtotal: null,
    minimum: null,
    median: null,
    maximum: null,
    quotationRequired: true,
    quoteCount: 0,
    staleQuoteCount: 0,
    sourceUrls: [],
    componentEstimates: [],
    exclusions,
  };
}

function splitFixedDemand(fixed: ResourceDemand, activeNodes: number): ResourceDemand {
  return scaleDemand(fixed, 1 / Math.max(1, activeNodes));
}

function allocateGroups(
  groups: GroupDemand[],
  fixed: ResourceDemand,
  template: HardwareNodeTemplate,
  activeNodes: number,
  totalNodes: number,
  utilizationLimit: number,
): NodeAllocation[] | null {
  const capacity = nodeCapacity(template);
  const effectiveCapacity = scaleDemand(capacity, utilizationLimit);
  const allocations: NodeAllocation[] = Array.from({ length: totalNodes }, (_, index) => ({
    nodeIndex: index + 1,
    role: index < activeNodes ? "active" : "reserve",
    cameraGroups: [],
    demand: index < activeNodes ? splitFixedDemand(fixed, activeNodes) : emptyDemand(),
    utilization: Object.fromEntries(RESOURCE_KEYS.map((key) => [key, 0])) as Record<keyof ResourceDemand, number>,
  }));

  const cameras = groups.flatMap((group) =>
    Array.from({ length: group.count }, () => ({ group, demand: group.perCamera })),
  ).sort((left, right) => {
    const leftRatio = ratioFor(left.demand, effectiveCapacity).value;
    const rightRatio = ratioFor(right.demand, effectiveCapacity).value;
    return rightRatio - leftRatio;
  });

  for (const camera of cameras) {
    let bestIndex = -1;
    let bestRatio = Number.POSITIVE_INFINITY;
    for (let index = 0; index < activeNodes; index += 1) {
      const allocation = allocations[index];
      if (!allocation) continue;
      const nextDemand = addDemand(allocation.demand, camera.demand);
      const ratio = ratioFor(nextDemand, effectiveCapacity).value;
      if (ratio <= 1 && ratio < bestRatio) {
        bestRatio = ratio;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) return null;
    const allocation = allocations[bestIndex];
    if (!allocation) return null;
    allocation.demand = addDemand(allocation.demand, camera.demand);
    const existing = allocation.cameraGroups.find((entry) => entry.groupId === camera.group.groupId);
    if (existing) existing.cameras += 1;
    else allocation.cameraGroups.push({ groupId: camera.group.groupId, groupName: camera.group.groupName, cameras: 1 });
  }

  for (const allocation of allocations) {
    for (const key of RESOURCE_KEYS) {
      allocation.utilization[key] = capacity[key] > 0 ? allocation.demand[key] / capacity[key] : 0;
    }
  }
  return allocations;
}

function estimateAdditionalCameras(
  aggregate: ResourceDemand,
  fixed: ResourceDemand,
  template: HardwareNodeTemplate,
  activeNodes: number,
  utilizationLimit: number,
  totalCameras: number,
): number {
  const cameraDemand = addDemand(aggregate, scaleDemand(fixed, -1));
  if (totalCameras <= 0) return 0;
  const perCamera = scaleDemand(cameraDemand, 1 / totalCameras);
  const totalCapacity = scaleDemand(nodeCapacity(template), activeNodes * utilizationLimit);
  let additional = Number.POSITIVE_INFINITY;
  for (const key of SIZING_RESOURCE_KEYS) {
    if (perCamera[key] <= 0) continue;
    additional = Math.min(additional, Math.floor(Math.max(0, totalCapacity[key] - aggregate[key]) / perCamera[key]));
  }
  return Number.isFinite(additional) ? Math.max(0, additional) : 0;
}

function evaluateTemplate(
  scenario: CapacityScenario,
  template: HardwareNodeTemplate,
  policy: RecommendationPolicy,
  aggregate: ResourceDemand,
  groups: GroupDemand[],
  fixed: ResourceDemand,
  quotes: PriceQuote[],
  warnings: string[],
): RecommendationAlternative | null {
  const templateOperatingSystem = operatingSystemFor(template);
  const requestedOperatingSystem = scenario.constraints.operatingSystem ?? "auto";
  if (scenario.constraints.requiredHardwareTemplateId && template.id !== scenario.constraints.requiredHardwareTemplateId) return null;
  if (scenario.constraints.infrastructureKind !== "either" && template.kind !== scenario.constraints.infrastructureKind) return null;
  if (requestedOperatingSystem !== "auto" && templateOperatingSystem !== requestedOperatingSystem) return null;
  // macOS remains opt-in until a matching Perceptrum Apple Silicon build is benchmarked.
  if (requestedOperatingSystem === "auto" && templateOperatingSystem === "macos") return null;
  if (scenario.constraints.preferredCpuVendors.length > 0 && !scenario.constraints.preferredCpuVendors.includes(template.cpuVendor)) return null;
  if (scenario.constraints.preferredGpuVendors.length > 0 && !scenario.constraints.preferredGpuVendors.includes(template.gpuVendor)) return null;
  if (scenario.constraints.requireEcc && !template.ecc) return null;
  if (aggregate.gpuDecode1080p30Streams > 0 && !template.supportsPerceptrumGpuDecode) return null;

  const headroomPercent = POLICY_HEADROOM[policy];
  const utilizationLimit = 1 - headroomPercent / 100;
  const capacity = nodeCapacity(template);
  const adjustedCapacity = scaleDemand(capacity, utilizationLimit);
  const highest = ratioFor(aggregate, adjustedCapacity);
  let activeNodes = Math.max(1, Math.ceil(highest.value));
  if (!Number.isFinite(activeNodes)) return null;
  let totalNodes = activeNodes + (policy === "n_plus_one" ? 1 : 0);

  let allocations: NodeAllocation[] | null = null;
  for (let attempt = 0; attempt < 256; attempt += 1) {
    totalNodes = activeNodes + (policy === "n_plus_one" ? 1 : 0);
    if (scenario.constraints.maxNodes !== null && totalNodes > scenario.constraints.maxNodes) return null;
    allocations = allocateGroups(groups, fixed, template, activeNodes, totalNodes, utilizationLimit);
    if (allocations) break;
    activeNodes += 1;
  }
  if (!allocations) return null;

  const activeAllocations = allocations.filter((allocation) => allocation.role === "active");
  const worst = activeAllocations
    .flatMap((allocation) => SIZING_RESOURCE_KEYS.map((key) => ({ key, value: allocation.utilization[key] })))
    .sort((left, right) => right.value - left.value)[0] ?? { key: "cpuCores" as const, value: 0 };
  const price = summarizePrice(template, totalNodes, scenario, quotes);
  if (scenario.constraints.budget !== null && price.median !== null && price.median > scenario.constraints.budget) return null;

  const candidateWarnings = [...warnings];
  if (price.basis === "reference_estimate") candidateWarnings.push("reference_price_estimate_purchase_quote_required");
  else if (price.quotationRequired) candidateWarnings.push("quotation_required");
  if (!template.supportsPerceptrumGpuDecode) candidateWarnings.push("cpu_rtsp_decode_selected_no_current_perceptrum_gpu_acceleration");
  if (!template.ecc) candidateWarnings.push("non_ecc_memory");
  if (template.kind === "laptop") candidateWarnings.push("laptop_sustained_thermal_and_ac_power_benchmark_required");
  if ((template.sustainedComputeFactor ?? 1) < 1) candidateWarnings.push(`conservative_unbenchmarked_compute_derating_${Math.round((template.sustainedComputeFactor ?? 1) * 100)}_percent`);
  if (template.id.includes("vivobook")) candidateWarnings.push("wired_ethernet_adapter_required_for_production_rtsp");
  if (template.gpuVendor === "intel") candidateWarnings.push("intel_npu_and_theoretical_ai_tops_are_not_used_as_local_aiq_capacity");
  if (templateOperatingSystem === "ubuntu") candidateWarnings.push("ubuntu_target_requires_matching_perceptrum_build_and_benchmark");
  if (templateOperatingSystem === "macos") {
    candidateWarnings.push("macos_perceptrum_port_and_matching_benchmark_required");
    candidateWarnings.push("apple_unified_memory_is_not_dedicated_vram");
    candidateWarnings.push("local_aiq_and_current_nvidia_rtsp_decode_are_not_supported_on_this_template");
  }

  return {
    id: randomUUID(),
    variant: "balanced",
    hardware: template,
    nodeCount: totalNodes,
    activeNodeCount: activeNodes,
    allocations,
    aggregateDemand: aggregate,
    headroomPercent,
    bottleneck: worst.key,
    maximumAdditionalCameras: estimateAdditionalCameras(
      aggregate,
      fixed,
      template,
      activeNodes,
      utilizationLimit,
      scenario.totalCameras,
    ),
    price,
    warnings: [...new Set(candidateWarnings)],
  };
}

function candidateCost(candidate: RecommendationAlternative): number {
  return candidate.price.median ?? Number.POSITIVE_INFINITY;
}

function fallbackHardwareCostScore(candidate: RecommendationAlternative): number {
  const hardware = candidate.hardware;
  return candidate.nodeCount * (
    hardware.physicalCores * 1.5 + hardware.ramGb * 0.12 + hardware.gpuVramGbTotal * 3 +
    hardware.nicGbps * 0.5 + hardware.gpuCount * 20
  );
}

function compareCapex(left: RecommendationAlternative, right: RecommendationAlternative): number {
  const leftCost = candidateCost(left);
  const rightCost = candidateCost(right);
  if (Number.isFinite(leftCost) && Number.isFinite(rightCost) && leftCost !== rightCost) return leftCost - rightCost;
  if (Number.isFinite(leftCost) !== Number.isFinite(rightCost)) return Number.isFinite(leftCost) ? -1 : 1;
  return fallbackHardwareCostScore(left) - fallbackHardwareCostScore(right) || left.nodeCount - right.nodeCount;
}

function withVariant(candidate: RecommendationAlternative, variant: RecommendationVariant): RecommendationAlternative {
  return { ...candidate, id: randomUUID(), variant };
}

function selectCandidates(
  candidates: RecommendationAlternative[],
  scenario: CapacityScenario,
  excludedPrimaryHardwareIds: ReadonlySet<string>,
  minimumHardware: HardwareNodeTemplate | null,
): {
  primary: RecommendationAlternative;
  alternatives: RecommendationAlternative[];
} {
  const explicitKind = scenario.constraints.infrastructureKind !== "either";
  const singleComputerFits = candidates.some((candidate) => candidate.hardware.kind !== "rack" && candidate.activeNodeCount === 1);
  // Laptops, mini PCs and towers compete for a small one-node deployment. Rack designs
  // become automatic only when no single non-rack computer carries the selected policy.
  const deploymentCandidates = explicitKind
    ? candidates
    : singleComputerFits
      ? candidates.filter((candidate) => candidate.hardware.kind !== "rack")
      : candidates.some((candidate) => candidate.hardware.kind === "rack")
        ? candidates.filter((candidate) => candidate.hardware.kind === "rack")
        : candidates;
  const unusedCandidates = deploymentCandidates.filter((candidate) => !excludedPrimaryHardwareIds.has(candidate.hardware.id));
  const nonDowngradeCandidates = minimumHardware === null ? unusedCandidates : unusedCandidates.filter((candidate) => {
    const hardware = candidate.hardware;
    return hardware.physicalCores >= minimumHardware.physicalCores &&
      hardware.ramGb >= minimumHardware.ramGb &&
      hardware.gpuVramGbTotal >= minimumHardware.gpuVramGbTotal &&
      hardware.localAiqSlots >= minimumHardware.localAiqSlots &&
      hardware.gpuDecode1080p30Streams >= minimumHardware.gpuDecode1080p30Streams &&
      hardware.nicGbps >= minimumHardware.nicGbps &&
      hardware.expansionScore >= minimumHardware.expansionScore;
  });
  const primaryCandidates = nonDowngradeCandidates.length
    ? nonDowngradeCandidates
    : unusedCandidates.length ? unusedCandidates : deploymentCandidates;
  const balanced = [...primaryCandidates].sort(compareCapex)[0];
  if (!balanced) throw new CapacityError("No compatible hardware design was found.");

  const lowerCapex = [...deploymentCandidates].sort(compareCapex).find((candidate) => candidate.hardware.id !== balanced.hardware.id) ?? balanced;
  const expansion = [...deploymentCandidates].sort((left, right) =>
    right.hardware.expansionScore - left.hardware.expansionScore ||
    right.maximumAdditionalCameras - left.maximumAdditionalCameras,
  )[0] ?? balanced;

  const selected = [
    withVariant(lowerCapex, "lower_capex"),
    withVariant(expansion, "expansion"),
  ].filter((candidate, index, all) =>
    candidate.hardware.id !== balanced.hardware.id &&
    all.findIndex((other) => other.hardware.id === candidate.hardware.id) === index,
  );
  return { primary: withVariant(balanced, "balanced"), alternatives: selected };
}

export function buildRecommendations(
  scenarioId: string,
  scenarioRevision: number,
  scenario: CapacityScenario,
  catalog: HardwareNodeTemplate[],
  quotes: PriceQuote[],
  validated = false,
  catalogVersion = HARDWARE_CATALOG_VERSION,
): CapacityRecommendation[] {
  const demand = calculateScenarioDemand(scenario);
  const policies: RecommendationPolicy[] = ["minimum", "recommended", "n_plus_one"];
  const recommendations: CapacityRecommendation[] = [];
  const usedPrimaryHardwareIds = new Set<string>();
  let minimumHardware: HardwareNodeTemplate | null = null;
  for (const policy of policies) {
    const candidates = catalog
      .map((template) => evaluateTemplate(
        scenario,
        template,
        policy,
        demand.aggregate,
        demand.groups,
        demand.fixed,
        quotes,
        demand.warnings,
      ))
      .filter((candidate): candidate is RecommendationAlternative => candidate !== null);
    if (candidates.length === 0) {
      throw new CapacityError(`No compatible ${policy} design was found.`, [
        "Increase maxNodes or remove restrictive hardware, platform, vendor or form-factor constraints.",
        "Integrated Intel and Apple templates currently require CPU decode; local AiQ requires a compatible NVIDIA/Vulkan runtime and sufficient dedicated VRAM.",
        scenario.constraints.requiredHardwareTemplateId
          ? `The selected existing machine (${scenario.constraints.requiredHardwareTemplateId}) cannot satisfy this workload with the requested safety margin.`
          : "Select an existing machine only when you want to measure that exact catalog configuration.",
      ]);
    }
    const selected = selectCandidates(candidates, scenario, usedPrimaryHardwareIds, minimumHardware);
    usedPrimaryHardwareIds.add(selected.primary.hardware.id);
    minimumHardware ??= selected.primary.hardware;
    recommendations.push({
      id: randomUUID(),
      scenarioId,
      scenarioRevision,
      generatedAt: new Date().toISOString(),
      policy,
      confidence: validated ? "validated" : "estimated",
      contractVersion: WORKLOAD_CONTRACT_VERSION,
      perceptrumBuildHash: scenario.perceptrumBuildHash,
      primary: selected.primary,
      alternatives: selected.alternatives,
      assumptions: [
        "Continuous RTSP decode remains charged at source codec, resolution and FPS.",
        "BGR buffer capacity is estimated as two seconds at the configured source FPS.",
        "Video frame extraction includes one FFmpeg process per sampled frame, capped at 300 frames per request.",
        "AiQ local execution uses effective video/10-second scheduling and 5.12 GB estimated VRAM per concurrent slot.",
        "Storage capacity and disk throughput are not sizing constraints; the BOM includes only an operational NVMe workspace for the operating system and temporary inference files.",
        "Inference media is assumed to be deleted by Perceptrum after short retention (normally up to one day); sparse alert media is operationally negligible.",
        "Built-in component costs are dated planning references converted with official FX snapshots; current compatible market quotes take precedence when available.",
        "Reference estimates exclude taxes, shipping, licenses, energy, support and TCO and still require a purchase quotation.",
        operatingSystemAssumption(selected.primary.hardware),
        scenario.constraints.requiredHardwareTemplateId
          ? `Sizing is restricted to the selected existing hardware template ${scenario.constraints.requiredHardwareTemplateId}; repeated hardware across policies is intentional in this comparison mode.`
          : "The full active catalog competes on compatible capacity and price; laptops and mini PCs are considered for small loads instead of starting at workstation class.",
      ],
      evidence: [
        `workload-contract:${WORKLOAD_CONTRACT_VERSION}`,
        `perceptrum-build:${scenario.perceptrumBuildHash}`,
        `catalog-version:${catalogVersion}`,
        `operating-system:${operatingSystemFor(selected.primary.hardware)}`,
        ...selected.primary.hardware.sources.map((source) => source.url),
      ],
    });
  }
  return recommendations;
}
