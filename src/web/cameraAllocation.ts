import type { CameraGroup, CapacityScenario } from "../shared/types.js";

export function normalizedCameraCount(value: number): number {
  return Math.min(1_000_000, Math.max(1, Math.trunc(Number.isFinite(value) ? value : 1)));
}

function distributeCameraTotal(cameraGroups: CameraGroup[], requestedTotal: number): CameraGroup[] {
  const total = normalizedCameraCount(requestedTotal);
  const retained = cameraGroups.slice(0, total);
  if (retained.length === 0) return [];
  if (retained.length === 1) return [{ ...retained[0]!, count: total }];

  const minimumPerGroup = 1;
  const remaining = total - retained.length * minimumPerGroup;
  const weights = retained.map((group) => Math.max(1, normalizedCameraCount(group.count)));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const exactExtras = weights.map((weight) => remaining * weight / weightTotal);
  const extras = exactExtras.map(Math.floor);
  let undistributed = remaining - extras.reduce((sum, count) => sum + count, 0);
  const priority = exactExtras
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

  for (const item of priority) {
    if (undistributed <= 0) break;
    extras[item.index] = (extras[item.index] ?? 0) + 1;
    undistributed -= 1;
  }

  return retained.map((group, index) => ({
    ...group,
    count: minimumPerGroup + (extras[index] ?? 0),
  }));
}

export function withCameraTotal(
  scenario: CapacityScenario,
  value: number,
  createGroup: (count: number) => CameraGroup,
): CapacityScenario {
  const totalCameras = normalizedCameraCount(value);
  const existingGroups = scenario.cameraGroups.length > 0
    ? scenario.cameraGroups
    : [createGroup(totalCameras)];
  return {
    ...scenario,
    totalCameras,
    cameraGroups: distributeCameraTotal(existingGroups, totalCameras),
  };
}

export function withCameraGroupCount(
  scenario: CapacityScenario,
  groupId: string,
  value: number,
): CapacityScenario {
  const targetIndex = scenario.cameraGroups.findIndex((group) => group.id === groupId);
  if (targetIndex < 0) return scenario;
  if (scenario.cameraGroups.length === 1) {
    return {
      ...scenario,
      cameraGroups: [{ ...scenario.cameraGroups[0]!, count: scenario.totalCameras }],
    };
  }

  const maximumTarget = Math.max(1, scenario.totalCameras - (scenario.cameraGroups.length - 1));
  const targetCount = Math.min(maximumTarget, normalizedCameraCount(value));
  const next = scenario.cameraGroups.map((group, index) => ({
    ...group,
    count: index === targetIndex ? targetCount : Math.max(1, normalizedCameraCount(group.count)),
  }));
  const otherIndexes = next.map((_, index) => index).filter((index) => index !== targetIndex);
  const requiredOtherTotal = scenario.totalCameras - targetCount;
  let currentOtherTotal = otherIndexes.reduce((sum, index) => sum + next[index]!.count, 0);

  if (currentOtherTotal < requiredOtherTotal) {
    const firstOther = otherIndexes[0]!;
    next[firstOther] = {
      ...next[firstOther]!,
      count: next[firstOther]!.count + requiredOtherTotal - currentOtherTotal,
    };
    currentOtherTotal = requiredOtherTotal;
  }

  if (currentOtherTotal > requiredOtherTotal) {
    let excess = currentOtherTotal - requiredOtherTotal;
    for (const index of [...otherIndexes].sort((left, right) => next[right]!.count - next[left]!.count)) {
      const removable = Math.min(excess, next[index]!.count - 1);
      next[index] = { ...next[index]!, count: next[index]!.count - removable };
      excess -= removable;
      if (excess === 0) break;
    }
  }

  return { ...scenario, cameraGroups: next };
}
