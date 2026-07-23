import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { selectHostPlatform } from "../src/platform/index.js";

describe("host platform adapters", () => {
  it("maps each supported operating system to its own runtime directory", () => {
    expect(selectHostPlatform("darwin").runtimeTarget("arm64")).toBe("darwin-arm64");
    expect(selectHostPlatform("win32").runtimeTarget("x64")).toBe("win32-x64");
    expect(selectHostPlatform("linux").runtimeTarget("x64")).toBe("linux-x64");
  });

  it("never requires privileged telemetry", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      expect(selectHostPlatform(platform).privilegedTelemetry).toBe("never");
    }
  });

  it("keeps Windows executable naming isolated", () => {
    expect(selectHostPlatform("win32").executableName("ffmpeg")).toBe("ffmpeg.exe");
    expect(selectHostPlatform("darwin").executableName("ffmpeg")).toBe("ffmpeg");
    expect(selectHostPlatform("linux").executableName("ffmpeg")).toBe("ffmpeg");
  });

  it("keeps OS detection and privileged telemetry commands out of calibration services", async () => {
    const root = fileURLToPath(new URL("../src/server", import.meta.url));
    const files = (await readdir(root)).filter((name) => /^calibration.*\.ts$/.test(name));
    for (const file of files) {
      const source = await readFile(join(root, file), "utf8");
      expect(source, `${file} performs platform detection outside an adapter`).not.toContain("process.platform");
      expect(source, `${file} contains a privileged telemetry command`).not.toMatch(/\b(?:sudo|powermetrics|osascript|pkexec)\b/);
    }
  });
});
