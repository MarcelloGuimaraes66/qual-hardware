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
  [/memory|ecc|vram/, "memory", "Memória e interconexão", 300],
  [/pcie|lane|configuration/, "io", "Controladores de I/O e expansão", 400],
  [/gpu|npu|compute|tensor|ray_tracing/, "acceleration", "Aceleradores e processamento", 500],
  [/video|decode|encode/, "video", "Codificação e decodificação de vídeo", 600],
  [/process|socket|package|dimension/, "physical", "Construção, encapsulamento e dimensões", 700],
  [/power|temperature/, "power_thermal", "Alimentação e limites térmicos", 800],
  [/instruction|virtual|security/, "software_security", "Software, instruções e segurança", 900],
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
  ["video_encode", "NVIDIA Encoder (NVENC)", "string", "3x Ninth Generation", null],
  ["video_decode", "NVIDIA Decoder (NVDEC)", "string", "2x Sixth Generation", null],
  ["dimensions_mm", "Length", "string", "304 mm", "mm"],
  ["continuous_power_watts", "Total Graphics Power (W)", "number", 575, "W"],
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
];
