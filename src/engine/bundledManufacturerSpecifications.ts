import type { ManufacturerSpecificationObservation, TechnicalSpecificationValueType } from "../shared/types.js";
import { MANUFACTURER_SPECIFICATION_OBSERVATION_VERSION } from "../shared/types.js";

type Fact = readonly [
  fieldCode: string,
  label: string,
  valueType: TechnicalSpecificationValueType,
  normalizedValue: string | number | boolean,
  normalizedUnit: string | null,
  originalValue?: string | number | boolean,
];

interface Subject {
  componentId: string;
  manufacturer: string;
  canonicalMpn: string;
  sourceId: string;
  sourceUrl: string;
  retrievedAt: string;
  rawArtifactSha256: string;
  parserId: string;
}

const sectionDefinitions: Array<[RegExp, string, string, number]> = [
  [/architecture/, "identity", "Identificação e ciclo de vida", 10],
  [/performance_core|efficient_core|physical_cores|threads|clock|frequency/, "topology", "Topologia e frequências", 100],
  [/cache/, "cache", "Estrutura de memória cache", 200],
  [/memory|ecc|vram|bandwidth/, "memory", "Memória e interconexão", 300],
  [/pcie|lane|configuration/, "io", "Controladores de I/O e expansão", 400],
  [/gpu|npu|compute|tensor|ray_tracing/, "acceleration", "Aceleradores e processamento", 500],
  [/video|decode|encode/, "video", "Codificação e decodificação de vídeo", 600],
  [/process|socket|package|dimension|length|slots/, "physical", "Construção, encapsulamento e dimensões", 700],
  [/power|temperature|connector/, "power_thermal", "Alimentação e limites térmicos", 800],
  [/instruction|virtual|security|operating_system|backend/, "software_security", "Software, instruções e segurança", 900],
];

function observations(subject: Subject, facts: readonly Fact[]): ManufacturerSpecificationObservation[] {
  return facts.map(([fieldCode, originalLabel, valueType, normalizedValue, normalizedUnit, originalValue], index) => {
    const section = sectionDefinitions.find(([pattern]) => pattern.test(fieldCode)) ?? [/./, "other", "Informações adicionais do fabricante", 1_000];
    return {
      schemaVersion: MANUFACTURER_SPECIFICATION_OBSERVATION_VERSION,
      id: `${subject.sourceId}:${subject.rawArtifactSha256}:manufacturer-field:${fieldCode}`,
      componentId: subject.componentId,
      manufacturer: subject.manufacturer,
      canonicalMpn: subject.canonicalMpn,
      scope: "sku",
      subject: subject.canonicalMpn,
      fieldCode,
      sectionCode: section[1] as string,
      sectionLabelPt: section[2] as string,
      displayOrder: Number(section[3]) + index,
      valueType,
      originalLabel,
      originalValue: originalValue ?? normalizedValue,
      originalUnit: null,
      normalizedValue,
      normalizedUnit,
      authority: "official_sku",
      sourceId: subject.sourceId,
      sourceUrl: subject.sourceUrl,
      retrievedAt: subject.retrievedAt,
      evidenceLocator: `official-product-page:${originalLabel}`,
      rawArtifactSha256: subject.rawArtifactSha256,
      parserId: subject.parserId,
      parserVersion: "1.0.0",
      licensePolicy: "Fato técnico normalizado com atribuição e rastreabilidade; o documento-fonte não é redistribuído.",
    };
  });
}

const intel285K = observations({
  componentId: "cpu:intel:intel-core-ultra-9-285k-24-cores-24-threads",
  manufacturer: "Intel",
  canonicalMpn: "Intel Core Ultra 9 285K",
  sourceId: "spec-intel-ark",
  sourceUrl: "https://www.intel.com/content/www/us/en/products/sku/241060/intel-core-ultra-9-processor-285k-36m-cache-up-to-5-70-ghz/specifications.html",
  retrievedAt: "2026-07-21T13:34:28.559Z",
  rawArtifactSha256: "43dd4d0ca646122d787d7fb6b915078794126562ceb01f2031ae96d56ccafb99",
  parserId: "intel-ark-tech-section",
}, [
  ["architecture", "Code Name", "string", "Products formerly Arrow Lake", null],
  ["physical_cores", "Total Cores", "number", 24, "núcleos"],
  ["threads", "Total Threads", "number", 24, "threads"],
  ["max_clock_ghz", "Max Turbo Frequency", "number", 5.7, "GHz", "5.7 GHz"],
  ["performance_core_base_clock_ghz", "Performance-core Base Frequency", "number", 3.7, "GHz", "3.7 GHz"],
  ["efficient_core_base_clock_ghz", "Efficient-core Base Frequency", "number", 3.2, "GHz", "3.2 GHz"],
  ["l2_cache_mb", "Total L2 Cache", "number", 40, "MB", "40 MB"],
  ["l3_cache_mb", "Cache", "number", 36, "MB", "36 MB Intel Smart Cache"],
  ["base_power_watts", "Processor Base Power", "number", 125, "W", "125 W"],
  ["turbo_power_watts", "Maximum Turbo Power", "number", 250, "W", "250 W"],
  ["process_nm", "CPU Lithography", "number", 3, "nm", "TSMC N3B"],
  ["maximum_memory_gb", "Max Memory Size (dependent on memory type)", "number", 256, "GB", "256 GB"],
  ["memory_type", "Memory Types", "string", "Up to DDR5 6400 MT/s", null],
  ["memory_channels", "Max # of Memory Channels", "number", 2, "canais"],
  ["ecc_support", "ECC Memory Supported", "boolean", true, null, "Yes"],
  ["integrated_gpu", "GPU Name", "string", "Intel Graphics", null],
  ["integrated_npu", "NPU Name", "string", "Intel AI Boost", null],
  ["npu_tops", "NPU Peak TOPS (Int8)", "number", 13, "TOPS"],
  ["pcie_generation", "PCI Express Revision", "number", 5, null, "5.0 and 4.0"],
  ["pcie_configurations", "PCI Express Configurations", "string", "Up to 1x16+2x4, 2x8+2x4, 1x8+4x4", null],
  ["pcie_lanes", "Max # of PCI Express Lanes", "number", 24, "pistas"],
  ["socket", "Sockets Supported", "string", "FCLGA1851", null],
  ["instruction_set_extensions", "Instruction Set Extensions", "string", "Intel SSE4.1, Intel SSE4.2, Intel AVX2", null],
  ["virtualization", "Intel Virtualization Technology with Redirect Protection (VT-rp)", "string", "Yes", null],
]);

const nvidia5090 = observations({
  componentId: "gpu:nvidia:nvidia-geforce-rtx-5090-32-gb",
  manufacturer: "NVIDIA",
  canonicalMpn: "GeForce RTX 5090",
  sourceId: "spec-nvidia-products",
  sourceUrl: "https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/",
  retrievedAt: "2026-07-21T13:42:31.000Z",
  rawArtifactSha256: "8c6a6427b69eb147499e0d53b795155f6c08a921e11fcd754b15389cbe8724aa",
  parserId: "manufacturer-spec-table",
}, [
  ["architecture", "NVIDIA Architecture", "string", "Blackwell", null],
  ["compute_units", "NVIDIA CUDA Cores", "number", 21_760, "unidades"],
  ["tensor_core_generation", "Tensor Cores (AI)", "string", "5th Generation", null, "5th Generation; 3352 AI TOPS"],
  ["tensor_performance_tops", "AI TOPS", "number", 3_352, "AI TOPS"],
  ["ray_tracing_core_generation", "Ray Tracing Cores", "string", "4th Generation", null, "4th Generation; 318 TFLOPS"],
  ["boost_clock_ghz", "Boost Clock (GHz)", "number", 2.41, "GHz"],
  ["vram_gb", "Standard Memory Config", "number", 32, "GB", "32 GB GDDR7"],
  ["memory_type", "Standard Memory Config", "string", "GDDR7", null, "32 GB GDDR7"],
  ["memory_bus_bits", "Memory Interface Width", "number", 512, "bits", "512-bit"],
  ["pcie_generation", "PCI Express Gen 5", "number", 5, null, "PCI Express Gen 5"],
  ["acceleration_backends", "CUDA Capability", "string", "CUDA 12.0; NVENC; NVDEC", null, "CUDA Capability 12.0"],
  ["video_encode_engines", "NVIDIA Encoder (NVENC)", "string", "3 × NVENC de nona geração", null, "3x Ninth Generation"],
  ["video_decode_engines", "NVIDIA Decoder (NVDEC)", "string", "2 × NVDEC de sexta geração", null, "2x Sixth Generation"],
  ["dimensions_mm", "Card Dimensions", "string", "304 × 137", "mm", "304 mm × 137 mm"],
  ["length_mm", "Length", "number", 304, "mm", "304 mm"],
  ["slots_wide", "Slot", "number", 2, "slots", "2-Slot"],
  ["continuous_power_watts", "Total Graphics Power (W)", "number", 575, "W"],
  ["required_system_power_watts", "Required System Power (W)", "number", 1_000, "W"],
  ["power_connectors", "Supplementary Power Connectors", "string", "4 × PCIe de 8 pinos com adaptador ou 1 × cabo PCIe Gen 5 de 600 W", null, "4x PCIe 8-pin cables (adapter in box) OR 1x 600 W PCIe Gen 5 cable"],
  ["maximum_temperature_c", "Maximum GPU Temperature (in C)", "number", 90, "°C"],
]);

const nvidia5090Architecture = observations({
  componentId: "gpu:nvidia:nvidia-geforce-rtx-5090-32-gb",
  manufacturer: "NVIDIA",
  canonicalMpn: "GeForce RTX 5090",
  sourceId: "spec-nvidia-products",
  sourceUrl: "https://images.nvidia.com/aem-dam/Solutions/geforce/blackwell/nvidia-rtx-blackwell-gpu-architecture.pdf",
  retrievedAt: "2026-07-21T14:15:00.000Z",
  rawArtifactSha256: "906ff2a409d7a7e4cbc56f5d3a179d574120d19aaba99520670e1a0c064595fa",
  parserId: "nvidia-blackwell-architecture-pdf",
}, [
  ["memory_bandwidth_gbps", "Memory Bandwidth", "number", 1_792, "GB/s", "1792 GB/sec"],
]);

const nvidia5090Codec = observations({
  componentId: "gpu:nvidia:nvidia-geforce-rtx-5090-32-gb",
  manufacturer: "NVIDIA",
  canonicalMpn: "GeForce RTX 5090",
  sourceId: "spec-nvidia-products",
  sourceUrl: "https://developer.nvidia.com/video-codec-sdk",
  retrievedAt: "2026-07-21T14:01:00.000Z",
  rawArtifactSha256: "50f085ff8ff4564061a661a59998af177840330f09fc5e1f2a3e6ca9dd512640",
  parserId: "nvidia-video-codec-sdk-page",
}, [
  ["video_encode", "NVENC supported encode codecs", "string", "H.264; H.265 (HEVC); AV1", null, "H.264, HEVC (H.265) and AV1"],
  ["video_decode", "NVDEC supported decode codecs", "string", "MPEG-2; VC-1; H.264; H.265 (HEVC); VP8; VP9; AV1", null, "MPEG-2, VC-1, H.264, H.265, VP8, VP9 and AV1"],
  ["supported_operating_systems", "Supported platforms", "string", "Windows; Linux", null, "Windows and Linux"],
]);

const amd9950X = observations({
  componentId: "cpu:amd:amd-ryzen-9-9950x",
  manufacturer: "AMD",
  canonicalMpn: "AMD Ryzen 9 9950X",
  sourceId: "spec-amd-products",
  sourceUrl: "https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-9-9950x.html",
  retrievedAt: "2026-07-21T14:01:00.000Z",
  rawArtifactSha256: "7869f91f98ca33f3722bf7d49a04434027eb8c239a07ed26a0c0823a0c91d7f6",
  parserId: "amd-product-definition-list",
}, [
  ["architecture", "Processor Architecture", "string", "Zen 5", null, "Zen 5"],
  ["physical_cores", "# of CPU Cores", "number", 16, "núcleos"],
  ["threads", "# of Threads", "number", 32, "threads"],
  ["max_clock_ghz", "Max. Boost Clock", "number", 5.7, "GHz", "Up to 5.7 GHz"],
  ["base_clock_ghz", "Base Clock", "number", 4.3, "GHz", "4.3 GHz"],
  ["l1_cache", "L1 Cache", "string", "1.280 KB", null, "1280 KB"],
  ["l2_cache_mb", "L2 Cache", "number", 16, "MB", "16 MB"],
  ["l3_cache_mb", "L3 Cache", "number", 64, "MB", "64 MB"],
  ["base_power_watts", "Default TDP", "number", 170, "W", "170W"],
  ["process_nm", "Processor Technology for CPU Cores", "number", 4, "nm", "TSMC 4nm FinFET"],
  ["maximum_memory_gb", "Max. Memory", "number", 256, "GB", "256 GB"],
  ["memory_type", "System Memory Type", "string", "DDR5", null],
  ["memory_channels", "Memory Channels", "number", 2, "canais"],
  ["ecc_support", "ECC Support", "boolean", true, null, "Yes (requires motherboard support)"],
  ["integrated_gpu", "Graphics Model", "string", "AMD Radeon Graphics", null],
  ["pcie_generation", "PCI Express Version", "number", 5, null, "PCIe 5.0"],
  ["pcie_lanes", "Native PCIe Lanes (Total/Usable)", "number", 28, "pistas", "28/24"],
  ["socket", "CPU Socket", "string", "AM5", null],
  ["instruction_set_extensions", "Supported Extensions", "string", "AES; AVX; AVX2; AVX512; FMA3; SSE; SHA", null, "AES, AVX, AVX2, AVX512, FMA3, SSE, SHA"],
  ["maximum_temperature_c", "Max. Operating Temperature (Tjmax)", "number", 95, "°C"],
  ["supported_operating_systems", "OS Support", "string", "Windows 11 64-bit; Windows 10 64-bit; RHEL x86-64; Ubuntu x86-64", null],
]);

/**
 * First reviewed offline snapshot. It is deliberately small: only values that
 * were fetched from an exact official product page and inspected are bundled.
 * The fortnightly publisher can append more observations without changing the
 * executable. Missing components remain blocked and are never fabricated.
 */
export const BUNDLED_MANUFACTURER_SPECIFICATION_OBSERVATIONS: readonly ManufacturerSpecificationObservation[] = [
  ...intel285K,
  ...nvidia5090,
  ...nvidia5090Architecture,
  ...nvidia5090Codec,
  ...amd9950X,
];
