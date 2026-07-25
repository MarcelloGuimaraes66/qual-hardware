import { describe, expect, it } from "vitest";
import { createCalibrationPlan } from "../src/engine/calibration.js";
import {
  compatibleRtspGroupIndexes,
  parseRtspStreamMetadata,
  probeRtspSimulator,
  redactedRtspSimulatorOrigin,
  rtspSimulatorCandidatePorts,
  sanitizeRtspDiagnostic,
} from "../src/server/rtspSimulator.js";
import { createDefaultScenario } from "../src/shared/schemas.js";
import type { RtspStreamProbe } from "../src/shared/types.js";
import { findForbiddenCalibrationData } from "../src/server/security.js";

const simulatorExecutable = {
  path: "C:\\Program Files\\Simulador de RTSP\\SimuladorRtsp.exe",
  sha256: "a".repeat(64),
  sizeBytes: 100,
  version: "1.0.0",
};

function profile(sourceFps = 12) {
  const scenario = createDefaultScenario(4);
  scenario.cameraGroups[0]!.source.sourceFps = sourceFps;
  return createCalibrationPlan(scenario, "quick").workloadProfile;
}

function endpoint(port = 5_541, sourceFps = 12): RtspStreamProbe {
  return {
    redactedOrigin: redactedRtspSimulatorOrigin(port),
    port,
    path: "Streaming/Channels/101",
    transport: "tcp",
    codec: "h264",
    width: 1_920,
    height: 1_080,
    fps: sourceFps,
    decodedFrames: 3,
    openLatencyMs: 42,
    payloadBytes: 1_000_000,
    payloadDurationSeconds: 2,
    payloadMbps: 4,
    compatibleGroupIndexes: [0],
    warnings: [],
  };
}

describe("functional RTSP simulator certification", () => {
  it("scans only the fixed loopback port contract", () => {
    expect(rtspSimulatorCandidatePorts(4)).toEqual([554, 5_541, 5_542, 5_543]);
    expect(rtspSimulatorCandidatePorts(1)).toEqual([554]);
    expect(rtspSimulatorCandidatePorts(10_000)).toHaveLength(64);
  });

  it("never emits the fixed simulator credentials in diagnostics", () => {
    expect(sanitizeRtspDiagnostic(
      "failed rtsp://admin:admin@127.0.0.1:5541/Streaming/Channels/101",
    )).not.toContain("admin:admin");
    expect(findForbiddenCalibrationData({ credentialsPersisted: false })).toEqual([]);
    expect(findForbiddenCalibrationData({ credentialsPersisted: true })).toEqual([{
      path: "$.credentialsPersisted",
      reason: "forbidden_calibration_field",
    }]);
  });

  it("parses the effective video metadata reported by ffprobe", () => {
    expect(parseRtspStreamMetadata(JSON.stringify({
      streams: [{
        codec_name: "h264",
        width: 1_920,
        height: 1_080,
        r_frame_rate: "12/1",
        avg_frame_rate: "12/1",
      }],
    }))).toEqual({ codec: "h264", width: 1_920, height: 1_080, fps: 12 });
    expect(() => parseRtspStreamMetadata('{"streams":[{"codec_name":"vp9"}]}'))
      .toThrow("rtsp_stream_metadata_invalid");
  });

  it("fails closed when stream FPS or measured payload does not match the workload", () => {
    const incompatible = compatibleRtspGroupIndexes({
      codec: "h264",
      width: 1_920,
      height: 1_080,
      fps: 12,
      payloadMbps: 2,
    }, profile(15));
    expect(incompatible.indexes).toEqual([]);
    expect(incompatible.warnings.join("|")).toContain("fps:");
    expect(incompatible.warnings.join("|")).toContain("payload_mbps:");
  });

  it("certifies only an open endpoint that passes the functional receiver probe", async () => {
    const result = await probeRtspSimulator({
      ffmpegPath: "ffmpeg.exe",
      ffprobePath: "ffprobe.exe",
      simulatorExecutable,
      hostPlatform: "win32",
      workloadProfile: profile(),
      ports: [554, 5_541],
      isPortOpen: async (port) => port === 5_541,
      probeEndpoint: async (port) => endpoint(port),
    });
    expect(result.status).toBe("passed");
    expect(result.endpoints.map((item) => item.port)).toEqual([5_541]);
    expect(result.credentialsPersisted).toBe(false);
    expect(JSON.stringify(result)).not.toContain("admin:admin");
  });

  it("distinguishes absent and incompatible simulators without assuming approval", async () => {
    const absent = await probeRtspSimulator({
      ffmpegPath: "ffmpeg.exe",
      ffprobePath: "ffprobe.exe",
      simulatorExecutable,
      hostPlatform: "win32",
      ports: [5_541],
      isPortOpen: async () => false,
    });
    expect(absent.status).toBe("not_running");

    const incompatible = await probeRtspSimulator({
      ffmpegPath: "ffmpeg.exe",
      ffprobePath: "ffprobe.exe",
      simulatorExecutable,
      hostPlatform: "win32",
      workloadProfile: profile(15),
      ports: [5_541],
      isPortOpen: async () => true,
      probeEndpoint: async (port) => ({
        ...endpoint(port, 12),
        compatibleGroupIndexes: [],
        warnings: ["group_0_incompatible:fps:12->15"],
      }),
    });
    expect(incompatible.status).toBe("incompatible");
  });

  it("reports failed authentication without leaking credentials and respects cancellation", async () => {
    const failed = await probeRtspSimulator({
      ffmpegPath: "ffmpeg.exe",
      ffprobePath: "ffprobe.exe",
      simulatorExecutable,
      hostPlatform: "win32",
      ports: [5_541],
      isPortOpen: async () => true,
      probeEndpoint: async () => {
        throw new Error("401 rtsp://admin:admin@127.0.0.1:5541/Streaming/Channels/101");
      },
    });
    expect(failed.status).toBe("failed");
    expect(JSON.stringify(failed)).not.toContain("admin:admin");
    expect(failed.errors.join("|")).toContain("credentials-redacted");

    await expect(probeRtspSimulator({
      ffmpegPath: "ffmpeg.exe",
      ffprobePath: "ffprobe.exe",
      simulatorExecutable,
      hostPlatform: "win32",
      ports: [5_541],
      cancelled: () => true,
      isPortOpen: async () => true,
      probeEndpoint: async (port) => endpoint(port),
    })).rejects.toThrow("calibration_cancelled");
  });

  it("blocks the Windows-only simulator safely on macOS and Ubuntu", async () => {
    const result = await probeRtspSimulator({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      simulatorExecutable,
      hostPlatform: "linux",
      ports: [5_541],
      isPortOpen: async () => true,
      probeEndpoint: async (port) => endpoint(port),
    });
    expect(result.status).toBe("unsupported");
    expect(result.endpoints).toEqual([]);
  });
});
