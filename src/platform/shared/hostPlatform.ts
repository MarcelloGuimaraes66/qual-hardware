export type SupportedHostPlatformId = "macos" | "windows" | "ubuntu";
export type SupportedRuntimeTarget = "darwin-arm64" | "win32-x64" | "linux-x64";

export interface HostPlatformAdapter {
  readonly id: SupportedHostPlatformId;
  readonly nodePlatform: "darwin" | "win32" | "linux";
  readonly detachedProcessGroups: boolean;
  readonly privilegedTelemetry: "never";
  runtimeTarget(architecture: string): SupportedRuntimeTarget | null;
  executableName(name: string): string;
  executableAccessMode(kind: "executable" | "model"): number;
  terminateProcessTree(pid: number, force: boolean): Promise<void>;
}

export function signalFor(force: boolean): NodeJS.Signals {
  return force ? "SIGKILL" : "SIGTERM";
}

export function terminateUnixProcessTree(pid: number, force: boolean): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return Promise.resolve();
  const signal = signalFor(force);
  try {
    process.kill(-pid, signal);
  } catch {
    try { process.kill(pid, signal); } catch { /* The owned process already exited. */ }
  }
  return Promise.resolve();
}
