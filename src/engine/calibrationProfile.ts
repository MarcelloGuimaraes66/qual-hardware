import { createHash } from "node:crypto";
import type { CalibrationPlan, CalibrationWorkloadProfile, CapacityScenario } from "../shared/types.js";

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

export function buildCalibrationWorkloadProfile(scenario: CapacityScenario): CalibrationWorkloadProfile {
  const cameraGroups = scenario.cameraGroups.map((group) => ({
    sharePpm: Math.round(group.count * 1_000_000 / Math.max(1, scenario.totalCameras)),
    codec: group.source.codec,
    width: group.source.width,
    height: group.source.height,
    sourceFps: group.source.sourceFps,
    bitrateMbps: group.source.bitrateMbps,
    decodeMode: group.decodeMode,
    motionPercent: group.motionPercent,
    storage: structuredClone(group.storage),
    agents: group.agents.map(({ id: _id, name: _name, ...agent }) => structuredClone(agent))
      .sort((left, right) => canonicalSha256(left).localeCompare(canonicalSha256(right))),
  })).sort((left, right) => canonicalSha256(left).localeCompare(canonicalSha256(right)));
  const payload = {
    schemaVersion: "qual-hardware-calibration-workload-profile/1.0.0" as const,
    targetBuildHash: scenario.perceptrumBuildHash,
    workloadContractVersion: scenario.workloadContractVersion,
    operatingSystem: scenario.constraints.operatingSystem,
    cameraGroups,
    concurrentWorkloads: structuredClone(scenario.concurrentWorkloads),
  };
  const signature = canonicalSha256(payload);
  return { ...payload, id: `workload:${signature}`, signature };
}

export function runWorkloadProfileId(run: { workloadProfileId?: string }): string {
  return run.workloadProfileId ?? "legacy-unscoped";
}
