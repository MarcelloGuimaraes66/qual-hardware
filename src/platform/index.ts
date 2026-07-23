import { macosHostPlatform } from "./macos/hostPlatform.js";
import type { HostPlatformAdapter } from "./shared/hostPlatform.js";
import { ubuntuHostPlatform } from "./ubuntu/hostPlatform.js";
import { windowsHostPlatform } from "./windows/hostPlatform.js";

export function selectHostPlatform(platform: NodeJS.Platform = process.platform): HostPlatformAdapter {
  if (platform === "darwin") return macosHostPlatform;
  if (platform === "win32") return windowsHostPlatform;
  if (platform === "linux") return ubuntuHostPlatform;
  throw new Error(`unsupported_host_platform:${platform}`);
}

export function trySelectHostPlatform(platform: NodeJS.Platform = process.platform): HostPlatformAdapter | null {
  try { return selectHostPlatform(platform); } catch { return null; }
}

export const currentHostPlatform = selectHostPlatform();
export type { HostPlatformAdapter, SupportedHostPlatformId, SupportedRuntimeTarget } from "./shared/hostPlatform.js";
