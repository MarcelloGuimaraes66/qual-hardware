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
const APPLE_MACBOOK_PRO_SPECS = "https://www.apple.com/macbook-pro/specs/";
const APPLE_MACBOOK_PRO_STORE = "https://www.apple.com/shop/buy-mac/macbook-pro";
const DELL_PRECISION_3680 = "https://www.dell.com/en-us/shop/desktop-computers/precision-3680-tower-workstation/spd/precision-t3680-workstation";
const DELL_PRECISION = "https://www.dell.com/en-us/shop/dell-desktops-and-all-in-one-pcs/scr/desktops/appref=precision-product-line";
const HP_Z_WORKSTATIONS = "https://www.hp.com/us-en/workstations/desktop-workstation-pc.html";
const HP_Z8 = "https://www.hp.com/us-en/workstations/z8.html";
const LENOVO_P_SERIES = "https://www.lenovo.com/us/en/c/workstations/thinkstation-p-series/";
const LENOVO_PX = "https://www.lenovo.com/us/en/p/workstations/thinkstation-p-series/lenovo-thinkstation-px-intel-tower-workstation/len102s0013";

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
    hardwareTemplateId: "apple-macbook-pro-m4max-14c-32gpu-36gb", cpuModel: "Apple M4 Max (14-core CPU; 10 performance + 4 efficiency)", gpuModel: "Apple M4 Max integrated 32-core GPU", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([750, 350, 450, 550, 250, 80, 650, 119]),
    sourceUrls: [APPLE_MACBOOK_PRO_SPECS, APPLE_MACBOOK_PRO_STORE],
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
  {
    hardwareTemplateId: "dell-precision-3680-i9-rtx4000ada", cpuModel: "Intel Core i9-14900K (24 cores / 32 threads)", gpuModel: "NVIDIA RTX 4000 Ada Generation 20 GB", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([580, 700, 650, 1600, 300, 120, 900, 500]),
    sourceUrls: [DELL_PRECISION_3680, "https://www.nvidia.com/en-us/design-visualization/rtx-4000/"],
  },
  {
    hardwareTemplateId: "hp-z2-g1i-ultra9-rtx4500ada", cpuModel: "Intel Core Ultra 9 285K (24 cores / 24 threads)", gpuModel: "NVIDIA RTX 4500 Ada Generation 24 GB", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([620, 750, 650, 2250, 300, 120, 950, 550]),
    sourceUrls: [HP_Z_WORKSTATIONS, "https://www.nvidia.com/en-us/design-visualization/rtx-4500/"],
  },
  {
    hardwareTemplateId: "lenovo-p3-gen2-ultra9-rtx4000ada", cpuModel: "Intel Core Ultra 9 285K (24 cores / 24 threads)", gpuModel: "NVIDIA RTX 4000 Ada Generation 20 GB", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([620, 700, 650, 1600, 300, 120, 900, 550]),
    sourceUrls: [LENOVO_P_SERIES, "https://www.nvidia.com/en-us/design-visualization/rtx-4000/"],
  },
  {
    hardwareTemplateId: "dell-precision-7960-xeonw-rtx5000ada", cpuModel: "Intel Xeon W7-2495X (24 cores / 48 threads)", gpuModel: "NVIDIA RTX 5000 Ada Generation 32 GB", gpuCount: 1,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([2200, 1600, 1400, 4000, 700, 250, 1500, 800]),
    sourceUrls: [DELL_PRECISION, "https://www.nvidia.com/en-us/design-visualization/rtx-5000/"],
  },
  {
    hardwareTemplateId: "hp-z8-g5-dualxeon-2xrtx6000ada", cpuModel: "2× Intel Xeon workstation processors (64 cores total)", gpuModel: "NVIDIA RTX 6000 Ada Generation 48 GB", gpuCount: 2,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([6000, 3500, 3000, 13600, 1400, 600, 3000, 1500]),
    sourceUrls: [HP_Z8, "https://www.nvidia.com/en-us/design-visualization/rtx-6000/"],
  },
  {
    hardwareTemplateId: "lenovo-thinkstation-px-dualxeon-2xrtx6000ada", cpuModel: "2× Intel Xeon Scalable processors (64 cores total)", gpuModel: "NVIDIA RTX 6000 Ada Generation 48 GB", gpuCount: 2,
    observedAt: REFERENCE_COST_OBSERVED_AT, components: workstationComponents([6200, 3600, 3000, 13600, 1400, 600, 3200, 1600]),
    sourceUrls: [LENOVO_PX, "https://www.nvidia.com/en-us/design-visualization/rtx-6000/"],
  },
];

export function referenceCostProfile(template: HardwareNodeTemplate): ReferenceCostProfile | null {
  return REFERENCE_COST_PROFILES.find((profile) =>
    profile.hardwareTemplateId === template.id && profile.cpuModel === template.cpuModel &&
    profile.gpuModel === template.gpuModel && profile.gpuCount === template.gpuCount,
  ) ?? null;
}
