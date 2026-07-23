import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { arch, platform } from "node:os";
import { promisify } from "node:util";
import { z } from "zod";
import type { TelemetryMetricSummary } from "../shared/types.js";

const execFileAsync = promisify(execFile);
export const CALIBRATION_TELEMETRY_PROBE_SCHEMA_VERSION = "qual-hardware-telemetry-probe/1.0.0" as const;
type ProbeThermalEvidence = "measured" | "partial" | "unavailable";

export interface CalibrationHardwareTelemetrySummary {
  provider: "approved-telemetry-probe" | "telemetry-probe-partial" | "nvidia-smi-diagnostic" | "operating-system" | "unavailable";
  sampleCount: number;
  gpuUtilizationPercent: TelemetryMetricSummary | null;
  gpuMemoryUsedBytes: TelemetryMetricSummary | null;
  gpuTemperatureCelsius: TelemetryMetricSummary | null;
  gpuPowerWatts: TelemetryMetricSummary | null;
  cpuTemperatureCelsius: TelemetryMetricSummary | null;
  thermalThrottlePercent: TelemetryMetricSummary | null;
  gpuDevices?: Array<{
    deviceId: string;
    index: number;
    name: string;
    utilizationPercent: TelemetryMetricSummary | null;
    memoryUsedBytes: TelemetryMetricSummary | null;
    temperatureCelsius: TelemetryMetricSummary | null;
    powerWatts: TelemetryMetricSummary | null;
    thermalThrottlePercent: TelemetryMetricSummary | null;
  }>;
}

export interface HardwareTelemetrySample {
  gpuUtilizationPercent?: number;
  gpuMemoryUsedBytes?: number;
  gpuTemperatureCelsius?: number;
  gpuPowerWatts?: number;
  cpuTemperatureCelsius?: number;
  thermalThrottlePercent?: number;
  thermalThrottleCounter?: number;
  probeThermalEvidence?: ProbeThermalEvidence;
  approvedThermalEvidence?: boolean;
  diagnosticProvider?: "nvidia-smi-diagnostic" | "operating-system";
  gpuDevices?: Array<{
    deviceId: string;
    index: number;
    name: string;
    utilizationPercent?: number;
    memoryUsedBytes?: number;
    temperatureCelsius?: number;
    powerWatts?: number;
    thermalThrottlePercent?: number;
  }>;
}

const percentageSchema = z.number().finite().min(0).max(100);
const temperatureSchema = z.number().finite().min(0).max(250);
const telemetryProbePayloadSchema = z.object({
  schemaVersion: z.literal(CALIBRATION_TELEMETRY_PROBE_SCHEMA_VERSION),
  probeVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  platform: z.enum(["darwin", "linux", "windows"]),
  architecture: z.enum(["arm64", "amd64"]),
  capturedAt: z.string().min(1).max(100).refine((value) => Number.isFinite(Date.parse(value))),
  quality: z.object({
    thermalThrottling: z.enum(["measured", "partial", "unavailable"]),
    cpuThermal: z.enum(["measured", "partial", "unavailable"]),
    gpuThermal: z.enum(["measured", "partial", "unavailable"]),
    sources: z.array(z.string().min(1).max(200)).max(32),
  }).strict(),
  gpuUtilizationPercent: percentageSchema.optional(),
  gpuMemoryUsedBytes: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  gpuTemperatureCelsius: temperatureSchema.optional(),
  gpuPowerWatts: z.number().finite().min(0).max(1_000_000).optional(),
  cpuTemperatureCelsius: temperatureSchema.optional(),
  thermalThrottlePercent: percentageSchema.optional(),
  thermalThrottleCounter: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  gpuDevices: z.array(z.object({
    index: z.number().int().nonnegative().max(1024),
    uuid: z.string().min(1).max(240),
    pciBusId: z.string().max(160),
    name: z.string().min(1).max(500),
    utilizationPercent: percentageSchema.optional(),
    memoryUsedBytes: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    temperatureCelsius: temperatureSchema.optional(),
    powerWatts: z.number().finite().min(0).max(1_000_000).optional(),
    thermalThrottlePercent: percentageSchema.optional(),
  }).strict()).max(1024).optional(),
  warnings: z.array(z.string().min(1).max(200)).max(64),
}).strict();

function finite(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function summary(samples: number[]): TelemetryMetricSummary | null {
  if (samples.length === 0) return null;
  const ordered = [...samples].sort((left, right) => left - right);
  const at = (fraction: number): number => ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
  return {
    samples: ordered.length,
    average: ordered.reduce((sum, value) => sum + value, 0) / ordered.length,
    p95: at(0.95),
    p99: at(0.99),
    peak: ordered.at(-1) ?? 0,
  };
}

export function parseNvidiaTelemetryCsv(output: string): HardwareTelemetrySample | null {
  const rows = output.trim().split("\n").filter(Boolean).map((line) => line.split(",").map((value) => value.trim()));
  if (rows.length === 0 || rows.some((row) => row.length < 6)) return null;
  const parsed = rows.map((row) => ({
    utilization: finite(row[0]),
    memoryMib: finite(row[1]),
    temperature: finite(row[2]),
    power: finite(row[3]),
    thermal: [row[4], row[5]].some((value) => /^(?:active|yes|true|1)$/i.test(value ?? "")) ? 100 : 0,
  }));
  const utilization = parsed.flatMap((item) => item.utilization === undefined ? [] : [item.utilization]);
  const memoryMib = parsed.flatMap((item) => item.memoryMib === undefined ? [] : [item.memoryMib]);
  const temperature = parsed.flatMap((item) => item.temperature === undefined ? [] : [item.temperature]);
  const power = parsed.flatMap((item) => item.power === undefined ? [] : [item.power]);
  return {
    ...(utilization.length ? { gpuUtilizationPercent: Math.max(...utilization) } : {}),
    ...(memoryMib.length ? { gpuMemoryUsedBytes: memoryMib.reduce((sum, value) => sum + value, 0) * 1024 ** 2 } : {}),
    ...(temperature.length ? { gpuTemperatureCelsius: Math.max(...temperature) } : {}),
    ...(power.length ? { gpuPowerWatts: power.reduce((sum, value) => sum + value, 0) } : {}),
    thermalThrottlePercent: Math.max(...parsed.map((item) => item.thermal)),
  };
}

export function parseApprovedTelemetryProbe(output: string): HardwareTelemetrySample | null {
  try {
    const parsed = telemetryProbePayloadSchema.parse(JSON.parse(output));
    const expectedPlatform = platform() === "win32" ? "windows" : platform();
    const expectedArchitecture = arch() === "x64" ? "amd64" : arch();
    if (parsed.platform !== expectedPlatform || parsed.architecture !== expectedArchitecture) return null;
    const evidence = parsed.quality.thermalThrottling;
    const thermalMeasurementAvailable = parsed.thermalThrottlePercent !== undefined || parsed.thermalThrottleCounter !== undefined;
    if (evidence === "measured" && (
      parsed.quality.cpuThermal !== "measured" ||
      parsed.quality.gpuThermal === "partial" ||
      parsed.quality.sources.length === 0 ||
      !thermalMeasurementAvailable
    )) return null;
    if (evidence === "unavailable" && (
      parsed.quality.cpuThermal === "measured" || parsed.quality.gpuThermal === "measured"
    )) return null;
    return {
      ...(parsed.gpuUtilizationPercent === undefined ? {} : { gpuUtilizationPercent: parsed.gpuUtilizationPercent }),
      ...(parsed.gpuMemoryUsedBytes === undefined ? {} : { gpuMemoryUsedBytes: parsed.gpuMemoryUsedBytes }),
      ...(parsed.gpuTemperatureCelsius === undefined ? {} : { gpuTemperatureCelsius: parsed.gpuTemperatureCelsius }),
      ...(parsed.gpuPowerWatts === undefined ? {} : { gpuPowerWatts: parsed.gpuPowerWatts }),
      ...(parsed.cpuTemperatureCelsius === undefined ? {} : { cpuTemperatureCelsius: parsed.cpuTemperatureCelsius }),
      ...(parsed.thermalThrottlePercent === undefined ? {} : { thermalThrottlePercent: parsed.thermalThrottlePercent }),
      ...(parsed.thermalThrottleCounter === undefined ? {} : { thermalThrottleCounter: parsed.thermalThrottleCounter }),
      ...(parsed.gpuDevices === undefined ? {} : {
        gpuDevices: parsed.gpuDevices.map((device) => ({
          deviceId: device.uuid || device.pciBusId || `gpu:${device.index}`,
          index: device.index,
          name: device.name,
          ...(device.utilizationPercent === undefined ? {} : { utilizationPercent: device.utilizationPercent }),
          ...(device.memoryUsedBytes === undefined ? {} : { memoryUsedBytes: device.memoryUsedBytes }),
          ...(device.temperatureCelsius === undefined ? {} : { temperatureCelsius: device.temperatureCelsius }),
          ...(device.powerWatts === undefined ? {} : { powerWatts: device.powerWatts }),
          ...(device.thermalThrottlePercent === undefined ? {} : { thermalThrottlePercent: device.thermalThrottlePercent }),
        })),
      }),
      probeThermalEvidence: evidence,
      approvedThermalEvidence: evidence === "measured",
    };
  } catch {
    return null;
  }
}

export function reconcileThermalThrottleCounter(
  sample: HardwareTelemetrySample,
  previousCounter: number | null,
): { sample: HardwareTelemetrySample; nextCounter: number | null } {
  const currentCounter = sample.thermalThrottleCounter;
  if (currentCounter === undefined) return { sample, nextCounter: previousCounter };
  const counterIncreased = previousCounter !== null && currentCounter > previousCounter;
  return {
    sample: {
      ...sample,
      thermalThrottlePercent: Math.max(sample.thermalThrottlePercent ?? 0, counterIncreased ? 100 : 0),
    },
    nextCounter: currentCounter,
  };
}

async function linuxCpuTemperature(): Promise<number | undefined> {
  if (platform() !== "linux") return undefined;
  const roots = await readdir("/sys/class/thermal", { withFileTypes: true }).catch(() => []);
  const values = await Promise.all(roots.filter((entry) => entry.isDirectory() && entry.name.startsWith("thermal_zone"))
    .map((entry) => readFile(`/sys/class/thermal/${entry.name}/temp`, "utf8")
      .then((value) => Number(value.trim()) / 1_000).catch(() => NaN)));
  const valid = values.filter((value) => Number.isFinite(value) && value > 0 && value < 200);
  return valid.length ? Math.max(...valid) : undefined;
}

export class CalibrationHardwareTelemetrySampler {
  private readonly samples: HardwareTelemetrySample[] = [];
  private timer: NodeJS.Timeout | null = null;
  private pending: Promise<void> = Promise.resolve();
  private lastThermalThrottleCounter: number | null = null;

  constructor(private readonly options: { enabled: boolean; approvedProbePath: string | null }) {}

  start(intervalMs: number): void {
    if (!this.options.enabled) return;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<CalibrationHardwareTelemetrySummary> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.options.enabled) this.schedule();
    await this.pending;
    const values = <K extends keyof HardwareTelemetrySample>(key: K): number[] =>
      this.samples.flatMap((sample) => sample[key] === undefined ? [] : [sample[key] as number]);
    const probeSamples = this.samples.filter((sample) => sample.probeThermalEvidence !== undefined);
    const provider: CalibrationHardwareTelemetrySummary["provider"] = probeSamples.length > 0
      ? probeSamples.length === this.samples.length && probeSamples.every((sample) =>
        sample.approvedThermalEvidence === true && sample.thermalThrottlePercent !== undefined)
        ? "approved-telemetry-probe"
        : "telemetry-probe-partial"
      : this.samples.some((sample) => sample.diagnosticProvider === "nvidia-smi-diagnostic")
        ? "nvidia-smi-diagnostic"
        : this.samples.some((sample) => sample.diagnosticProvider === "operating-system")
          ? "operating-system"
          : "unavailable";
    const deviceSamples = new Map<string, NonNullable<HardwareTelemetrySample["gpuDevices"]>>();
    for (const sample of this.samples) {
      for (const device of sample.gpuDevices ?? []) {
        const samples = deviceSamples.get(device.deviceId) ?? [];
        samples.push(device);
        deviceSamples.set(device.deviceId, samples);
      }
    }
    return {
      provider,
      sampleCount: this.samples.length,
      gpuUtilizationPercent: summary(values("gpuUtilizationPercent")),
      gpuMemoryUsedBytes: summary(values("gpuMemoryUsedBytes")),
      gpuTemperatureCelsius: summary(values("gpuTemperatureCelsius")),
      gpuPowerWatts: summary(values("gpuPowerWatts")),
      cpuTemperatureCelsius: summary(values("cpuTemperatureCelsius")),
      thermalThrottlePercent: summary(values("thermalThrottlePercent")),
      gpuDevices: [...deviceSamples.entries()].map(([deviceId, samples]) => ({
        deviceId,
        index: samples[0]?.index ?? 0,
        name: samples[0]?.name ?? deviceId,
        utilizationPercent: summary(samples.flatMap((sample) =>
          sample.utilizationPercent === undefined ? [] : [sample.utilizationPercent])),
        memoryUsedBytes: summary(samples.flatMap((sample) =>
          sample.memoryUsedBytes === undefined ? [] : [sample.memoryUsedBytes])),
        temperatureCelsius: summary(samples.flatMap((sample) =>
          sample.temperatureCelsius === undefined ? [] : [sample.temperatureCelsius])),
        powerWatts: summary(samples.flatMap((sample) =>
          sample.powerWatts === undefined ? [] : [sample.powerWatts])),
        thermalThrottlePercent: summary(samples.flatMap((sample) =>
          sample.thermalThrottlePercent === undefined ? [] : [sample.thermalThrottlePercent])),
      })),
    };
  }

  private schedule(): void {
    this.pending = this.pending.then(() => this.capture()).catch(() => undefined);
  }

  private async capture(): Promise<void> {
    let sample: HardwareTelemetrySample | null = null;
    if (this.options.approvedProbePath) {
      const result = await execFileAsync(this.options.approvedProbePath, ["--format", "json"], {
        timeout: 5_000, maxBuffer: 500_000, windowsHide: true,
      }).catch(() => null);
      sample = result ? parseApprovedTelemetryProbe(result.stdout) : null;
      if (sample) {
        const reconciled = reconcileThermalThrottleCounter(sample, this.lastThermalThrottleCounter);
        sample = reconciled.sample;
        this.lastThermalThrottleCounter = reconciled.nextCounter;
      }
    }
    if ((!sample || sample.probeThermalEvidence !== "measured") && platform() !== "darwin") {
      const result = await execFileAsync("nvidia-smi", [
        "--query-gpu=utilization.gpu,memory.used,temperature.gpu,power.draw,clocks_event_reasons.sw_thermal_slowdown,clocks_event_reasons.hw_thermal_slowdown",
        "--format=csv,noheader,nounits",
      ], { timeout: 5_000, maxBuffer: 500_000, windowsHide: true }).catch(() => null);
      const diagnostic = result ? parseNvidiaTelemetryCsv(result.stdout) : null;
      if (diagnostic) {
        diagnostic.diagnosticProvider = "nvidia-smi-diagnostic";
        sample = sample ? {
          ...diagnostic,
          ...sample,
          thermalThrottlePercent: Math.max(
            diagnostic.thermalThrottlePercent ?? 0,
            sample.thermalThrottlePercent ?? 0,
          ),
        } : diagnostic;
      }
    }
    const cpuTemperatureCelsius = await linuxCpuTemperature();
    if (cpuTemperatureCelsius !== undefined) {
      sample = { ...(sample ?? {}), cpuTemperatureCelsius };
      if (!sample.diagnosticProvider) sample.diagnosticProvider = "operating-system";
    }
    if (sample) this.samples.push(sample);
  }
}
