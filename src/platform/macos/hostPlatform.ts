import { constants } from "node:fs";
import type { HostPlatformAdapter } from "../shared/hostPlatform.js";
import { terminateUnixProcessTree } from "../shared/hostPlatform.js";

export const macosHostPlatform: HostPlatformAdapter = {
  id: "macos",
  nodePlatform: "darwin",
  detachedProcessGroups: true,
  privilegedTelemetry: "never",
  runtimeTarget: (architecture) => architecture === "arm64" ? "darwin-arm64" : null,
  executableName: (name) => name,
  executableAccessMode: (kind) => kind === "executable" ? constants.R_OK | constants.X_OK : constants.R_OK,
  terminateProcessTree: terminateUnixProcessTree,
};
