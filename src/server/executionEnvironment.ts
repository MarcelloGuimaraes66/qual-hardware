import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { arch, homedir, platform } from "node:os";
import { basename, delimiter, dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  EXECUTION_ENVIRONMENT_VERSION,
  type CalibrationHardwarePreflight,
  type CalibrationRuntimeStatus,
  type DependencyDownloadLink,
  type ExecutionEnvironment,
  type ExecutionEnvironmentComponent,
  type QwenModelProbeResult,
  type QwenVisionModelCandidate,
} from "../shared/types.js";
import {
  expectedGpuInferenceBackend,
  parseLlamaGpuDevices,
  selectLlamaGpuDevice,
  type CalibrationGpuDevice,
} from "./calibrationCompute.js";
import { calibrationHardwareDigest } from "./calibrationHardware.js";
import {
  loadApprovedQwen3VlContract,
  type LoadedQwen3VlContract,
} from "./qwenModelCertificationRegistry.js";
import {
  selectQwenVisionModels,
  type QwenVisionDiscoveredFile,
  type QwenVisionSelectionPreference,
} from "./qwenVisionModelSelection.js";
import {
  discoverRtspSimulatorExecutable,
  probeRtspSimulator,
  simulatorBundledFfmpegPath,
} from "./rtspSimulator.js";

const execFileAsync = promisify(execFile);
const MAX_DISCOVERY_FILES = 8_000;
const MAX_DISCOVERY_DEPTH = 5;
const VERSION_OUTPUT_LIMIT = 256_000;

export const DEPENDENCY_DOWNLOAD_LINKS: readonly DependencyDownloadLink[] = Object.freeze([
  { id: "ffmpeg-official", label: "FFmpeg — downloads oficiais", url: "https://ffmpeg.org/download.html", platforms: ["windows", "ubuntu", "macos"] },
  { id: "ffmpeg-homebrew", label: "FFmpeg — Homebrew", url: "https://formulae.brew.sh/formula/ffmpeg", platforms: ["macos"] },
  { id: "llama-install", label: "llama.cpp — instalação", url: "https://github.com/ggml-org/llama.cpp/blob/master/docs/install.md", platforms: ["windows", "ubuntu", "macos"] },
  { id: "llama-releases", label: "llama.cpp — releases", url: "https://github.com/ggml-org/llama.cpp/releases", platforms: ["windows", "ubuntu", "macos"] },
  { id: "qwen-vl-2b", label: "Qwen3-VL 2B GGUF", url: "https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF", platforms: ["windows", "ubuntu", "macos"] },
  { id: "qwen-vl-4b", label: "Qwen3-VL 4B GGUF", url: "https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF", platforms: ["windows", "ubuntu", "macos"] },
  { id: "rtsp-simulator-repository", label: "Simulador de RTSP", url: "https://github.com/edguimkit/simulador-rtsp", platforms: ["windows"] },
  { id: "nvidia-drivers", label: "Drivers NVIDIA", url: "https://www.nvidia.com/en-us/drivers/", platforms: ["windows"] },
  { id: "nvidia-ubuntu", label: "Drivers NVIDIA no Ubuntu", url: "https://documentation.ubuntu.com/server/how-to/graphics/install-nvidia-drivers/", platforms: ["ubuntu"] },
  { id: "amd-drivers", label: "Drivers AMD", url: "https://www.amd.com/en/support", platforms: ["windows", "ubuntu"] },
  { id: "intel-drivers", label: "Drivers Intel", url: "https://www.intel.com/content/www/us/en/support/detect.html", platforms: ["windows"] },
  { id: "macos-update", label: "Atualizar o macOS", url: "https://support.apple.com/macos/upgrade", platforms: ["macos"] },
]);

const linkById = new Map(DEPENDENCY_DOWNLOAD_LINKS.map((item) => [item.id, item]));
const completedHashes = new Map<string, string>();
const pendingHashes = new Map<string, Promise<void>>();

export function dependencyDownloadLink(id: string): DependencyDownloadLink | null {
  return linkById.get(id) ?? null;
}

const runtimeAssetByComponentId: Partial<Record<ExecutionEnvironmentComponent["id"], string>> = {
  ffmpeg: "ffmpeg",
  ffprobe: "ffprobe",
  "llama-server": "llama-server",
  "qwen-vl-2b": "qwen-core-gguf",
  "qwen-vl-2b-mmproj": "qwen-core-mmproj",
  "qwen-vl-4b": "qwen-core-max-gguf",
  "qwen-vl-4b-mmproj": "qwen-core-max-mmproj",
  "rtsp-simulator": "rtsp-simulator",
  telemetry: "telemetry-probe",
  "native-benchmark": "native-benchmark",
  perceptrum: "perceptrum-worker",
};

export async function runtimeStatusFromExecutionEnvironment(
  environment: ExecutionEnvironment,
  legacy: CalibrationRuntimeStatus,
): Promise<CalibrationRuntimeStatus> {
  const candidates = environment.qwenModelSelection?.candidates ?? [];
  const core = candidates.find((candidate) =>
    candidate.id === environment.qwenModelSelection?.selectedCoreModelId) ?? null;
  const coreMax = candidates.find((candidate) =>
    candidate.id === environment.qwenModelSelection?.selectedCoreMaxModelId) ?? null;
  const qwenCertified = Boolean(
    core?.compatible && core.probeId && core.resourceProfile &&
    coreMax?.compatible && coreMax.probeId && coreMax.resourceProfile,
  );
  const qwenCertification = qwenCertified && core?.probeId && core.resourceProfile &&
    coreMax?.probeId && coreMax.resourceProfile
    ? {
        selectionSignature: createHash("sha256").update(JSON.stringify(canonical({
          contractSha256: environment.qwenModelSelection?.certificationContractSha256 ?? "",
          core: { id: core.id, inventorySignature: core.inventorySignature, probeId: core.probeId },
          coreMax: { id: coreMax.id, inventorySignature: coreMax.inventorySignature, probeId: coreMax.probeId },
          runtimeIdentity: environment.runtimeIdentity,
        }))).digest("hex"),
        coreProbeId: core.probeId,
        coreMaxProbeId: coreMax.probeId,
        usageGate: core.usageGate === "purchase" && coreMax.usageGate === "purchase"
          ? "purchase" as const : "planning_only" as const,
        coreResourceProfile: core.resourceProfile,
        coreMaxResourceProfile: coreMax.resourceProfile,
      }
    : null;
  const discoveredAssets = await Promise.all(environment.components.flatMap((item) => {
    const id = runtimeAssetByComponentId[item.id];
    if (!id) return [];
    return [Promise.resolve(item.path ? stat(item.path).catch(() => null) : null).then((information) => ({
      id,
      status: item.status === "installed" && item.path ? "system_only" as const : "missing" as const,
      path: item.status === "installed" ? item.path : null,
      sha256: item.sha256,
      sizeBytes: information?.isFile() ? information.size : null,
      expectedSizeBytes: null,
      version: item.version,
      licenseSpdx: null,
      sbomRef: null,
    }))];
  }));
  const merged = new Map(legacy.assets.map((asset) => [asset.id, asset]));
  for (const asset of discoveredAssets) {
    if (asset.status === "system_only" || !merged.has(asset.id)) merged.set(asset.id, asset);
  }
  return {
    ...legacy,
    featureMode: !environment.supported ? "disabled"
      : environment.evidenceLevel === "exact_perceptrum" ? "full" : "diagnostic",
    manifestApproved: environment.evidenceLevel === "exact_perceptrum",
    runtimeAssetsVerified: false,
    readyForQuickTest: environment.supported && qwenCertified,
    readyForFullQualification: environment.evidenceLevel === "exact_perceptrum" && qwenCertified,
    manifestHash: environment.environmentSignature,
    environmentSignature: environment.environmentSignature,
    environmentEvidenceLevel: environment.evidenceLevel,
    environmentProvenance: {
      schemaVersion: environment.schemaVersion,
      detectedAt: environment.detectedAt,
      readiness: environment.readiness,
      evidenceLevel: environment.evidenceLevel,
      components: environment.components.map(({
        id, name, status, origin, path, version, sha256, selfTest, capabilities,
      }) => ({ id, name, status, origin, path, version, sha256, selfTest, capabilities })),
      ...(qwenCertification ? { qwenCertification } : {}),
      ...(environment.rtspSimulatorProbe ? { rtspSimulatorProbe: environment.rtspSimulatorProbe } : {}),
      missingRequiredComponentIds: [...environment.missingRequiredComponentIds],
    },
    assets: [...merged.values()],
    reasons: [...new Set([
      ...environment.warnings,
      ...(!qwenCertified ? ["qwen3-vl:functional-probe-required"] : []),
      `evidence-level:${environment.evidenceLevel}`,
      ...environment.missingRequiredComponentIds.map((id) => `component:${id}:missing_or_incompatible`),
    ])],
  };
}

function supportedTarget(hostPlatform = platform(), hostArchitecture = arch()): boolean {
  return (hostPlatform === "win32" && hostArchitecture === "x64") ||
    (hostPlatform === "linux" && hostArchitecture === "x64") ||
    (hostPlatform === "darwin" && hostArchitecture === "arm64");
}

function platformFamily(hostPlatform = platform()): "windows" | "ubuntu" | "macos" {
  if (hostPlatform === "win32") return "windows";
  if (hostPlatform === "darwin") return "macos";
  return "ubuntu";
}

async function readableFile(candidate: string): Promise<string | null> {
  try {
    await access(candidate, platform() === "win32" ? constants.F_OK : constants.X_OK);
    const information = await stat(candidate);
    if (!information.isFile()) return null;
    return await realpath(candidate);
  } catch {
    return null;
  }
}

function executableNames(name: string, hostPlatform = platform()): string[] {
  return hostPlatform === "win32" ? [`${name}.exe`, name] : [name];
}

function programSearchDirectories(): string[] {
  const home = homedir();
  const envDirectories = (process.env.PATH ?? "").split(delimiter).map((item) => item.trim()).filter(Boolean);
  const known = platform() === "win32"
    ? [
        process.env.ProgramFiles,
        process.env["ProgramFiles(x86)"],
        process.env.LOCALAPPDATA,
        process.env.APPDATA,
        "C:\\Program Files\\ffmpeg\\bin",
        "C:\\ffmpeg\\bin",
        "C:\\Program Files (x86)\\Perceptrum\\llm\\bin",
        "C:\\Program Files (x86)\\Drakon\\llm\\bin",
      ]
    : platform() === "darwin"
      ? ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/Applications", join(home, "Applications")]
      : ["/usr/local/bin", "/usr/bin", "/bin", "/opt", join(home, ".local", "bin")];
  return [...new Set([...envDirectories, ...known.filter((item): item is string => Boolean(item))].map((item) => resolve(item)))];
}

async function discoverExecutable(name: string, extraCandidates: string[] = []): Promise<string | null> {
  const candidates = [
    ...extraCandidates,
    ...programSearchDirectories().flatMap((directory) => executableNames(name).map((file) => join(directory, file))),
  ];
  for (const candidate of [...new Set(candidates)]) {
    const path = await readableFile(candidate);
    if (path) return path;
  }
  return null;
}

export interface DiscoveredLlamaServer {
  path: string;
  version: string;
  sha256: string;
  backend: QwenModelProbeResult["backend"];
  device: CalibrationGpuDevice | null;
  devices: CalibrationGpuDevice[];
  listDevicesOutput: string;
}

async function executableOutput(
  path: string,
  argumentsList: string[],
  timeoutMs = 4_000,
): Promise<{ passed: boolean; output: string }> {
  try {
    const result = await execFileAsync(path, argumentsList, {
      timeout: timeoutMs,
      maxBuffer: VERSION_OUTPUT_LIMIT,
      windowsHide: true,
      shell: false,
      env: { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
    });
    return { passed: true, output: `${result.stdout}\n${result.stderr}`.trim() };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { passed: false, output: `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`.trim() };
  }
}

function llamaSearchCandidates(extraCandidates: string[]): string[] {
  const backendDirectories = ["cuda", "vulkan", "sycl", "rocm", "hip", "metal", "cpu"];
  const extraDirectories = extraCandidates.flatMap((candidate) => [
    dirname(resolve(candidate)),
    dirname(dirname(resolve(candidate))),
  ]);
  const searchDirectories = [...new Set([...programSearchDirectories(), ...extraDirectories])];
  const baseCandidates = searchDirectories.flatMap((directory) =>
    executableNames("llama-server").map((file) => join(directory, file)));
  const nestedCandidates = searchDirectories.flatMap((directory) =>
    backendDirectories.flatMap((backend) =>
      executableNames("llama-server").map((file) => join(directory, backend, file))));
  return [...new Set([...extraCandidates, ...baseCandidates, ...nestedCandidates])];
}

export async function discoverLlamaServer(
  hardware: CalibrationHardwarePreflight,
  extraCandidates: string[] = [],
): Promise<DiscoveredLlamaServer | null> {
  const expectedBackend = expectedGpuInferenceBackend(hardware, platform());
  const discoveredPaths = (await Promise.all(llamaSearchCandidates(extraCandidates).map(readableFile)))
    .filter((item): item is string => item !== null);
  const candidates: Array<DiscoveredLlamaServer & { rank: number }> = [];
  for (const path of [...new Set(discoveredPaths)]) {
    const [versionResult, devicesResult] = await Promise.all([
      executableOutput(path, ["--version"]),
      executableOutput(path, ["--list-devices"]),
    ]);
    if (!versionResult.passed) continue;
    const devices = parseLlamaGpuDevices(devicesResult.output);
    const device = selectLlamaGpuDevice({
      devices,
      expectedBackend,
      gpuModel: hardware.gpuModel,
    });
    const firstLine = versionResult.output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "unknown";
    const backend = device?.backend ?? "unavailable";
    const exactGpuBackend = device?.backend === expectedBackend;
    const acceptedGpuFallback = expectedBackend !== "unavailable" && device !== null;
    const explicitRank = extraCandidates.some((candidate) => resolve(candidate).toLowerCase() === path.toLowerCase()) ? 20 : 0;
    candidates.push({
      path,
      version: firstLine.slice(0, 240),
      sha256: await sha256Path(path),
      backend,
      device,
      devices,
      listDevicesOutput: devicesResult.output,
      rank: exactGpuBackend ? 1_000 + explicitRank
        : acceptedGpuFallback ? 700 + explicitRank
          : expectedBackend === "unavailable" ? 300 + explicitRank
            : 10 + explicitRank,
    });
  }
  candidates.sort((left, right) =>
    right.rank - left.rank ||
    Number(right.device !== null) - Number(left.device !== null) ||
    left.path.localeCompare(right.path));
  const selected = candidates[0];
  if (!selected) return null;
  const { rank: _rank, ...result } = selected;
  return result;
}

async function versionProbe(
  path: string,
  argumentsList: string[],
  timeoutMs = 4_000,
): Promise<{ passed: boolean; version: string | null }> {
  try {
    const result = await execFileAsync(path, argumentsList, {
      timeout: timeoutMs,
      maxBuffer: VERSION_OUTPUT_LIMIT,
      windowsHide: true,
      shell: false,
      env: { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
    });
    const firstLine = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
    return { passed: true, version: firstLine.slice(0, 240) || null };
  } catch {
    return { passed: false, version: null };
  }
}

async function sha256Path(path: string): Promise<string> {
  const digest = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest("hex");
}

async function immediateHash(path: string): Promise<string | null> {
  try {
    const information = await stat(path);
    if (information.size > 256 * 1024 ** 2) return scheduledHash(path, information.size, information.mtimeMs);
    return await sha256Path(path);
  } catch {
    return null;
  }
}

function scheduledHash(path: string, size: number, modified: number): string | null {
  const key = `${path}\0${size}\0${modified}`;
  const completed = completedHashes.get(key);
  if (completed) return completed;
  if (!pendingHashes.has(key)) {
    const task = sha256Path(path).then((hash) => { completedHashes.set(key, hash); }).catch(() => undefined)
      .finally(() => pendingHashes.delete(key));
    pendingHashes.set(key, task);
  }
  return null;
}

function knownModelRoots(extraRoots: string[] = []): string[] {
  const home = homedir();
  return [...new Set([
    ...extraRoots,
    process.env.QWEN_MODEL_PATH ? resolve(process.env.QWEN_MODEL_PATH) : "",
    ...(process.env.QWEN_MODEL_SEARCH_PATHS ?? "").split(delimiter).filter(Boolean).map((item) => resolve(item)),
    process.env.HF_HOME ? join(process.env.HF_HOME, "hub") : "",
    process.env.HUGGINGFACE_HUB_CACHE ?? "",
    join(home, ".cache", "huggingface", "hub"),
    join(home, "Documents", "Qual Hardware", "Modelos"),
    platform() === "win32" ? "C:\\Program Files (x86)\\Perceptrum\\llm\\models" : "",
    platform() === "win32" ? "C:\\Program Files (x86)\\Drakon\\llm\\models" : "",
    platform() === "darwin" ? "/Applications/Perceptrum.app/Contents/Resources/llm/models" : "",
    platform() === "linux" ? "/opt/perceptrum/llm/models" : "",
  ].filter(Boolean))];
}

async function listModelFiles(root: string, state: { count: number }, depth = 0): Promise<string[]> {
  if (state.count >= MAX_DISCOVERY_FILES || depth > MAX_DISCOVERY_DEPTH) return [];
  try {
    const information = await stat(root);
    if (information.isFile()) return extname(root).toLowerCase() === ".gguf" ? [root] : [];
    if (!information.isDirectory()) return [];
  } catch {
    return [];
  }
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (state.count++ >= MAX_DISCOVERY_FILES) break;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listModelFiles(path, state, depth + 1));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".gguf") files.push(path);
  }
  return files;
}

async function discoverModels(extraRoots: string[] = []): Promise<QwenVisionDiscoveredFile[]> {
  const state = { count: 0 };
  const files = (await Promise.all(knownModelRoots(extraRoots).map((root) => listModelFiles(root, state)))).flat();
  const discovered: QwenVisionDiscoveredFile[] = [];
  for (const path of [...new Set(files)].sort()) {
    const information = await stat(path).catch(() => null);
    if (!information?.isFile()) continue;
    discovered.push({ path, sizeBytes: information.size, modifiedMs: information.mtimeMs });
  }
  return discovered;
}

function component(input: ExecutionEnvironmentComponent): ExecutionEnvironmentComponent {
  return input;
}

function missingProgram(
  id: ExecutionEnvironmentComponent["id"],
  name: string,
  purpose: string,
  impact: string,
  instruction: string,
  downloadLinkId: string,
): ExecutionEnvironmentComponent {
  return component({
    id, name, purpose, status: "missing", origin: "missing", path: null, version: null, sha256: null,
    selfTest: "not_run", capabilities: [], impact, instruction, downloadLinkId, diagnosticOnly: true,
  });
}

async function programComponent(input: {
  id: "ffmpeg" | "ffprobe" | "llama-server";
  name: string;
  purpose: string;
  path: string | null;
  argumentsList: string[];
  impact: string;
  instruction: string;
  downloadLinkId: string;
  capabilities: string[];
}): Promise<ExecutionEnvironmentComponent> {
  if (!input.path) return missingProgram(input.id, input.name, input.purpose, input.impact, input.instruction, input.downloadLinkId);
  const probe = await versionProbe(input.path, input.argumentsList);
  return component({
    id: input.id,
    name: input.name,
    purpose: input.purpose,
    status: probe.passed ? "installed" : "incompatible",
    origin: (process.env.PATH ?? "").split(delimiter).some((directory) =>
      resolve(directory, basename(input.path!)).toLowerCase() === input.path!.toLowerCase()) ? "system_path" : "known_installation",
    path: input.path,
    version: probe.version,
    sha256: await immediateHash(input.path),
    selfTest: probe.passed ? "passed" : "failed",
    capabilities: probe.passed ? input.capabilities : [],
    impact: probe.passed ? "Componente disponível para medição local." : input.impact,
    instruction: input.instruction,
    downloadLinkId: input.downloadLinkId,
    diagnosticOnly: true,
  });
}

function driverLink(hardware: CalibrationHardwarePreflight): string | null {
  const names = `${hardware.gpuModel} ${hardware.gpuDevices?.map((item) => item.name).join(" ") ?? ""}`.toLowerCase();
  if (platform() === "darwin") return "macos-update";
  if (names.includes("nvidia") || names.includes("geforce") || names.includes("rtx")) {
    return platform() === "linux" ? "nvidia-ubuntu" : "nvidia-drivers";
  }
  if (names.includes("amd") || names.includes("radeon")) return "amd-drivers";
  if (names.includes("intel")) return platform() === "win32" ? "intel-drivers" : null;
  return null;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
  }
  return value;
}

export async function detectExecutionEnvironment(options: {
  hardware: CalibrationHardwarePreflight;
  appVersion: string;
  resourceRoot?: string;
  nativeBenchmarkPath?: string | null;
  selectedPaths?: Partial<Record<ExecutionEnvironmentComponent["id"], string>>;
  qwenSelection?: QwenVisionSelectionPreference;
  qwenProbes?: QwenModelProbeResult[];
  certificationContract?: LoadedQwen3VlContract | null;
}): Promise<ExecutionEnvironment> {
  const hostPlatform = platform();
  const hostArchitecture = arch();
  const supported = supportedTarget(hostPlatform, hostArchitecture);
  const llamaExplicitCandidates = [
    ...(options.selectedPaths?.["llama-server"] ? [options.selectedPaths["llama-server"]] : []),
    ...(platform() === "win32" ? [
      "C:\\Program Files (x86)\\Perceptrum\\llm\\bin\\llama-server.exe",
      "C:\\Program Files (x86)\\Drakon\\llm\\bin\\llama-server.exe",
    ] : []),
  ];
  const rtspSimulatorExecutable = await discoverRtspSimulatorExecutable(
    options.selectedPaths?.["rtsp-simulator"],
  );
  const bundledSimulatorFfmpeg = simulatorBundledFfmpegPath(rtspSimulatorExecutable.path);
  const [ffmpegPath, ffprobePath, llamaDiscovery, modelFiles, loadedContract] = await Promise.all([
    discoverExecutable("ffmpeg", [
      ...(options.selectedPaths?.ffmpeg ? [options.selectedPaths.ffmpeg] : []),
      ...(bundledSimulatorFfmpeg ? [bundledSimulatorFfmpeg] : []),
    ]),
    discoverExecutable("ffprobe", options.selectedPaths?.ffprobe ? [options.selectedPaths.ffprobe] : []),
    discoverLlamaServer(options.hardware, llamaExplicitCandidates),
    discoverModels([
      ...(["qwen-vl-2b", "qwen-vl-2b-mmproj", "qwen-vl-4b", "qwen-vl-4b-mmproj"] as const)
        .map((id) => options.selectedPaths?.[id]).filter((item): item is string => Boolean(item)),
    ]),
    options.certificationContract === undefined
      ? loadApprovedQwen3VlContract(options.resourceRoot ?? process.cwd()).catch(() => null)
      : Promise.resolve(options.certificationContract),
  ]);
  const hardwareSignature = calibrationHardwareDigest(options.hardware);
  const qwenModelSelection = selectQwenVisionModels(modelFiles, options.hardware, options.qwenSelection, {
    contractSha256: loadedContract?.sha256 ?? "",
    probes: options.qwenProbes ?? [],
    hardwareSignature,
    llamaServerSha256: llamaDiscovery?.sha256 ?? null,
    backend: llamaDiscovery?.backend ?? "unavailable",
    deviceId: llamaDiscovery?.device?.id ?? null,
    driverVersion: options.hardware.gpuDriver || null,
  });
  const [ffmpeg, ffprobe, llama] = await Promise.all([
    programComponent({
      id: "ffmpeg", name: "FFmpeg", purpose: "Decodificação, encode e concorrência de vídeo.",
      path: ffmpegPath, argumentsList: ["-version"], capabilities: ["video_decode", "video_encode"],
      impact: "O pipeline real de vídeo não poderá ser reproduzido; será usado o benchmark nativo.",
      instruction: "Instale o FFmpeg para o seu sistema e clique em Verificar novamente.",
      downloadLinkId: platform() === "darwin" ? "ffmpeg-homebrew" : "ffmpeg-official",
    }),
    programComponent({
      id: "ffprobe", name: "FFprobe", purpose: "Validação técnica dos fluxos e amostras.",
      path: ffprobePath, argumentsList: ["-version"], capabilities: ["media_probe"],
      impact: "A validação detalhada dos fluxos ficará indisponível.",
      instruction: "FFprobe normalmente é instalado junto com o FFmpeg.",
      downloadLinkId: platform() === "darwin" ? "ffmpeg-homebrew" : "ffmpeg-official",
    }),
    programComponent({
      id: "llama-server", name: "llama.cpp / llama-server", purpose: "Inferência local equivalente ao AiQ.",
      path: llamaDiscovery?.path ?? null, argumentsList: ["--version"], capabilities: [
        "local_inference",
        `backend:${llamaDiscovery?.backend ?? "unavailable"}`,
        ...(llamaDiscovery?.device ? [
          `device:${llamaDiscovery.device.id}`,
          `device-name:${llamaDiscovery.device.name}`,
        ] : []),
      ],
      impact: "A inferência real será substituída por um proxy computacional.",
      instruction: "Instale o llama.cpp e clique em Verificar novamente.",
      downloadLinkId: "llama-install",
    }),
  ]);
  const rtspSimulatorProbe = rtspSimulatorExecutable.path && ffmpegPath && ffprobePath
    ? await probeRtspSimulator({
        ffmpegPath,
        ffprobePath,
        simulatorExecutable: rtspSimulatorExecutable,
      }).catch((error) => ({
        schemaVersion: "qual-hardware-rtsp-simulator-probe/1.0.0" as const,
        status: "failed" as const,
        detectedAt: new Date().toISOString(),
        host: "127.0.0.1" as const,
        simulatorExecutable: rtspSimulatorExecutable,
        endpoints: [],
        credentialsPersisted: false as const,
        externalRequestCount: 0 as const,
        errors: [error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)],
        warnings: [],
      }))
    : undefined;
  const rtspSimulator: ExecutionEnvironmentComponent = platform() !== "win32"
    ? component({
        id: "rtsp-simulator",
        name: "Simulador de RTSP",
        purpose: "Fonte Hikvision compatível para carga RTSP autenticada.",
        status: "not_applicable",
        origin: "missing",
        path: null,
        version: null,
        sha256: null,
        selfTest: "not_applicable",
        capabilities: [],
        impact: "O simulador atual é WPF e executa somente no Windows.",
        instruction: "No macOS e Ubuntu, a ausência mantém a qualificação RTSP bloqueada com segurança.",
        downloadLinkId: null,
        diagnosticOnly: true,
      })
    : rtspSimulatorExecutable.path
      ? component({
          id: "rtsp-simulator",
          name: "Simulador de RTSP",
          purpose: "Fonte Hikvision compatível para carga RTSP autenticada.",
          status: "installed",
          origin: "known_installation",
          path: rtspSimulatorExecutable.path,
          version: rtspSimulatorExecutable.version,
          sha256: rtspSimulatorExecutable.sha256,
          selfTest: rtspSimulatorProbe?.status === "passed" ? "passed"
            : rtspSimulatorProbe?.status === "failed" || rtspSimulatorProbe?.status === "incompatible"
              ? "failed" : "not_run",
          capabilities: [
            "rtsp_loopback",
            "hikvision_compatible_path",
            "fixed_test_credentials",
            ...(rtspSimulatorProbe?.endpoints.map((endpoint) =>
              `endpoint:${endpoint.redactedOrigin}`) ?? []),
          ],
          impact: rtspSimulatorProbe?.status === "passed"
            ? "Stream autenticado, caracterizado e decodificado com frames reais."
            : "O executável foi localizado, mas a calibração fará um preflight fresco antes de usar o stream.",
          instruction: rtspSimulatorProbe?.status === "passed"
            ? "Mantenha o simulador aberto durante a calibração."
            : "Abra o simulador, carregue um vídeo, inicie RTSP na porta 554 ou 5541+ e verifique novamente.",
          downloadLinkId: "rtsp-simulator-repository",
          diagnosticOnly: true,
        })
      : missingProgram(
          "rtsp-simulator",
          "Simulador de RTSP",
          "Fonte Hikvision compatível para carga RTSP autenticada.",
          "O gerador interno continuará disponível apenas como evidência diagnóstica.",
          "Instale ou localize o Simulador de RTSP antes da validação física.",
          "rtsp-simulator-repository",
        );
  const candidateById = new Map(qwenModelSelection.candidates.map((candidate) => [candidate.id, candidate]));
  const activeCandidate = (id: string | null): QwenVisionModelCandidate | null =>
    id ? candidateById.get(id) ?? null : null;
  const modelComponents = (
    slot: "core" | "core-max",
    candidate: QwenVisionModelCandidate | null,
  ): [ExecutionEnvironmentComponent, ExecutionEnvironmentComponent] => {
    const modelId = slot === "core" ? "qwen-vl-2b" : "qwen-vl-4b";
    const projectorId = slot === "core" ? "qwen-vl-2b-mmproj" : "qwen-vl-4b-mmproj";
    const slotName = slot === "core" ? "AiQ Core" : "AiQ Core Max";
    const link = candidate && candidate.parameterBillions <= 2.5 ? "qwen-vl-2b" : "qwen-vl-4b";
    if (!candidate?.projectorPath || candidate.projectorSizeBytes === null) {
      return [
        missingProgram(modelId, `Qwen3-VL — ${slotName}`, `Modelo local selecionado para ${slotName}.`,
          "A carga desse modelo será representada pelo benchmark nativo e ficará diagnóstica.",
          "Instale um par Qwen3-VL com o arquivo mmproj correspondente e verifique novamente.", link),
        missingProgram(projectorId, `Qwen3-VL — visão do ${slotName}`, `Projetor visual selecionado para ${slotName}.`,
          "A carga visual será representada pelo benchmark nativo e ficará diagnóstica.",
          "Instale o mmproj da mesma família e quantidade de parâmetros do modelo.", link),
      ];
    }
    const modelInformation = modelFiles.find((file) => resolve(file.path) === candidate.modelPath);
    const projectorInformation = modelFiles.find((file) => resolve(file.path) === candidate.projectorPath);
    const certifiedProbe = candidate.probeId
      ? (options.qwenProbes ?? []).find((probe) => probe.id === candidate.probeId && probe.status === "passed") ?? null
      : null;
    const modelHash = certifiedProbe?.modelSha256 ?? (modelInformation
      ? scheduledHash(candidate.modelPath, modelInformation.sizeBytes, modelInformation.modifiedMs ?? 0)
      : null);
    const projectorHash = certifiedProbe?.projectorSha256 ?? (projectorInformation
      ? scheduledHash(candidate.projectorPath, projectorInformation.sizeBytes, projectorInformation.modifiedMs ?? 0)
      : null);
    const origin = candidate.modelPath.toLowerCase().includes("perceptrum") ? "perceptrum" : "known_installation";
    return [
      component({
        id: modelId,
        name: `Qwen3-VL ${candidate.parameterBillions}B — ${slotName}`,
        purpose: `Modelo local selecionado para ${slotName}.`,
        status: "installed",
        origin,
        path: candidate.modelPath,
        version: candidate.modelFileName,
        sha256: modelHash,
        selfTest: candidate.compatible ? "passed"
          : candidate.certificationState === "incompatible" ? "failed" : "not_run",
        capabilities: ["gguf", "vision_language", `parameters:${candidate.parameterBillions}b`,
          `selection:${qwenModelSelection.mode}`, `certification:${candidate.certificationState}`,
          `usage:${candidate.usageGate}`],
        impact: candidate.compatible
          ? "Modelo carregado e aprovado em inferência visual local."
          : "Arquivo localizado, mas ainda não aprovado por inferência visual real.",
        instruction: candidate.compatible
          ? "Use a lista de modelos para manter a seleção automática ou escolher outro par validado."
          : "Execute Testar modelo antes de selecionar este arquivo.",
        downloadLinkId: link,
        diagnosticOnly: modelHash === null || candidate.usageGate !== "purchase",
      }),
      component({
        id: projectorId,
        name: `Qwen3-VL ${candidate.parameterBillions}B — visão do ${slotName}`,
        purpose: `Projetor visual selecionado para ${slotName}.`,
        status: "installed",
        origin,
        path: candidate.projectorPath,
        version: candidate.projectorFileName,
        sha256: projectorHash,
        selfTest: candidate.compatible ? "passed"
          : candidate.certificationState === "incompatible" ? "failed" : "not_run",
        capabilities: ["gguf", "vision_projection", `parameters:${candidate.parameterBillions}b`,
          `selection:${qwenModelSelection.mode}`, `certification:${candidate.certificationState}`,
          `usage:${candidate.usageGate}`],
        impact: candidate.compatible
          ? "Projetor visual carregado com o modelo e aprovado localmente."
          : "Arquivo localizado, mas o pareamento modelo + projetor ainda não foi aprovado.",
        instruction: candidate.compatible ? "Nenhuma ação necessária." : "Execute Testar modelo para validar o par completo.",
        downloadLinkId: link,
        diagnosticOnly: projectorHash === null || candidate.usageGate !== "purchase",
      }),
    ];
  };
  const models = [
    ...modelComponents("core", activeCandidate(qwenModelSelection.selectedCoreModelId)),
    ...modelComponents("core-max", activeCandidate(qwenModelSelection.selectedCoreMaxModelId)),
  ];
  const driverPresent = options.hardware.gpuCount > 0 || (options.hardware.gpuDevices?.length ?? 0) > 0;
  const driver: ExecutionEnvironmentComponent = component({
    id: "gpu-driver", name: "Driver de GPU", purpose: "Compute, decode e telemetria por dispositivo.",
    status: driverPresent ? "installed" : "missing", origin: driverPresent ? "os_native" : "missing",
    path: null, version: options.hardware.gpuDriver || null, sha256: null,
    selfTest: driverPresent ? "passed" : "not_run",
    capabilities: driverPresent ? ["gpu_inventory", "gpu_compute_candidate", "gpu_media_candidate"] : [],
    impact: driverPresent ? "GPU e driver detectados pelo sistema operacional." : "Somente CPU poderá ser medida.",
    instruction: driverPresent ? "Nenhuma ação necessária." : "Instale o driver oficial da GPU e reinicie a máquina.",
    downloadLinkId: driverLink(options.hardware), diagnosticOnly: false,
  });
  const nativePath = options.nativeBenchmarkPath ? await readableFile(options.nativeBenchmarkPath) : null;
  const nativeProbe = nativePath
    ? await versionProbe(nativePath, ["--self-test"], 15_000)
    : { passed: supported, version: null };
  const nativeReady = supported && nativeProbe.passed;
  const builtIn: ExecutionEnvironmentComponent = component({
    id: "native-benchmark", name: "Benchmark nativo do Qual Hardware",
    purpose: "Medição interna de CPU, GPU, vídeo, memória, disco e rede.",
    status: nativeReady ? "installed" : "incompatible", origin: nativePath ? "os_native" : "built_in_proxy",
    path: nativePath, version: "1.0.0", sha256: nativePath ? await immediateHash(nativePath) : null,
    selfTest: nativeReady ? "passed" : "failed",
    capabilities: nativeReady ? ["cpu", "memory", "disk", "network", "generic_inference_proxy", "synthetic_video", "per_gpu_probe"] : [],
    impact: nativeReady ? "Garante diagnóstico sem componentes externos." : "Não há benchmark interno executável para esta plataforma.",
    instruction: nativeReady ? "Nenhuma ação necessária." : "Reinstale a edição adequada do Qual Hardware.",
    downloadLinkId: null, diagnosticOnly: true,
  });
  const perceptrum: ExecutionEnvironmentComponent = component({
    id: "perceptrum", name: "Adaptador isolado de produção", purpose: "Evidência opcional de maior validade.",
    status: "not_applicable",
    origin: "missing",
    path: null,
    version: null,
    sha256: null,
    selfTest: "not_run",
    capabilities: [],
    impact: "O diagnóstico e o dimensionamento usam os componentes locais detectados.",
    instruction: "Nenhuma ação necessária.",
    downloadLinkId: null, diagnosticOnly: true,
  });
  const application: ExecutionEnvironmentComponent = component({
    id: "application", name: "Qual Hardware", purpose: "Interface, descoberta, planejamento e relatórios.",
    status: supported ? "installed" : "incompatible", origin: "built_in_proxy", path: null,
    version: options.appVersion, sha256: null, selfTest: supported ? "passed" : "failed",
    capabilities: ["planning", "reports", "calibration_import", "dynamic_capacity"],
    impact: supported ? "Aplicativo pronto." : "Plataforma não suportada por esta edição.",
    instruction: supported ? "Nenhuma ação necessária." : "Instale a edição adequada à plataforma.",
    downloadLinkId: null, diagnosticOnly: false,
  });
  const telemetry: ExecutionEnvironmentComponent = component({
    id: "telemetry", name: "Telemetria local", purpose: "Utilização, memória, temperatura e potência.",
    status: "installed", origin: "os_native", path: null, version: "0.2.0", sha256: null,
    selfTest: "passed", capabilities: ["cpu_telemetry", "gpu_telemetry_when_exposed_by_driver"],
    impact: "Sensores indisponíveis serão declarados, nunca inventados.",
    instruction: "Mantenha os drivers atualizados para ampliar a cobertura.", downloadLinkId: driver.downloadLinkId,
    diagnosticOnly: false,
  });
  const components = [
    application, driver, ffmpeg, ffprobe, rtspSimulator, llama, ...models, perceptrum, builtIn, telemetry,
  ];
  const requiredIds: ExecutionEnvironmentComponent["id"][] = [
    "ffmpeg", "ffprobe", "llama-server", "qwen-vl-2b", "qwen-vl-2b-mmproj", "qwen-vl-4b", "qwen-vl-4b-mmproj",
  ];
  const missingRequiredComponentIds = components
    .filter((item) => requiredIds.includes(item.id) && item.status !== "installed")
    .map((item) => item.id);
  const compatibleLocalStack = missingRequiredComponentIds.length === 0 &&
    components.filter((item) => requiredIds.includes(item.id)).every((item) => item.selfTest === "passed" && item.sha256 !== null);
  const evidenceLevel = compatibleLocalStack ? "compatible_local_stack" as const
    : supported ? "generic_native" as const : "inventory_only" as const;
  const signaturePayload = components.map(({ id, status, origin, path, version, sha256, selfTest, capabilities }) => ({
    id, status, origin, path, version, sha256, selfTest, capabilities,
  }));
  const environmentSignature = createHash("sha256").update(JSON.stringify(canonical({
    platform: hostPlatform,
    architecture: hostArchitecture,
    hardware: options.hardware,
    certificationContractSha256: loadedContract?.sha256 ?? null,
    components: signaturePayload,
    qwenModelSelection,
    rtspSimulatorProbe: rtspSimulatorProbe ?? null,
  }))).digest("hex");
  return {
    schemaVersion: EXECUTION_ENVIRONMENT_VERSION,
    detectedAt: new Date().toISOString(),
    platform: hostPlatform,
    architecture: hostArchitecture,
    supported,
    readiness: !supported ? "unsupported" : compatibleLocalStack ? "ready_full" : "ready_diagnostic",
    evidenceLevel,
    environmentSignature,
    runtimeIdentity: {
      llamaServerPath: llamaDiscovery?.path ?? null,
      llamaServerSha256: llamaDiscovery?.sha256 ?? null,
      llamaServerVersion: llamaDiscovery?.version ?? null,
      backend: llamaDiscovery?.backend ?? "unavailable",
      deviceId: llamaDiscovery?.device?.id ?? null,
      deviceName: llamaDiscovery?.device?.name ?? null,
      driverVersion: options.hardware.gpuDriver || null,
    },
    components,
    qwenModelSelection,
    ...(rtspSimulatorProbe ? { rtspSimulatorProbe } : {}),
    missingRequiredComponentIds,
    warnings: [
      ...(compatibleLocalStack ? [] : ["O benchmark nativo permite diagnóstico e planejamento, mas o relatório não representa homologação comercial."]),
      ...(!loadedContract ? ["O contrato embarcado de revisões Qwen3-VL não pôde ser validado; todos os modelos permanecerão bloqueados."] : []),
      ...(rtspSimulatorExecutable.path && rtspSimulatorProbe?.status !== "passed"
        ? ["O Simulador de RTSP foi localizado, mas nenhum stream autenticado e compatível foi aprovado nesta verificação."] : []),
      ...(rtspSimulatorExecutable.path
        ? ["Use o Simulador de RTSP somente em rede de teste protegida: o MediaMTX pode escutar também fora do loopback com as credenciais fixas de ensaio."] : []),
      ...(rtspSimulatorProbe?.status === "passed"
        ? ["O RTSP em 127.0.0.1 mede recepção e decode, mas não comprova o enlace físico da placa de rede."] : []),
      ...qwenModelSelection.warnings.map((warning) => ({
        qwen3_vl_models_not_found: "Nenhum modelo Qwen3-VL foi localizado. Modelos Qwen apenas textuais não são aceitos.",
        qwen3_vl_models_incompatible_with_detected_hardware: "Os modelos Qwen3-VL localizados não cabem com segurança na memória detectada ou estão sem mmproj.",
        qwen3_vl_functional_probe_required: "Os modelos localizados precisam passar no ensaio visual real antes da seleção.",
        manual_qwen_selection_restored_to_automatic: "A escolha manual de Qwen não está mais disponível; a seleção automática foi restaurada.",
        same_qwen_model_selected_for_core_and_core_max: "O mesmo Qwen3-VL atenderá Core e Core Max porque não há dois pares compatíveis disponíveis.",
      })[warning] ?? warning),
    ],
    externalDownloadsPerformed: false,
  };
}

export async function readConfiguredPerceptrumPath(file: string): Promise<string | null> {
  try {
    const value = (await readFile(file, "utf8")).trim();
    return value ? resolve(value) : null;
  } catch {
    return null;
  }
}
