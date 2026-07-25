import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tsc = resolve("node_modules", "typescript", "bin", "tsc");
let lastFailure: unknown;

for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    const result = await execFileAsync(process.execPath, [
      tsc,
      "-p",
      "tsconfig.server.json",
      "--pretty",
      "false",
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = 0;
    break;
  } catch (error) {
    lastFailure = error;
    const failure = error as { stdout?: string; stderr?: string; code?: number | string };
    if (failure.stdout) process.stdout.write(failure.stdout);
    if (failure.stderr) process.stderr.write(failure.stderr);
    if (attempt < 3) {
      process.stderr.write(`Compilação do servidor não concluiu na tentativa ${attempt}; repetindo.\n`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 300 * attempt));
    }
  }
}

if (lastFailure && process.exitCode !== 0) {
  const failure = lastFailure as { code?: number | string };
  throw new Error(`server_compilation_failed:${failure.code ?? "unknown"}`);
}
