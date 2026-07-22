import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createDefaultScenario } from "../src/shared/schemas.js";
import type { CapacityPrediction, CapacityRecommendation, HardwareNodeTemplate, LocalCalibrationRun, ScenarioRecord } from "../src/shared/types.js";

interface PackagePaths {
  executable: string;
  asar: string;
  bundle?: string;
}

interface RunningDesktop {
  child: ChildProcessWithoutNullStreams;
  origin: string;
  debuggerUrl: string;
  logs: string[];
  userData: string;
}

const projectRoot = resolve(import.meta.dirname, "..");
const releaseRoot = resolve(String(process.env.QUAL_HARDWARE_RELEASE_ROOT || "").trim() || join(projectRoot, "release"));

function packagePaths(): PackagePaths {
  if (process.platform === "darwin") {
    const application = join(releaseRoot, "mac-arm64", "Qual Hardware.app", "Contents");
    return {
      executable: join(application, "MacOS", "Qual Hardware"),
      asar: join(application, "Resources", "app.asar"),
      bundle: join(releaseRoot, "mac-arm64", "Qual Hardware.app"),
    };
  }
  if (process.platform === "win32") {
    const application = join(releaseRoot, "win-unpacked");
    return {
      executable: join(application, "Qual Hardware.exe"),
      asar: join(application, "resources", "app.asar"),
    };
  }
  const application = join(releaseRoot, "linux-unpacked");
  return {
    executable: join(application, "qual-hardware"),
    asar: join(application, "resources", "app.asar"),
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address !== "string");
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitFor<T>(description: string, action: () => Promise<T | null>, timeoutMs = 30_000): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await action();
      if (result !== null) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Timed out waiting for ${description}${lastError instanceof Error ? `: ${lastError.message}` : ""}`);
}

async function launchDesktop(executable: string, userData: string): Promise<RunningDesktop> {
  const debugPort = await freePort();
  const logs: string[] = [];
  const child = spawn(executable, [
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${debugPort}`,
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
      QUAL_HARDWARE_CALIBRATION_TIME_SCALE: process.env.QUAL_HARDWARE_CALIBRATION_TIME_SCALE ?? "0.02",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => logs.push(chunk.toString()));

  let page: { origin: string; debuggerUrl: string };
  try {
    page = await waitFor("the packaged renderer", async () => {
      if (child.exitCode !== null) throw new Error(`desktop exited with ${child.exitCode}: ${logs.join("")}`);
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(2_000) });
      if (!response.ok) return null;
      const pages = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>;
      const candidate = pages.find((entry) => entry.type === "page" && entry.url?.startsWith("http://127.0.0.1:"));
      return candidate?.url && candidate.webSocketDebuggerUrl
        ? { origin: new URL(candidate.url).origin, debuggerUrl: candidate.webSocketDebuggerUrl }
        : null;
    }, 90_000);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error instanceof Error ? error.message : "desktop_start_failed"}; electron logs: ${logs.join("").slice(-4_000)}`);
  }
  assert.equal(new URL(page.origin).hostname, "127.0.0.1");
  return { child, ...page, logs, userData };
}

async function rendererValue<T>(debuggerUrl: string, expression: string): Promise<T> {
  return new Promise<T>((resolveValue, reject) => {
    const socket = new WebSocket(debuggerUrl);
    const requestId = 1;
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("renderer evaluation timed out"));
    }, 5_000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({
      id: requestId,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true },
    })));
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(String(event.data)) as {
        id?: number;
        error?: { message?: string };
        result?: { exceptionDetails?: unknown; result?: { value?: T } };
      };
      if (response.id !== requestId) return;
      clearTimeout(timeout);
      socket.close();
      if (response.error || response.result?.exceptionDetails) {
        reject(new Error(response.error?.message ?? "renderer evaluation failed"));
      } else {
        resolveValue(response.result?.result?.value as T);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("renderer debugger connection failed"));
    });
  });
}

async function waitForExit(child: ChildProcess, timeoutMs = 15_000): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolveExit, reject) => {
    const timeout = setTimeout(() => reject(new Error("desktop did not exit")), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

async function stopDesktop(application: RunningDesktop): Promise<void> {
  if (application.child.exitCode !== null) return;
  application.child.kill("SIGTERM");
  try {
    await waitForExit(application.child);
  } catch (error) {
    application.child.kill("SIGKILL");
    await waitForExit(application.child, 5_000);
    throw error;
  }
}

async function launchDuplicate(paths: PackagePaths, userData: string): Promise<void> {
  if (process.platform === "darwin") {
    assert(paths.bundle);
    execFileSync("/usr/bin/open", [paths.bundle, "--args", `--user-data-dir=${userData}`]);
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
    return;
  }
  const duplicate = spawn(paths.executable, [`--user-data-dir=${userData}`], { stdio: "ignore" });
  await waitForExit(duplicate, 10_000);
}

async function api<T>(origin: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function verifyBinaryArchitecture(file: string): Promise<void> {
  const binary = await readFile(file);
  if (process.platform === "win32") {
    assert.equal(binary.subarray(0, 2).toString("ascii"), "MZ");
    const peOffset = binary.readUInt32LE(0x3c);
    assert.equal(binary.subarray(peOffset, peOffset + 4).toString("binary"), "PE\0\0");
    assert.equal(binary.readUInt16LE(peOffset + 4), 0x8664, "Windows package must be x64");
  } else if (process.platform === "darwin") {
    assert.equal(binary.readUInt32LE(0), 0xfeedfacf, "macOS package must be 64-bit Mach-O");
    assert.equal(binary.readUInt32LE(4), 0x0100000c, "macOS package must be arm64");
  } else {
    assert.deepEqual([...binary.subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46]);
    assert.equal(binary[4], 2, "Linux package must be ELF64");
    assert.equal(binary.readUInt16LE(18), 0x3e, "Linux package must be x64");
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function verifyPackage(paths: PackagePaths): Promise<void> {
  await stat(paths.executable);
  await stat(paths.asar);
  await verifyBinaryArchitecture(paths.executable);

  const require = createRequire(import.meta.url);
  const asarCli = join(dirname(require.resolve("@electron/asar/package.json")), "bin", "asar.js");
  const listing = execFileSync(process.execPath, [asarCli, "list", paths.asar], { encoding: "utf8" }).replaceAll("\\", "/");
  for (const required of [
    "/dist/web/index.html",
    "/dist/web/brand/aiquimist-logo-white.png",
    "/dist/server/desktop/main.js",
    "/contracts/perceptrum-workload-v1.json",
    "/contracts/perceptrum-workload-v2.json",
    "/contracts/perceptrum-workload-v3.json",
    "/contracts/qual-hardware-source-registry-v1.schema.json",
    "/contracts/qual-hardware-catalog-bundle-v1.schema.json",
    "/contracts/qual-hardware-component-catalog-v2.schema.json",
    "/contracts/qual-hardware-component-technical-specification-v1.schema.json",
    "/contracts/qual-hardware-procurement-neutral-specification-v1.schema.json",
    "/contracts/qual-hardware-tr-technical-annex-v1.schema.json",
    "/database/sqlite-schema.sql",
    "/dist/server/server/calibrationKernelService.js",
    "/dist/server/server/calibrationKernelWorker.js",
    "/dist/server/server/calibrationKernelProtocol.js",
    "/dist/server/server/calibrationHardware.js",
    "/dist/server/server/calibrationPipeline.js",
    "/dist/server/server/calibrationQualification.js",
    "/dist/server/server/calibrationRuntime.js",
    "/dist/server/server/calibrationTelemetry.js",
    "/dist/server/server/calibrationTemporaryFiles.js",
    "/node_modules/docx/dist/index.mjs",
  ]) assert(listing.includes(required), `ASAR is missing ${required}`);
  for (const forbidden of [
    "/dist/server/server/index.js",
    "/dist/server/server/worker.js",
  ]) assert(!listing.includes(forbidden), `Desktop-only ASAR contains forbidden runtime ${forbidden}`);
  const runtimeManifestPath = join(dirname(paths.asar), "resources", "calibration", "runtime-manifest.json");
  const runtimeManifest = JSON.parse(await readFile(runtimeManifestPath, "utf8")) as {
    schemaVersion?: string;
    authorityCommit?: string;
    pipelineImplementation?: string;
    authorityContract?: { relativePath: string; sha256: string };
    pipelineContract?: { relativePath: string; sha256: string };
    sourceLock?: { relativePath: string; sha256: string };
    supportedTargets?: string[];
    assets?: Array<{
      id: string;
      artifacts?: Record<string, {
        relativePath: string;
        sha256?: string | null;
        sizeBytes?: number | null;
        licenseEvidence?: { relativePath: string; sha256: string } | null;
        sbomEvidence?: { relativePath: string; sha256: string } | null;
      }>;
    }>;
  };
  assert.equal(runtimeManifest.schemaVersion, "qual-hardware-calibration-runtime-manifest/2.0.0");
  assert.equal(runtimeManifest.authorityCommit, "d918faa0ecd6a9906b711039e5d89f78e0536c44");
  assert.equal(runtimeManifest.pipelineImplementation, "perceptrum-equivalent-v1");
  assert.deepEqual(runtimeManifest.supportedTargets, ["darwin-arm64", "win32-x64", "linux-x64"]);
  assert(runtimeManifest.assets?.some((asset) => asset.id === "telemetry-probe"));
  for (const asset of runtimeManifest.assets ?? []) {
    for (const target of runtimeManifest.supportedTargets ?? []) {
      assert(asset.artifacts?.[target]?.relativePath, `Runtime asset ${asset.id} is missing ${target}`);
    }
  }
  for (const contract of [runtimeManifest.authorityContract, runtimeManifest.pipelineContract, runtimeManifest.sourceLock]) {
    assert(contract);
    const bytes = await readFile(join(dirname(paths.asar), contract.relativePath));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), contract.sha256);
  }
  const sourceLock = JSON.parse(await readFile(join(dirname(paths.asar), runtimeManifest.sourceLock!.relativePath), "utf8")) as {
    schemaVersion?: string;
    policy?: { runtimeNetworkAccess?: string; approvalMode?: string };
    assets?: unknown[];
  };
  assert.equal(sourceLock.schemaVersion, "qual-hardware-calibration-asset-sources/1.0.0");
  assert.equal(sourceLock.policy?.runtimeNetworkAccess, "forbidden");
  assert.equal(sourceLock.policy?.approvalMode, "candidate_inventory_fail_closed");
  assert.equal(sourceLock.assets?.length, 9);
  const selectedTarget = process.platform === "darwin" ? "darwin-arm64" : process.platform === "win32" ? "win32-x64" : "linux-x64";
  const telemetryArtifact = runtimeManifest.assets?.find((asset) => asset.id === "telemetry-probe")?.artifacts?.[selectedTarget];
  assert(telemetryArtifact?.sha256 && telemetryArtifact.sizeBytes && telemetryArtifact.licenseEvidence && telemetryArtifact.sbomEvidence,
    "packaged telemetry probe must have complete candidate integrity evidence");
  const selectedRuntimeRoot = join(dirname(paths.asar), "resources", "calibration", selectedTarget);
  const telemetryPath = join(selectedRuntimeRoot, telemetryArtifact.relativePath);
  const telemetryInfo = await stat(telemetryPath);
  assert.equal(telemetryInfo.size, telemetryArtifact.sizeBytes);
  assert.equal(createHash("sha256").update(await readFile(telemetryPath)).digest("hex"), telemetryArtifact.sha256);
  if (process.platform !== "win32") assert(telemetryInfo.mode & 0o111, "packaged telemetry probe must be executable");
  for (const evidence of [telemetryArtifact.licenseEvidence, telemetryArtifact.sbomEvidence]) {
    assert.equal(createHash("sha256").update(await readFile(join(selectedRuntimeRoot, evidence.relativePath))).digest("hex"), evidence.sha256);
  }
}

async function verifyReleaseArtifacts(): Promise<void> {
  const metadata = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as { version: string };
  if (process.platform === "win32") {
    const portable = join(releaseRoot, `Qual-Hardware-${metadata.version}-windows-x64-portable.exe`);
    if (await fileExists(portable)) await verifyBinaryArchitecture(portable);
    return;
  }
  if (process.platform === "darwin") {
    const dmg = join(releaseRoot, `Qual-Hardware-${metadata.version}-macos-arm64.dmg`);
    if (await fileExists(dmg)) execFileSync("/usr/bin/hdiutil", ["verify", dmg], { stdio: "pipe" });
    return;
  }
  const appImage = join(releaseRoot, `Qual-Hardware-${metadata.version}-linux-x64.AppImage`);
  const deb = join(releaseRoot, `qual-hardware_${metadata.version}_amd64.deb`);
  if (await fileExists(appImage)) {
    await verifyBinaryArchitecture(appImage);
    assert((await stat(appImage)).mode & 0o111, "AppImage must be executable");
  }
  if (await fileExists(deb)) {
    assert.equal(execFileSync("dpkg-deb", ["--field", deb, "Architecture"], { encoding: "utf8" }).trim(), "amd64");
    assert.equal(execFileSync("dpkg-deb", ["--field", deb, "Package"], { encoding: "utf8" }).trim(), "qual-hardware");
  }
}

async function exerciseApplication(application: RunningDesktop): Promise<{ scenarioId: string; recommendationId: string }> {
  const renderedText = await waitFor("the rendered React interface", async () => {
    const text = await rendererValue<string>(application.debuggerUrl, "document.body.innerText");
    return text.includes("Qual Hardware") && text.length > 100 ? text : null;
  });
  assert(renderedText.includes("Qual Hardware"));
  const brand = await waitFor("the Aiquimist brand", async () => {
    const state = await rendererValue<{
      href: string;
      target: string;
      rel: string;
      imageWidth: number;
      imageHeight: number;
      viewportRatio: number;
    } | null>(application.debuggerUrl, `(() => {
      const link = document.querySelector('header a.brand');
      const image = link?.querySelector('img');
      const viewport = link?.querySelector('.brand-logo-viewport');
      if (!(link instanceof HTMLAnchorElement) || !(image instanceof HTMLImageElement) || !(viewport instanceof HTMLElement) || !image.complete || image.naturalWidth === 0) return null;
      const bounds = viewport.getBoundingClientRect();
      return {
        href: link.href,
        target: link.target,
        rel: link.rel,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        viewportRatio: bounds.width / bounds.height,
      };
    })()`);
    return state?.imageWidth === 1080 ? state : null;
  });
  assert.equal(brand.href, "https://aiquimist.ai/");
  assert.equal(brand.target, "_blank");
  assert(brand.rel.split(/\s+/).includes("noreferrer"));
  assert.equal(brand.imageWidth, brand.imageHeight, "the original logo proportions must remain intact");
  assert(Math.abs(brand.viewportRatio - 8.84) < 0.05, "the responsive viewport must frame the horizontal brand without distortion");
  assert(renderedText.includes("Calibração de capacidade"), "the permanent calibration entry point must be visible");
  const openedCalibration = await rendererValue<boolean>(application.debuggerUrl, `(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Calibrar este computador') || item.textContent?.includes('Ver calibrações e instruções'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(openedCalibration, true, "the permanent calibration entry point must open");
  const calibrationText = await waitFor("calibration actions", async () => {
    const text = await rendererValue<string>(application.debuggerUrl, "document.body.innerText");
    const fullActionVisible = text.includes("Calibração completa — 3 repetições") ||
      text.includes("Validação física completa — diagnóstico");
    return text.includes("Teste rápido interno — diagnóstico") && fullActionVisible ? text : null;
  });
  assert(calibrationText.includes("Medição avançada de CPU/GPU"));
  await rendererValue(application.debuggerUrl, "location.assign('data:text/html,blocked'); true");
  await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  assert.equal(await rendererValue<string>(application.debuggerUrl, "location.origin"), application.origin, "non-loopback navigation must be blocked");

  const health = await api<{ status: string; storage: string }>(application.origin, "/api/health");
  assert.deepEqual(health, { status: "ok", storage: "sqlite" });
  const catalog = await api<{ source: string; channel: string; automatic: boolean; hardwareCount: number }>(application.origin, "/api/catalog/status");
  assert(["bundled", "cached", "remote"].includes(catalog.source));
  assert.equal(catalog.channel, "official_public");
  assert.equal(catalog.automatic, true);
  assert.equal(catalog.hardwareCount, 21);
  const catalogSources = await api<Array<{ id: string }>>(application.origin, "/api/catalog/sources");
  assert(catalogSources.length >= 39);
  const catalogPublications = await api<Array<{ sequence: number }>>(application.origin, "/api/catalog/publications");
  if (catalog.source !== "bundled") assert(catalogPublications.length >= 1);
  const hardware = await api<HardwareNodeTemplate[]>(application.origin, "/api/catalog/hardware");
  assert.equal(hardware.length, 21);
  assert.equal(hardware.filter((item) => item.operatingSystemFamily === "macos").length, 5);
  assert.ok(hardware.some((item) => item.id === "apple-macbook-pro-m4max-14c-32gpu-36gb"));
  assert(hardware.some((item) => item.id === "laptop-vivobook-s16-285h-32gb-user"));
  const components = await api<Array<{ id: string; technicalSpecification?: { schemaVersion: string; completeness: { procurementReady: boolean } } }>>(application.origin, "/api/catalog/components");
  assert(components.length > 200);
  assert(components.every((item) => item.technicalSpecification?.schemaVersion === "qual-hardware-component-technical-specification/2.0.0"));
  const specificationCoverage = await api<{ componentCount: number; procurementReadyCount: number }>(application.origin, "/api/catalog/specifications/coverage");
  assert.equal(specificationCoverage.componentCount, components.length);
  assert.equal(specificationCoverage.procurementReadyCount, 3, "only the three reviewed exact-SKU CPU/GPU snapshots may satisfy the technical-specification gate");
  const specificationHistory = await api<unknown[]>(application.origin, `/api/catalog/components/${encodeURIComponent(components[0]!.id)}/specifications/history`);
  assert(specificationHistory.length >= 1);
  const html = await (await fetch(`${application.origin}/`, { signal: AbortSignal.timeout(10_000) })).text();
  assert(html.includes("Qual Hardware"));
  assert(html.includes("Content-Security-Policy"));

  const scenario = createDefaultScenario(4);
  scenario.projectName = "Packaged desktop smoke test";
  const created = await api<ScenarioRecord>(application.origin, "/api/scenarios", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  const recommendations = await api<CapacityRecommendation[]>(application.origin, `/api/scenarios/${created.id}/recommendations`, { method: "POST" });
  assert.equal(recommendations.length, 3);
  assert.equal(new Set(recommendations.map((item) => item.primary.hardware.id)).size, 3);
  for (const item of recommendations) {
    assert(item.primary.price.median && item.primary.price.median > 0);
    const componentTotal = Math.round(item.primary.price.componentEstimates.reduce((sum, component) => sum + component.projectAmount, 0) * 100) / 100;
    assert.equal(componentTotal, item.primary.price.median);
  }
  const recommendation = recommendations.find((item) => item.policy === "recommended");
  assert(recommendation);
  const runtime = await api<{
    readyForQuickTest: boolean;
    readyForFullQualification: boolean;
    authorityCommit: string;
    assets: Array<{ id: string; status: string }>;
    reasons: string[];
  }>(application.origin, "/api/calibrations/runtime-status");
  assert.equal(runtime.readyForQuickTest, true);
  assert.equal(runtime.readyForFullQualification, false, "diagnostic runtime must fail closed for commercial qualification");
  assert.equal(runtime.authorityCommit, "d918faa0ecd6a9906b711039e5d89f78e0536c44");
  assert.equal(runtime.assets.find((asset) => asset.id === "telemetry-probe")?.status, "verified");
  assert(runtime.reasons.length > 0);

  const fullAttempt = await fetch(`${application.origin}/api/calibration-sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recommendationId: recommendation.id, mode: "full", targetHardwareTemplateId: null, advancedTelemetry: true }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(fullAttempt.status, 503, "full qualification must remain blocked without verified packaged assets");

  const startedCalibration = await api<{
    delivery: string;
    session: { id: string };
  }>(application.origin, "/api/calibration-sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recommendationId: recommendation.id, mode: "quick", targetHardwareTemplateId: null, advancedTelemetry: true }),
  });
  assert.equal(startedCalibration.delivery, "internal");
  const completedCalibration = await waitFor("the autonomous calibration and exact-session cleanup", async () => {
    const current = await api<{
      id: string;
      state: string;
      progress: { percent?: number } | null;
      cleanup: { state: string; bytesTemporary: number; bytesRemoved: number; remainingBytes: number } | null;
      result: LocalCalibrationRun | null;
      error: string | null;
    }>(application.origin, `/api/calibration-sessions/${startedCalibration.session.id}`);
    if (["failed", "cancelled", "interrupted"].includes(current.state)) {
      throw new Error(`calibration ended in ${current.state}: ${current.error ?? "no recorded error"}; electron logs: ${application.logs.join("").slice(-2_000)}`);
    }
    return current.state === "completed" ? current : null;
  }, 180_000);
  assert.equal(completedCalibration.progress?.percent, 100);
  assert.equal(completedCalibration.cleanup?.state, "completed");
  assert.equal(completedCalibration.cleanup?.remainingBytes, 0);
  assert.equal(completedCalibration.cleanup?.bytesRemoved, completedCalibration.cleanup?.bytesTemporary);
  assert.equal(completedCalibration.result?.schemaVersion, "qual-hardware-local-calibration/3.0.0");
  assert.equal(completedCalibration.result?.developmentOnly, true);
  assert.equal(completedCalibration.result?.externalRequestCount, 0);
  assert.equal(completedCalibration.result?.openAiRequestCount, 0);
  assert.equal(completedCalibration.result?.overallSafeCameraCapacity, null);
  assert.equal(completedCalibration.result?.pipelineEvidence?.complete, false);
  assert.equal(completedCalibration.result?.qualityGate?.eligibleForCapacityExtrapolation, false);
  assert(completedCalibration.result?.artifact?.fileName);
  const completedEvidencePath = join(application.userData, "calibration-evidence", completedCalibration.result.artifact.fileName);
  assert.equal(await fileExists(completedEvidencePath), true, "the compact successful evidence must survive temporary cleanup");
  assert((await stat(completedEvidencePath)).size <= 10 * 1024 * 1024, "successful evidence must respect the 10 MB limit");
  assert.equal(completedCalibration.result?.stages.find((stage) => stage.stage === "local_inference")?.evidenceStatus, "unavailable");
  for (const stage of ["thermal_sustain", "job_scheduler", "intelligence_scheduler", "database_persistence", "dashboard_queries"] as const) {
    assert.equal(completedCalibration.result?.stages.find((item) => item.stage === stage)?.evidenceStatus, "measured");
  }
  assert.equal(completedCalibration.result?.pipelineEvidence?.jobSchedulerExecuted, true);
  assert.equal(completedCalibration.result?.pipelineEvidence?.jobStepRunsPersisted, true);
  assert.equal(completedCalibration.result?.pipelineEvidence?.intelligenceSchedulerExecuted, true);
  assert.equal(completedCalibration.result?.pipelineEvidence?.dashboardQueriesExecuted, true);
  assert.equal(await fileExists(join(tmpdir(), "qual-hardware-calibration", startedCalibration.session.id)), false,
    "the exact calibration session directory must be removed after persistence");
  const calibrationStatus = await api<{ calibrationRuns: number }>(application.origin, "/api/calibrations/status");
  assert.equal(calibrationStatus.calibrationRuns, 1, "the diagnostic run must be committed before the session reaches 100%");
  const assessments = await api<Array<{
    calibrationRunIds: string[];
    workloadProfileId: string;
    targetBuildHash: string;
    procurementEligibility: string;
  }>>(
    application.origin,
    `/api/capacity-assessments?workloadProfileId=${encodeURIComponent(completedCalibration.result!.workloadProfileId!)}`,
  );
  assert(assessments.length > 0);
  assert(assessments.every((assessment) => !assessment.calibrationRunIds.includes(completedCalibration.result!.id)),
    "a quick diagnostic must not be promoted as a validated hardware anchor");
  assert(assessments.every((assessment) => assessment.procurementEligibility !== "eligible"));
  assert(assessments.every((assessment) => assessment.targetBuildHash === completedCalibration.result!.fingerprint.perceptrumBuildHash));

  const cancelCalibration = await api<{ delivery: string; session: { id: string } }>(application.origin, "/api/calibration-sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recommendationId: recommendation.id, mode: "quick", targetHardwareTemplateId: null, advancedTelemetry: false }),
  });
  assert.equal(cancelCalibration.delivery, "internal");
  await api(application.origin, `/api/calibration-sessions/${cancelCalibration.session.id}/cancel`, { method: "POST" });
  const cancelledCalibration = await waitFor("cancelled calibration cleanup", async () => {
    const current = await api<{
      state: string;
      cleanup: { state: string; remainingBytes: number } | null;
      diagnostic?: { fileName: string; payloadSha256: string; status: string; completedMeasurementCount: number };
    }>(application.origin, `/api/calibration-sessions/${cancelCalibration.session.id}`);
    if (["completed", "failed", "interrupted"].includes(current.state)) {
      throw new Error(`cancel request ended in unexpected state ${current.state}: ${JSON.stringify(current)}`);
    }
    return current.state === "cancelled" ? current : null;
  }, 30_000);
  assert.equal(cancelledCalibration.cleanup?.state, "completed");
  assert.equal(cancelledCalibration.cleanup?.remainingBytes, 0);
  assert.equal(cancelledCalibration.diagnostic?.status, "cancelled");
  assert.match(cancelledCalibration.diagnostic?.payloadSha256 ?? "", /^[0-9a-f]{64}$/);
  assert(cancelledCalibration.diagnostic?.fileName);
  const cancelledEvidencePath = join(application.userData, "calibration-evidence", cancelledCalibration.diagnostic.fileName);
  assert.equal(await fileExists(cancelledEvidencePath), true, "cancelled diagnostics must survive temporary cleanup");
  assert((await stat(cancelledEvidencePath)).size <= 10 * 1024 * 1024, "cancelled diagnostics must respect the 10 MB limit");
  assert.equal(await fileExists(join(tmpdir(), "qual-hardware-calibration", cancelCalibration.session.id)), false);
  assert.equal((await api<{ calibrationRuns: number }>(application.origin, "/api/calibrations/status")).calibrationRuns, 1,
    "cancelled diagnostics must not create calibration runs");
  for (const format of ["json", "pdf", "xlsx"] as const) {
    const response = await fetch(`${application.origin}/api/recommendations/${recommendation.id}/export/${format}`, { signal: AbortSignal.timeout(15_000) });
    assert(response.ok, `${format} report returned ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (format === "pdf") assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
    if (format === "xlsx") assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]);
    if (format === "json") {
      const report = JSON.parse(new TextDecoder().decode(bytes)) as { schemaVersion: string; commercialAndNeutralOptions: Array<{ commercialReference: unknown; procurementNeutralSpecification: { status: string } }> };
      assert.equal(report.schemaVersion, "capacity-recommendation-export/6.0.0");
      assert(report.commercialAndNeutralOptions.length >= 6);
      assert(report.commercialAndNeutralOptions.every((item) => item.commercialReference && item.procurementNeutralSpecification.status === "blocked"));
    }
  }
  for (const format of ["tr-json", "tr-pdf", "tr-docx"] as const) {
    const response = await fetch(`${application.origin}/api/recommendations/${recommendation.id}/export/${format}`, { signal: AbortSignal.timeout(30_000) });
    assert(response.ok, `${format} report returned ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (format === "tr-pdf") assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
    if (format === "tr-docx") assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]);
    if (format === "tr-json") {
      const annex = JSON.parse(new TextDecoder().decode(bytes)) as { schemaVersion: string; specifications: Array<{ status: string; requirements: Array<{ matchingComponentIds: string[] }>; marketCompetitionAssessment: { matchingComponentIds: string[]; manufacturerNames: string[] } }> };
      assert.equal(annex.schemaVersion, "qual-hardware-tr-technical-annex/1.0.0");
      assert(annex.specifications.length >= 6);
      assert(annex.specifications.every((item) => item.status === "blocked" && item.requirements.every((requirement) => requirement.matchingComponentIds.length === 0)));
      assert(annex.specifications.every((item) => item.marketCompetitionAssessment.matchingComponentIds.length === 0 && item.marketCompetitionAssessment.manufacturerNames.length === 0));
      assert(!/\b(?:intel|nvidia|asus|dell|lenovo|supermicro)\b/i.test(new TextDecoder().decode(bytes)), "neutral annex contains a commercial identifier");
    }
  }
  const competition = await api<{ options: Array<{ neutralSpecificationStatus: string; assessment: { status: string } | null }> }>(application.origin, `/api/recommendations/${recommendation.id}/procurement-competition`);
  assert(competition.options.every((option) => option.neutralSpecificationStatus === "blocked" && option.assessment?.status === "no_coverage"));

  const macScenario = createDefaultScenario(4);
  macScenario.projectName = "Packaged Apple Silicon smoke test";
  macScenario.cameraGroups[0]!.decodeMode = "cpu";
  macScenario.cameraGroups[0]!.agents[0]!.inputType = "image";
  macScenario.constraints.operatingSystem = "macos";
  const createdMac = await api<ScenarioRecord>(application.origin, "/api/scenarios", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario: macScenario }),
  });
  const macRecommendations = await api<CapacityRecommendation[]>(application.origin, `/api/scenarios/${createdMac.id}/recommendations`, { method: "POST" });
  assert.equal(macRecommendations.length, 3);
  assert.equal(new Set(macRecommendations.map((item) => item.primary.hardware.id)).size, 3);
  assert(macRecommendations.every((item) => item.primary.hardware.operatingSystemFamily === "macos"));

  const calibrationFile = String(process.env.QUAL_HARDWARE_CALIBRATION_FILE || "").trim();
  if (calibrationFile) {
    const calibration = JSON.parse(await readFile(resolve(calibrationFile), "utf8")) as LocalCalibrationRun;
    const imported = await api<{ run: LocalCalibrationRun; predictions: CapacityPrediction[] }>(application.origin, "/api/calibrations/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(calibration),
    });
    assert.equal(imported.run.id, calibration.id);
    const exact = imported.predictions.find((item) => item.hardwareTemplateId === calibration.fingerprint.hardwareTemplateId);
    assert.equal(exact?.status, "validated_local");
    assert.equal(exact?.exactCalibrationRunId, calibration.id);
  }
  return { scenarioId: created.id, recommendationId: recommendation.id };
}

async function main(): Promise<void> {
  const paths = packagePaths();
  await verifyPackage(paths);
  await verifyReleaseArtifacts();
  const userData = await mkdtemp(join(tmpdir(), "qual-hardware-desktop-smoke-"));
  let running: RunningDesktop | null = null;
  try {
    running = await launchDesktop(paths.executable, userData);
    const { scenarioId, recommendationId } = await exerciseApplication(running);

    await launchDuplicate(paths, userData);
    assert.equal(running.child.exitCode, null, "second instance must not terminate the primary instance");
    const startedForShutdown = await api<{ delivery: string; session: { id: string } }>(running.origin, "/api/calibration-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recommendationId, mode: "quick", targetHardwareTemplateId: null, advancedTelemetry: false }),
    });
    assert.equal(startedForShutdown.delivery, "internal");
    const shutdownCalibrationSessionId = startedForShutdown.session.id;
    await stopDesktop(running);
    running = null;

    running = await launchDesktop(paths.executable, userData);
    const scenarios = await api<ScenarioRecord[]>(running.origin, "/api/scenarios");
    assert(scenarios.some((scenario) => scenario.id === scenarioId), "SQLite data did not persist across restarts");
    const shutdownCalibration = await api<{
      state: string;
      cleanup: { state: string; remainingBytes: number } | null;
      diagnostic?: { fileName: string; status: string };
    }>(running.origin, `/api/calibration-sessions/${shutdownCalibrationSessionId}`);
    assert(["cancelled", "interrupted"].includes(shutdownCalibration.state));
    assert.equal(shutdownCalibration.cleanup?.state, "completed");
    assert.equal(shutdownCalibration.cleanup?.remainingBytes, 0);
    assert(shutdownCalibration.diagnostic?.fileName, "shutdown interruption must preserve a compact diagnostic artifact");
    assert.equal(await fileExists(join(userData, "calibration-evidence", shutdownCalibration.diagnostic.fileName)), true);
    assert.equal(await fileExists(join(tmpdir(), "qual-hardware-calibration", shutdownCalibrationSessionId)), false,
      "application shutdown must leave no temporary files for the active calibration session");
    await stopDesktop(running);
    running = null;

    const databasePath = join(userData, "qual-hardware.sqlite");
    const database = await readFile(databasePath);
    assert.equal(database.subarray(0, 16).toString("binary"), "SQLite format 3\0");
    const sqlite = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal((sqlite.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 9);
    assert((sqlite.prepare("SELECT count(*) AS total FROM component_technical_specification_versions").get() as { total: number }).total > 200);
    sqlite.close();
    console.log(`Packaged desktop smoke test passed on ${process.platform}/${process.arch}`);
  } finally {
    if (running) await stopDesktop(running);
    if (process.env.QUAL_HARDWARE_KEEP_SMOKE_DATA === "1") {
      console.log(`Smoke data preserved by explicit request: ${userData}`);
    } else {
      await rm(userData, { recursive: true, force: true });
      console.log(`Temporary smoke data removed: ${userData}`);
    }
  }
}

await main();
