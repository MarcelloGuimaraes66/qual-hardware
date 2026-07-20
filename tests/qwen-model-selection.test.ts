import { describe, expect, it } from "vitest";
import { qwenTextCandidateFromFile, selectBestQwenTextCandidate, type QwenTextModelCandidate } from "../src/server/qwenModelSelection.js";

const gib = 1024 ** 3;

function candidate(fileName: string, parameterBillions: number, sizeGiB: number, quantization = "Q4_K_M"): QwenTextModelCandidate {
  return {
    path: `/models/${fileName}`,
    fileName,
    sizeBytes: Math.floor(sizeGiB * gib),
    parameterBillions,
    quantization,
    source: "auto_detected",
  };
}

describe("Qwen textual local model selection", () => {
  it("accepts text GGUF files and rejects visual projectors and VL models", () => {
    expect(qwenTextCandidateFromFile("/models/Qwen3-32B-Q4_K_M.gguf", 19 * gib, "auto_detected"))
      .toMatchObject({ parameterBillions: 32, quantization: "Q4_K_M" });
    expect(qwenTextCandidateFromFile("/models/mmproj-Qwen3-32B-F16.gguf", 1 * gib, "auto_detected")).toBeNull();
    expect(qwenTextCandidateFromFile("/models/Qwen3-VL-32B-Q4_K_M.gguf", 19 * gib, "auto_detected")).toBeNull();
  });

  it("selects the highest-capability text model that preserves the memory reserve", () => {
    const selected = selectBestQwenTextCandidate([
      candidate("Qwen3-4B-Q4_K_M.gguf", 4, 2.5),
      candidate("Qwen3-32B-Q4_K_M.gguf", 32, 19.76),
    ], 36 * gib);
    expect(selected?.fileName).toBe("Qwen3-32B-Q4_K_M.gguf");
  });

  it("falls back instead of selecting a model that would consume the operating reserve", () => {
    const selected = selectBestQwenTextCandidate([
      candidate("Qwen3-4B-Q4_K_M.gguf", 4, 2.5),
      candidate("Qwen3-32B-Q4_K_M.gguf", 32, 19.76),
    ], 24 * gib);
    expect(selected?.fileName).toBe("Qwen3-4B-Q4_K_M.gguf");
  });

  it("uses the stronger quantization only as a tie-breaker within the same model size", () => {
    const selected = selectBestQwenTextCandidate([
      candidate("Qwen3-8B-Q4_K_M.gguf", 8, 5, "Q4_K_M"),
      candidate("Qwen3-8B-Q8_0.gguf", 8, 8, "Q8_0"),
    ], 36 * gib);
    expect(selected?.quantization).toBe("Q8_0");
  });
});
