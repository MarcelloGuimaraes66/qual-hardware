import { createHash } from "node:crypto";
import { manufacturerSourceTarget } from "../engine/manufacturerSourceMappings.js";
import type { CatalogSource, SourceObservation, TechnicalSpecificationValueType } from "../shared/types.js";

interface FieldMapping {
  code: string;
  sectionCode: string;
  sectionLabelPt: string;
  displayOrder: number;
  valueType: TechnicalSpecificationValueType;
  unit: string | null;
  patterns: RegExp[];
}

const fields: FieldMapping[] = [
  { code: "architecture", sectionCode: "identity", sectionLabelPt: "Identificação e ciclo de vida", displayOrder: 10, valueType: "string", unit: null, patterns: [/architecture/i, /code name/i] },
  { code: "physical_cores", sectionCode: "topology", sectionLabelPt: "Topologia e frequências", displayOrder: 100, valueType: "number", unit: "núcleos", patterns: [/^total cores$/i, /^# of cores$/i, /^cores$/i] },
  { code: "performance_cores", sectionCode: "topology", sectionLabelPt: "Topologia e frequências", displayOrder: 110, valueType: "number", unit: "núcleos", patterns: [/performance cores/i, /# of p-cores/i] },
  { code: "efficient_cores", sectionCode: "topology", sectionLabelPt: "Topologia e frequências", displayOrder: 120, valueType: "number", unit: "núcleos", patterns: [/efficient cores/i, /# of e-cores/i] },
  { code: "threads", sectionCode: "topology", sectionLabelPt: "Topologia e frequências", displayOrder: 130, valueType: "number", unit: "threads", patterns: [/^total threads$/i, /^# of threads$/i, /^threads$/i] },
  { code: "max_clock_ghz", sectionCode: "topology", sectionLabelPt: "Topologia e frequências", displayOrder: 140, valueType: "number", unit: "GHz", patterns: [/^max turbo frequency$/i, /^max\. boost clock$/i] },
  { code: "performance_core_max_clock_ghz", sectionCode: "topology", sectionLabelPt: "Topologia e frequências", displayOrder: 150, valueType: "number", unit: "GHz", patterns: [/performance-core max turbo frequency/i, /p-core max turbo frequency/i] },
  { code: "efficient_core_max_clock_ghz", sectionCode: "topology", sectionLabelPt: "Topologia e frequências", displayOrder: 160, valueType: "number", unit: "GHz", patterns: [/efficient-core max turbo frequency/i, /e-core max turbo frequency/i] },
  { code: "base_clock_ghz", sectionCode: "topology", sectionLabelPt: "Topologia e frequências", displayOrder: 170, valueType: "number", unit: "GHz", patterns: [/^processor base frequency$/i, /^base clock$/i] },
  { code: "performance_core_base_clock_ghz", sectionCode: "topology", sectionLabelPt: "Topologia e frequências", displayOrder: 180, valueType: "number", unit: "GHz", patterns: [/performance-core base frequency/i, /p-core base frequency/i] },
  { code: "efficient_core_base_clock_ghz", sectionCode: "topology", sectionLabelPt: "Topologia e frequências", displayOrder: 190, valueType: "number", unit: "GHz", patterns: [/efficient-core base frequency/i, /e-core base frequency/i] },
  { code: "l2_cache_mb", sectionCode: "cache", sectionLabelPt: "Estrutura de memória cache", displayOrder: 210, valueType: "number", unit: "MB", patterns: [/total l2 cache/i, /^l2 cache$/i] },
  { code: "l3_cache_mb", sectionCode: "cache", sectionLabelPt: "Estrutura de memória cache", displayOrder: 220, valueType: "number", unit: "MB", patterns: [/intel smart cache/i, /^l3 cache$/i, /^cache$/i] },
  { code: "maximum_memory_gb", sectionCode: "memory", sectionLabelPt: "Memória e interconexão", displayOrder: 300, valueType: "number", unit: "GB", patterns: [/max memory size/i, /max\. memory/i] },
  { code: "memory_type", sectionCode: "memory", sectionLabelPt: "Memória e interconexão", displayOrder: 310, valueType: "string", unit: null, patterns: [/^memory types$/i, /^system memory specification$/i, /^memory type$/i] },
  { code: "maximum_memory_speed", sectionCode: "memory", sectionLabelPt: "Memória e interconexão", displayOrder: 320, valueType: "string", unit: null, patterns: [/max memory speed/i] },
  { code: "memory_channels", sectionCode: "memory", sectionLabelPt: "Memória e interconexão", displayOrder: 330, valueType: "number", unit: "canais", patterns: [/max # of memory channels/i, /^memory channels$/i] },
  { code: "ecc_support", sectionCode: "memory", sectionLabelPt: "Memória e interconexão", displayOrder: 340, valueType: "boolean", unit: null, patterns: [/ecc memory supported/i, /^ecc support$/i] },
  { code: "pcie_generation", sectionCode: "io", sectionLabelPt: "Controladores de I/O e expansão", displayOrder: 400, valueType: "number", unit: null, patterns: [/pci express revision/i, /^pci express$/i] },
  { code: "pcie_configurations", sectionCode: "io", sectionLabelPt: "Controladores de I/O e expansão", displayOrder: 410, valueType: "string", unit: null, patterns: [/pci express configurations/i] },
  { code: "pcie_lanes", sectionCode: "io", sectionLabelPt: "Controladores de I/O e expansão", displayOrder: 420, valueType: "number", unit: "pistas", patterns: [/max # of pci express lanes/i, /^pcie lanes$/i] },
  { code: "integrated_gpu", sectionCode: "acceleration", sectionLabelPt: "Aceleradores e processamento", displayOrder: 500, valueType: "string", unit: null, patterns: [/^gpu name$/i, /processor graphics/i, /^graphics model$/i] },
  { code: "integrated_npu", sectionCode: "acceleration", sectionLabelPt: "Aceleradores e processamento", displayOrder: 510, valueType: "string", unit: null, patterns: [/npu name/i, /intel ai boost/i] },
  { code: "npu_tops", sectionCode: "acceleration", sectionLabelPt: "Aceleradores e processamento", displayOrder: 520, valueType: "number", unit: "TOPS", patterns: [/npu peak tops/i] },
  { code: "compute_units", sectionCode: "acceleration", sectionLabelPt: "Aceleradores e processamento", displayOrder: 530, valueType: "number", unit: "unidades", patterns: [/cuda.*cores/i, /stream processors/i, /execution units/i] },
  { code: "tensor_core_generation", sectionCode: "acceleration", sectionLabelPt: "Aceleradores e processamento", displayOrder: 540, valueType: "string", unit: null, patterns: [/tensor cores/i] },
  { code: "tensor_performance_tops", sectionCode: "acceleration", sectionLabelPt: "Aceleradores e processamento", displayOrder: 542, valueType: "number", unit: "AI TOPS", patterns: [/^ai tops$/i] },
  { code: "ray_tracing_core_generation", sectionCode: "acceleration", sectionLabelPt: "Aceleradores e processamento", displayOrder: 545, valueType: "string", unit: null, patterns: [/ray tracing cores/i, /^rt cores$/i] },
  { code: "vram_gb", sectionCode: "memory", sectionLabelPt: "Memória e interconexão", displayOrder: 350, valueType: "number", unit: "GB", patterns: [/standard memory config/i, /^memory size$/i, /^gpu memory$/i] },
  { code: "memory_type", sectionCode: "memory", sectionLabelPt: "Memória e interconexão", displayOrder: 360, valueType: "string", unit: null, patterns: [/^memory type$/i] },
  { code: "memory_bus_bits", sectionCode: "memory", sectionLabelPt: "Memória e interconexão", displayOrder: 370, valueType: "number", unit: "bits", patterns: [/memory interface width/i, /memory bus/i] },
  { code: "boost_clock_ghz", sectionCode: "acceleration", sectionLabelPt: "Aceleradores e processamento", displayOrder: 550, valueType: "number", unit: "GHz", patterns: [/^boost clock(?: \(ghz\))?$/i] },
  { code: "video_decode", sectionCode: "video", sectionLabelPt: "Codificação e decodificação de vídeo", displayOrder: 600, valueType: "string", unit: null, patterns: [/decode/i, /nvdec/i] },
  { code: "video_encode", sectionCode: "video", sectionLabelPt: "Codificação e decodificação de vídeo", displayOrder: 610, valueType: "string", unit: null, patterns: [/encode/i, /nvenc/i] },
  { code: "process_nm", sectionCode: "physical", sectionLabelPt: "Construção, encapsulamento e dimensões", displayOrder: 700, valueType: "number", unit: "nm", patterns: [/lithography/i, /process technology/i] },
  { code: "socket", sectionCode: "physical", sectionLabelPt: "Construção, encapsulamento e dimensões", displayOrder: 710, valueType: "string", unit: null, patterns: [/sockets supported/i, /^cpu socket$/i, /^socket$/i] },
  { code: "package", sectionCode: "physical", sectionLabelPt: "Construção, encapsulamento e dimensões", displayOrder: 720, valueType: "string", unit: null, patterns: [/package specifications/i, /^package$/i] },
  { code: "dimensions_mm", sectionCode: "physical", sectionLabelPt: "Construção, encapsulamento e dimensões", displayOrder: 730, valueType: "string", unit: "mm", patterns: [/card dimensions/i, /^length$/i, /^dimensions$/i] },
  { code: "base_power_watts", sectionCode: "power_thermal", sectionLabelPt: "Alimentação e limites térmicos", displayOrder: 800, valueType: "number", unit: "W", patterns: [/processor base power/i, /^default tdp$/i, /^tdp$/i] },
  { code: "turbo_power_watts", sectionCode: "power_thermal", sectionLabelPt: "Alimentação e limites térmicos", displayOrder: 810, valueType: "number", unit: "W", patterns: [/maximum turbo power/i] },
  { code: "continuous_power_watts", sectionCode: "power_thermal", sectionLabelPt: "Alimentação e limites térmicos", displayOrder: 820, valueType: "number", unit: "W", patterns: [/total graphics power/i, /graphics card power/i, /^board power$/i] },
  { code: "maximum_temperature_c", sectionCode: "power_thermal", sectionLabelPt: "Alimentação e limites térmicos", displayOrder: 830, valueType: "number", unit: "°C", patterns: [/tjunction/i, /max\. operating temperature/i, /maximum temperature/i] },
  { code: "instruction_set_extensions", sectionCode: "software_security", sectionLabelPt: "Software, instruções e segurança", displayOrder: 900, valueType: "string", unit: null, patterns: [/instruction set extensions/i] },
  { code: "virtualization", sectionCode: "software_security", sectionLabelPt: "Software, instruções e segurança", displayOrder: 910, valueType: "string", unit: null, patterns: [/virtualization technology/i] },
];

function text(value: string): string {
  return value
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&deg;/gi, "°")
    .replace(/\s+/g, " ")
    .trim();
}

function pairsFromHtml(html: string): Array<{ label: string; value: string; locator: string }> {
  const result: Array<{ label: string; value: string; locator: string }> = [];
  const intelRows = html.split(/<div\b[^>]*class=["'][^"']*tech-section-row[^"']*["'][^>]*>/gi).slice(1);
  for (const [index, row] of intelRows.entries()) {
    const label = text(/class=["'][^"']*tech-label[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(row)?.[1] ?? "");
    const value = text(/class=["'][^"']*tech-data[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(row)?.[1] ?? "");
    if (label && value) result.push({ label, value, locator: `html:.tech-section-row[${index}]` });
  }
  for (const [index, match] of [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].entries()) {
    const cells = [...(match[1] ?? "").matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => text(cell[1] ?? ""));
    const labelIndex = cells.length >= 3 ? 1 : 0;
    if (cells[labelIndex] && cells[labelIndex + 1]) result.push({ label: cells[labelIndex]!, value: cells.slice(labelIndex + 1).join("; "), locator: `html:table-row[${index}]` });
  }
  for (const [index, match] of [...html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)].entries()) {
    const label = text(match[1] ?? ""); const value = text(match[2] ?? "");
    if (label && value) result.push({ label, value, locator: `html:definition[${index}]` });
  }
  return [...new Map(result.map((item) => [`${item.label}\u0000${item.value}`, item])).values()];
}

function mappingFor(label: string): FieldMapping | null {
  return fields.find((field) => field.patterns.some((pattern) => pattern.test(label.trim()))) ?? null;
}

function normalizedNumber(value: string, unit: string | null): number | null {
  const number = Number(value.replace(/,/g, "").match(/[-+]?\d+(?:\.\d+)?/)?.[0]);
  if (!Number.isFinite(number)) return null;
  if (unit === "GB" && /\bTB\b/i.test(value)) return number * 1024;
  return number;
}

function normalizedBoolean(value: string): boolean | null {
  if (/^(yes|sim|supported|true)\b/i.test(value)) return true;
  if (/^(no|não|not supported|false)\b/i.test(value)) return false;
  return null;
}

export function extractManufacturerSpecificationObservations(
  source: CatalogSource,
  url: string,
  contentType: string,
  html: string,
  retrievedAt: string,
): SourceObservation[] {
  if (!contentType.includes("html")) return [];
  const target = manufacturerSourceTarget(source.id, url);
  if (!target) return [];
  const contentHash = createHash("sha256").update(html).digest("hex");
  const seen = new Set<string>();
  const results: SourceObservation[] = [];
  for (const pair of pairsFromHtml(html)) {
    const primary = mappingFor(pair.label);
    const selected: Array<{ mapping: FieldMapping; normalizedValue: string | number | boolean | null }> = [];
    if (primary) {
      selected.push({
        mapping: primary,
        normalizedValue: primary.valueType === "number" ? normalizedNumber(pair.value, primary.unit)
          : primary.valueType === "boolean" ? normalizedBoolean(pair.value) : pair.value,
      });
    }
    if (/^standard memory config$/i.test(pair.label)) {
      const memoryType = /\b(?:GDDR|HBM)\w*\b/i.exec(pair.value)?.[0];
      const mapping = fields.find((field) => field.code === "memory_type");
      if (mapping && memoryType) selected.push({ mapping, normalizedValue: memoryType.toUpperCase() });
    }
    if (/tensor cores/i.test(pair.label)) {
      const tops = /([0-9,.]+)\s*AI\s*TOPS/i.exec(pair.value)?.[1];
      const mapping = fields.find((field) => field.code === "tensor_performance_tops");
      if (mapping && tops) selected.push({ mapping, normalizedValue: Number(tops.replaceAll(",", "")) });
    }
    for (const { mapping, normalizedValue } of selected) {
      if (normalizedValue === null || seen.has(mapping.code)) continue;
      seen.add(mapping.code);
      results.push({
        id: `${source.id}:${contentHash}:manufacturer-field:${mapping.code}`,
      sourceId: source.id,
      retrievedAt,
      url,
      contentType,
      contentHash,
      evidenceLocator: `${pair.locator}:${pair.label}`,
      payload: {
        kind: "manufacturer_specification_field",
        componentId: target.componentId,
        manufacturer: target.manufacturer,
        canonicalMpn: target.canonicalMpn,
        scope: target.scope,
        subject: target.subject,
        authority: target.authority,
        parserId: target.parserId,
        parserVersion: "1.0.0",
        fieldCode: mapping.code,
        sectionCode: mapping.sectionCode,
        sectionLabelPt: mapping.sectionLabelPt,
        displayOrder: mapping.displayOrder,
        valueType: mapping.valueType,
        originalLabel: pair.label,
        originalValue: pair.value,
        originalUnit: null,
        normalizedValue,
        normalizedUnit: mapping.unit,
        licensePolicy: "Fato técnico normalizado com atribuição e rastreabilidade; o documento-fonte não é redistribuído.",
      },
      });
    }
  }
  return results;
}
