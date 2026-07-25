import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createCalibrationPlan } from "../src/engine/calibration.js";
import { buildCalibrationDiagnosticReport } from "../src/engine/calibrationDiagnostic.js";
import {
  calibrationDiagnosticText,
  renderCalibrationDiagnosticReport,
} from "../src/server/calibrationDiagnosticReport.js";
import { createDefaultScenario } from "../src/shared/schemas.js";
import { autonomousCalibrationRun } from "./fixtures/autonomousCalibrationRun.js";

describe("relatório de diagnóstico da calibração", () => {
  it("usa um único modelo para tela, PDF, TXT, XLSX e JSON", async () => {
    const run = autonomousCalibrationRun();
    run.executionHealth = { status: "completed", infrastructureErrors: [], conclusion: "approved" };
    run.capacityBoundary = {
      seedCameraCount: 25,
      highestPassingCameraCount: 40,
      firstFailingCameraCount: 41,
      operationalSafeCameraCount: 32,
      bound: "exact",
      adjacentBoundaryConfirmed: true,
      confirmationRuns: 3,
      generatorLimit: 1_000_000,
      nonMonotonic: false,
      infrastructureFailure: null,
      maximumAttemptedCameraCount: 41,
      searchTrace: [
        { cameraCount: 25, passed: true, outcome: "pass", attempt: 1, phase: "seed", durationMs: 1,
          failureCode: null, retryOfAttempt: null, composition: [
            { groupIndex: 0, groupName: "Mista", cameras: 25, videoCameras: 4, frameCameras: 21 },
          ] },
        { cameraCount: 41, passed: false, outcome: "capacity_fail", attempt: 2, phase: "confirm", durationMs: 1,
          failureCode: "queue_growth_detected", retryOfAttempt: null, composition: [
            { groupIndex: 0, groupName: "Mista", cameras: 41, videoCameras: 7, frameCameras: 34 },
          ] },
      ],
    };
    run.overallSafeCameraCapacity = 32;
    run.capacityRecommendation = { safeCameraCount: 32, maximumTestedCameraCount: 41, confidence: "medium", basis: "physical_measurement" };
    const model = buildCalibrationDiagnosticReport(run, null);
    expect(model.requested.cameras).toBe(25);
    expect(model.capacity.safeCameras).toBe(32);
    expect(model.capacity.testedAboveRequested).toBe(true);
    expect(calibrationDiagnosticText(model)).toContain("As 25 câmeras solicitadas funcionam? Sim.");
    expect(calibrationDiagnosticText(model)).not.toContain("queue_growth_detected");
    expect(calibrationDiagnosticText(model)).toContain("A carga ultrapassou a capacidade operacional observada.");

    const pdf = await renderCalibrationDiagnosticReport(model, "pdf");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);

    const xlsx = await renderCalibrationDiagnosticReport(model, "xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(xlsx).buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Resumo",
      "Carga testada",
      "Busca do limite",
      "CPU e GPU",
      "Gargalos",
      "Plano de servidores",
      "Falhas e orientações",
      "Evidência técnica",
    ]);
    expect(workbook.getWorksheet("Carga testada")!.rowCount).toBe(2);
    const json = new TextDecoder().decode(await renderCalibrationDiagnosticReport(model, "json")).replace(/^\uFEFF/, "");
    expect(JSON.parse(json)).toMatchObject({ runId: run.id, capacity: { safeCameras: 32 } });
  });

  it("não publica capacidade quando a infraestrutura torna o ensaio inconclusivo", () => {
    const run = autonomousCalibrationRun();
    run.executionHealth = {
      status: "completed_with_errors",
      infrastructureErrors: ["approved_local_inference_assets_unavailable"],
      conclusion: "inconclusive",
    };
    run.overallSafeCameraCapacity = null;
    run.capacityBoundary = {
      seedCameraCount: 25, highestPassingCameraCount: null, firstFailingCameraCount: null,
      operationalSafeCameraCount: null, bound: "inconclusive", adjacentBoundaryConfirmed: false,
      confirmationRuns: 1, generatorLimit: 1_000_000, nonMonotonic: false,
      infrastructureFailure: "approved_local_inference_assets_unavailable", maximumAttemptedCameraCount: 25,
      searchTrace: [{ cameraCount: 25, passed: null, outcome: "infrastructure_error", attempt: 1,
        phase: "seed", durationMs: 1, failureCode: "approved_local_inference_assets_unavailable",
        retryOfAttempt: null, composition: [] }],
    };
    const model = buildCalibrationDiagnosticReport(run, null);
    expect(model.conclusion).toBe("inconclusive");
    expect(model.capacity.safeCameras).toBeNull();
    expect(model.fleetPlan.status).toBe("blocked");
  });

  it("renderiza históricos cujos grupos ainda não tinham nome", async () => {
    const run = autonomousCalibrationRun();
    const profile = createCalibrationPlan(createDefaultScenario(12), "quick").workloadProfile;
    const legacyProfile = {
      ...profile,
      cameraGroups: profile.cameraGroups.map(({ name: _name, ...group }) => group),
    };
    const model = buildCalibrationDiagnosticReport(run, legacyProfile as typeof profile);
    expect(model.requested.composition[0]?.groupName).toBe("Grupo de câmeras 1");
    const pdf = await renderCalibrationDiagnosticReport(model, "pdf");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
  });

  it("mantém o plano de frota como estimativa quando a origem é o benchmark genérico", () => {
    const run = autonomousCalibrationRun();
    run.capacityRecommendation = {
      safeCameraCount: 63,
      maximumTestedCameraCount: 186,
      confidence: "medium",
      basis: "generic_native_estimate",
    };
    run.overallSafeCameraCapacity = 63;
    run.executionHealth = { status: "completed", infrastructureErrors: [], conclusion: "approved" };
    const profile = createCalibrationPlan(createDefaultScenario(12), "quick").workloadProfile;
    const model = buildCalibrationDiagnosticReport(run, profile);
    expect(model.fleetPlan.status).toBe("planning_only");
    expect(model.fleetPlan.explanationPt).toContain("estimativa conservadora");
  });

  it("remove a quantidade digitada do nome do grupo ao apresentar a composição extrapolada", async () => {
    const run = autonomousCalibrationRun();
    run.mode = "validation";
    run.executionHealth = { status: "completed", infrastructureErrors: [], conclusion: "approved" };
    run.capacityBoundary = {
      seedCameraCount: 12,
      highestPassingCameraCount: 186,
      firstFailingCameraCount: null,
      operationalSafeCameraCount: 148,
      bound: "at_least",
      adjacentBoundaryConfirmed: false,
      confirmationRuns: 1,
      generatorLimit: 186,
      nonMonotonic: false,
      infrastructureFailure: null,
      maximumAttemptedCameraCount: 186,
      searchTrace: [{
        cameraCount: 12, passed: true, outcome: "pass", attempt: 1, phase: "seed", durationMs: 1,
        failureCode: null, retryOfAttempt: null, composition: [
          { groupIndex: 0, groupName: "8 câmeras — FRAME", cameras: 8, videoCameras: 0, frameCameras: 8 },
          { groupIndex: 1, groupName: "4 câmeras — VÍDEO FULL", cameras: 4, videoCameras: 4, frameCameras: 0 },
        ],
      }],
    };
    run.overallSafeCameraCapacity = 148;
    run.capacityRecommendation = {
      safeCameraCount: 148,
      maximumTestedCameraCount: 186,
      confidence: "medium",
      basis: "generic_native_estimate",
    };
    run.qualityGate = {
      eligibleForCapacityExtrapolation: true,
      evidenceLevel: "representative_only",
      failures: ["packaged_runtime_not_qualified"],
      warnings: [],
    };
    const profile = createCalibrationPlan(createDefaultScenario(12), "validation").workloadProfile;
    const baseGroup = profile.cameraGroups[0]!;
    profile.cameraGroups = [
      {
        ...structuredClone(baseGroup),
        name: "8 câmeras — FRAME",
        sharePpm: 666_667,
        storage: { ...structuredClone(baseGroup.storage), storeVideo: false },
        agents: baseGroup.agents.map((agent) => ({ ...structuredClone(agent), inputType: "image" as const })),
      },
      {
        ...structuredClone(baseGroup),
        id: `${baseGroup.id}-video`,
        name: "4 câmeras — VÍDEO FULL",
        sharePpm: 333_333,
        storage: { ...structuredClone(baseGroup.storage), storeVideo: true },
        agents: baseGroup.agents.map((agent) => ({ ...structuredClone(agent), inputType: "video" as const })),
      },
    ];
    const model = buildCalibrationDiagnosticReport(run, profile);
    const text = calibrationDiagnosticText(model);
    expect(text).toContain("FRAME: 99 câmeras");
    expect(text).toContain("VÍDEO FULL: 49 câmeras");
    expect(text).not.toContain("8 câmeras — FRAME: 99");
    expect(text).toContain("Este resultado tem validade de engenharia.");

    const xlsx = await renderCalibrationDiagnosticReport(model, "xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(xlsx).buffer);
    expect(workbook.getWorksheet("Carga testada")!.getColumn(1).values).toEqual(
      expect.arrayContaining(["Carga informada", "Capacidade segura"]),
    );
  });

  it("não expõe códigos e classificações internas nos formatos do operador", async () => {
    const run = autonomousCalibrationRun();
    run.executionHealth = { status: "completed", infrastructureErrors: [], conclusion: "approved" };
    run.capacityBoundary = {
      seedCameraCount: 12,
      highestPassingCameraCount: 24,
      firstFailingCameraCount: 48,
      operationalSafeCameraCount: 19,
      bound: "interval",
      adjacentBoundaryConfirmed: false,
      confirmationRuns: 1,
      generatorLimit: 1_000_000,
      nonMonotonic: false,
      infrastructureFailure: null,
      maximumAttemptedCameraCount: 48,
      searchTrace: [{
        cameraCount: 48,
        passed: false,
        outcome: "capacity_fail",
        attempt: 1,
        phase: "expand",
        durationMs: 1,
        failureCode: "exact_concurrent_camera_load_not_executed",
        retryOfAttempt: null,
        composition: [],
      }],
    };
    const model = buildCalibrationDiagnosticReport(run, createCalibrationPlan(createDefaultScenario(12), "quick").workloadProfile);
    model.hardware.gpus = [{
      id: "gpu-0",
      name: "GPU de teste",
      classification: "compute",
      vramBytes: 8 * 1024 ** 3,
      receivedLoad: true,
      telemetryMeasured: false,
    }];
    model.hardware.networkLinks = [{
      name: "Rede de teste",
      speedMbps: 1_000,
      duplex: "unknown",
      physicalLinkVerified: true,
    }];
    model.stages = [{
      stage: "rtsp_ingest",
      labelPt: "Recepção de vídeo",
      evidence: "unavailable",
      safeCameraCapacity: null,
      utilizationPercent: null,
      explanationPt: "Evidência física ainda não disponível.",
    }];

    const text = calibrationDiagnosticText(model);
    expect(text).not.toContain("exact_concurrent_camera_load_not_executed");
    expect(text).toContain("processamento");
    expect(text).toContain("duplex não verificado");

    const xlsx = await renderCalibrationDiagnosticReport(model, "xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(xlsx).buffer);
    expect(workbook.getWorksheet("Busca do limite")!.getCell("E2").value).toBe(
      "A carga simultânea não pôde ser concluída nesse nível.",
    );
    expect(workbook.getWorksheet("Gargalos")!.getCell("B2").value).toBe("não disponível");
  });

  it("mantém textos do operador em português e oculta nomes externos do ambiente", async () => {
    const run = autonomousCalibrationRun();
    run.executionHealth = { status: "completed", infrastructureErrors: [], conclusion: "approved" };
    run.environmentProvenance = {
      schemaVersion: "qual-hardware-execution-environment/1.0.0",
      detectedAt: new Date().toISOString(),
      readiness: "ready_diagnostic",
      evidenceLevel: "generic_native",
      components: [{
        id: "llama-server",
        name: "llama.cpp / llama-server",
        status: "installed",
        origin: "known_installation",
        path: "C:\\Program Files (x86)\\Perceptrum\\llm\\bin\\llama-server.exe",
        version: "backend carregado de C:\\Program Files (x86)\\Perceptrum\\llm\\bin\\ggml-rpc.dll",
        sha256: null,
        selfTest: "passed",
        capabilities: [],
      }],
      missingRequiredComponentIds: [],
    };
    const model = buildCalibrationDiagnosticReport(run, createCalibrationPlan(createDefaultScenario(12), "quick").workloadProfile);
    model.searchTrace = [{
      cameraCount: 12,
      passed: true,
      outcome: "pass",
      attempt: 1,
      phase: "seed",
      durationMs: 1,
      failureCode: null,
      retryOfAttempt: null,
      composition: [],
    }];
    const text = calibrationDiagnosticText(model);
    expect(text).not.toMatch(/perceptrum/i);
    expect(text).not.toContain("WARNING:");
    expect(text).toContain("INFORMAÇÃO:");
    expect(text).toContain("taxa de bits");

    const xlsx = await renderCalibrationDiagnosticReport(model, "xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(xlsx).buffer);
    expect(workbook.getWorksheet("Resumo")!.getCell("B10").value).toContain("não libera compra");
    expect(workbook.getWorksheet("Busca do limite")!.getCell("B2").value).not.toBe("seed");
    expect(workbook.getWorksheet("Busca do limite")!.getCell("E2").value).toBe("Nenhuma");
    expect(workbook.getWorksheet("Evidência técnica")!.getCell("B9").value).not.toMatch(/perceptrum/i);
  });
});
