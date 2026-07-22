import type { CalibrationHardwarePreflight } from "../shared/types.js";

export const REQUIRED_CALIBRATION_COMPUTE_MODES = ["cpu_only", "gpu_accelerated"] as const;
export type CalibrationComputeMode = typeof REQUIRED_CALIBRATION_COMPUTE_MODES[number];

export type CalibrationGpuInferenceBackend = "cuda" | "metal" | "vulkan" | "rocm" | "unavailable";
export type CalibrationGpuMediaBackend =
  | "cuda_nvenc"
  | "videotoolbox"
  | "qsv"
  | "d3d11va_amf"
  | "vaapi"
  | "unavailable";

export interface CalibrationGpuDevice {
  id: string;
  name: string;
  backend: Exclude<CalibrationGpuInferenceBackend, "unavailable">;
}

export interface CalibrationComputeCapabilities {
  cpuInferenceAvailable: boolean;
  gpuInferenceAvailable: boolean;
  gpuInferenceBackend: CalibrationGpuInferenceBackend;
  gpuInferenceDevice: CalibrationGpuDevice | null;
  gpuMediaAvailable: boolean;
  gpuMediaBackend: CalibrationGpuMediaBackend;
  failures: string[];
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function expectedGpuInferenceBackend(
  hardware: Pick<CalibrationHardwarePreflight, "gpuModel" | "gpuArchitecture" | "gpuCount"> | null,
  platform: NodeJS.Platform,
): CalibrationGpuInferenceBackend {
  if (!hardware || hardware.gpuCount < 1) return "unavailable";
  const identity = normalized(`${hardware.gpuModel} ${hardware.gpuArchitecture}`);
  if (platform === "darwin" || identity.includes("apple")) return "metal";
  if (identity.includes("nvidia") || identity.includes("cuda")) return "cuda";
  if (platform === "linux" && identity.includes("amd") && identity.includes("rocm")) return "rocm";
  return "vulkan";
}

export function parseLlamaGpuDevices(output: string): CalibrationGpuDevice[] {
  const devices: CalibrationGpuDevice[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(CUDA|Metal|Vulkan|ROCm)(\d*)\s*:\s*(.+?)\s*$/i);
    if (!match) continue;
    const prefix = match[1]!.toLowerCase();
    const backend = prefix === "cuda" ? "cuda" : prefix === "metal" ? "metal"
      : prefix === "rocm" ? "rocm" : "vulkan";
    const canonicalPrefix = backend === "cuda" ? "CUDA" : backend === "rocm" ? "ROCm"
      : backend === "metal" ? "Metal" : "Vulkan";
    const id = `${canonicalPrefix}${match[2] ?? ""}`;
    if (seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    devices.push({ id, name: match[3]!.trim(), backend });
  }
  return devices;
}

export function selectLlamaGpuDevice(input: {
  devices: CalibrationGpuDevice[];
  expectedBackend: CalibrationGpuInferenceBackend;
  gpuModel: string;
}): CalibrationGpuDevice | null {
  if (input.expectedBackend === "unavailable") return null;
  const preferred = input.devices.filter((device) => device.backend === input.expectedBackend);
  const candidates = preferred.length > 0
    ? preferred
    : input.expectedBackend === "cuda" || input.expectedBackend === "rocm"
      ? input.devices.filter((device) => device.backend === "vulkan")
      : [];
  if (candidates.length === 0) return null;
  const expectedTokens = normalized(input.gpuModel).split(" ").filter((token) => token.length >= 3);
  return [...candidates].sort((left, right) => {
    const score = (device: CalibrationGpuDevice): number => {
      const name = normalized(device.name);
      return expectedTokens.filter((token) => name.includes(token)).length;
    };
    return score(right) - score(left) || left.id.localeCompare(right.id);
  })[0] ?? null;
}

function capabilityTokens(output: string): Set<string> {
  return new Set(output.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
}

export function selectFfmpegGpuMediaBackend(input: {
  platform: NodeJS.Platform;
  gpuModel: string;
  requiredCodecs: Array<"h264" | "h265">;
  hardwareAcceleratorsOutput: string;
  encodersOutput: string;
}): CalibrationGpuMediaBackend {
  const accelerators = capabilityTokens(input.hardwareAcceleratorsOutput);
  const encoders = capabilityTokens(input.encodersOutput);
  const supports = (h264: string, h265: string): boolean =>
    input.requiredCodecs.every((codec) => encoders.has(codec === "h265" ? h265 : h264));
  const gpu = normalized(input.gpuModel);
  if ((gpu.includes("nvidia") || gpu.includes("geforce") || gpu.includes("quadro")) &&
      accelerators.has("cuda") && supports("h264_nvenc", "hevc_nvenc")) return "cuda_nvenc";
  if (input.platform === "darwin" && accelerators.has("videotoolbox") &&
      supports("h264_videotoolbox", "hevc_videotoolbox")) return "videotoolbox";
  if (gpu.includes("intel") && accelerators.has("qsv") && supports("h264_qsv", "hevc_qsv")) return "qsv";
  if (input.platform === "win32" && (gpu.includes("amd") || gpu.includes("radeon")) &&
      accelerators.has("d3d11va") && supports("h264_amf", "hevc_amf")) return "d3d11va_amf";
  if (input.platform === "linux" && accelerators.has("vaapi") && supports("h264_vaapi", "hevc_vaapi")) return "vaapi";
  return "unavailable";
}

export function llamaComputeArguments(
  mode: CalibrationComputeMode,
  gpuDevice: CalibrationGpuDevice | null,
): string[] {
  if (mode === "cpu_only") return ["--device", "none", "--n-gpu-layers", "0"];
  if (!gpuDevice) throw new Error("calibration_gpu_inference_device_unavailable");
  return ["--device", gpuDevice.id, "--n-gpu-layers", "999"];
}

export function ffmpegGpuInputArguments(backend: CalibrationGpuMediaBackend): string[] {
  if (backend === "cuda_nvenc") return ["-hwaccel", "cuda"];
  if (backend === "videotoolbox") return ["-hwaccel", "videotoolbox"];
  if (backend === "qsv") return ["-hwaccel", "qsv"];
  if (backend === "d3d11va_amf") return ["-hwaccel", "d3d11va"];
  if (backend === "vaapi") return ["-hwaccel", "vaapi"];
  throw new Error("calibration_gpu_media_backend_unavailable");
}

export function ffmpegEncoder(
  mode: CalibrationComputeMode,
  backend: CalibrationGpuMediaBackend,
  codec: "h264" | "h265",
): { encoder: string; extraArguments: string[] } {
  if (mode === "cpu_only") {
    return { encoder: codec === "h265" ? "libx265" : "libx264", extraArguments: ["-preset", "ultrafast"] };
  }
  if (backend === "cuda_nvenc") return { encoder: codec === "h265" ? "hevc_nvenc" : "h264_nvenc", extraArguments: ["-preset", "p1"] };
  if (backend === "videotoolbox") return { encoder: codec === "h265" ? "hevc_videotoolbox" : "h264_videotoolbox", extraArguments: [] };
  if (backend === "qsv") return { encoder: codec === "h265" ? "hevc_qsv" : "h264_qsv", extraArguments: [] };
  if (backend === "d3d11va_amf") return { encoder: codec === "h265" ? "hevc_amf" : "h264_amf", extraArguments: [] };
  if (backend === "vaapi") return { encoder: codec === "h265" ? "hevc_vaapi" : "h264_vaapi", extraArguments: [] };
  throw new Error("calibration_gpu_media_backend_unavailable");
}
