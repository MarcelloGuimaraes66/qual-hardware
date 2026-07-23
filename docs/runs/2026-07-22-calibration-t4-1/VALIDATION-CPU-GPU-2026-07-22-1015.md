# Validation addendum — mandatory CPU and GPU lanes

Status: local Qual Hardware gates green; approved runtime and physical Windows/Ubuntu/macOS gates pending; no commit created.

## Scope and invariants

- All implementation and validation in this addendum occurred only in the isolated Qual Hardware worktree on `codex/calibracao-autonoma-qual-hardware`.
- The original `main` remains at `f0c4c00ed914d567bb2678e429b0e373d0ae11a7`.
- The autonomous button path does not execute, open, modify or query Perceptrum or its database. The immutable compatibility commit is static contract metadata only.
- Every discovery tier and every quick/full phase now requires both `cpu_only` and `gpu_accelerated` measurements. Full qualification still requires three complete repetitions.

## Corrections proved locally

- CPU inference uses `--device none --n-gpu-layers 0`; GPU inference uses the exact detected device and GPU offload.
- CPU and GPU inference servers are no longer resident at the same time. The requested lane stops the previous lane before loading its own models, preventing idle-model memory from contaminating capacity measurements.
- Windows RTX uses the official llama.cpp CUDA 13.3 bundle plus all DLL companions from the base and CUDA runtime archives.
- macOS uses the official Metal bundle plus its dynamic libraries.
- Ubuntu uses the official Vulkan bundle plus shared libraries, with a measured Vulkan fallback when a vendor CUDA/ROCm binary is unavailable.
- FFmpeg packaging is explicitly blocked until one build provides the required CPU H.264/H.265 encoders and the platform GPU decode/encode backend, with GPL/license review and CycloneDX evidence.
- Media output is a two-second circular segment window; long phases do not retain their full encoded duration.
- Phase checkpoint cleanup is cumulative in terminal byte accounting.
- Concurrent temporary-file registrations are serialized. A 64-file adversarial test closes a JSON-manifest corruption race found by the full regression suite.
- The UI distinguishes a complete candidate runtime from a commercially approved runtime and labels unapproved full runs as physical validation diagnostics.
- The exchange command now self-tests Windows, Linux and macOS packages by default and finishes with zero temporary bytes.

## Final local evidence

- Typecheck: passed.
- Production build: passed.
- Complete Vitest suite: 25 files / 198 tests passed.
- Pipeline and temporary-file critical set: 29 tests passed in three consecutive executions after the concurrency fix.
- Packaged desktop smoke: passed on macOS arm64 from `release-t4-cpugpu-20260722-1010`; success, cancellation, restart, persisted SQLite v9 evidence and exact-session cleanup were exercised.
- Smoke temporary data: removed; zero retained smoke workspace.
- Telemetry probe: reproducible Mach-O arm64, PE x64 and ELF x64 binaries; local macOS contract/thermal execution passed; verifier temporaries ended at zero bytes.
- Signed exchange self-test: three producer identities, one consolidated collection, zero temporary bytes.
- Dependency audit: zero high-or-higher vulnerabilities.
- Source audit: `externalSourceAccess:false`; source-lock SHA-256 `8ab591a075e8f25a58736ebf68a55292eb11bc338d3da43be73e4c462558aa4d`.
- `git diff --check`: passed.
- Transport snapshot without `.git`, dependencies, builds or local certificates: `/Users/marcellogmfreire/.codex/snapshots/qual-hardware/2026-07-22-t4-1-cpugpu-candidate/qual-hardware-t4-1-cpugpu-candidate.tar.gz`, 5,892,769 bytes, SHA-256 `599a29fed52f908a2918b2d91aa3e6eb47ea3ff6d63779a603bca8436751a139`.

## Disk evidence

- Windows acquisition bytes: `5,091,933,369`.
- Windows conservative preparation peak: `10,720,737,650` bytes (about 10.0 GiB).
- The reported Windows machine has 152 GB free, which is sufficient for this projected peak while retaining the configured 50 GiB reserve.
- This macOS host has only about 13.6 GB free and correctly refuses large-runtime preparation under the 50 GiB reserve.

## Remaining hard gates

- Assemble, license-review, SBOM and hash the complete per-platform runtime/model packages.
- Execute the native packaged smoke and full physical CPU+GPU run on Windows 11 x64 with the RTX 5090.
- Execute the same full physical gate on Ubuntu 24.04 x64 and macOS arm64.
- Confirm native thermal sensor coverage, zero egress, zero session-temporary bytes, cancel/resume and cross-platform `.qhcal` exchange.
- Approve the exact runtime-manifest hashes only after those physical gates.
- Create the first candidate commit only after the complete pre-commit matrix is green.

No local code failure is known at this checkpoint. Completion and commercial capacity claims remain blocked by the deliberately unapproved assets and missing physical evidence.
