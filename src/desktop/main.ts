import { serve, type ServerType } from "@hono/node-server";
import { app, BrowserWindow, dialog, Menu, safeStorage, session, shell, utilityProcess } from "electron";
import { createApp, refreshPredictions } from "../server/app.js";
import { CatalogUpdateService } from "../server/catalogUpdates.js";
import { createStore, type PlannerStore } from "../server/store.js";
import { CalibrationKernelService, type CalibrationWorkerHandle } from "../server/calibrationKernelService.js";
import { CalibrationRuntimePackageManager } from "../server/calibrationRuntimePackage.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createIdempotentShutdown,
  DESKTOP_APP_ID,
  externalHttpUrl,
  isLocalApplicationUrl,
  resolveDesktopPaths,
  shouldQuitWhenAllWindowsClosed,
} from "./runtime.js";
import { installDesktopLogger } from "./logger.js";

const HOST = "127.0.0.1";
const CATALOG_REFRESH_INTERVAL_MILLISECONDS = 24 * 60 * 60 * 1_000;
let mainWindow: BrowserWindow | null = null;
let localServer: ServerType | null = null;
let store: PlannerStore | null = null;
let catalogUpdates: CatalogUpdateService | null = null;
let catalogRefreshTimer: ReturnType<typeof setInterval> | null = null;
let catalogDeferredRetryTimer: ReturnType<typeof setInterval> | null = null;
let catalogStartupRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let catalogRefreshDeferred = false;
let localOrigin = "";
let shutdownComplete = false;
let calibrationKernel: CalibrationKernelService | null = null;
let calibrationRuntimePackages: CalibrationRuntimePackageManager | null = null;
let desktopLogDirectory = "";

function createCalibrationUtilityProcess(): CalibrationWorkerHandle {
  const modulePath = fileURLToPath(new URL("../server/calibrationKernelWorker.js", import.meta.url));
  const child = utilityProcess.fork(modulePath, [], {
    serviceName: "Qual Hardware Calibration Kernel",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PERCEPTRUM_BENCHMARK_MODE: "1",
      QUAL_HARDWARE_CALIBRATION_OFFLINE: "1",
    },
  });
  child.stdout?.on("data", (chunk: Buffer) => console.log("Calibration utility", chunk.toString("utf8").slice(-2_000)));
  child.stderr?.on("data", (chunk: Buffer) => console.error("Calibration utility", chunk.toString("utf8").slice(-2_000)));
  const handle = {
    postMessage(message: unknown): void { child.postMessage(message); },
    async terminate(): Promise<number> {
      return await new Promise<number>((resolve) => {
        let finished = false;
        const complete = (code: number): void => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          resolve(code);
        };
        const timeout = setTimeout(() => complete(-1), 5_000);
        timeout.unref?.();
        child.once("exit", (code) => complete(code));
        if (!child.kill()) complete(-1);
      });
    },
    on(event: "message" | "error" | "exit", listener: (...args: unknown[]) => void) {
      if (event === "message") child.on("message", (message) => listener(message));
      else if (event === "exit") child.on("exit", (code) => listener(code));
      else child.on("error", (type, location, report) => listener(new Error(`${type}:${location}:${report.slice(0, 500)}`)));
      return handle;
    },
  };
  return handle as CalibrationWorkerHandle;
}

async function refreshCalibrationEvidence(): Promise<void> {
  if (!store || !calibrationKernel) return;
  const runtime = await calibrationKernel.runtimeStatus();
  await refreshPredictions(store, { kernelVersion: runtime.kernelVersion, runtimeManifestHash: runtime.manifestHash });
}

app.enableSandbox();

async function startLocalApplication(): Promise<string> {
  const paths = resolveDesktopPaths(app.getAppPath(), app.getPath("userData"));
  process.env.QUAL_HARDWARE_RESOURCE_ROOT = paths.resourceRoot;
  process.env.QUAL_HARDWARE_SQLITE_PATH = paths.databaseFile;
  delete process.env.QUAL_HARDWARE_IN_MEMORY;
  store = createStore();
  const applicationResourceRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
  let trust = JSON.parse(await readFile(join(applicationResourceRoot, "resources", "calibration", "runtime-trust.json"), "utf8")) as {
    keys: Array<{ keyId: string; publicKeyPem: string; classification: "candidate" | "production" }>;
  };
  const localTrustPath = process.env.QUAL_HARDWARE_RUNTIME_LOCAL_TRUST_FILE;
  if (process.env.QUAL_HARDWARE_RUNTIME_ALLOW_LOCAL_QUALIFICATION === "1" && localTrustPath) {
    const localTrust = JSON.parse(await readFile(localTrustPath, "utf8")) as typeof trust;
    trust = { keys: [...new Map([...trust.keys, ...localTrust.keys].map((key) => [key.keyId, key])).values()] };
  }
  calibrationKernel = new CalibrationKernelService({
    temporaryRoot: join(app.getPath("temp"), "qual-hardware-calibration"),
    evidenceDirectory: paths.calibrationEvidenceDirectory,
    resourceRoot: applicationResourceRoot,
    // The embedded runtime is allowed to execute the complete local validation
    // when every target asset passes the manifest, license and SBOM checks.
    // Commercial approval remains independently fail-closed through
    // manifestApproved/runtimeTrust and is never inferred from this flag.
    featureMode: "full",
    runtimePackageProvider: async () => {
      const [activeRoot, status] = await Promise.all([
        calibrationRuntimePackages?.activeResourceRoot(),
        calibrationRuntimePackages?.status(),
      ]);
      return {
        resourceRoot: activeRoot ?? applicationResourceRoot,
        manifestApproved: status?.qualificationAllowed === true,
        installed: Boolean(activeRoot),
      };
    },
    appVersion: app.getVersion(),
    workerFactory: createCalibrationUtilityProcess,
  });
  calibrationRuntimePackages = new CalibrationRuntimePackageManager({
    root: join(app.getPath("userData"), "calibration-runtime"),
    appVersion: app.getVersion(),
    trustedKeys: Object.fromEntries(trust.keys.map((key) => [key.keyId, key.publicKeyPem])),
    productionKeyIds: new Set(trust.keys.filter((key) => key.classification === "production").map((key) => key.keyId)),
    selectPackage: async () => {
      const selection = await dialog.showOpenDialog({
        title: "Instalar runtime de calibração",
        properties: ["openFile"],
        filters: [{ name: "Qual Hardware Runtime", extensions: ["qhruntime"] }],
      });
      return selection.canceled ? null : selection.filePaths[0] ?? null;
    },
    onActivated: () => calibrationKernel?.invalidateRuntimeStatus(),
  });
  const updates = new CatalogUpdateService(store, {
    remoteUrl: process.env.QUAL_HARDWARE_CATALOG_URL,
    publicKeyPem: process.env.QUAL_HARDWARE_CATALOG_PUBLIC_KEY?.replaceAll("\\n", "\n"),
    cacheFile: paths.catalogCacheFile,
    configFile: paths.catalogConfigFile,
    officialEnabled: true,
    allowLegacyConfiguration: process.env.QUAL_HARDWARE_CATALOG_ADMIN === "1",
  });
  catalogUpdates = updates;
  // Cache and bundled data are enough to open the desktop. Network refreshes
  // must never hold the window behind a chain of remote release requests.
  await updates.initialize({ refreshRemote: false });
  await refreshCalibrationEvidence();
  // Calibration must be immediately available after launch and must never
  // overlap a remote catalog request. Startup refresh is opt-in; the regular
  // 24-hour refresh remains deferred whenever calibration is active.
  if (process.env.QUAL_HARDWARE_CATALOG_STARTUP_REFRESH === "1") {
    catalogStartupRefreshTimer = setTimeout(() => {
      catalogStartupRefreshTimer = null;
      if (calibrationKernel?.hasActiveSession()) {
        catalogRefreshDeferred = true;
        return;
      }
      void updates.refresh().then(refreshCalibrationEvidence)
        .catch((error: unknown) => console.error("Startup catalog refresh failed", error));
    }, 2_000);
    catalogStartupRefreshTimer.unref?.();
  }
  catalogRefreshTimer = setInterval(() => {
    if (calibrationKernel?.hasActiveSession()) {
      catalogRefreshDeferred = true;
      return;
    }
    void updates.refresh().then(refreshCalibrationEvidence)
      .catch((error: unknown) => console.error("Catalog refresh failed", error));
  }, CATALOG_REFRESH_INTERVAL_MILLISECONDS);
  catalogRefreshTimer.unref();
  catalogDeferredRetryTimer = setInterval(() => {
    if (!catalogRefreshDeferred || calibrationKernel?.hasActiveSession() || updates.refreshing) return;
    catalogRefreshDeferred = false;
    void updates.refresh().then(refreshCalibrationEvidence).catch((error: unknown) => {
      catalogRefreshDeferred = true;
      console.error("Deferred catalog refresh failed", error);
    });
  }, 1_000);
  catalogDeferredRetryTimer.unref();

  return new Promise((resolveOrigin, reject) => {
    localServer = serve({
      fetch: createApp(store!, updates, {
        documentsDirectory: app.getPath("documents"),
        resourceRoot: app.isPackaged ? process.resourcesPath : app.getAppPath(),
        calibrationTemporaryRoot: join(app.getPath("temp"), "qual-hardware-calibration"),
        calibrationEvidenceDirectory: paths.calibrationEvidenceDirectory,
        calibrationIdentityDirectory: join(app.getPath("userData"), "calibration-identity"),
        calibrationPrivateKeyProtection: {
          isAvailable(): boolean {
            if (!safeStorage.isEncryptionAvailable()) return false;
            return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
          },
          encryptString(value: string): Uint8Array { return safeStorage.encryptString(value); },
          decryptString(value: Uint8Array): string { return safeStorage.decryptString(Buffer.from(value)); },
        },
        appVersion: app.getVersion(),
        diagnostics: { databasePath: paths.databaseFile, logDirectory: desktopLogDirectory },
        calibrationKernel: calibrationKernel!,
        calibrationRuntimePackages: calibrationRuntimePackages!,
        desktopBridge: {
          async openPath(path: string): Promise<void> {
            const failure = await shell.openPath(path);
            if (failure) throw new Error(failure);
          },
        },
      }).fetch,
      hostname: HOST,
      port: 0,
    }, (info) => resolveOrigin(`http://${HOST}:${info.port}`));
    localServer.once("error", reject);
  });
}

function openExternalUrl(candidate: string): void {
  if (calibrationKernel?.hasActiveSession()) return;
  const target = externalHttpUrl(candidate);
  if (target) void shell.openExternal(target);
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "Qual Hardware",
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: "#061014",
    show: false,
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  if (process.platform !== "darwin") window.setMenuBarVisibility(false);
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isLocalApplicationUrl(url, localOrigin)) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process terminated unexpectedly", details);
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (errorCode !== -3) console.error("Renderer failed to load", { errorCode, errorDescription, validatedUrl, isMainFrame });
  });
  window.on("unresponsive", () => console.error("Renderer became unresponsive"));
  window.on("closed", () => { mainWindow = null; });
  void window.loadURL(localOrigin);
  return window;
}

const shutdown = createIdempotentShutdown(async (): Promise<void> => {
  if (catalogRefreshTimer) clearInterval(catalogRefreshTimer);
  if (catalogDeferredRetryTimer) clearInterval(catalogDeferredRetryTimer);
  if (catalogStartupRefreshTimer) clearTimeout(catalogStartupRefreshTimer);
  catalogRefreshTimer = null;
  catalogDeferredRetryTimer = null;
  catalogStartupRefreshTimer = null;
  catalogRefreshDeferred = false;
  if (localServer) await new Promise<void>((resolveClose) => localServer!.close(() => resolveClose()));
  localServer = null;
  catalogUpdates = null;
  await calibrationKernel?.close();
  calibrationKernel = null;
  await store?.close();
  store = null;
});

function configureApplicationMenu(): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { type: "separator" }, { role: "quit" }] },
    { role: "editMenu" },
    { role: "windowMenu" },
  ]));
}

function focusMainWindow(): void {
  if (!mainWindow && localOrigin) mainWindow = createMainWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function bootstrap(): Promise<void> {
  if (process.platform === "win32") app.setAppUserModelId(DESKTOP_APP_ID);
  desktopLogDirectory = installDesktopLogger(app.getPath("userData"));
  configureApplicationMenu();
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  localOrigin = await startLocalApplication();
  mainWindow = createMainWindow();
  console.log("Qual Hardware desktop ready", {
    origin: localOrigin,
    version: app.getVersion(),
    platform: process.platform,
    architecture: process.arch,
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", focusMainWindow);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) focusMainWindow();
  });
  void app.whenReady().then(bootstrap).catch(async (error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Qual Hardware failed to start", error);
    await shutdown().catch((shutdownError: unknown) => console.error("Qual Hardware shutdown failed", shutdownError));
    const logHint = desktopLogDirectory ? `\n\nConsulte o diagnóstico em: ${desktopLogDirectory}` : "";
    dialog.showErrorBox("Qual Hardware não pôde iniciar", `${detail}${logHint}`);
    app.exit(1);
  });
}

app.on("window-all-closed", () => {
  if (shouldQuitWhenAllWindowsClosed(process.platform)) app.quit();
});
app.on("before-quit", (event) => {
  if (shutdownComplete || (!localServer && !store)) return;
  event.preventDefault();
  mainWindow?.destroy();
  mainWindow = null;
  void shutdown()
    .catch((error: unknown) => console.error("Qual Hardware shutdown failed", error))
    .finally(() => {
      shutdownComplete = true;
      app.quit();
    });
});

process.on("SIGINT", () => app.quit());
process.on("SIGTERM", () => app.quit());
