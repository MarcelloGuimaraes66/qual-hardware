import { createHash } from "node:crypto";
import type {
  AgentExecutionBackend,
  AgentExecutionScope,
  AgentLoad,
  CalibrationPlan,
  CalibrationWorkloadProfile,
  CapacityScenario,
} from "../shared/types.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().filter((key) => record[key] !== undefined)
      .map((key) => [key, canonical(record[key])]));
  }
  return value;
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function calibrationWorkloadProfileSignature(
  profile: Omit<CalibrationWorkloadProfile, "id" | "signature">,
): string {
  return canonicalSha256({
    ...profile,
    cameraGroups: profile.cameraGroups.map(({ id: _id, name: _name, ...group }) => group),
  });
}

export function calibrationPolicyHash(plan: CalibrationPlan): string {
  return canonicalSha256({
    mode: plan.mode,
    executionMode: plan.executionMode,
    strategy: plan.strategy,
    cameraTiers: plan.cameraTiers,
    discovery: plan.discovery,
    qualification: plan.qualification,
    phases: plan.phases,
  });
}

export function agentExecutionBackend(agent: Pick<AgentLoad, "model" | "executionBackend">): AgentExecutionBackend {
  if (agent.executionBackend) return agent.executionBackend;
  if (agent.model === "aiq-3.7" || agent.model === "aiq-3.7-max") return "local_aiq";
  if (agent.model === "opencv-portal-counter") return "native_cv";
  return "remote_vision";
}

export function agentExecutionScope(agent: Pick<AgentLoad, "runEverySeconds" | "executionScope">): AgentExecutionScope {
  if (agent.executionScope) return agent.executionScope;
  return agent.runEverySeconds === 300 || agent.runEverySeconds === 600 ? "inference_group" : "camera_agent";
}

function proportionalShares(counts: number[]): number[] {
  const total = Math.max(1, counts.reduce((sum, count) => sum + count, 0));
  const shares = counts.map((count, index) => ({
    index,
    floor: Math.floor(count * 1_000_000 / total),
    remainder: count * 1_000_000 % total,
  }));
  let remaining = 1_000_000 - shares.reduce((sum, share) => sum + share.floor, 0);
  for (const share of [...shares].sort((left, right) =>
    right.remainder - left.remainder || left.index - right.index)) {
    if (remaining <= 0) break;
    share.floor += 1;
    remaining -= 1;
  }
  return shares.sort((left, right) => left.index - right.index).map((share) => share.floor);
}

export function buildCalibrationWorkloadProfile(scenario: CapacityScenario): CalibrationWorkloadProfile {
  const shares = proportionalShares(scenario.cameraGroups.map((group) => group.count));
  const cameraGroups = scenario.cameraGroups.map((group, index) => ({
    id: group.id,
    name: group.name,
    sharePpm: shares[index] ?? 0,
    codec: group.source.codec,
    width: group.source.width,
    height: group.source.height,
    sourceFps: group.source.sourceFps,
    bitrateMbps: group.source.bitrateMbps,
    decodeMode: group.decodeMode,
    motionPercent: group.motionPercent,
    storage: structuredClone(group.storage),
    agents: group.agents.map(({ id: _id, name: _name, ...agent }) => ({
      ...structuredClone(agent),
      executionBackend: agentExecutionBackend(agent),
      executionScope: agentExecutionScope(agent),
    }))
      .sort((left, right) => canonicalSha256(left).localeCompare(canonicalSha256(right))),
  })).sort((left, right) => canonicalSha256(left).localeCompare(canonicalSha256(right)));
  const payload = {
    schemaVersion: "qual-hardware-calibration-workload-profile/2.0.0" as const,
    targetBuildHash: scenario.perceptrumBuildHash,
    workloadContractVersion: scenario.workloadContractVersion,
    operatingSystem: scenario.constraints.operatingSystem,
    cameraGroups,
    concurrentWorkloads: structuredClone(scenario.concurrentWorkloads),
  };
  const signature = calibrationWorkloadProfileSignature(payload);
  return { ...payload, id: `workload:${signature}`, signature };
}

export function runWorkloadProfileId(run: { workloadProfileId?: string }): string {
  return run.workloadProfileId ?? "legacy-unscoped";
}
