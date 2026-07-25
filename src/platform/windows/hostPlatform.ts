import { execFile } from "node:child_process";
import { constants } from "node:fs";
import type { HostPlatformAdapter } from "../shared/hostPlatform.js";

async function terminateWindowsProcessTree(pid: number, force: boolean): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, 0);
  } catch {
    return;
  }
  await new Promise<void>((resolveStop) => {
    execFile("taskkill.exe", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], {
      windowsHide: true,
      timeout: 5_000,
      killSignal: "SIGKILL",
    }, () => resolveStop());
  });
}

export const windowsHostPlatform: HostPlatformAdapter = {
  id: "windows",
  nodePlatform: "win32",
  detachedProcessGroups: false,
  privilegedTelemetry: "never",
  runtimeTarget: (architecture) => architecture === "x64" ? "win32-x64" : null,
  executableName: (name) => `${name}.exe`,
  executableAccessMode: () => constants.R_OK,
  terminateProcessTree: terminateWindowsProcessTree,
};
