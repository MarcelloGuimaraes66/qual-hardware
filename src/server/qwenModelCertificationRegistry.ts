import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  QWEN_MODEL_CERTIFICATION_CONTRACT_VERSION,
  type QwenModelCertificationLevel,
  type QwenModelUsageGate,
} from "../shared/types.js";

export const QWEN3_VL_APPROVED_CONTRACT_FILE = "qwen3-vl-approved-revisions-v1.json";
export const QWEN3_VL_FUNCTIONAL_PROBE_CONTRACT = {
  id: "qwen3-vl-visual-probe/1.0.0",
  maxTokens: 96,
  parallelism: 2,
  sequentialChallenges: [
    { id: "logo-letters", expectedToken: "AQ" },
    { id: "red-panel", expectedToken: "RED" },
    { id: "blue-panel", expectedToken: "BLUE" },
  ],
  concurrentChallengeIds: ["logo-letters", "red-panel"],
} as const;

export interface ApprovedQwen3VlFile {
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

export interface ApprovedQwen3VlRevision {
  id: string;
  repository: string;
  revision: string;
  parameterBillions: number;
  model: ApprovedQwen3VlFile;
  projector: ApprovedQwen3VlFile;
}

export interface ApprovedQwen3VlContract {
  schemaVersion: typeof QWEN_MODEL_CERTIFICATION_CONTRACT_VERSION;
  family: "Qwen3-VL";
  generatedAt: string;
  policy: {
    fileNameIsEvidence: false;
    unknownRevisionUsage: "planning_only";
    approvedRevisionRequiresFunctionalProbe: true;
    cacheValidityDays: number;
  };
  functionalProbe: typeof QWEN3_VL_FUNCTIONAL_PROBE_CONTRACT;
  revisions: ApprovedQwen3VlRevision[];
}

export interface LoadedQwen3VlContract {
  contract: ApprovedQwen3VlContract;
  sha256: string;
  sourcePath: string;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validateContract(value: unknown): ApprovedQwen3VlContract {
  if (!value || typeof value !== "object") throw new Error("qwen_contract_invalid");
  const contract = value as Partial<ApprovedQwen3VlContract>;
  if (contract.schemaVersion !== QWEN_MODEL_CERTIFICATION_CONTRACT_VERSION ||
      contract.family !== "Qwen3-VL" ||
      !contract.policy ||
      contract.policy.fileNameIsEvidence !== false ||
      contract.policy.unknownRevisionUsage !== "planning_only" ||
      contract.policy.approvedRevisionRequiresFunctionalProbe !== true ||
      !Number.isInteger(contract.policy.cacheValidityDays) ||
      (contract.policy.cacheValidityDays ?? 0) < 1 ||
      JSON.stringify(contract.functionalProbe) !== JSON.stringify(QWEN3_VL_FUNCTIONAL_PROBE_CONTRACT) ||
      !Array.isArray(contract.revisions) ||
      contract.revisions.length === 0) {
    throw new Error("qwen_contract_invalid");
  }
  const ids = new Set<string>();
  for (const revision of contract.revisions) {
    if (!revision || typeof revision !== "object" ||
        typeof revision.id !== "string" || ids.has(revision.id) ||
        typeof revision.repository !== "string" ||
        typeof revision.revision !== "string" ||
        !Number.isFinite(revision.parameterBillions) ||
        revision.parameterBillions <= 0 ||
        !revision.model || !revision.projector ||
        !Number.isSafeInteger(revision.model.sizeBytes) || revision.model.sizeBytes <= 0 ||
        !Number.isSafeInteger(revision.projector.sizeBytes) || revision.projector.sizeBytes <= 0 ||
        !isSha256(revision.model.sha256) || !isSha256(revision.projector.sha256)) {
      throw new Error("qwen_contract_invalid");
    }
    ids.add(revision.id);
  }
  return contract as ApprovedQwen3VlContract;
}

export async function loadApprovedQwen3VlContract(resourceRoot: string): Promise<LoadedQwen3VlContract> {
  const candidatePaths = [
    resolve(resourceRoot, "contracts", QWEN3_VL_APPROVED_CONTRACT_FILE),
    resolve(resourceRoot, "resources", "contracts", QWEN3_VL_APPROVED_CONTRACT_FILE),
  ];
  let lastError: unknown;
  for (const sourcePath of candidatePaths) {
    try {
      const bytes = await readFile(sourcePath);
      return {
        contract: validateContract(JSON.parse(bytes.toString("utf8")) as unknown),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sourcePath,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`qwen_contract_unavailable:${lastError instanceof Error ? lastError.message : "unknown"}`);
}

export function findApprovedQwen3VlRevision(
  contract: ApprovedQwen3VlContract,
  modelSha256: string,
  projectorSha256: string,
): ApprovedQwen3VlRevision | null {
  return contract.revisions.find((revision) =>
    revision.model.sha256 === modelSha256 &&
    revision.projector.sha256 === projectorSha256) ?? null;
}

export function qwenCertificationPolicy(
  approvedRevision: ApprovedQwen3VlRevision | null,
  functionalProbePassed: boolean,
): { level: QwenModelCertificationLevel; usageGate: QwenModelUsageGate } {
  if (!functionalProbePassed) return { level: "none", usageGate: "blocked" };
  return approvedRevision
    ? { level: "approved_revision", usageGate: "purchase" }
    : { level: "unknown_revision", usageGate: "planning_only" };
}
