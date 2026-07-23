import { describe, expect, it } from "vitest";
import {
  expectedGpuInferenceBackend,
  ffmpegEncoder,
  ffmpegGpuInputArguments,
  llamaComputeArguments,
  parseLlamaGpuDevices,
  selectFfmpegGpuMediaBackend,
  selectLlamaGpuDevice,
} from "../src/server/calibrationCompute.js";

describe("mandatory CPU and GPU calibration compute paths", () => {
  it("selects CUDA and the physical RTX 5090 instead of a CPU-only backend", () => {
    const expected = expectedGpuInferenceBackend({
      gpuModel: "NVIDIA GeForce RTX 5090",
      gpuArchitecture: "NVIDIA CUDA",
      gpuCount: 1,
    }, "win32");
    expect(expected).toBe("cuda");
    const devices = parseLlamaGpuDevices([
      "Available devices:",
      "  CUDA0: NVIDIA GeForce RTX 5090 (32109 MiB, 31588 MiB free)",
      "  Vulkan0: Microsoft Basic Render Driver",
    ].join("\n"));
    const selected = selectLlamaGpuDevice({ devices, expectedBackend: expected, gpuModel: "NVIDIA GeForce RTX 5090" });
    expect(selected).toMatchObject({ id: "CUDA0", backend: "cuda", name: expect.stringContaining("RTX 5090") });
    expect(llamaComputeArguments("gpu_accelerated", selected)).toEqual([
      "--device", "CUDA0", "--n-gpu-layers", "999",
    ]);
  });

  it("forces the CPU lane to disable GPU offload even when a GPU exists", () => {
    expect(llamaComputeArguments("cpu_only", {
      id: "CUDA0", name: "NVIDIA GeForce RTX 5090", backend: "cuda",
    })).toEqual(["--device", "none", "--n-gpu-layers", "0"]);
    expect(ffmpegEncoder("cpu_only", "cuda_nvenc", "h265")).toEqual({
      encoder: "libx265", extraArguments: ["-preset", "ultrafast"],
    });
  });

  it("recognizes the MTL identifier emitted by llama.cpp on Apple Silicon", () => {
    const devices = parseLlamaGpuDevices([
      "Available devices:",
      "  MTL0: Apple M5 Pro (18186 MiB, 16832 MiB free)",
      "  BLAS: Accelerate (0 MiB, 0 MiB free)",
    ].join("\n"));
    expect(devices).toEqual([{ id: "MTL0", name: "Apple M5 Pro (18186 MiB, 16832 MiB free)", backend: "metal" }]);
    expect(selectLlamaGpuDevice({ devices, expectedBackend: "metal", gpuModel: "Apple M5 Pro" })?.id).toBe("MTL0");
    expect(llamaComputeArguments("gpu_accelerated", devices[0]!)).toContain("MTL0");
  });

  it("requires both NVIDIA decode and encoders before declaring GPU media available", () => {
    const available = selectFfmpegGpuMediaBackend({
      platform: "win32",
      gpuModel: "NVIDIA GeForce RTX 5090",
      requiredCodecs: ["h264", "h265"],
      hardwareAcceleratorsOutput: "Hardware acceleration methods:\n cuda\n d3d11va",
      encodersOutput: "V..... h264_nvenc\nV..... hevc_nvenc",
    });
    expect(available).toBe("cuda_nvenc");
    expect(ffmpegGpuInputArguments(available)).toEqual(["-hwaccel", "cuda"]);
    expect(ffmpegEncoder("gpu_accelerated", available, "h264").encoder).toBe("h264_nvenc");

    expect(selectFfmpegGpuMediaBackend({
      platform: "win32",
      gpuModel: "NVIDIA GeForce RTX 5090",
      requiredCodecs: ["h264", "h265"],
      hardwareAcceleratorsOutput: "cuda",
      encodersOutput: "h264_nvenc",
    })).toBe("unavailable");
  });

  it("uses the packaged Vulkan backend on Linux when an NVIDIA CUDA binary is not present", () => {
    const selected = selectLlamaGpuDevice({
      devices: [{ id: "Vulkan0", name: "NVIDIA GeForce RTX 5090", backend: "vulkan" }],
      expectedBackend: "cuda",
      gpuModel: "NVIDIA GeForce RTX 5090",
    });
    expect(selected).toMatchObject({ id: "Vulkan0", backend: "vulkan" });
    expect(llamaComputeArguments("gpu_accelerated", selected)).toEqual([
      "--device", "Vulkan0", "--n-gpu-layers", "999",
    ]);
  });

  it("supports Metal, Intel QSV, AMD AMF and Linux VAAPI without treating detection as proof", () => {
    expect(expectedGpuInferenceBackend({ gpuModel: "Apple M4 Max", gpuArchitecture: "Apple GPU", gpuCount: 1 }, "darwin"))
      .toBe("metal");
    expect(expectedGpuInferenceBackend({ gpuModel: "Intel Arc", gpuArchitecture: "Xe", gpuCount: 1 }, "win32"))
      .toBe("vulkan");
    expect(selectFfmpegGpuMediaBackend({
      platform: "darwin", gpuModel: "Apple M4 Max", requiredCodecs: ["h264"],
      hardwareAcceleratorsOutput: "videotoolbox", encodersOutput: "h264_videotoolbox",
    })).toBe("videotoolbox");
    expect(selectFfmpegGpuMediaBackend({
      platform: "win32", gpuModel: "Intel Arc B580", requiredCodecs: ["h264"],
      hardwareAcceleratorsOutput: "qsv", encodersOutput: "h264_qsv",
    })).toBe("qsv");
    expect(selectFfmpegGpuMediaBackend({
      platform: "win32", gpuModel: "AMD Radeon", requiredCodecs: ["h264"],
      hardwareAcceleratorsOutput: "d3d11va", encodersOutput: "h264_amf",
    })).toBe("d3d11va_amf");
    expect(selectFfmpegGpuMediaBackend({
      platform: "linux", gpuModel: "AMD Radeon", requiredCodecs: ["h264"],
      hardwareAcceleratorsOutput: "vaapi", encodersOutput: "h264_vaapi",
    })).toBe("vaapi");
  });

  it("fails closed when no physical GPU device is exposed", () => {
    expect(expectedGpuInferenceBackend({ gpuModel: "GPU unavailable", gpuArchitecture: "unavailable", gpuCount: 0 }, "linux"))
      .toBe("unavailable");
    expect(selectLlamaGpuDevice({ devices: [], expectedBackend: "cuda", gpuModel: "RTX 5090" })).toBeNull();
    expect(() => llamaComputeArguments("gpu_accelerated", null)).toThrow("calibration_gpu_inference_device_unavailable");
  });
});
