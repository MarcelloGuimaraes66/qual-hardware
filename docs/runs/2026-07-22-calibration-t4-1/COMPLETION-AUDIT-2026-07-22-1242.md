# Completion audit — Calibration T4.1

Status: objective active; local and hosted native implementation gates green; approved runtime and physical qualification gates pending.

Authoritative scope: the 624-line T4.1 plan supplied by the user. This audit distinguishes implemented behavior from evidence that actually proves completion.

## Requirement evidence

| Requirement | Current evidence | Decision |
|---|---|---|
| Isolated branch and untouched `main` | Work occurs in the isolated branch/worktree; the original `main` remains at `f0c4c00ed914d567bb2678e429b0e373d0ae11a7`. The user later expressly authorized publishing the diagnostic candidate before physical qualification | Proven |
| Local calibration without Perceptrum/database access | Internal worker/kernel, loopback contracts, forbidden-field guards, source audit with `externalSourceAccess:false`, packaged macOS smoke | Proven locally |
| Progress v2, elapsed time, ETA and 100% only after commit/cleanup | Progress tests and packaged smoke confirming committed run and cleanup before 100% | Proven locally |
| Progressive disk reclamation and safe exact-session cleanup | Adversarial filesystem tests and packaged success/cancel/shutdown scenarios with zero remaining session bytes | Proven locally |
| Idempotent cancellation and diagnostic preservation | API tests, packaged regression and forced-exit recovery; cancellation dominates killed-child errors and late results | Proven in automated native matrix; physical interruption still pending |
| Scientifically safe resume/lineage | Compatibility, checkpoint and lineage tests; commercial repetitions restart | Proven in automated tests; physical resume pending |
| Signed `.qhcal` and `.qhcalset`, trust, duplicate/conflict limits | Ed25519/gzip/adversarial tests and ten-machine fixture consolidation | Proven in automated tests |
| Cross-platform package exchange | Desktop CI run `29938625358` generated one native signed fixture per OS; receiver jobs on all three OS verified all three packages and consolidated a collection | Proven in hosted native matrix |
| SQLite v9 additive extension v2 and append-only consolidation | Database boundary, migration, rollback and import transaction tests | Proven locally |
| Exact evidence before extrapolation/benchmark/theory | Capacity and recommendation tests, incompatible evidence rejection, distinct-system extrapolation gate | Proven in automated tests |
| Fifteen-day signed public catalog without calibration interference | Publisher workflow, deferred-update coordination and catalog tests | Proven in automated tests; scheduled production execution remains operational evidence |
| One multiplatform source tree | Shared code and one branch; platform adapters restricted to runtime/process/telemetry/packaging | Proven structurally |
| Telemetry probe on three targets | Source-tree lock, Go 1.26.5, deterministic double-build for Mach-O/PE/ELF and execution in the hosted Windows, Ubuntu and macOS jobs | Proven for automated host diagnostics; physical sensor qualification pending |
| Native installers and packaged smoke on all targets | Desktop CI run `29938625358` passed Windows 11 x64, Ubuntu 24.04 x64 and macOS arm64 producer jobs plus all receiver jobs | Proven in hosted native matrix |
| Fail-closed runtime intake preparation | Deterministic target templates cover all nine IDs, immutable source guide and placeholders; planner accepts the completed wrapper, refuses placeholders and rejects incomplete CUDA/Metal/Vulkan companion groups before asset reads | Proven locally by 6 focused tests and CLI parsing on all targets; hosted revalidation of the current candidate pending |
| Approved FFmpeg/ffprobe/MediaMTX/llama/Qwen runtime | Immutable candidate inventory exists, but legal/SBOM/package/physical approvals and installed artifacts are absent; disk reserve blocks acquisition | Incomplete |
| Three full physical repetitions per reference platform | No approved full runtime or three physical environments available | Missing |
| Physical zero-egress capture and cross-system exchange | Local counters/source audit prove no application egress path; physical capture not performed | Incomplete |
| Candidate commit, push and hosted CI | Published commit `d62273a703beb0906469ea411f0ec59b88dbcb3a`; run `29938625358` passed all six jobs after the user expressly authorized publication | Proven; current intake-hardening candidate not yet published |

## New native CI gate

`desktop-ci.yml` now runs on `codex/**`, pull requests and `main`. On Windows 11 x64, macOS arm64 and Ubuntu 24.04 x64 it installs the pinned Go toolchain, audits sources/assets/dependencies, tests and deterministically rebuilds the telemetry probe, packages the desktop, runs the packaged smoke, creates a signed diagnostic-only `.qhcal`, and uploads it. A second three-OS receiver matrix downloads every producer package, verifies each signature/identity and consolidates them into a valid `.qhcalset`.

`desktop-release.yml` applies the same Go, telemetry, source and dependency gates before creating release installers.

## Current local candidate

The intake-hardening candidate passes 25 files / 204 tests, typecheck, production build, source audit with `externalSourceAccess:false`, asset audit and deterministic CLI-template parsing for `darwin-arm64`, `win32-x64` and `linux-x64`. The asset audit remains intentionally fail-closed because all nine candidates still carry legal/SBOM/package/physical blockers. The current Mac has about 15.9 GB free, below the mandatory 50 GiB reserve.

## Completion decision

The objective cannot be marked complete. Evidence is still missing for approved large runtime/model assets, full physical CPU/GPU runs with three repetitions on Windows, Ubuntu and macOS, physical zero-egress capture, zero session-temporary bytes on those physical runs, and cross-machine exchange of their real results. The reported Windows RTX 5090 host with 152 GB free is the first intended physical gate.
