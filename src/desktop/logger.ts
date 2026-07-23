import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const MAX_LOG_BYTES = 512 * 1024;
const MAX_LOG_FILES = 5;

export function redactDesktopLog(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]{16,}/g, "Bearer [redacted]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?'\"]+)\?[^\s'\"]+/gi, "$1?[redacted]")
    .replace(/("authorization"\s*:\s*")[^"]+/gi, '$1[redacted]')
    .replace(/("(?:token|nonce|api[_-]?key|private[_-]?key|secret|path)"\s*:\s*")[^"]+/gi, '$1[redacted]')
    .replace(/\b((?:OPENAI_API_KEY|API_KEY|PRIVATE_KEY|TOKEN|SECRET)=)[^\s]+/gi, "$1[redacted]")
    .replace(/\b[A-Za-z]:(?:\\\\)+(?:[^"'\r\n]|\\")*/g, "[redacted-path]")
    .replace(/\b[A-Za-z]:\\(?:[^\\\r\n]+\\)*[^\\\r\n\s]*/g, "[redacted-path]")
    .replace(/\/(?:Users|home)\/[^\s'\"]+/g, "[redacted-path]");
}

function serialize(args: unknown[]): string {
  return redactDesktopLog(args.map((value) => {
    if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ""}`;
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(" "));
}

function rotate(baseFile: string): void {
  if (!existsSync(baseFile) || statSync(baseFile).size < MAX_LOG_BYTES) return;
  for (let index = MAX_LOG_FILES - 1; index >= 1; index -= 1) {
    const source = `${baseFile}.${index}`;
    const target = `${baseFile}.${index + 1}`;
    if (existsSync(target)) unlinkSync(target);
    if (existsSync(source)) renameSync(source, target);
  }
  const first = `${baseFile}.1`;
  if (existsSync(first)) unlinkSync(first);
  renameSync(baseFile, first);
}

export function installDesktopLogger(userDataPath: string): string {
  const logDirectory = join(userDataPath, "logs");
  mkdirSync(logDirectory, { recursive: true });
  const logFile = join(logDirectory, "qual-hardware.log");
  const sink = (level: "INFO" | "WARN" | "ERROR", args: unknown[]): void => {
    rotate(logFile);
    appendFileSync(logFile, `${JSON.stringify({ timestamp: new Date().toISOString(), level, message: serialize(args) })}\n`, "utf8");
  };
  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  console.log = (...args: unknown[]) => { sink("INFO", args); original.log(...args); };
  console.warn = (...args: unknown[]) => { sink("WARN", args); original.warn(...args); };
  console.error = (...args: unknown[]) => { sink("ERROR", args); original.error(...args); };
  process.on("uncaughtExceptionMonitor", (error) => sink("ERROR", [error]));
  process.on("unhandledRejection", (reason) => sink("ERROR", [reason]));
  return logDirectory;
}
