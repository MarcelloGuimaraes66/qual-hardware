import { constants } from "node:fs";
import type { HostPlatformAdapter } from "../shared/hostPlatform.js";
import { terminateUnixProcessTree } from "../shared/hostPlatform.js";

export const ubuntuHostPlatform: HostPlatformAdapter = {
  id: "ubuntu",
  nodePlatform: "linux",
  detachedProcessGroups: true,
  privilegedTelemetry: "never",
  runtimeTarget: (architecture) => architecture === "x64" ? "linux-x64" : null,
  executableName: (name) => name,
  executableAccessMode: (kind) => kind === "executable" ? constants.R_OK | constants.X_OK : constants.R_OK,
  terminateProcessTree: terminateUnixProcessTree,
};
