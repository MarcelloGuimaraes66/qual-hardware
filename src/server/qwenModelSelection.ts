import { createHash } from "node:crypto";
import { access, readdir, stat } from "node:fs/promises";
import { constants as fsConstants, createReadStream } from "node:fs";
import { homedir, totalmem } from "node:os";
import { basename, delimiter, extname, join, resolve } from "node:path";

export const QWEN_LOCAL_MODEL_PROFILE_VERSION = "qual-hardware-qwen-model-profile/1.0.0" as const;
export const QWEN_MEMORY_BUDGET_FRACTION = 0.68;

export type QwenModelSelectionSource = "explicit" | "auto_detected";

export interface QwenTextModelCandidate {
  path: string;
  fileName: string;
  sizeBytes: number;
  parameterBillions: number;
  quantization: string;
  source: QwenModelSelectionSource;
}

export interface SelectedQwenTextModel extends QwenTextModelCandidate {
  modelId: string;
  modelSha256: string;
  profileVersion: typeof QWEN_LOCAL_MODEL_PROFILE_VERSION;
}

export interface QwenModelDiscoveryOptions {
  explicitPath?: string | null;
  searchPaths?: string[];
  totalMemoryBytes?: number;
}

const QUANTIZATION_RANK: Readonly<Record<string, number>> = Object.freeze({
  F32: 100, F16: 90, BF16: 88, Q8_0: 80, Q6_K: 70, Q5_K_M: 64, Q5_K_S: 62,
  Q4_K_M: 54, Q4_K_S: 52, Q4_1: 50, Q4_0: 48, Q3_K_M: 40, Q2_K: 30,
});

function parseParameterBillions(fileName: string): number | null {
  const match = fileName.match(/(?:^|[-_.])(?:qwen\d*(?:\.\d+)?[-_.])?(\d+(?:\.\d+)?)b(?:[-_.]|$)/i)
    ?? fileName.match(/(\d+(?:\.\d+)?)b/i);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseQuantization(fileName: string): string {
  const match = fileName.toUpperCase().match(/(?:^|[-_.])(Q\d(?:_[A-Z0-9]+)*|F16|F32|BF16)(?:[-_.]|$)/);
  return match?.[1] ?? "UNKNOWN";
}

export function qwenTextCandidateFromFile(path: string, sizeBytes: number, source: QwenModelSelectionSource): QwenTextModelCandidate | null {
  const fileName = basename(path);
  const normalized = fileName.toLowerCase();
  if (extname(normalized) !== ".gguf" || !normalized.includes("qwen") || normalized.includes("mmproj")) return null;
  // Vision-language models require a projector and serve a different role. The Qual Hardware
  // classifier deliberately selects a text-only model and consumes visual results from Perceptrum.
  if (/qwen\d*[-_.]?vl|qwen[-_.]?vl/.test(normalized)) return null;
  const parameterBillions = parseParameterBillions(fileName);
  if (parameterBillions === null || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return null;
  return { path: resolve(path), fileName, sizeBytes, parameterBillions, quantization: parseQuantization(fileName), source };
}

export function selectBestQwenTextCandidate(
  candidates: QwenTextModelCandidate[],
  totalMemoryBytes: number,
  memoryBudgetFraction = QWEN_MEMORY_BUDGET_FRACTION,
): QwenTextModelCandidate | null {
  const maximumModelBytes = Math.floor(totalMemoryBytes * memoryBudgetFraction);
  return candidates
    .filter((candidate) => candidate.sizeBytes <= maximumModelBytes)
    .sort((left, right) => right.parameterBillions - left.parameterBillions
      || (QUANTIZATION_RANK[right.quantization] ?? 0) - (QUANTIZATION_RANK[left.quantization] ?? 0)
      || right.sizeBytes - left.sizeBytes
      || left.path.localeCompare(right.path))[0] ?? null;
}

async function listQwenFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch { return []; }
  const files: string[] = [];
  for (const entry of entries.slice(0, 2_000)) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listQwenFiles(path, depth + 1));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".gguf") && entry.name.toLowerCase().includes("qwen")) files.push(path);
  }
  return files;
}

function defaultSearchPaths(): string[] {
  const home = homedir();
  return [
    join(home, "Documents", "Qual Hardware", "Modelos"),
    join(home, "Documents", "inteligencia-finc", "tools", "llm", "models"),
    join(home, "Library", "Application Support", "Inteligencia FINC", "models"),
    join(home, ".local", "share", "qual-hardware", "models"),
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Qual Hardware", "Models") : "",
    process.env.APPDATA ? join(process.env.APPDATA, "Qual Hardware", "Models") : "",
  ].filter(Boolean);
}

export function configuredQwenSearchPaths(value = process.env.QWEN_MODEL_SEARCH_PATHS): string[] {
  return value?.split(delimiter).map((item) => item.trim()).filter(Boolean) ?? [];
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const file = createReadStream(path);
  for await (const chunk of file) hash.update(chunk);
  return hash.digest("hex");
}

export async function discoverBestQwenTextModel(options: QwenModelDiscoveryOptions = {}): Promise<SelectedQwenTextModel | null> {
  const explicitPath = options.explicitPath?.trim();
  const paths = explicitPath
    ? [resolve(explicitPath)]
    : [...new Set([...(options.searchPaths ?? configuredQwenSearchPaths()), ...defaultSearchPaths()].map((path) => resolve(path)))];
  const files = explicitPath ? paths : (await Promise.all(paths.map((root) => listQwenFiles(root)))).flat();
  const candidates: QwenTextModelCandidate[] = [];
  for (const path of [...new Set(files)]) {
    try {
      const information = await stat(path);
      const candidate = qwenTextCandidateFromFile(path, information.size, explicitPath ? "explicit" : "auto_detected");
      if (candidate) candidates.push(candidate);
    } catch { /* An unavailable candidate is ignored; no file is changed. */ }
  }
  const selected = selectBestQwenTextCandidate(candidates, options.totalMemoryBytes ?? totalmem());
  if (!selected) {
    if (explicitPath) throw new Error("qwen_explicit_model_invalid_or_exceeds_memory_budget");
    return null;
  }
  return {
    ...selected,
    modelId: process.env.QWEN_MODEL_ID?.trim() || `local-gguf/${selected.fileName.slice(0, -extname(selected.fileName).length)}`,
    modelSha256: await sha256File(selected.path),
    profileVersion: QWEN_LOCAL_MODEL_PROFILE_VERSION,
  };
}

async function executableFile(path: string): Promise<boolean> {
  try { await access(path, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK); return true; }
  catch { return false; }
}

async function discoverLlamaCppExecutable(name: "llama-cli" | "llama-server", explicitPath?: string): Promise<string | null> {
  if (explicitPath?.trim()) {
    const path = resolve(explicitPath.trim());
    if (!await executableFile(path)) throw new Error("llama_cpp_executable_unavailable");
    return path;
  }
  const executableNames = process.platform === "win32" ? [`${name}.exe`, name] : [name];
  const pathCandidates = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
    .flatMap((directory) => executableNames.map((name) => join(directory, name)));
  const platformCandidates = process.platform === "darwin"
    ? [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]
    : process.platform === "linux" ? [`/usr/local/bin/${name}`, `/usr/bin/${name}`] : [];
  for (const path of [...new Set([...pathCandidates, ...platformCandidates])]) if (await executableFile(path)) return path;
  return null;
}

export async function discoverLlamaCppCli(explicitPath = process.env.LLAMA_CPP_PATH): Promise<string | null> {
  return discoverLlamaCppExecutable("llama-cli", explicitPath);
}

export async function discoverLlamaCppServer(explicitPath = process.env.LLAMA_SERVER_PATH): Promise<string | null> {
  return discoverLlamaCppExecutable("llama-server", explicitPath);
}
