import { join } from "node:path";

export const DESKTOP_APP_ID = "ai.aiquimist.qualhardware";
export const DESKTOP_SQLITE_FILENAME = "qual-hardware.sqlite";

export interface DesktopPaths {
  resourceRoot: string;
  databaseFile: string;
  catalogCacheFile: string;
  catalogConfigFile: string;
}

export function resolveDesktopPaths(appPath: string, userDataPath: string): DesktopPaths {
  return {
    resourceRoot: appPath,
    databaseFile: join(userDataPath, DESKTOP_SQLITE_FILENAME),
    catalogCacheFile: join(userDataPath, "catalog-snapshot.json"),
    catalogConfigFile: join(userDataPath, "catalog-update-config.json"),
  };
}

export function shouldQuitWhenAllWindowsClosed(platform: NodeJS.Platform): boolean {
  return platform !== "darwin";
}

export function isLocalApplicationUrl(candidate: string, localOrigin: string): boolean {
  try {
    return new URL(candidate).origin === new URL(localOrigin).origin;
  } catch {
    return false;
  }
}

export function externalHttpUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function createIdempotentShutdown(action: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    pending ??= action();
    return pending;
  };
}
