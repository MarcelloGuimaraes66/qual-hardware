import { serve, type ServerType } from "@hono/node-server";
import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { CatalogUpdateService } from "../server/catalogUpdates.js";
import { createStore, type PlannerStore } from "../server/store.js";

const HOST = "127.0.0.1";
const CATALOG_REFRESH_INTERVAL_MILLISECONDS = 24 * 60 * 60 * 1_000;
let mainWindow: BrowserWindow | null = null;
let localServer: ServerType | null = null;
let store: PlannerStore | null = null;
let catalogUpdates: CatalogUpdateService | null = null;
let catalogRefreshTimer: ReturnType<typeof setInterval> | null = null;
let localOrigin = "";
let shuttingDown = false;

app.enableSandbox();

async function startLocalApplication(): Promise<string> {
  process.env.QUAL_HARDWARE_RESOURCE_ROOT = app.getAppPath();
  process.env.QUAL_HARDWARE_SQLITE_PATH = join(app.getPath("userData"), "qual-hardware.sqlite");
  delete process.env.QUAL_HARDWARE_IN_MEMORY;
  store = createStore();
  const updates = new CatalogUpdateService(store, {
    remoteUrl: process.env.QUAL_HARDWARE_CATALOG_URL,
    publicKeyPem: process.env.QUAL_HARDWARE_CATALOG_PUBLIC_KEY?.replaceAll("\\n", "\n"),
    cacheFile: join(app.getPath("userData"), "catalog-snapshot.json"),
  });
  catalogUpdates = updates;
  await updates.initialize();
  if (updates.status.remoteUpdateConfigured) {
    catalogRefreshTimer = setInterval(() => {
      void catalogUpdates?.refresh().catch((error: unknown) => console.error("Catalog refresh failed", error));
    }, CATALOG_REFRESH_INTERVAL_MILLISECONDS);
    catalogRefreshTimer.unref();
  }

  return new Promise((resolveOrigin, reject) => {
    localServer = serve({
      fetch: createApp(store!, updates).fetch,
      hostname: HOST,
      port: 0,
    }, (info) => resolveOrigin(`http://${HOST}:${info.port}`));
    localServer.once("error", reject);
  });
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
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  window.setMenuBarVisibility(false);
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== localOrigin && !url.startsWith(`${localOrigin}/`)) {
      event.preventDefault();
      if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    }
  });
  window.on("closed", () => { mainWindow = null; });
  void window.loadURL(localOrigin);
  return window;
}

async function shutdown(): Promise<void> {
  if (catalogRefreshTimer) clearInterval(catalogRefreshTimer);
  catalogRefreshTimer = null;
  if (localServer) await new Promise<void>((resolveClose) => localServer!.close(() => resolveClose()));
  localServer = null;
  catalogUpdates = null;
  await store?.close();
  store = null;
}

app.whenReady().then(async () => {
  localOrigin = await startLocalApplication();
  mainWindow = createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
}).catch((error: unknown) => {
  console.error("Qual Hardware failed to start", error);
  app.exit(1);
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (shuttingDown || (!localServer && !store)) return;
  event.preventDefault();
  shuttingDown = true;
  void shutdown().finally(() => app.quit());
});
