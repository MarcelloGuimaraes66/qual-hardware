import { serve, type ServerType } from "@hono/node-server";
import { app, BrowserWindow, dialog, Menu, session, shell } from "electron";
import { createApp } from "../server/app.js";
import { CatalogUpdateService } from "../server/catalogUpdates.js";
import { validatePerceptrumProtocolUri } from "../server/calibrationSessions.js";
import { createStore, type PlannerStore } from "../server/store.js";
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
let localOrigin = "";
let shutdownComplete = false;

app.enableSandbox();

async function startLocalApplication(): Promise<string> {
  const paths = resolveDesktopPaths(app.getAppPath(), app.getPath("userData"));
  process.env.QUAL_HARDWARE_RESOURCE_ROOT = paths.resourceRoot;
  process.env.QUAL_HARDWARE_SQLITE_PATH = paths.databaseFile;
  delete process.env.QUAL_HARDWARE_IN_MEMORY;
  store = createStore();
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
  catalogRefreshTimer = setInterval(() => {
    void updates.refresh().catch((error: unknown) => console.error("Catalog refresh failed", error));
  }, CATALOG_REFRESH_INTERVAL_MILLISECONDS);
  catalogRefreshTimer.unref();

  return new Promise((resolveOrigin, reject) => {
    localServer = serve({
      fetch: createApp(store!, updates, {
        documentsDirectory: app.getPath("documents"),
        desktopBridge: {
          async openPerceptrumCalibration(uri: string): Promise<void> {
            const target = validatePerceptrumProtocolUri(uri);
            if (!target) throw new Error("invalid_perceptrum_calibration_uri");
            await shell.openExternal(target);
          },
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
  catalogRefreshTimer = null;
  if (localServer) await new Promise<void>((resolveClose) => localServer!.close(() => resolveClose()));
  localServer = null;
  catalogUpdates = null;
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
