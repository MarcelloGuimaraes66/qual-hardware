import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { arch, cpus, networkInterfaces, platform, release, totalmem } from "node:os";
import { promisify } from "node:util";
import { canonicalSha256 } from "../engine/calibrationProfile.js";
import type {
  CalibrationHardwarePreflight,
  HardwareFingerprint,
  HardwareNodeTemplate,
  OperatingSystemFamily,
} from "../shared/types.js";

const execFileAsync = promisify(execFile);

export function calibrationHardwareDigest(input: CalibrationHardwarePreflight | HardwareFingerprint): string {
  return canonicalSha256({
    cpuModel: normalizeCalibrationHardwareModel(input.cpuModel),
    cpuArchitecture: input.cpuArchitecture,
    physicalCores: input.physicalCores,
    logicalCores: input.logicalCores,
    gpuModel: normalizeCalibrationHardwareModel(input.gpuModel),
    gpuArchitecture: input.gpuArchitecture,
    gpuCount: input.gpuCount,
    gpuVramBytes: input.gpuVramBytes,
    gpuDriver: input.gpuDriver,
    ramBytes: input.ramBytes,
    operatingSystem: input.operatingSystem,
    operatingSystemVersion: input.operatingSystemVersion,
    formFactor: input.formFactor ?? "unknown",
  });
}

export function calibrationOperatingSystem(): OperatingSystemFamily {
  return platform() === "darwin" ? "macos" : platform() === "win32" ? "windows" : "ubuntu";
}

export function normalizeCalibrationHardwareModel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizedInventoryModel(value: string): string {
  return normalizeCalibrationHardwareModel(value
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:r|tm|processor|graphics|integrated|generation|gpu)\b/gi, " "));
}

interface CalibrationHardwareIdentity {
  cpuModel: string;
  physicalCores: number;
  gpuModel: string;
  gpuCount: number;
  ramBytes: number;
  operatingSystem: OperatingSystemFamily;
  formFactor: "laptop" | "mini_pc" | "workstation" | "rack" | "unknown" | null;
}

/**
 * Links a physical measurement to a catalog template without copying catalog
 * metadata into the measurement. Model inventories vary between operating
 * systems, so trademark and descriptive inventory tokens are ignored while
 * vendor, model, core count, memory, GPU count, OS and chassis must agree.
 */
export function calibrationHardwareMatchesTemplate(
  detected: CalibrationHardwareIdentity,
  template: HardwareNodeTemplate,
): boolean {
  const cpu = normalizedInventoryModel(detected.cpuModel);
  const expectedCpu = normalizedInventoryModel(template.cpuModel);
  const gpu = normalizedInventoryModel(detected.gpuModel);
  const expectedGpu = normalizedInventoryModel(template.gpuModel);
  const cpuMatches = cpu.includes(template.cpuVendor) &&
    (cpu.includes(expectedCpu) || expectedCpu.includes(cpu));
  const gpuMatches = gpu.includes(template.gpuVendor) &&
    (gpu.includes(expectedGpu) || expectedGpu.includes(gpu));
  const expectedMemoryBytes = template.ramGb * 1024 ** 3;
  const memoryMatches = Math.abs(detected.ramBytes - expectedMemoryBytes) /
    Math.max(1, expectedMemoryBytes) <= 0.1;
  return cpuMatches && gpuMatches && memoryMatches &&
    detected.operatingSystem === template.operatingSystemFamily &&
    detected.physicalCores === template.physicalCores &&
    detected.gpuCount === template.gpuCount &&
    detected.formFactor === template.kind;
}

async function formFactor(): Promise<CalibrationHardwarePreflight["formFactor"]> {
  try {
    if (platform() === "darwin") {
      const { stdout } = await execFileAsync("system_profiler", ["SPHardwareDataType", "-json"], { timeout: 10_000, maxBuffer: 2_000_000 });
      const description = normalizeCalibrationHardwareModel(stdout);
      if (description.includes("macbook")) return "laptop";
      if (description.includes("mac mini")) return "mini_pc";
      if (description.includes("mac studio") || description.includes("mac pro")) return "workstation";
      return null;
    }
    let chassisTypes: number[];
    if (platform() === "win32") {
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        "@(Get-CimInstance Win32_SystemEnclosure).ChassisTypes | ConvertTo-Json -Compress"], { timeout: 10_000 });
      const parsed = JSON.parse(stdout) as number | number[];
      chassisTypes = Array.isArray(parsed) ? parsed : [parsed];
    } else {
      chassisTypes = [Number((await readFile("/sys/class/dmi/id/chassis_type", "utf8")).trim())];
    }
    if (chassisTypes.some((type) => [8, 9, 10, 14, 30, 31, 32].includes(type))) return "laptop";
    if (chassisTypes.some((type) => [23, 28].includes(type))) return "rack";
    if (chassisTypes.some((type) => [34, 35, 36].includes(type))) return "mini_pc";
    if (chassisTypes.some((type) => [3, 4, 5, 6, 7, 15, 16, 17, 24].includes(type))) return "workstation";
    return null;
  } catch {
    return null;
  }
}

async function physicalCores(logicalCores: number): Promise<number> {
  try {
    if (platform() === "darwin") {
      const { stdout } = await execFileAsync("sysctl", ["-n", "hw.physicalcpu"], { timeout: 5_000 });
      const count = Number(stdout.trim());
      return Number.isInteger(count) && count > 0 ? count : logicalCores;
    }
    if (platform() === "win32") {
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        "(Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum"], { timeout: 10_000 });
      const count = Number(stdout.trim());
      return Number.isInteger(count) && count > 0 ? count : logicalCores;
    }
    const { stdout } = await execFileAsync("lscpu", ["-p=CORE,SOCKET"], { timeout: 5_000 });
    return Math.max(1, new Set(stdout.split("\n").filter((line) => line && !line.startsWith("#"))).size);
  } catch {
    return logicalCores;
  }
}

async function gpu(): Promise<Pick<CalibrationHardwarePreflight, "gpuModel" | "gpuDriver" | "gpuArchitecture" | "gpuCount" | "gpuVramBytes">> {
  try {
    if (platform() === "darwin") {
      const { stdout } = await execFileAsync("system_profiler", ["SPDisplaysDataType", "-json"], { timeout: 10_000, maxBuffer: 2_000_000 });
      const items = (JSON.parse(stdout) as { SPDisplaysDataType?: Array<Record<string, unknown>> }).SPDisplaysDataType ?? [];
      const item = items[0] ?? {};
      return { gpuModel: String(item.sppci_model ?? "Apple GPU"), gpuDriver: String(item.spdisplays_metal ?? "Metal"), gpuArchitecture: "Apple GPU", gpuCount: Math.max(1, items.length), gpuVramBytes: null };
    }
    try {
      const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=name,driver_version,memory.total", "--format=csv,noheader,nounits"], { timeout: 10_000 });
      const rows = stdout.trim().split("\n").filter(Boolean).map((line) => line.split(",").map((value) => value.trim()));
      if (rows.length > 0) return {
        gpuModel: [...new Set(rows.map((row) => row[0] ?? "NVIDIA GPU"))].join(" + "),
        gpuDriver: rows[0]?.[1] ?? "nvidia-smi",
        gpuArchitecture: "NVIDIA CUDA",
        gpuCount: rows.length,
        gpuVramBytes: rows.reduce((sum, row) => sum + Number(row[2] ?? 0) * 1024 ** 2, 0),
      };
    } catch { /* Use the operating-system inventory when NVIDIA telemetry is absent. */ }
    if (platform() === "win32") {
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM | ConvertTo-Json -Compress"], { timeout: 10_000 });
      const parsed = JSON.parse(stdout) as { Name?: string; DriverVersion?: string; AdapterRAM?: number } | Array<{ Name?: string; DriverVersion?: string; AdapterRAM?: number }>;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return { gpuModel: items.map((item) => item.Name ?? "GPU unavailable").join(" + "), gpuDriver: items.map((item) => item.DriverVersion ?? "unavailable").join(" + "), gpuArchitecture: "detected", gpuCount: items.length, gpuVramBytes: items.reduce((sum, item) => sum + Number(item.AdapterRAM ?? 0), 0) || null };
    }
    const { stdout } = await execFileAsync("lspci", ["-mm"], { timeout: 10_000 });
    const lines = stdout.split("\n").filter((value) => /vga|3d controller/i.test(value));
    return { gpuModel: lines.join(" + ") || "GPU unavailable", gpuDriver: "kernel", gpuArchitecture: "detected", gpuCount: lines.length, gpuVramBytes: null };
  } catch {
    return { gpuModel: "GPU unavailable", gpuDriver: "unavailable", gpuArchitecture: "unavailable", gpuCount: 0, gpuVramBytes: null };
  }
}

async function networkLinks(): Promise<CalibrationHardwarePreflight["networkLinks"]> {
  const names = Object.entries(networkInterfaces()).filter(([, addresses]) =>
    (addresses ?? []).some((address) => !address.internal)).map(([name]) => name);
  if (platform() === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object Name,LinkSpeed,MediaConnectionState,FullDuplex | ConvertTo-Json -Compress"], { timeout: 10_000 });
      const parsed = JSON.parse(stdout) as Record<string, unknown> | Array<Record<string, unknown>>;
      return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => {
        const speedText = String(item.LinkSpeed ?? "");
        const value = Number(speedText.match(/[0-9.]+/)?.[0] ?? 0);
        const speedMbps = /gbps/i.test(speedText) ? value * 1_000 : /mbps/i.test(speedText) ? value : null;
        const duplex = item.FullDuplex === true ? "full" as const : item.FullDuplex === false ? "half" as const : "unknown" as const;
        return { name: String(item.Name ?? "adapter"), speedMbps, duplex, physicalLinkVerified: speedMbps !== null };
      });
    } catch { /* Fall back to interface identity only. */ }
  }
  if (platform() === "linux") {
    return await Promise.all(names.filter((name) => /^[a-zA-Z0-9_.-]+$/.test(name)).map(async (name) => {
      const speed = await readFile(`/sys/class/net/${name}/speed`, "utf8").then((value) => Number(value.trim())).catch(() => NaN);
      const duplexText = await readFile(`/sys/class/net/${name}/duplex`, "utf8").then((value) => value.trim().toLowerCase()).catch(() => "unknown");
      const speedMbps = Number.isFinite(speed) && speed > 0 ? speed : null;
      return { name, speedMbps, duplex: duplexText === "full" ? "full" as const : duplexText === "half" ? "half" as const : "unknown" as const, physicalLinkVerified: speedMbps !== null };
    }));
  }
  if (platform() === "darwin") {
    return await Promise.all(names.filter((name) => /^[a-zA-Z0-9_.-]+$/.test(name)).map(async (name) => {
      try {
        const { stdout } = await execFileAsync("ifconfig", [name], { timeout: 5_000, maxBuffer: 500_000 });
        const activeMedia = stdout.match(/^\s*media:\s.*\(([^)]*)\)/mi)?.[1] ?? "";
        const baseT = activeMedia.match(/(\d+(?:\.\d+)?)\s*(G?)base[-A-Za-z0-9]*/i);
        const speedMbps = baseT
          ? Number(baseT[1]) * (baseT[2]?.toLowerCase() === "g" ? 1_000 : 1)
          : null;
        const duplex = /full-duplex/i.test(activeMedia) ? "full" as const
          : /half-duplex/i.test(activeMedia) ? "half" as const : "unknown" as const;
        return { name, speedMbps, duplex, physicalLinkVerified: speedMbps !== null };
      } catch {
        return { name, speedMbps: null, duplex: "unknown" as const, physicalLinkVerified: false };
      }
    }));
  }
  return names.map((name) => ({ name, speedMbps: null, duplex: "unknown" as const, physicalLinkVerified: false }));
}

export async function detectCalibrationHardware(): Promise<CalibrationHardwarePreflight> {
  const logicalCores = Math.max(1, cpus().length);
  const detectedGpu = await gpu();
  return {
    schemaVersion: "qual-hardware-calibration-hardware/1.0.0",
    detectedAt: new Date().toISOString(),
    cpuModel: cpus()[0]?.model ?? "CPU unavailable",
    cpuArchitecture: arch(),
    physicalCores: await physicalCores(logicalCores),
    logicalCores,
    ...detectedGpu,
    ramBytes: totalmem(),
    operatingSystem: calibrationOperatingSystem(),
    operatingSystemVersion: release(),
    formFactor: await formFactor(),
    networkLinks: await networkLinks(),
  };
}
