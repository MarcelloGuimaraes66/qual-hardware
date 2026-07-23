import type { CalibrationCapacityBoundary } from "../shared/types.js";

export interface CapacityProbeResult {
  passed: boolean;
  failures?: string[];
}

export interface CapacityDiscoveryOptions {
  seedCameraCount: number;
  generatorCameraLimit: number;
  confirmationRuns?: number;
  operationalHeadroomPercent?: number;
  signal?: AbortSignal;
  evaluate: (cameraCount: number, context: {
    attempt: number;
    phase: "seed" | "expand" | "binary" | "confirm";
    signal?: AbortSignal;
  }) => Promise<boolean | CapacityProbeResult>;
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name}_must_be_a_positive_safe_integer`);
  return value;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("capacity_discovery_aborted");
}

/**
 * Discovers a measured adjacent pass/fail boundary. The project camera count is
 * only the seed: it is deliberately probed both above and, when needed, below.
 */
export async function discoverCapacityBoundary(options: CapacityDiscoveryOptions): Promise<CalibrationCapacityBoundary> {
  const limit = positiveInteger("generatorCameraLimit", options.generatorCameraLimit);
  const seed = Math.min(positiveInteger("seedCameraCount", options.seedCameraCount), limit);
  const confirmationRuns = Math.min(10, positiveInteger("confirmationRuns", options.confirmationRuns ?? 2));
  const headroomPercent = options.operationalHeadroomPercent ?? 20;
  if (!Number.isFinite(headroomPercent) || headroomPercent < 0 || headroomPercent >= 100) {
    throw new Error("operationalHeadroomPercent_must_be_between_0_and_100");
  }

  const searchTrace: CalibrationCapacityBoundary["searchTrace"] = [];
  let attempt = 0;
  const probe = async (
    cameraCount: number,
    phase: "seed" | "expand" | "binary" | "confirm",
  ): Promise<boolean> => {
    assertNotAborted(options.signal);
    attempt += 1;
    const context = options.signal ? { attempt, phase, signal: options.signal } : { attempt, phase };
    const result = await options.evaluate(cameraCount, context);
    const passed = typeof result === "boolean" ? result : result.passed;
    searchTrace.push({ cameraCount, passed, attempt, phase });
    return passed;
  };

  const seedPassed = await probe(seed, "seed");
  let highestPassingCameraCount: number | null = seedPassed ? seed : null;
  let firstFailingCameraCount: number | null = seedPassed ? null : seed;

  if (seedPassed) {
    let candidate = seed;
    while (candidate < limit) {
      candidate = Math.min(limit, Math.max(candidate + 1, candidate * 2));
      const passed = await probe(candidate, "expand");
      if (passed) {
        highestPassingCameraCount = candidate;
        if (candidate === limit) break;
      } else {
        firstFailingCameraCount = candidate;
        break;
      }
    }
  } else {
    let candidate = seed;
    while (candidate > 1) {
      candidate = Math.max(1, Math.floor(candidate / 2));
      const passed = await probe(candidate, "expand");
      if (passed) {
        highestPassingCameraCount = candidate;
        break;
      }
      firstFailingCameraCount = candidate;
    }
  }

  if (highestPassingCameraCount !== null && firstFailingCameraCount !== null) {
    let low = highestPassingCameraCount;
    let high = firstFailingCameraCount;
    while (high - low > 1) {
      const middle = low + Math.floor((high - low) / 2);
      if (await probe(middle, "binary")) low = middle;
      else high = middle;
    }
    highestPassingCameraCount = low;
    firstFailingCameraCount = high;
  }

  let adjacentBoundaryConfirmed = false;
  if (highestPassingCameraCount !== null && firstFailingCameraCount === highestPassingCameraCount + 1) {
    adjacentBoundaryConfirmed = true;
    for (let run = 0; run < confirmationRuns; run += 1) {
      const passConfirmed = await probe(highestPassingCameraCount, "confirm");
      const failConfirmed = !(await probe(firstFailingCameraCount, "confirm"));
      adjacentBoundaryConfirmed &&= passConfirmed && failConfirmed;
    }
  }

  const observations = new Map<number, Set<boolean>>();
  for (const item of searchTrace) {
    const values = observations.get(item.cameraCount) ?? new Set<boolean>();
    values.add(item.passed);
    observations.set(item.cameraCount, values);
  }
  const sortedCounts = [...observations.keys()].sort((left, right) => left - right);
  let sawFailure = false;
  let nonMonotonic = [...observations.values()].some((values) => values.size > 1);
  for (const cameraCount of sortedCounts) {
    const values = observations.get(cameraCount)!;
    if (values.has(false)) sawFailure = true;
    if (sawFailure && values.has(true)) nonMonotonic = true;
  }

  const reachedGeneratorLimit = highestPassingCameraCount === limit && firstFailingCameraCount === null;
  const bound = reachedGeneratorLimit
    ? "at_least"
    : adjacentBoundaryConfirmed && !nonMonotonic
      ? "exact"
      : "uncertain";
  const operationalSafeCameraCount = highestPassingCameraCount === null
    ? null
    : Math.max(1, Math.floor(highestPassingCameraCount * (1 - headroomPercent / 100)));

  return {
    seedCameraCount: seed,
    highestPassingCameraCount,
    firstFailingCameraCount,
    operationalSafeCameraCount,
    bound,
    adjacentBoundaryConfirmed: bound === "exact",
    confirmationRuns,
    generatorLimit: limit,
    nonMonotonic,
    searchTrace,
  };
}
