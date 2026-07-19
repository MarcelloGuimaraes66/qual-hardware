import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
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
}

const projectRoot = resolve(import.meta.dirname, "..");

function packagePaths(): PackagePaths {
  if (process.platform === "darwin") {
    const application = join(projectRoot, "release", "mac-arm64", "Qual Hardware.app", "Contents");
    return {
      executable: join(application, "MacOS", "Qual Hardware"),
      asar: join(application, "Resources", "app.asar"),
      bundle: join(projectRoot, "release", "mac-arm64", "Qual Hardware.app"),
    };
  }
  if (process.platform === "win32") {
    const application = join(projectRoot, "release", "win-unpacked");
    return {
      executable: join(application, "Qual Hardware.exe"),
      asar: join(application, "resources", "app.asar"),
    };
  }
  const application = join(projectRoot, "release", "linux-unpacked");
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
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
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
  return { child, ...page, logs };
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
    "/database/sqlite-schema.sql",
  ]) assert(listing.includes(required), `ASAR is missing ${required}`);
  for (const forbidden of [
    "/dist/server/server/index.js",
    "/dist/server/server/worker.js",
  ]) assert(!listing.includes(forbidden), `Desktop-only ASAR contains forbidden runtime ${forbidden}`);
}

async function verifyReleaseArtifacts(): Promise<void> {
  const metadata = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as { version: string };
  if (process.platform === "win32") {
    const portable = join(projectRoot, "release", `Qual-Hardware-${metadata.version}-windows-x64-portable.exe`);
    if (await fileExists(portable)) await verifyBinaryArchitecture(portable);
    return;
  }
  if (process.platform === "darwin") {
    const dmg = join(projectRoot, "release", `Qual-Hardware-${metadata.version}-macos-arm64.dmg`);
    if (await fileExists(dmg)) execFileSync("/usr/bin/hdiutil", ["verify", dmg], { stdio: "pipe" });
    return;
  }
  const appImage = join(projectRoot, "release", `Qual-Hardware-${metadata.version}-linux-x64.AppImage`);
  const deb = join(projectRoot, "release", `qual-hardware_${metadata.version}_amd64.deb`);
  if (await fileExists(appImage)) {
    await verifyBinaryArchitecture(appImage);
    assert((await stat(appImage)).mode & 0o111, "AppImage must be executable");
  }
  if (await fileExists(deb)) {
    assert.equal(execFileSync("dpkg-deb", ["--field", deb, "Architecture"], { encoding: "utf8" }).trim(), "amd64");
    assert.equal(execFileSync("dpkg-deb", ["--field", deb, "Package"], { encoding: "utf8" }).trim(), "qual-hardware");
  }
}

async function exerciseApplication(application: RunningDesktop): Promise<string> {
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
    return text.includes("Teste rápido local") && text.includes("Calibração completa local") ? text : null;
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
  for (const format of ["json", "pdf", "xlsx"] as const) {
    const response = await fetch(`${application.origin}/api/recommendations/${recommendation.id}/export/${format}`, { signal: AbortSignal.timeout(15_000) });
    assert(response.ok, `${format} report returned ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (format === "pdf") assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
    if (format === "xlsx") assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]);
    if (format === "json") assert.equal(JSON.parse(new TextDecoder().decode(bytes)).schemaVersion, "capacity-recommendation-export/4.0.0");
  }

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
  return created.id;
}

async function main(): Promise<void> {
  const paths = packagePaths();
  await verifyPackage(paths);
  await verifyReleaseArtifacts();
  const userData = await mkdtemp(join(tmpdir(), "qual-hardware-desktop-smoke-"));
  let running: RunningDesktop | null = null;
  try {
    running = await launchDesktop(paths.executable, userData);
    const scenarioId = await exerciseApplication(running);

    await launchDuplicate(paths, userData);
    assert.equal(running.child.exitCode, null, "second instance must not terminate the primary instance");
    await stopDesktop(running);
    running = null;

    running = await launchDesktop(paths.executable, userData);
    const scenarios = await api<ScenarioRecord[]>(running.origin, "/api/scenarios");
    assert(scenarios.some((scenario) => scenario.id === scenarioId), "SQLite data did not persist across restarts");
    await stopDesktop(running);
    running = null;

    const database = await readFile(join(userData, "qual-hardware.sqlite"));
    assert.equal(database.subarray(0, 16).toString("binary"), "SQLite format 3\0");
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
