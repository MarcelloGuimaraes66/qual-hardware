import { createHash } from "node:crypto";
import {
  PERCEPTRUM_AUTHORITY_CONTRACT_VERSION,
  PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT,
  type PerceptrumAuthorityContract,
} from "../shared/types.js";

const snapshotFiles: PerceptrumAuthorityContract["files"] = [
  {
    role: "jobs_ui",
    path: "DrakonSite/src/react-app/pages/Jobs.tsx",
    sizeBytes: 612_740,
    sha256: "092592e6222190ae2f1aac92d7d60997c9a5c369e1622a076173ff1d22b4a56b",
  },
  {
    role: "job_types",
    path: "Perceptrum/Perceptrum/jobs/JobTypes.h",
    sizeBytes: 10_832,
    sha256: "b0389aa453319185628bfc8ef06b40bbabb1bfa5abb71dc892ce61844a0bb69c",
  },
  {
    role: "job_runtime",
    path: "Perceptrum/Perceptrum/jobs/JobRuntime.cpp",
    sizeBytes: 676_943,
    sha256: "3392e8f5b11241dfa495a0ec2e7e287f271016ab4e602b67ab2666b428d53740",
  },
  {
    role: "agent_runtime",
    path: "Perceptrum/Perceptrum/core/AgentCore.cpp",
    sizeBytes: 1_620_237,
    sha256: "1a83d4c5f9e10fb949ca446b19908a36c3220e41b6c7b6a23c1697bb3bb34e53",
  },
  {
    role: "camera_session",
    path: "Perceptrum/Perceptrum/camera/CameraSession.cpp",
    sizeBytes: 456_655,
    sha256: "e0c2b37f4e7c7c3f77860fae948280f1fbf3173df969c07a6267e5892e2f00a5",
  },
  {
    role: "frame_writer",
    path: "Perceptrum/Perceptrum/camera/FrameDiskWriter.cpp",
    sizeBytes: 116_073,
    sha256: "b78e4e110ff0538d0542f52d833eea49a25dc667bbe623152259649615c78442",
  },
];

const behaviorSnapshotSha256 = createHash("sha256")
  .update(JSON.stringify(snapshotFiles.map(({ role, path, sizeBytes, sha256 }) => ({ role, path, sizeBytes, sha256 }))))
  .digest("hex");

export const PERCEPTRUM_AUTHORITY_CONTRACT: PerceptrumAuthorityContract = Object.freeze({
  schemaVersion: PERCEPTRUM_AUTHORITY_CONTRACT_VERSION,
  repository: "perceptrum_desktop_aspp",
  legacyCompatibleCommit: PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT,
  capturedAt: "2026-07-23T16:30:00.000Z",
  status: "verified",
  behaviorSnapshotSha256,
  files: snapshotFiles,
  rules: {
    videoModelFps: { minimum: 1 as const, maximum: 10 as const },
    individualCadenceSeconds: [10, 60] as [10, 60],
    groupCadenceSeconds: [10, 60, 300, 600] as [10, 60, 300, 600],
    imageWritesSnapshotEverySeconds: 10 as const,
    sharedDecodeWithinCamera: true as const,
    videoCaptureDominatesMixedCamera: true as const,
    inferenceCallsRemainAdditive: true as const,
  },
});

export function perceptrumAuthorityContract(): PerceptrumAuthorityContract {
  return structuredClone(PERCEPTRUM_AUTHORITY_CONTRACT);
}
