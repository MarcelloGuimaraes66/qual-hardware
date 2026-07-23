import { serve, type ServerType } from "@hono/node-server";
import { app, BrowserWindow, dialog, Menu, safeStorage, session, shell } from "electron";
import { createApp, refreshPredictions } from "../server/app.js";
import { CatalogUpdateService } from "../server/catalogUpdates.js";
import { createStore, type PlannerStore } from "../server/store.js";
import { CalibrationKernelService } from "../server/calibrationKernelService.js";
import { join } from "node:path";
import {
  createIdempotentShutdown,
  DESKTOP_APP_ID,
  externalHttpUrl,
  isLocalApplicationUrl,
  resolveDesktopPaths,
  shouldQuitWhenAllWindowsClosed,
} from "./runtime.js";

const HOST = "127.0.0.1";
const CATALOG_REFRESH_INTERVAL_MILLISECONDS = 24 * 60 * 60 * 1_000;
let mainWindow: BrowserWindow | null = null;
let localServer: ServerType | null = null;
let store: PlannerStore | null = null;
let catalogUpdates: CatalogUpdateService | null = null;
let catalogRefreshTimer: ReturnType<typeof setInterval> | null = null;
let catalogDeferredRetryTimer: ReturnType<typeof setInterval> | null = null;
let catalogRefreshDeferred = false;
let localOrigin = "";
let shutdownComplete = false;
let calibrationKernel: CalibrationKernelService | null = null;

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
  calibrationKernel = new CalibrationKernelService({
    temporaryRoot: join(app.getPath("temp"), "qual-hardware-calibration"),
    evidenceDirectory: paths.calibrationEvidenceDirectory,
    resourceRoot: app.isPackaged ? process.resourcesPath : app.getAppPath(),
    appVersion: app.getVersion(),
    featureMode: "full",
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
  await updates.initialize();
  await refreshCalibrationEvidence();
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
        calibrationKernel: calibrationKernel!,
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
  window.on("closed", () => { mainWindow = null; });
  void window.loadURL(localOrigin);
  return window;
}

const shutdown = createIdempotentShutdown(async (): Promise<void> => {
  if (catalogRefreshTimer) clearInterval(catalogRefreshTimer);
  if (catalogDeferredRetryTimer) clearInterval(catalogDeferredRetryTimer);
  catalogRefreshTimer = null;
  catalogDeferredRetryTimer = null;
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
  configureApplicationMenu();
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  localOrigin = await startLocalApplication();
  mainWindow = createMainWindow();
  console.log(`Qual Hardware desktop ready on ${localOrigin}; data=${app.getPath("userData")}`);
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
    dialog.showErrorBox("Qual Hardware não pôde iniciar", detail);
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
