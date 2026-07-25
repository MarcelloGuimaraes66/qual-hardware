import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { arch, platform } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { deflateSync } from "node:zlib";
import {
  QWEN_MODEL_PROBE_VERSION,
  type CalibrationHardwarePreflight,
  type ExecutionEnvironment,
  type QwenModelProbeChallenge,
  type QwenModelProbeResult,
  type QwenRuntimeResourceProfile,
  type QwenVisionModelCandidate,
} from "../shared/types.js";
import { expectedGpuInferenceBackend } from "./calibrationCompute.js";
import { calibrationHardwareDigest } from "./calibrationHardware.js";
import {
  findApprovedQwen3VlRevision,
  loadApprovedQwen3VlContract,
  QWEN3_VL_FUNCTIONAL_PROBE_CONTRACT,
  qwenCertificationPolicy,
  type LoadedQwen3VlContract,
} from "./qwenModelCertificationRegistry.js";

const execFileAsync = promisify(execFile);
const MIB = 1024 ** 2;
const PROBE_VALIDITY_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_LOAD_TIMEOUT_MILLISECONDS = 180_000;
const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 90_000;
const MAX_LOG_CHARACTERS = 32_000;
const CRC32_TABLE = Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current & 1) ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  }
  return current >>> 0;
});

interface ResourceSample {
  ramBytes: number | null;
  vramBytes: number | null;
}

interface ActiveProbe {
  result: QwenModelProbeResult;
  abortController: AbortController;
  child: ChildProcess | null;
  log: string;
  terminalPersisted: boolean;
}

export interface QwenModelCertificationOptions {
  resourceRoot: string;
  contract?: LoadedQwen3VlContract;
  loadTimeoutMs?: number;
  requestTimeoutMs?: number;
  onUpdate?: (result: QwenModelProbeResult) => Promise<void> | void;
  now?: () => Date;
  spawnServer?: (
    executable: string,
    argumentsList: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) => ChildProcess;
}

function cloneResult(result: QwenModelProbeResult): QwenModelProbeResult {
  return structuredClone(result);
}

async function sha256Path(path: string): Promise<string> {
  const digest = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest("hex");
}

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("qwen_probe_loopback_port_unavailable"));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function normalizedAnswer(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(":")[0]!.slice(0, 120) || "qwen_probe_failed";
}

async function readProbeImage(resourceRoot: string): Promise<string> {
  const candidates = [
    resolve(resourceRoot, "resources", "qwen-model-probe.png"),
    resolve(resourceRoot, "build", "icon.png"),
  ];
  for (const candidate of candidates) {
    try {
      return `data:image/png;base64,${(await readFile(candidate)).toString("base64")}`;
    } catch { /* Try the development or packaged location. */ }
  }
  throw new Error("qwen_probe_image_unavailable");
}

function crc32(bytes: Buffer): number {
  let checksum = 0xffffffff;
  for (const byte of bytes) checksum = CRC32_TABLE[(checksum ^ byte) & 0xff]! ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function generatedColorImage(color: "red" | "blue"): string {
  const width = 256;
  const height = 256;
  const [red, green, blue] = color === "red" ? [220, 35, 35] : [30, 90, 220];
  const pixels = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    pixels[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      const border = x < 12 || y < 12 || x >= width - 12 || y >= height - 12;
      pixels[offset] = border ? 255 : red;
      pixels[offset + 1] = border ? 255 : green;
      pixels[offset + 2] = border ? 255 : blue;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function sampleProcessRam(processId: number): Promise<number | null> {
  try {
    if (platform() === "linux") {
      const status = await readFile(`/proc/${processId}/status`, "utf8");
      const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
      return match?.[1] ? Number(match[1]) * 1024 : null;
    }
    if (platform() === "darwin") {
      const result = await execFileAsync("ps", ["-o", "rss=", "-p", String(processId)], {
        timeout: 3_000, windowsHide: true,
      });
      const kib = Number(result.stdout.trim());
      return Number.isFinite(kib) && kib >= 0 ? kib * 1024 : null;
    }
    const command = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${processId}").WorkingSetSize`;
    const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      timeout: 5_000, windowsHide: true,
    });
    const bytes = Number(result.stdout.trim());
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
  } catch {
    return null;
  }
}

async function sampleNvidiaVram(processId: number): Promise<number | null> {
  try {
    const result = await execFileAsync("nvidia-smi", [
      "--query-compute-apps=pid,used_memory",
      "--format=csv,noheader,nounits",
    ], { timeout: 5_000, windowsHide: true });
    const usedMib = result.stdout.split(/\r?\n/).reduce((sum, line) => {
      const match = line.match(/^\s*(\d+)\s*,\s*(\d+(?:\.\d+)?)\s*$/);
      return match?.[1] && Number(match[1]) === processId ? sum + Number(match[2]) : sum;
    }, 0);
    return usedMib > 0 ? Math.round(usedMib * MIB) : null;
  } catch {
    return null;
  }
}

async function sampleResources(processId: number): Promise<ResourceSample> {
  const [ramBytes, vramBytes] = await Promise.all([
    sampleProcessRam(processId),
    sampleNvidiaVram(processId),
  ]);
  return { ramBytes, vramBytes };
}

function maximum(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? Math.max(...present) : null;
}

async function terminateProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (platform() === "win32") {
    await execFileAsync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      timeout: 10_000,
      windowsHide: true,
    }).catch(() => undefined);
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  if (child.exitCode === null) child.kill("SIGKILL");
}

export class QwenModelCertificationService {
  private readonly jobs = new Map<string, ActiveProbe>();
  private activeJobId: string | null = null;
  private contractPromise: Promise<LoadedQwen3VlContract>;

  constructor(private readonly options: QwenModelCertificationOptions) {
    this.contractPromise = options.contract
      ? Promise.resolve(options.contract)
      : loadApprovedQwen3VlContract(options.resourceRoot);
  }

  hasActiveProbe(): boolean {
    if (!this.activeJobId) return false;
    const active = this.jobs.get(this.activeJobId);
    return Boolean(active && !active.terminalPersisted);
  }

  get(probeId: string): QwenModelProbeResult | null {
    const active = this.jobs.get(probeId);
    if (!active) return null;
    if (!active.terminalPersisted && !["queued", "running"].includes(active.result.status)) {
      return {
        ...cloneResult(active.result),
        status: "running",
        message: "Finalizando e persistindo o resultado do ensaio.",
      };
    }
    return cloneResult(active.result);
  }

  async start(
    candidateId: string,
    environment: ExecutionEnvironment,
    hardware: CalibrationHardwarePreflight,
  ): Promise<QwenModelProbeResult> {
    if (this.hasActiveProbe()) throw new Error("qwen_probe_already_running");
    this.activeJobId = null;
    const candidate = environment.qwenModelSelection?.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new Error("qwen_probe_candidate_not_in_inventory");
    if (!candidate.projectorPath) throw new Error("qwen_probe_projector_missing");
    if (!candidate.estimatedCompatible) throw new Error("qwen_probe_candidate_exceeds_safe_memory_budget");
    if (!environment.runtimeIdentity?.llamaServerPath) throw new Error("qwen_probe_llama_server_missing");
    const contract = await this.contractPromise;
    if (environment.qwenModelSelection?.certificationContractSha256 !== contract.sha256) {
      throw new Error("qwen_probe_contract_changed");
    }
    const now = (this.options.now ?? (() => new Date()))();
    const result: QwenModelProbeResult = {
      schemaVersion: QWEN_MODEL_PROBE_VERSION,
      id: randomUUID(),
      candidateId,
      inventorySignature: candidate.inventorySignature,
      stackSignature: "",
      status: "queued",
      certificationLevel: "none",
      usageGate: "blocked",
      approvedRevisionId: null,
      contractSha256: contract.sha256,
      modelSha256: "",
      projectorSha256: "",
      llamaServerSha256: environment.runtimeIdentity.llamaServerSha256 ?? "",
      llamaServerVersion: environment.runtimeIdentity.llamaServerVersion ?? "",
      llamaServerPath: environment.runtimeIdentity.llamaServerPath,
      backend: environment.runtimeIdentity.backend,
      deviceId: environment.runtimeIdentity.deviceId,
      deviceName: environment.runtimeIdentity.deviceName,
      hardwareSignature: calibrationHardwareDigest(hardware),
      driverVersion: hardware.gpuDriver || null,
      platform: platform(),
      architecture: arch(),
      challenges: [],
      concurrency: { attempted: false, passed: false, maxValidatedParallelism: 0 },
      resourceProfile: null,
      failureCode: null,
      message: "Ensaio aguardando início.",
      startedAt: now.toISOString(),
      completedAt: null,
      expiresAt: null,
    };
    const active: ActiveProbe = {
      result,
      abortController: new AbortController(),
      child: null,
      log: "",
      terminalPersisted: false,
    };
    this.jobs.set(result.id, active);
    this.activeJobId = result.id;
    await this.emit(active);
    void this.run(active, candidate, hardware, contract);
    return cloneResult(result);
  }

  async cancel(probeId: string): Promise<QwenModelProbeResult> {
    const active = this.jobs.get(probeId);
    if (!active) throw new Error("qwen_probe_not_found");
    if (!["queued", "running"].includes(active.result.status)) return cloneResult(active.result);
    active.abortController.abort();
    await terminateProcess(active.child);
    return cloneResult(active.result);
  }

  async stopAll(): Promise<void> {
    const active = this.activeJobId ? this.jobs.get(this.activeJobId) : null;
    if (!active) return;
    active.abortController.abort();
    await terminateProcess(active.child);
  }

  private async emit(active: ActiveProbe): Promise<void> {
    await this.options.onUpdate?.(cloneResult(active.result));
  }

  private assertRunning(active: ActiveProbe): void {
    if (active.abortController.signal.aborted) throw new Error("qwen_probe_cancelled");
    if (active.child?.exitCode !== null && active.child?.exitCode !== undefined) {
      throw new Error(`qwen_probe_server_exit_${active.child.exitCode}`);
    }
  }

  private async waitForHealth(active: ActiveProbe, origin: string): Promise<void> {
    const deadline = Date.now() + (this.options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MILLISECONDS);
    while (Date.now() < deadline) {
      this.assertRunning(active);
      try {
        const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1_000) });
        if (response.ok) return;
      } catch { /* Model loading is allowed until the bounded deadline. */ }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    throw new Error("qwen_probe_health_timeout");
  }

  private async requestChallenge(
    active: ActiveProbe,
    origin: string,
    image: string,
    id: string,
    prompt: string,
    expectedToken: string,
  ): Promise<QwenModelProbeChallenge> {
    this.assertRunning(active);
    const started = performance.now();
    const response = await fetch(`${origin}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.any([
        active.abortController.signal,
        AbortSignal.timeout(this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MILLISECONDS),
      ]),
      body: JSON.stringify({
        model: `qual-hardware-qwen-probe-${id}`,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: `/no_think\n${prompt}` },
            { type: "image_url", image_url: { url: image } },
          ],
        }],
        temperature: 0,
        max_tokens: QWEN3_VL_FUNCTIONAL_PROBE_CONTRACT.maxTokens,
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`qwen_probe_http_${response.status}:${raw.slice(0, 240)}`);
    let text = "";
    try {
      const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: unknown } }> };
      text = typeof parsed.choices?.[0]?.message?.content === "string"
        ? parsed.choices[0].message.content : "";
    } catch {
      throw new Error("qwen_probe_invalid_json");
    }
    if (!text) throw new Error("qwen_probe_invalid_response");
    const passed = normalizedAnswer(text).includes(normalizedAnswer(expectedToken));
    return {
      id,
      expectedToken,
      actualText: text.slice(0, 240),
      latencyMs: Math.round(performance.now() - started),
      passed,
    };
  }

  private async run(
    active: ActiveProbe,
    candidate: QwenVisionModelCandidate,
    hardware: CalibrationHardwarePreflight,
    contract: LoadedQwen3VlContract,
  ): Promise<void> {
    try {
      active.result.status = "running";
      active.result.message = "Calculando assinaturas do modelo, projetor e servidor.";
      await this.emit(active);
      const [modelSha256, projectorSha256, llamaServerSha256, logoImage] = await Promise.all([
        sha256Path(candidate.modelPath),
        sha256Path(candidate.projectorPath!),
        sha256Path(active.result.llamaServerPath),
        readProbeImage(this.options.resourceRoot),
      ]);
      this.assertRunning(active);
      active.result.modelSha256 = modelSha256;
      active.result.projectorSha256 = projectorSha256;
      active.result.llamaServerSha256 = llamaServerSha256;
      const approvedRevision = findApprovedQwen3VlRevision(contract.contract, modelSha256, projectorSha256);
      active.result.approvedRevisionId = approvedRevision?.id ?? null;
      active.result.stackSignature = createHash("sha256").update(JSON.stringify({
        contractSha256: contract.sha256,
        modelSha256,
        projectorSha256,
        llamaServerSha256,
        llamaServerVersion: active.result.llamaServerVersion,
        backend: active.result.backend,
        deviceId: active.result.deviceId,
        hardwareSignature: active.result.hardwareSignature,
        driverVersion: active.result.driverVersion,
        platform: active.result.platform,
        architecture: active.result.architecture,
      })).digest("hex");

      const expectedBackend = expectedGpuInferenceBackend(hardware, platform());
      if (expectedBackend !== "unavailable" && active.result.backend !== expectedBackend) {
        throw new Error(`qwen_probe_backend_mismatch_expected_${expectedBackend}_received_${active.result.backend}`);
      }
      if (expectedBackend !== "unavailable" && !active.result.deviceId) {
        throw new Error("qwen_probe_gpu_device_missing");
      }

      const port = await freeLoopbackPort();
      const computeArguments = active.result.deviceId
        ? ["--device", active.result.deviceId, "--n-gpu-layers", "999"]
        : ["--device", "none", "--n-gpu-layers", "0"];
      const argumentsList = [
        "-m", candidate.modelPath,
        "--mmproj", candidate.projectorPath!,
        "--host", "127.0.0.1",
        "--port", String(port),
        "--ctx-size", "8192",
        "--parallel", String(QWEN3_VL_FUNCTIONAL_PROBE_CONTRACT.parallelism),
        "--jinja",
        "--log-disable",
        ...computeArguments,
      ];
      active.result.message = `Carregando ${basename(candidate.modelPath)} em ${active.result.backend}.`;
      await this.emit(active);
      const childEnvironment = {
        ...process.env,
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
      };
      const child = this.options.spawnServer
        ? this.options.spawnServer(active.result.llamaServerPath, argumentsList, {
            cwd: dirname(active.result.llamaServerPath),
            env: childEnvironment,
          })
        : spawn(active.result.llamaServerPath, argumentsList, {
          cwd: dirname(active.result.llamaServerPath),
          windowsHide: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
          ...process.env,
          NO_PROXY: "127.0.0.1,localhost",
          no_proxy: "127.0.0.1,localhost",
          },
        });
      active.child = child;
      const appendLog = (chunk: Buffer): void => {
        active.log = `${active.log}${chunk.toString("utf8")}`.slice(-MAX_LOG_CHARACTERS);
      };
      child.stdout?.on("data", appendLog);
      child.stderr?.on("data", appendLog);
      child.once("error", (error) => {
        active.log = `${active.log}\n${error.message}`.slice(-MAX_LOG_CHARACTERS);
      });
      const origin = `http://127.0.0.1:${port}`;
      await this.waitForHealth(active, origin);
      if (!child.pid) throw new Error("qwen_probe_process_id_missing");
      const sequentialSamples: ResourceSample[] = [await sampleResources(child.pid)];
      const [logoContract, redContract, blueContract] =
        QWEN3_VL_FUNCTIONAL_PROBE_CONTRACT.sequentialChallenges;
      const challengeInputs = [
        [logoContract.id, logoImage, "Return only the two large letters visible in the central logo.", logoContract.expectedToken],
        [redContract.id, generatedColorImage("red"), "What is the dominant color of the square? Answer with one English color word.", redContract.expectedToken],
        [blueContract.id, generatedColorImage("blue"), "What is the dominant color of the square? Answer with one English color word.", blueContract.expectedToken],
      ] as const;
      for (const [id, image, prompt, expected] of challengeInputs) {
        active.result.message = `Executando desafio visual ${active.result.challenges.length + 1} de 3.`;
        await this.emit(active);
        const challenge = await this.requestChallenge(active, origin, image, id, prompt, expected);
        active.result.challenges.push(challenge);
        sequentialSamples.push(await sampleResources(child.pid));
        await this.emit(active);
        if (!challenge.passed) throw new Error(`qwen_probe_visual_answer_invalid_${id}`);
      }

      active.result.message = "Validando duas solicitações visuais simultâneas.";
      active.result.concurrency.attempted = true;
      await this.emit(active);
      const concurrent = await Promise.all([
        this.requestChallenge(active, origin, challengeInputs[0][1], "parallel-1", challengeInputs[0][2], challengeInputs[0][3]),
        this.requestChallenge(active, origin, challengeInputs[1][1], "parallel-2", challengeInputs[1][2], challengeInputs[1][3]),
      ]);
      const parallelSample = await sampleResources(child.pid);
      active.result.challenges.push(...concurrent);
      const concurrencyPassed = concurrent.every((challenge) => challenge.passed);
      active.result.concurrency = {
        attempted: true,
        passed: concurrencyPassed,
        maxValidatedParallelism: concurrencyPassed ? QWEN3_VL_FUNCTIONAL_PROBE_CONTRACT.parallelism : 1,
      };
      if (!concurrencyPassed) throw new Error("qwen_probe_parallel_request_failed");
      this.assertRunning(active);

      const peakRamParallel1Bytes = maximum(sequentialSamples.map((sample) => sample.ramBytes));
      const peakVramParallel1Bytes = maximum(sequentialSamples.map((sample) => sample.vramBytes));
      const peakRamParallel2Bytes = parallelSample.ramBytes;
      const peakVramParallel2Bytes = parallelSample.vramBytes;
      const observedParallel1 = active.result.backend === "unavailable"
        ? peakRamParallel1Bytes : peakVramParallel1Bytes;
      const observedParallel2 = active.result.backend === "unavailable"
        ? peakRamParallel2Bytes : peakVramParallel2Bytes;
      const profile: QwenRuntimeResourceProfile = {
        staticEstimateBytes: candidate.estimatedMemoryBytes,
        peakRamParallel1Bytes,
        peakVramParallel1Bytes,
        peakRamParallel2Bytes,
        peakVramParallel2Bytes,
        baseRequirementBytes: Math.max(candidate.estimatedMemoryBytes, observedParallel1 ?? 0),
        incrementalSlotBytes: observedParallel1 !== null && observedParallel2 !== null
          ? Math.max(0, observedParallel2 - observedParallel1)
          : Math.ceil(5.12 * 1024 ** 3),
        maxValidatedParallelism: QWEN3_VL_FUNCTIONAL_PROBE_CONTRACT.parallelism,
        safeAvailableMemoryFraction: 0.75,
        sequentialLatencyMs: active.result.challenges.slice(0, 3).map((challenge) => challenge.latencyMs),
        concurrentLatencyMs: concurrent.map((challenge) => challenge.latencyMs),
      };
      const policy = qwenCertificationPolicy(approvedRevision, true);
      const completedAt = (this.options.now ?? (() => new Date()))();
      active.result.status = "passed";
      active.result.certificationLevel = policy.level;
      active.result.usageGate = policy.usageGate;
      active.result.resourceProfile = profile;
      active.result.failureCode = null;
      active.result.message = approvedRevision
        ? "Modelo, projetor, runtime e backend aprovados neste equipamento."
        : "Stack validado localmente; revisão desconhecida limitada a planejamento.";
      active.result.completedAt = completedAt.toISOString();
      active.result.expiresAt = new Date(completedAt.getTime() + PROBE_VALIDITY_MILLISECONDS).toISOString();
    } catch (error) {
      const cancelled = active.abortController.signal.aborted || failureCode(error) === "qwen_probe_cancelled";
      active.result.status = cancelled ? "cancelled" : "failed";
      active.result.certificationLevel = "none";
      active.result.usageGate = "blocked";
      active.result.resourceProfile = null;
      active.result.failureCode = cancelled ? "qwen_probe_cancelled" : failureCode(error);
      const detail = error instanceof Error ? error.message : String(error);
      active.result.message = cancelled
        ? "Ensaio cancelado; o processo local foi encerrado."
        : `Ensaio reprovado: ${detail.slice(0, 240)}${active.log ? ` | ${active.log.slice(-400)}` : ""}`;
      active.result.completedAt = (this.options.now ?? (() => new Date()))().toISOString();
      active.result.expiresAt = null;
    } finally {
      await terminateProcess(active.child);
      active.child = null;
      try {
        await this.emit(active);
      } catch (error) {
        active.result.status = "failed";
        active.result.certificationLevel = "none";
        active.result.usageGate = "blocked";
        active.result.resourceProfile = null;
        active.result.failureCode = "qwen_probe_result_persistence_failed";
        active.result.message = `Não foi possível persistir o ensaio: ${
          error instanceof Error ? error.message : String(error)
        }`.slice(0, 480);
        active.result.completedAt = (this.options.now ?? (() => new Date()))().toISOString();
        active.result.expiresAt = null;
        await this.emit(active).catch(() => undefined);
      } finally {
        active.terminalPersisted = true;
        if (this.activeJobId === active.result.id) this.activeJobId = null;
      }
    }
  }
}
