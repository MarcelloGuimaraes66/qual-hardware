import type {
  CalibrationPlan,
  CalibrationCheckpoint,
  CalibrationRuntimeStatus,
  CalibrationSessionProgress,
  CalibrationRepetitionResult,
  CalibrationTierResult,
  HardwareFingerprint,
  HardwareNodeTemplate,
  LocalCalibrationRun,
} from "../shared/types.js";

export interface CalibrationKernelDiagnosticPayload {
  schemaVersion: "qual-hardware-calibration-diagnostic/1.0.0";
  sessionId: string;
  runId: string;
  planId: string;
  createdAt: string;
  completedAt: string;
  status: "cancelled" | "failed" | "interrupted";
  error: string;
  kernelVersion: string;
  runtimeManifestHash: string;
  workloadProfileId: string;
  workloadProfileSignature: string;
  compatiblePerceptrumCommit: string;
  lastProgress: CalibrationSessionProgress | null;
  fingerprint: HardwareFingerprint | null;
  runtimeSummary: {
    mediaAvailable: boolean;
    rtspAvailable: boolean;
    localInferenceAvailable: boolean;
    unavailableReasons: string[];
  } | null;
  tierResults: CalibrationTierResult[];
  repetitions: CalibrationRepetitionResult[];
  measurements: Array<Record<string, unknown>>;
}

export interface CalibrationKernelWorkerInput {
  sessionId: string;
  runId: string;
  appVersion: string;
  temporaryRoot: string;
  plan: CalibrationPlan;
  targetHardware: HardwareNodeTemplate | null;
  runtimeStatus: CalibrationRuntimeStatus;
  advancedTelemetry: boolean;
  timeScale: number;
  resumeCheckpoint?: CalibrationCheckpoint;
}

export type CalibrationKernelWorkerMessage =
  | { type: "progress"; progress: CalibrationSessionProgress }
  | { type: "checkpoint"; checkpoint: CalibrationCheckpoint }
  | { type: "child_process"; action: "started" | "stopped"; pid: number; kind: "ffmpeg" | "ffprobe" | "mediamtx" | "llama-server" }
  | { type: "result"; result: LocalCalibrationRun }
  | { type: "cancelled"; detail: string; diagnostic: CalibrationKernelDiagnosticPayload }
  | { type: "failed"; error: string; diagnostic: CalibrationKernelDiagnosticPayload };

export type CalibrationKernelControlMessage =
  | { type: "cancel" }
  | { type: "checkpoint_committed"; checkpointId: string }
  | { type: "checkpoint_failed"; checkpointId: string; error: string };

export function calibrationFailureWasCancelled(cancellationRequested: boolean, detail: string): boolean {
  return cancellationRequested || detail === "calibration_cancelled";
}
