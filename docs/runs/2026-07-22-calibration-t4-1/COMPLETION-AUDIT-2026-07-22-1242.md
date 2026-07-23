# Completion audit — Calibration T4.1

Status: objective active; local implementation gates green; native CI, approved runtime and physical gates pending.

Authoritative scope: the 624-line T4.1 plan supplied by the user. This audit distinguishes implemented behavior from evidence that actually proves completion.

## Requirement evidence

| Requirement | Current evidence | Decision |
|---|---|---|
| Isolated branch, untouched `main`, no commit before physical matrix | Branch `codex/calibracao-autonoma-qual-hardware` remains at base `f0c4c00...`; original `main` remains at the same commit with only its pre-existing untracked items | Proven |
| Local calibration without Perceptrum/database access | Internal worker/kernel, loopback contracts, forbidden-field guards, source audit with `externalSourceAccess:false`, packaged macOS smoke | Proven locally |
| Progress v2, elapsed time, ETA and 100% only after commit/cleanup | Progress tests and packaged smoke confirming committed run and cleanup before 100% | Proven locally |
| Progressive disk reclamation and safe exact-session cleanup | Adversarial filesystem tests and packaged success/cancel/shutdown scenarios with zero remaining session bytes | Proven locally |
| Idempotent cancellation and diagnostic preservation | API tests plus packaged regression; cancellation dominates killed-child errors and late results | Proven on macOS; native Windows/Linux pending |
| Scientifically safe resume/lineage | Compatibility, checkpoint and lineage tests; commercial repetitions restart | Proven in automated tests; physical resume pending |
| Signed `.qhcal` and `.qhcalset`, trust, duplicate/conflict limits | Ed25519/gzip/adversarial tests and ten-machine fixture consolidation | Proven in automated tests |
| Cross-platform package exchange | CI now generates one native signed fixture per OS; receiver jobs on all three OS verify all three packages and consolidate a collection. Local three-package rehearsal passed | Implemented; hosted native CI not yet executed because no candidate commit exists |
| SQLite v9 additive extension v2 and append-only consolidation | Database boundary, migration, rollback and import transaction tests | Proven locally |
| Exact evidence before extrapolation/benchmark/theory | Capacity and recommendation tests, incompatible evidence rejection, distinct-system extrapolation gate | Proven in automated tests |
| Fifteen-day signed public catalog without calibration interference | Publisher workflow, deferred-update coordination and catalog tests | Proven in automated tests; scheduled production execution remains operational evidence |
| One multiplatform source tree | Shared code and one branch; platform adapters restricted to runtime/process/telemetry/packaging | Proven structurally |
| Telemetry probe on three targets | Source-tree lock, Go 1.26.5, deterministic double-build for Mach-O/PE/ELF, packaged hashes/SBOM notices; macOS execution measured | macOS actual; Windows/Linux native execution delegated to new CI and still pending |
| Native installers and packaged smoke on all targets | macOS DMG and two final smokes passed | Windows and Ubuntu missing |
| Approved FFmpeg/ffprobe/MediaMTX/llama/Qwen runtime | Immutable candidate inventory exists, but legal/SBOM/package/physical approvals and installed artifacts are absent; disk reserve blocks acquisition | Incomplete |
| Three full physical repetitions per reference platform | No approved full runtime or three physical environments available | Missing |
| Physical zero-egress capture and cross-system exchange | Local counters/source audit prove no application egress path; physical capture not performed | Incomplete |
| Candidate commit, push, hosted CI and one PR | Explicitly forbidden by the plan until the physical pre-commit matrix passes | Pending by design |

## New native CI gate

`desktop-ci.yml` now runs on `codex/**`, pull requests and `main`. On Windows 11 x64, macOS arm64 and Ubuntu 24.04 x64 it installs the pinned Go toolchain, audits sources/assets/dependencies, tests and deterministically rebuilds the telemetry probe, packages the desktop, runs the packaged smoke, creates a signed diagnostic-only `.qhcal`, and uploads it. A second three-OS receiver matrix downloads every producer package, verifies each signature/identity and consolidates them into a valid `.qhcalset`.

`desktop-release.yml` applies the same Go, telemetry, source and dependency gates before creating release installers.

## Completion decision

The objective cannot be marked complete. Evidence is still missing for approved large runtime/model assets, native Windows/Ubuntu installers and smokes, full physical runs on all three platforms, physical zero-egress capture, and cross-machine physical package exchange. No commit, push or PR is authorized until those pre-commit gates pass.
