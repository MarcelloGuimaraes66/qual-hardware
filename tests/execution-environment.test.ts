import { describe, expect, it } from "vitest";
import {
  DEPENDENCY_DOWNLOAD_LINKS,
  dependencyDownloadLink,
  runtimeStatusFromExecutionEnvironment,
} from "../src/server/executionEnvironment.js";
import type { CalibrationRuntimeStatus, ExecutionEnvironment } from "../src/shared/types.js";

function environment(level: ExecutionEnvironment["evidenceLevel"]): ExecutionEnvironment {
  return {
    schemaVersion: "qual-hardware-execution-environment/1.0.0",
    detectedAt: "2026-07-23T18:00:00.000Z",
    platform: "win32",
    architecture: "x64",
    supported: true,
    readiness: level === "exact_perceptrum" ? "ready_full" : "ready_diagnostic",
    evidenceLevel: level,
    environmentSignature: "e".repeat(64),
    components: [{
      id: "native-benchmark",
      name: "Benchmark nativo do Qual Hardware",
      purpose: "Diagnóstico genérico",
      status: "installed",
      origin: "built_in_proxy",
      path: null,
      version: "1.0.0",
      sha256: null,
      selfTest: "passed",
      capabilities: ["cpu", "memory"],
      impact: "Diagnóstico disponível.",
      instruction: "Nenhuma ação necessária.",
      downloadLinkId: null,
      diagnosticOnly: true,
    }],
    missingRequiredComponentIds: ["ffmpeg"],
    warnings: ["Stack exata ausente."],
    externalDownloadsPerformed: false,
  };
}

function legacyStatus(): CalibrationRuntimeStatus {
  return {
    schemaVersion: "qual-hardware-calibration-runtime-status/1.0.0",
    kernelVersion: "qual-hardware-calibration-kernel/4.0.0",
    authorityCommit: "d918faa0ecd6a9906b711039e5d89f78e0536c44",
    platform: "win32",
    architecture: "x64",
    featureMode: "diagnostic",
    manifestApproved: false,
    runtimeAssetsVerified: false,
    readyForQuickTest: false,
    readyForFullQualification: false,
    manifestHash: "a".repeat(64),
    contracts: [],
    assets: [],
    reasons: [],
  };
}

describe("execution environment", () => {
  it("exposes only the signed local catalog of official links", () => {
    expect(DEPENDENCY_DOWNLOAD_LINKS.length).toBeGreaterThan(5);
    expect(DEPENDENCY_DOWNLOAD_LINKS.every((item) => item.url.startsWith("https://"))).toBe(true);
    expect(dependencyDownloadLink("ffmpeg-official")?.url).toBe("https://ffmpeg.org/download.html");
    expect(dependencyDownloadLink("https://malicious.invalid/installer.exe")).toBeNull();
    expect(dependencyDownloadLink("../ffmpeg-official")).toBeNull();
  });

  it("allows a generic benchmark only as diagnostic evidence", async () => {
    const status = await runtimeStatusFromExecutionEnvironment(environment("generic_native"), legacyStatus());
    expect(status.readyForQuickTest).toBe(true);
    expect(status.readyForFullQualification).toBe(false);
    expect(status.manifestApproved).toBe(false);
    expect(status.environmentEvidenceLevel).toBe("generic_native");
    expect(status.environmentProvenance?.missingRequiredComponentIds).toEqual(["ffmpeg"]);
    expect(status.reasons).toContain("evidence-level:generic_native");
  });

  it("enables the qualification gate only for an exact isolated Perceptrum worker", async () => {
    const exact = environment("exact_perceptrum");
    exact.missingRequiredComponentIds = [];
    const status = await runtimeStatusFromExecutionEnvironment(exact, legacyStatus());
    expect(status.featureMode).toBe("full");
    expect(status.readyForFullQualification).toBe(true);
    expect(status.manifestApproved).toBe(true);
    expect(status.environmentSignature).toBe(exact.environmentSignature);
  });
});
