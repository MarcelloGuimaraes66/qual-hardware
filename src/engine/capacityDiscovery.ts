import type {
  CalibrationCapacityBoundary,
  CalibrationProbeOutcome,
} from "../shared/types.js";

type SearchPhase = "seed" | "expand" | "binary" | "confirm";
type Composition = CalibrationCapacityBoundary["searchTrace"][number]["composition"];

export interface CapacityProbeResult {
  outcome?: CalibrationProbeOutcome;
  /** Compatibility with v4 callers. Prefer outcome for new probes. */
  passed?: boolean;
  failures?: string[];
  failureCode?: string | null;
  composition?: Composition;
}
export interface CapacityDiscoveryOptions {
  seedCameraCount: number;
  generatorCameraLimit: number;
  confirmationRuns?: number;
  /**
   * Optional wall-clock budget expressed as complete probe executions.
   * Diagnostic runs use this to return an honest preliminary boundary instead
   * of silently turning a nominal ten-minute test into a long qualification.
   */
  maximumEvaluations?: number;
  /**
   * Wall-clock budget for discovery. Before a new tier starts, the search uses
   * observed probe durations and a conservative reserve to avoid beginning
   * work that cannot finish inside the diagnostic window.
   */
  maximumDurationMs?: number;
  operationalHeadroomPercent?: number;
  infrastructureRetryCount?: number;
  signal?: AbortSignal;
  evaluate: (cameraCount: number, context: {
    attempt: number;
    phase: SearchPhase;
    signal?: AbortSignal;
  }) => Promise<boolean | CapacityProbeResult>;
}

interface NormalizedProbe {
  outcome: CalibrationProbeOutcome;
  failureCode: string | null;
  composition: Composition;
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name}_must_be_a_positive_safe_integer`);
  return value;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("capacity_discovery_aborted");
}

function normalizedProbe(result: boolean | CapacityProbeResult): NormalizedProbe {
  if (typeof result === "boolean") {
    return { outcome: result ? "pass" : "capacity_fail", failureCode: null, composition: [] };
  }
  const outcome = result.outcome ?? (result.passed === true ? "pass" : "capacity_fail");
  return {
    outcome,
    failureCode: result.failureCode ?? result.failures?.[0] ?? null,
    composition: structuredClone(result.composition ?? []),
  };
}

function capacityBoolean(outcome: CalibrationProbeOutcome): boolean | null {
  if (outcome === "pass") return true;
  if (outcome === "capacity_fail") return false;
  return null;
}

/**
 * Discovers a measured adjacent pass/fail boundary. Infrastructure failures
 * are retried once by default and are never converted into capacity evidence.
 */
export async function discoverCapacityBoundary(options: CapacityDiscoveryOptions): Promise<CalibrationCapacityBoundary> {
  const limit = positiveInteger("generatorCameraLimit", options.generatorCameraLimit);
  const seed = Math.min(positiveInteger("seedCameraCount", options.seedCameraCount), limit);
  const confirmationRuns = Math.min(10, positiveInteger("confirmationRuns", options.confirmationRuns ?? 2));
  const infrastructureRetryCount = Math.min(3, Math.max(0, Math.floor(options.infrastructureRetryCount ?? 1)));
  const maximumEvaluations = options.maximumEvaluations === undefined
    ? Number.POSITIVE_INFINITY
    : positiveInteger("maximumEvaluations", options.maximumEvaluations);
  const maximumDurationMs = options.maximumDurationMs === undefined
    ? Number.POSITIVE_INFINITY
    : positiveInteger("maximumDurationMs", options.maximumDurationMs);
  const discoveryStartedAt = performance.now();
  const headroomPercent = options.operationalHeadroomPercent ?? 20;
  if (!Number.isFinite(headroomPercent) || headroomPercent < 0 || headroomPercent >= 100) {
    throw new Error("operationalHeadroomPercent_must_be_between_0_and_100");
  }

  const searchTrace: CalibrationCapacityBoundary["searchTrace"] = [];
  let attempt = 0;
  let infrastructureFailure: string | null = null;

  const probe = async (cameraCount: number, phase: SearchPhase): Promise<CalibrationProbeOutcome | "budget_exhausted"> => {
    let retryOfAttempt: number | null = null;
    for (let retry = 0; retry <= infrastructureRetryCount; retry += 1) {
      assertNotAborted(options.signal);
      if (attempt >= maximumEvaluations) return "budget_exhausted";
      const elapsedMs = performance.now() - discoveryStartedAt;
      const longestObservedMs = Math.max(0, ...searchTrace.map((item) => item.durationMs));
      const conservativeNextProbeMs = longestObservedMs > 0
        ? longestObservedMs * 2 + 30_000
        : 0;
      if (elapsedMs >= maximumDurationMs ||
          (searchTrace.length > 0 && elapsedMs + conservativeNextProbeMs > maximumDurationMs)) {
        return "budget_exhausted";
      }
      attempt += 1;
      const currentAttempt = attempt;
      const startedAt = performance.now();
      const context = options.signal ? { attempt, phase, signal: options.signal } : { attempt, phase };
      const result = normalizedProbe(await options.evaluate(cameraCount, context));
      searchTrace.push({
        cameraCount,
        passed: capacityBoolean(result.outcome),
        outcome: result.outcome,
        attempt: currentAttempt,
        phase,
        durationMs: Math.max(0, performance.now() - startedAt),
        failureCode: result.failureCode,
        retryOfAttempt,
        composition: result.composition,
      });
      if (result.outcome === "cancelled") throw new Error("capacity_discovery_aborted");
      if (result.outcome !== "infrastructure_error") return result.outcome;
      infrastructureFailure = result.failureCode ?? "calibration_infrastructure_error";
      if (retry === infrastructureRetryCount) return "infrastructure_error";
      retryOfAttempt ??= currentAttempt;
    }
    return "infrastructure_error";
  };

  let highestPassingCameraCount: number | null = null;
  let firstFailingCameraCount: number | null = null;
  const seedOutcome = await probe(seed, "seed");
  if (seedOutcome === "budget_exhausted") {
    return budgetBoundary(seed, limit, confirmationRuns, headroomPercent, searchTrace, highestPassingCameraCount, firstFailingCameraCount);
  }
  if (seedOutcome === "infrastructure_error") {
    return incompleteBoundary(seed, limit, confirmationRuns, searchTrace, infrastructureFailure);
  }
  if (seedOutcome === "pass") highestPassingCameraCount = seed;
  else firstFailingCameraCount = seed;

  if (seedOutcome === "pass") {
    let candidate = seed;
    while (candidate < limit) {
      candidate = Math.min(limit, Math.max(candidate + 1, candidate * 2));
      const outcome = await probe(candidate, "expand");
      if (outcome === "budget_exhausted") {
        return budgetBoundary(seed, limit, confirmationRuns, headroomPercent, searchTrace, highestPassingCameraCount, firstFailingCameraCount);
      }
      if (outcome === "infrastructure_error") {
        return incompleteBoundary(seed, limit, confirmationRuns, searchTrace, infrastructureFailure);
      }
      if (outcome === "pass") {
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
      const outcome = await probe(candidate, "expand");
      if (outcome === "budget_exhausted") {
        return budgetBoundary(seed, limit, confirmationRuns, headroomPercent, searchTrace, highestPassingCameraCount, firstFailingCameraCount);
      }
      if (outcome === "infrastructure_error") {
        return incompleteBoundary(seed, limit, confirmationRuns, searchTrace, infrastructureFailure);
      }
      if (outcome === "pass") {
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
      const outcome = await probe(middle, "binary");
      if (outcome === "budget_exhausted") {
        return budgetBoundary(seed, limit, confirmationRuns, headroomPercent, searchTrace, low, high);
      }
      if (outcome === "infrastructure_error") {
        return incompleteBoundary(seed, limit, confirmationRuns, searchTrace, infrastructureFailure);
      }
      if (outcome === "pass") low = middle;
      else high = middle;
    }
    highestPassingCameraCount = low;
    firstFailingCameraCount = high;
  }

  let adjacentBoundaryConfirmed = false;
  if (highestPassingCameraCount !== null && firstFailingCameraCount === highestPassingCameraCount + 1) {
    adjacentBoundaryConfirmed = true;
    for (let run = 0; run < confirmationRuns; run += 1) {
      const passOutcome = await probe(highestPassingCameraCount, "confirm");
      if (passOutcome === "budget_exhausted") {
        return budgetBoundary(seed, limit, confirmationRuns, headroomPercent, searchTrace, highestPassingCameraCount, firstFailingCameraCount);
      }
      if (passOutcome === "infrastructure_error") {
        return incompleteBoundary(seed, limit, confirmationRuns, searchTrace, infrastructureFailure);
      }
      const failOutcome = await probe(firstFailingCameraCount, "confirm");
      if (failOutcome === "budget_exhausted") {
        return budgetBoundary(seed, limit, confirmationRuns, headroomPercent, searchTrace, highestPassingCameraCount, firstFailingCameraCount);
      }
      if (failOutcome === "infrastructure_error") {
        return incompleteBoundary(seed, limit, confirmationRuns, searchTrace, infrastructureFailure);
      }
      adjacentBoundaryConfirmed &&= passOutcome === "pass" && failOutcome === "capacity_fail";
    }
  }

  const observations = new Map<number, Set<boolean>>();
  for (const item of searchTrace) {
    if (item.passed === null) continue;
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
      : "interval";
  const operationalSafeCameraCount = highestPassingCameraCount === null
    ? null
    : Math.floor(highestPassingCameraCount * (1 - headroomPercent / 100));

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
    infrastructureFailure: null,
    maximumAttemptedCameraCount: Math.max(...searchTrace.map((item) => item.cameraCount), seed),
    searchTrace,
  };
}

function budgetBoundary(
  seed: number,
  limit: number,
  confirmationRuns: number,
  headroomPercent: number,
  searchTrace: CalibrationCapacityBoundary["searchTrace"],
  highestPassingCameraCount: number | null,
  firstFailingCameraCount: number | null,
): CalibrationCapacityBoundary {
  return {
    seedCameraCount: seed,
    highestPassingCameraCount,
    firstFailingCameraCount,
    operationalSafeCameraCount: highestPassingCameraCount === null
      ? null
      : Math.floor(highestPassingCameraCount * (1 - headroomPercent / 100)),
    bound: highestPassingCameraCount !== null && firstFailingCameraCount === null ? "at_least" : "interval",
    adjacentBoundaryConfirmed: false,
    confirmationRuns,
    generatorLimit: limit,
    nonMonotonic: false,
    infrastructureFailure: null,
    maximumAttemptedCameraCount: Math.max(...searchTrace.map((item) => item.cameraCount), seed),
    searchTrace,
  };
}

function incompleteBoundary(
  seed: number,
  limit: number,
  confirmationRuns: number,
  searchTrace: CalibrationCapacityBoundary["searchTrace"],
  infrastructureFailure: string | null,
): CalibrationCapacityBoundary {
  return {
    seedCameraCount: seed,
    highestPassingCameraCount: null,
    firstFailingCameraCount: null,
    operationalSafeCameraCount: null,
    bound: "inconclusive",
    adjacentBoundaryConfirmed: false,
    confirmationRuns,
    generatorLimit: limit,
    nonMonotonic: false,
    infrastructureFailure: infrastructureFailure ?? "calibration_infrastructure_error",
    maximumAttemptedCameraCount: Math.max(...searchTrace.map((item) => item.cameraCount), seed),
    searchTrace,
  };
}
