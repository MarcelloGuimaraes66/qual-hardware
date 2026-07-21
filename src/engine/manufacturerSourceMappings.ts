import { canonicalComponentId } from "./componentCatalog.js";
import type { HardwareComponentKind, ManufacturerSpecificationAuthority, ManufacturerSpecificationScope } from "../shared/types.js";

export interface ManufacturerSourceTarget {
  sourceId: string;
  url: string;
  componentId: string;
  kind: HardwareComponentKind;
  manufacturer: string;
  canonicalMpn: string;
  subject: string;
  scope: ManufacturerSpecificationScope;
  authority: ManufacturerSpecificationAuthority;
  parserId: "intel-ark-tech-section" | "manufacturer-spec-table" | "manufacturer-definition-list";
}

/**
 * The registry is intentionally exact and reviewable. A discovered page is
 * never attached to a catalog component by fuzzy matching. Adding a SKU
 * requires its official URL and the canonical component identifier.
 */
export const MANUFACTURER_SOURCE_TARGETS: readonly ManufacturerSourceTarget[] = [
  {
    sourceId: "spec-intel-ark",
    url: "https://www.intel.com/content/www/us/en/products/sku/241060/intel-core-ultra-9-processor-285k-36m-cache-up-to-5-70-ghz/specifications.html",
    componentId: canonicalComponentId("cpu", "intel", "Intel Core Ultra 9 285K (24 cores / 24 threads)"),
    kind: "cpu",
    manufacturer: "Intel",
    canonicalMpn: "Intel Core Ultra 9 285K",
    subject: "Intel Core Ultra 9 285K",
    scope: "sku",
    authority: "official_sku",
    parserId: "intel-ark-tech-section",
  },
  {
    sourceId: "spec-nvidia-products",
    url: "https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/",
    componentId: canonicalComponentId("gpu", "nvidia", "NVIDIA GeForce RTX 5090 32 GB"),
    kind: "gpu",
    manufacturer: "NVIDIA",
    canonicalMpn: "GeForce RTX 5090",
    subject: "NVIDIA GeForce RTX 5090",
    scope: "sku",
    authority: "official_sku",
    parserId: "manufacturer-spec-table",
  },
  {
    sourceId: "spec-amd-products",
    url: "https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-9-9950x.html",
    componentId: canonicalComponentId("cpu", "amd", "AMD Ryzen 9 9950X"),
    kind: "cpu",
    manufacturer: "AMD",
    canonicalMpn: "AMD Ryzen 9 9950X",
    subject: "AMD Ryzen 9 9950X",
    scope: "sku",
    authority: "official_sku",
    parserId: "manufacturer-spec-table",
  },
];

export function manufacturerSourceTargetsFor(sourceId: string): ManufacturerSourceTarget[] {
  return MANUFACTURER_SOURCE_TARGETS.filter((target) => target.sourceId === sourceId);
}

export function manufacturerSourceTarget(sourceId: string, url: string): ManufacturerSourceTarget | null {
  const normalized = new URL(url);
  normalized.hash = "";
  normalized.search = "";
  return MANUFACTURER_SOURCE_TARGETS.find((target) => {
    const expected = new URL(target.url);
    expected.hash = "";
    expected.search = "";
    return target.sourceId === sourceId && expected.toString().replace(/\/$/, "") === normalized.toString().replace(/\/$/, "");
  }) ?? null;
}
