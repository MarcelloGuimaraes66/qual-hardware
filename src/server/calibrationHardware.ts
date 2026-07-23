import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { arch, cpus, networkInterfaces, platform, release, totalmem } from "node:os";
import { promisify } from "node:util";
import { canonicalSha256 } from "../engine/calibrationProfile.js";
import { CALIBRATION_HARDWARE_VERSION } from "../shared/types.js";
import type {
  CalibrationCpuPackage,
  CalibrationGpuDevice,
  CalibrationHardwarePreflight,
  CalibrationNumaNode,
  CalibrationProcessorGroup,
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
    cpuPackages: input.cpuPackages ?? [],
    processorGroups: input.processorGroups ?? [],
    numaNodes: input.numaNodes ?? [],
    gpuDevices: (input.gpuDevices ?? []).map((device) => ({
      id: device.id,
      uuid: device.uuid,
      pciBusId: device.pciBusId,
      name: normalizeCalibrationHardwareModel(device.name),
      classification: device.classification,
      vramBytes: device.vramBytes,
      numaNodeId: device.numaNodeId,
    })),
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

export function calibrationProcessorGroups(logicalCores: number): CalibrationProcessorGroup[] {
  const groups: CalibrationProcessorGroup[] = [];
  for (let first = 0, id = 0; first < logicalCores; first += 64, id += 1) {
    const count = Math.min(64, logicalCores - first);
    groups.push({
      id,
      logicalProcessorCount: count,
      activeProcessorMask: count === 64 ? "0xffffffffffffffff" : `0x${((1n << BigInt(count)) - 1n).toString(16)}`,
    });
  }
  return groups;
}

async function windowsGroupAndNumaTopology(logicalCores: number, ramBytes: number): Promise<{
  processorGroups: CalibrationProcessorGroup[];
  numaNodes: Array<Pick<CalibrationNumaNode, "id" | "processorGroupIds" | "logicalProcessorCount" | "memoryBytes">>;
}> {
  const fallbackGroups = calibrationProcessorGroups(logicalCores);
  const script = String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QualHardwareTopology {
  [StructLayout(LayoutKind.Sequential)]
  public struct GROUP_AFFINITY {
    public UIntPtr Mask;
    public ushort Group;
    public ushort Reserved0;
    public ushort Reserved1;
    public ushort Reserved2;
  }
  [DllImport("kernel32.dll")] public static extern ushort GetActiveProcessorGroupCount();
  [DllImport("kernel32.dll")] public static extern uint GetActiveProcessorCount(ushort groupNumber);
  [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetNumaHighestNodeNumber(out uint highestNodeNumber);
  [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetNumaNodeProcessorMaskEx(ushort node, out GROUP_AFFINITY groupAffinity);
}
'@
$groups=@()
$groupCount=[QualHardwareTopology]::GetActiveProcessorGroupCount()
for($group=0;$group -lt $groupCount;$group++){
  $count=[QualHardwareTopology]::GetActiveProcessorCount([uint16]$group)
  $mask=if($count -ge 64){'0xffffffffffffffff'}else{'0x{0:x}' -f (([uint64]1 -shl $count)-1)}
  $groups += [pscustomobject]@{id=$group;logicalProcessorCount=$count;activeProcessorMask=$mask}
}
$nodes=@()
$highest=[uint32]0
if([QualHardwareTopology]::GetNumaHighestNodeNumber([ref]$highest)){
  for($node=0;$node -le $highest;$node++){
    $affinity=New-Object QualHardwareTopology+GROUP_AFFINITY
    if([QualHardwareTopology]::GetNumaNodeProcessorMaskEx([uint16]$node,[ref]$affinity)){
      $value=$affinity.Mask.ToUInt64()
      $count=0
      while($value -ne 0){$count += [int]($value -band 1); $value=$value -shr 1}
      $nodes += [pscustomobject]@{id=$node;processorGroupId=[int]$affinity.Group;logicalProcessorCount=$count}
    }
  }
}
[pscustomobject]@{processorGroups=$groups;numaNodes=$nodes} | ConvertTo-Json -Compress -Depth 5`;
  try {
    const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 15_000, maxBuffer: 2_000_000 });
    const parsed = JSON.parse(stdout) as {
      processorGroups?: Array<{ id?: number; logicalProcessorCount?: number; activeProcessorMask?: string }>;
      numaNodes?: Array<{ id?: number; processorGroupId?: number; logicalProcessorCount?: number }>;
    };
    const groups = (parsed.processorGroups ?? []).map((item): CalibrationProcessorGroup => ({
      id: Number(item.id ?? 0),
      logicalProcessorCount: Math.max(1, Number(item.logicalProcessorCount ?? 1)),
      activeProcessorMask: item.activeProcessorMask ? String(item.activeProcessorMask) : null,
    }));
    const nodes = (parsed.numaNodes ?? []).map((item) => ({
      id: Number(item.id ?? 0),
      processorGroupIds: [Number(item.processorGroupId ?? 0)],
      logicalProcessorCount: Math.max(1, Number(item.logicalProcessorCount ?? logicalCores)),
      memoryBytes: null as number | null,
    }));
    const totalNodeThreads = nodes.reduce((sum, item) => sum + item.logicalProcessorCount, 0);
    for (const node of nodes) {
      node.memoryBytes = Math.floor(ramBytes * node.logicalProcessorCount / Math.max(1, totalNodeThreads));
    }
    return {
      processorGroups: groups.length > 0 ? groups : fallbackGroups,
      numaNodes: nodes,
    };
  } catch {
    return { processorGroups: fallbackGroups, numaNodes: [] };
  }
}

async function cpuTopology(
  cpuModel: string,
  physicalCoreCount: number,
  logicalCoreCount: number,
  ramBytes: number,
): Promise<{
  cpuPackages: CalibrationCpuPackage[];
  processorGroups: CalibrationProcessorGroup[];
  numaNodes: CalibrationNumaNode[];
}> {
  let groups = calibrationProcessorGroups(logicalCoreCount);
  try {
    if (platform() === "win32") {
      const nativeTopology = await windowsGroupAndNumaTopology(logicalCoreCount, ramBytes);
      groups = nativeTopology.processorGroups;
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_Processor | Select-Object DeviceID,Name,NumberOfCores,NumberOfLogicalProcessors | ConvertTo-Json -Compress"], { timeout: 10_000 });
      const parsed = JSON.parse(stdout) as Record<string, unknown> | Array<Record<string, unknown>>;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const packages = items.map((item, index): CalibrationCpuPackage => ({
        id: String(item.DeviceID ?? `package-${index}`),
        model: String(item.Name ?? cpuModel),
        physicalCores: Math.max(1, Number(item.NumberOfCores ?? physicalCoreCount)),
        logicalCores: Math.max(1, Number(item.NumberOfLogicalProcessors ?? logicalCoreCount)),
        processorGroupIds: groups.map((group) => group.id),
        numaNodeIds: [index],
      }));
      const totalPackageThreads = packages.reduce((sum, item) => sum + item.logicalCores, 0);
      return {
        cpuPackages: packages,
        processorGroups: groups,
        numaNodes: nativeTopology.numaNodes.length > 0
          ? nativeTopology.numaNodes.map((node) => ({
              ...node,
              cpuPackageIds: packages
                .filter((item) => item.numaNodeIds.includes(node.id))
                .map((item) => item.id)
                .concat(packages.length === 1 ? [packages[0]!.id] : [])
                .filter((id, index, all) => all.indexOf(id) === index),
            }))
          : packages.map((item, index) => ({
              id: index,
              processorGroupIds: groups.map((group) => group.id),
              logicalProcessorCount: item.logicalCores,
              memoryBytes: Math.floor(ramBytes * item.logicalCores / Math.max(1, totalPackageThreads)),
              cpuPackageIds: [item.id],
            })),
      };
    }
    if (platform() === "linux") {
      const { stdout } = await execFileAsync("lscpu", ["-p=CPU,CORE,SOCKET,NODE"], { timeout: 10_000 });
      const rows = stdout.split(/\r?\n/).filter((line) => line && !line.startsWith("#"))
        .map((line) => line.split(",").map((value) => Number(value)));
      const socketIds = [...new Set(rows.map((row) => row[2] ?? 0))].sort((left, right) => left - right);
      const nodeIds = [...new Set(rows.map((row) => row[3] ?? 0))].sort((left, right) => left - right);
      const packages = socketIds.map((socketId): CalibrationCpuPackage => {
        const packageRows = rows.filter((row) => (row[2] ?? 0) === socketId);
        return {
          id: `socket-${socketId}`,
          model: cpuModel,
          physicalCores: new Set(packageRows.map((row) => row[1])).size,
          logicalCores: packageRows.length,
          processorGroupIds: groups.map((group) => group.id),
          numaNodeIds: [...new Set(packageRows.map((row) => row[3] ?? 0))],
        };
      });
      const numaNodes: CalibrationNumaNode[] = [];
      for (const nodeId of nodeIds) {
        const nodeRows = rows.filter((row) => (row[3] ?? 0) === nodeId);
        const memoryBytes = await readFile(`/sys/devices/system/node/node${nodeId}/meminfo`, "utf8")
          .then((text) => Number(text.match(/MemTotal:\s+(\d+)\s+kB/i)?.[1] ?? 0) * 1024)
          .catch(() => 0);
        numaNodes.push({
          id: nodeId,
          processorGroupIds: groups.map((group) => group.id),
          logicalProcessorCount: nodeRows.length,
          memoryBytes: memoryBytes || null,
          cpuPackageIds: [...new Set(nodeRows.map((row) => `socket-${row[2] ?? 0}`))],
        });
      }
      return { cpuPackages: packages, processorGroups: groups, numaNodes };
    }
  } catch { /* Fall through to a conservative single-package topology. */ }
  return {
    cpuPackages: [{
      id: "package-0", model: cpuModel, physicalCores: physicalCoreCount, logicalCores: logicalCoreCount,
      processorGroupIds: groups.map((group) => group.id), numaNodeIds: [0],
    }],
    processorGroups: groups,
    numaNodes: [{
      id: 0, processorGroupIds: groups.map((group) => group.id), logicalProcessorCount: logicalCoreCount,
      memoryBytes: ramBytes, cpuPackageIds: ["package-0"],
    }],
  };
}

function gpuVendor(name: string): CalibrationGpuDevice["vendor"] {
  const identity = normalizedInventoryModel(name);
  if (identity.includes("nvidia")) return "nvidia";
  if (identity.includes("amd") || identity.includes("radeon")) return "amd";
  if (identity.includes("apple")) return "apple";
  return "intel";
}

async function gpuDevices(): Promise<CalibrationGpuDevice[]> {
  const devices: CalibrationGpuDevice[] = [];
  try {
    if (platform() === "darwin") {
      const { stdout } = await execFileAsync("system_profiler", ["SPDisplaysDataType", "-json"], { timeout: 10_000, maxBuffer: 2_000_000 });
      const items = (JSON.parse(stdout) as { SPDisplaysDataType?: Array<Record<string, unknown>> }).SPDisplaysDataType ?? [];
      return (items.length ? items : [{ sppci_model: "Apple GPU" }]).map((item, index) => ({
        id: `metal:${index}`, uuid: null, pciBusId: null, index,
        name: String(item.sppci_model ?? "Apple GPU"), vendor: "apple", driver: String(item.spdisplays_metal ?? "Metal"),
        architecture: "Apple GPU", inferenceBackend: "metal", mediaBackend: "videotoolbox",
        classification: "compute", vramBytes: null, numaNodeId: 0, computeEligible: true, mediaEligible: true,
        encodeSupported: true, decodeSupported: true,
        reason: "Apple unified-memory GPU detected; runtime preflight must confirm load and telemetry.",
      }));
    }
    try {
      const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=index,uuid,pci.bus_id,name,driver_version,memory.total", "--format=csv,noheader,nounits"], { timeout: 10_000 });
      const rows = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => line.split(",").map((value) => value.trim()));
      devices.push(...rows.map((row, position) => ({
        id: row[1] || `cuda:${row[0] ?? position}`,
        uuid: row[1] || null,
        pciBusId: row[2] || null,
        index: Number(row[0] ?? position),
        name: row[3] ?? "NVIDIA GPU",
        vendor: "nvidia" as const,
        driver: row[4] ?? "nvidia-smi",
        architecture: "NVIDIA CUDA",
        inferenceBackend: "cuda" as const,
        mediaBackend: "cuda_nvenc" as const,
        classification: "compute" as const,
        vramBytes: Number(row[5] ?? 0) * 1024 ** 2 || null,
        numaNodeId: null,
        computeEligible: true,
        mediaEligible: true,
        encodeSupported: true,
        decodeSupported: true,
        reason: "NVIDIA device detected by UUID/PCI identity; runtime preflight must confirm codecs and measured benefit.",
      })));
    } catch { /* Use the operating-system inventory when NVIDIA telemetry is absent. */ }
    if (platform() === "win32") {
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object PNPDeviceID,Name,AdapterCompatibility,DriverVersion,AdapterRAM | ConvertTo-Json -Compress"], { timeout: 10_000 });
      const parsed = JSON.parse(stdout) as Record<string, unknown> | Array<Record<string, unknown>>;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const [position, item] of items.entries()) {
        const name = String(item.Name ?? "GPU unavailable");
        if (devices.some((device) => normalizedInventoryModel(device.name) === normalizedInventoryModel(name))) continue;
        const vendor = gpuVendor(`${item.AdapterCompatibility ?? ""} ${name}`);
        const integratedIntel = vendor === "intel" && !/\barc\b/i.test(name);
        devices.push({
          id: String(item.PNPDeviceID ?? `display:${position}`),
          uuid: null, pciBusId: null, index: devices.length, name, vendor,
          driver: String(item.DriverVersion ?? "unavailable"),
          architecture: "Windows display adapter",
          inferenceBackend: integratedIntel ? "unavailable" : "vulkan",
          mediaBackend: vendor === "intel" ? "qsv" : vendor === "amd" ? "d3d11va_amf" : "unavailable",
          classification: integratedIntel ? "display_only" : "compute",
          vramBytes: Number(item.AdapterRAM ?? 0) || null,
          numaNodeId: null,
          computeEligible: !integratedIntel,
          mediaEligible: !integratedIntel,
          encodeSupported: false,
          decodeSupported: false,
          reason: integratedIntel
            ? "Integrated Intel adapter detected but excluded until a per-device media measurement proves benefit."
            : "Display adapter detected; runtime preflight must prove compute/media support before use.",
        });
      }
      return devices;
    }
    const { stdout } = await execFileAsync("lspci", ["-mm"], { timeout: 10_000 });
    const lines = stdout.split(/\r?\n/).filter((value) => /vga|3d controller/i.test(value));
    for (const [position, name] of lines.entries()) {
      if (devices.some((device) => normalizedInventoryModel(name).includes(normalizedInventoryModel(device.name)))) continue;
      const vendor = gpuVendor(name);
      devices.push({
        id: `pci-inventory:${position}`, uuid: null, pciBusId: null, index: devices.length, name, vendor,
        driver: "kernel", architecture: "PCI display adapter",
        inferenceBackend: vendor === "amd" ? "rocm" : vendor === "nvidia" ? "cuda" : "vulkan",
        mediaBackend: vendor === "nvidia" ? "cuda_nvenc" : vendor === "amd" || vendor === "intel" ? "vaapi" : "unavailable",
        classification: "compute", vramBytes: null, numaNodeId: null, computeEligible: true, mediaEligible: true,
        encodeSupported: false, decodeSupported: false,
        reason: "PCI display adapter detected; runtime preflight must prove device capabilities.",
      });
    }
  } catch { /* Return devices already proven by a stronger inventory provider. */ }
  return devices;
}

async function gpu(): Promise<Pick<CalibrationHardwarePreflight,
"gpuModel" | "gpuDriver" | "gpuArchitecture" | "gpuCount" | "gpuVramBytes" | "gpuDevices">> {
  const detected = await gpuDevices();
  const compute = detected.filter((device) => device.computeEligible);
  const aggregate = compute.length > 0 ? compute : detected.filter((device) => device.classification !== "unavailable");
  return {
    gpuModel: aggregate.map((device) => device.name).join(" + ") || "GPU unavailable",
    gpuDriver: [...new Set(aggregate.map((device) => device.driver))].join(" + ") || "unavailable",
    gpuArchitecture: [...new Set(aggregate.map((device) => device.architecture))].join(" + ") || "unavailable",
    gpuCount: compute.length,
    gpuVramBytes: compute.some((device) => device.vramBytes !== null)
      ? compute.reduce((sum, device) => sum + (device.vramBytes ?? 0), 0) : null,
    gpuDevices: detected,
  };
}

async function networkLinks(): Promise<CalibrationHardwarePreflight["networkLinks"]> {
  const names = Object.entries(networkInterfaces()).filter(([, addresses]) =>
    (addresses ?? []).some((address) => !address.internal)).map(([name]) => name);
  if (platform() === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | Select-Object Name,InterfaceDescription,LinkSpeed,MediaConnectionState,FullDuplex,PhysicalMediaType | ConvertTo-Json -Compress"], { timeout: 10_000 });
      const parsed = JSON.parse(stdout) as Record<string, unknown> | Array<Record<string, unknown>>;
      return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => {
        const speedText = String(item.LinkSpeed ?? "");
        const value = Number(speedText.match(/[0-9.]+/)?.[0] ?? 0);
        const speedMbps = /gbps/i.test(speedText) ? value * 1_000 : /mbps/i.test(speedText) ? value : null;
        const wireless = /wireless|wi-?fi|802\.11/i.test(`${item.Name ?? ""} ${item.InterfaceDescription ?? ""} ${item.PhysicalMediaType ?? ""}`);
        const duplex = wireless ? "unknown" as const
          : item.FullDuplex === true ? "full" as const : item.FullDuplex === false ? "half" as const : "unknown" as const;
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
  const cpuModel = cpus()[0]?.model ?? "CPU unavailable";
  const ramBytes = totalmem();
  const [physicalCoreCount, detectedGpu] = await Promise.all([physicalCores(logicalCores), gpu()]);
  const topology = await cpuTopology(cpuModel, physicalCoreCount, logicalCores, ramBytes);
  return {
    schemaVersion: CALIBRATION_HARDWARE_VERSION,
    detectedAt: new Date().toISOString(),
    cpuModel,
    cpuArchitecture: arch(),
    physicalCores: physicalCoreCount,
    logicalCores,
    ...detectedGpu,
    ...topology,
    ramBytes,
    operatingSystem: calibrationOperatingSystem(),
    operatingSystemVersion: release(),
    formFactor: await formFactor(),
    networkLinks: await networkLinks(),
  };
}
