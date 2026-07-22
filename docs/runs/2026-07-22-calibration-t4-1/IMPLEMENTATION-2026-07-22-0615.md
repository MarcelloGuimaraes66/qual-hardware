# Implementation — Calibration T4.1

Update 2026-07-22 10:15: every tier/phase now executes isolated CPU and GPU lanes; official Windows CUDA, macOS Metal and Ubuntu Vulkan runtime companions are pinned; media uses bounded circular segments; progressive cleanup bytes remain cumulative; runtime-candidate wording is fail-closed; and concurrent temporary-manifest updates are serialized. Final local evidence is recorded in `VALIDATION-CPU-GPU-2026-07-22-1015.md`.

Status: local implementation complete and green; approved-runtime and physical pre-commit gates pending.

## Execution order

- [x] Verify isolation and original repository preservation.
- [x] Create external, hashed pre-implementation snapshot.
- [x] Re-run green baseline.
- [x] Add contracts and additive schema v2.
- [x] Implement progress, disk lifecycle, checkpoints, cancel, and resume.
- [x] Implement signed exchange and offline collection.
- [x] Integrate evidence precedence and catalog retry.
- [x] Update UI and packaging.
- [x] Pin and hash official runtime/model candidates without enabling download or commercial use.
- [x] Add fail-closed asset audit, provisioning disk admission, source-lock packaging, and cancellation ordering regression protection.
- [x] Implement, cross-build, hash-lock, package and locally execute the first-party telemetry probe for macOS arm64, Windows x64 and Linux x64.
- [x] Extend native CI/release gates with pinned Go, telemetry tests/reproducibility, source/runtime audits and dependency audit on every OS.
- [x] Add a native three-producer × three-receiver `.qhcal` interchange matrix, with diagnostic-only fixtures and `.qhcalset` consolidation.
- [x] Run local adversarial, regression, typecheck, build, packaged smoke, dependency, and source-isolation validation.
- [ ] Run native and physical qualification on Windows 11 x64, Ubuntu 24.04 x64, and macOS arm64 with approved assets.

## Delivered behavior

- Internal worker-only calibration is the active button path; it does not start or call Perceptrum.
- Progress v2 persists bounded heartbeats and reconstructs elapsed time/ETA while the renderer clock updates every second.
- Session-owned media, probes, logs, auxiliary databases, and model caches are reclaimed after each committed phase and again at the terminal cleanup gate.
- Cancellation is idempotent, persists a diagnostic/checkpoint, terminates children in bounded stages, and cleans session files.
- Resume creates immutable lineage, reuses compatible discovery aggregates only, and restarts commercial qualification at repetition 1.
- `.qhcal` and `.qhcalset` use deterministic canonical JSON, real gzip, Ed25519 signatures, size/expansion bounds, device trust, duplicate/conflict handling, and collector re-export preserving individual signatures.
- Imports have a non-mutating consolidation preview after device trust; pending first-use identities are persisted for explicit fingerprint confirmation.
- Exact compatible physical evidence outranks extrapolation; extrapolation requires three distinct hardware configurations; untrusted, revoked, unmapped, or incompatible results remain diagnostic.
- Public catalog refresh is blocked during calibration and retried immediately afterward. A successful manual or automatic catalog import recalculates predictions.
- Independent rollback switches exist for the kernel (`QUAL_HARDWARE_CALIBRATION_FEATURE`), resume, exchange, and evidence policy.
- The runtime supply chain is versioned and hash-locked separately from approval. `calibration:assets:audit` validates exact inventory/targets/hosts/immutable selectors, computes peak disk demand, and reports every unresolved gate without downloading anything.
- Provisioning refuses an existing target before mutation, then refuses when acquisition/staging would cross the reserve; tests inject disk state so host pressure cannot make the suite flaky.
- Cancellation/result/progress messages are serialized; cancelling and terminal states reject late progress writes.
- The packaged telemetry probe uses no shell, network, automatic elevation or user-controlled arguments. It reads `pmset`/`ioreg` on macOS, thermal sysfs/counters on Linux, Windows CIM thermal policy, and NVIDIA thermal slowdown flags when available.
- Probe output is accepted only with the exact schema, local platform/architecture, bounded values and explicit sensor quality. Partial GPU/CPU coverage remains diagnostic; it can never satisfy the commercial thermal guardrail.
- Immediate cancellation now dominates FFmpeg/child exit codes and late results, so stopping a test produces `cancelled`, preserves a compact diagnostic, and cleans the exact session instead of reporting a false hardware failure.
- Branch pushes under `codex/**` now trigger the Windows/macOS/Ubuntu desktop matrix. Each native job exports a signed platform fixture; every receiver OS verifies and consolidates all three packages before CI can pass.

## Deliberate fail-closed state

The runtime manifest intentionally contains no approved manifest hash yet. The telemetry-probe candidate now has reproducible platform binaries, installed hashes/sizes, provenance notices and candidate CycloneDX SBOMs, so diagnostic calibration can measure thermals locally. Its legal/SBOM review and physical sensor validation remain blocked, as do all other runtime/model approvals. Purchase-grade full calibration remains disabled until every asset and native physical gate passes. Current disk reserve also blocks acquisition on this host. No candidate commit is allowed before those external gates pass.
