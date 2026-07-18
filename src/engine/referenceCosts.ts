import type { Currency, HardwareNodeTemplate } from "../shared/types.js";

export interface ReferenceCostComponentUsd {
  componentId: "cpu" | "motherboard" | "ram" | "gpu" | "storage" | "network" | "power_cooling_chassis" | "integration";
  component: string;
  usdPerNode: number;
}

export interface ReferenceCostProfile {
  hardwareTemplateId: string;
  cpuModel: string;
  gpuModel: string;
  gpuCount: number;
  observedAt: string;
  components: ReferenceCostComponentUsd[];
  sourceUrls: string[];
}

export const REFERENCE_COST_OBSERVED_AT = "2026-07-17T16:00:00.000Z";

export const REFERENCE_FX_FROM_USD: Record<Currency, { rate: number; sourceUrl: string }> = {
  USD: { rate: 1, sourceUrl: "https://www.federalreserve.gov/" },
  BRL: { rate: 5.0975, sourceUrl: "https://www.bcb.gov.br/conversao" },
  EUR: { rate: 1 / 1.1467, sourceUrl: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-usd.en.html" },
};

const NVIDIA_5090 = "https://marketplace.nvidia.com/en-us/consumer/graphics-cards/nvidia-geforce-rtx-5090/";
const NVIDIA_A6000 = "https://marketplace.nvidia.com/en-us/enterprise/laptops-workstations/nvidia-rtx-a6000/";
const NVIDIA_PRO_6000 = "https://marketplace.nvidia.com/en-us/enterprise/laptops-workstations/nvidia-rtx-pro-6000-blackwell-workstation-edition/";
const NVIDIA_PRO_5000 = "https://www.nvidia.com/content/dam/en-zz/Solutions/products/workstations/professional-desktop-gpus/rtx-pro-5000-blackwell/workstation-datasheet-blackwell-rtx-pro-5000-gtc25-spring-nvidia-3658700.pdf";
const NVIDIA_4070_TI_SUPER = "https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4070-family/";
const AMD_W7900 = "https://www.amd.com/en/products/graphics/workstations/radeon-pro/w7900.html";
const AMD_PROCESSORS = "https://www.amd.com/en/products/specifications/processors.html";
const INTEL_XEON = "https://www.intel.com/content/www/us/en/ark/products/series/240357/intel-xeon-6-processors.html";
const ASUS_VIVOBOOK_S16 = "https://www.asus.com/laptops/for-home/vivobook/asus-vivobook-s-16-oled-s5606/techspec/";
const ASUS_ZEPHYRUS_G16 = "https://rog.asus.com/laptops/rog-zephyrus/rog-zephyrus-g16-2025-gu605/spec/";
const APPLE_MAC_MINI_SPECS = "https://www.apple.com/mac-mini/specs/";
const APPLE_MAC_MINI_STORE = "https://www.apple.com/shop/buy-mac/mac-mini";
const APPLE_MAC_STUDIO_SPECS = "https://www.apple.com/mac-studio/specs/";
const APPLE_MAC_STUDIO_STORE = "https://www.apple.com/shop/buy-mac/mac-studio";

function workstationComponents(values: [number, number, number, number, number, number, number, number]): ReferenceCostComponentUsd[] {
  const ids: Array<ReferenceCostComponentUsd["componentId"]> = ["cpu", "motherboard", "ram", "gpu", "storage", "network", "power_cooling_chassis", "integration"];
  const labels = ["CPU", "Placa-mae / plataforma", "Memoria RAM", "GPU", "NVMe operacional", "Rede", "Fonte, refrigeracao e chassi", "Montagem e integracao"];
  return ids.map((componentId, index) => ({ componentId, component: labels[index]!, usdPerNode: values[index]! }));
}

export const REFERENCE_COST_PROFILES: ReferenceCostProfile[] = [
  {
    hardwareTemplateId: "ws-rtx4070tis-7950x", cpuModel: "AMD Ryzen 9 7950X", gpuModel: "NVIDIA GeForce RTX 4070 Ti SUPER 16 GB", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([480, 400, 350, 900, 300, 120, 750, 300]),
    sourceUrls: [NVIDIA_4070_TI_SUPER, AMD_PROCESSORS],
  },
  {
    hardwareTemplateId: "ws-rtx5090-9950x", cpuModel: "AMD Ryzen 9 9950X", gpuModel: "NVIDIA GeForce RTX 5090 32 GB", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([550, 500, 650, 1999, 350, 150, 1100, 400]),
    sourceUrls: [NVIDIA_5090, AMD_PROCESSORS],
  },
  {
    hardwareTemplateId: "ws-rtxpro5000-trpro", cpuModel: "AMD Ryzen Threadripper PRO 7975WX", gpuModel: "NVIDIA RTX PRO 5000 Blackwell 72 GB", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([3899, 1300, 2500, 6600, 800, 400, 1200, 800]),
    sourceUrls: [NVIDIA_PRO_5000, AMD_PROCESSORS],
  },
  {
    hardwareTemplateId: "ws-w7900-trpro", cpuModel: "AMD Ryzen Threadripper PRO 7975WX", gpuModel: "AMD Radeon PRO W7900 48 GB", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([3899, 1300, 2500, 3999, 800, 400, 1200, 800]),
    sourceUrls: [AMD_W7900, AMD_PROCESSORS],
  },
  {
    hardwareTemplateId: "rack-2x-pro6000-xeon", cpuModel: "Intel Xeon 674X (28 cores)", gpuModel: "NVIDIA RTX PRO 6000 Blackwell Server Edition 96 GB", gpuCount: 2,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([6000, 5000, 3000, 26500, 1500, 1000, 7000, 3000]),
    sourceUrls: [NVIDIA_PRO_6000, INTEL_XEON],
  },
  {
    hardwareTemplateId: "rack-4x-pro6000-dualxeon", cpuModel: "2× Intel Xeon 6962P (144 cores total)", gpuModel: "NVIDIA RTX PRO 6000 Blackwell Server Edition 96 GB", gpuCount: 4,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([12000, 8000, 6000, 53000, 2500, 1500, 14000, 5000]),
    sourceUrls: [NVIDIA_PRO_6000, INTEL_XEON],
  },
  {
    hardwareTemplateId: "ws-rtxa6000-trpro5975wx", cpuModel: "AMD Ryzen Threadripper PRO 5975WX", gpuModel: "NVIDIA RTX A6000 48 GB", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([3300, 900, 1000, 4650, 400, 250, 900, 500]),
    sourceUrls: [NVIDIA_A6000, AMD_PROCESSORS],
  },
  {
    hardwareTemplateId: "laptop-vivobook-s16-225h-16gb", cpuModel: "Intel Core Ultra 5 225H (14 cores / 16 threads)", gpuModel: "Integrated Intel Arc graphics", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([280, 120, 80, 90, 90, 40, 149, 50]),
    sourceUrls: [ASUS_VIVOBOOK_S16],
  },
  {
    hardwareTemplateId: "laptop-vivobook-s16-285h-32gb-user", cpuModel: "Intel Core Ultra 9 285H (16 cores / 16 threads, up to 5.4 GHz)", gpuModel: "Intel Arc 140T integrated (8 Xe cores, shared memory)", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([420, 150, 160, 150, 120, 60, 289, 50]),
    sourceUrls: [ASUS_VIVOBOOK_S16, "https://e-catalog.com/ASUS-S5606CA-SB92.htm"],
  },
  {
    hardwareTemplateId: "laptop-zephyrus-g16-285h-rtx5070", cpuModel: "Intel Core Ultra 9 285H (16 cores / 16 threads)", gpuModel: "NVIDIA GeForce RTX 5070 Laptop GPU 8 GB", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([450, 180, 170, 900, 150, 60, 489, 100]),
    sourceUrls: [ASUS_ZEPHYRUS_G16],
  },
  {
    hardwareTemplateId: "apple-mac-mini-m4-24gb", cpuModel: "Apple M4 (10-core CPU; 4 performance + 6 efficiency)", gpuModel: "Apple M4 integrated 10-core GPU", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([350, 180, 200, 180, 200, 100, 60, 29]),
    sourceUrls: [APPLE_MAC_MINI_SPECS, APPLE_MAC_MINI_STORE],
  },
  {
    hardwareTemplateId: "apple-mac-mini-m4pro-48gb", cpuModel: "Apple M4 Pro (14-core CPU; 10 performance + 4 efficiency)", gpuModel: "Apple M4 Pro integrated 20-core GPU", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([650, 250, 500, 500, 300, 100, 400, 99]),
    sourceUrls: [APPLE_MAC_MINI_SPECS, APPLE_MAC_MINI_STORE],
  },
  {
    hardwareTemplateId: "apple-mac-studio-m4max-64gb", cpuModel: "Apple M4 Max (16-core CPU; 12 performance + 4 efficiency)", gpuModel: "Apple M4 Max integrated 40-core GPU", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([800, 300, 650, 650, 250, 100, 550, 99]),
    sourceUrls: [APPLE_MAC_STUDIO_SPECS, APPLE_MAC_STUDIO_STORE],
  },
  {
    hardwareTemplateId: "apple-mac-studio-m3ultra-96gb", cpuModel: "Apple M3 Ultra (28-core CPU; 20 performance + 8 efficiency)", gpuModel: "Apple M3 Ultra integrated 60-core GPU", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([1200, 500, 900, 1100, 300, 100, 1099, 100]),
    sourceUrls: [APPLE_MAC_STUDIO_SPECS, APPLE_MAC_STUDIO_STORE],
  },
];

export function referenceCostProfile(template: HardwareNodeTemplate): ReferenceCostProfile | null {
  return REFERENCE_COST_PROFILES.find((profile) =>
    profile.hardwareTemplateId === template.id && profile.cpuModel === template.cpuModel &&
    profile.gpuModel === template.gpuModel && profile.gpuCount === template.gpuCount,
  ) ?? null;
}
