# Implementation diary — Perceptrum capacity calibration v2

## Completed surface

- [x] Added versioned workload, local calibration, evidence catalog, prediction
  and report contracts.
- [x] Added append-only calibration/evidence/prediction persistence and additive
  SQLite schema v2 initialization without moving or recreating the database.
- [x] Added stage-specific conservative extrapolation, leave-one-out validation,
  20/30/40% reserves and public evidence rejection rules.
- [x] Replaced the Windows-return benchmark action with the calibration center:
  plan generation, result import, signed snapshot import and recalculation.
- [x] Separated RTSP read FPS from AiQ inference FPS and aligned AiQ/Qwen Core
  with the verified 1 FPS, 60-second execution cycle.
- [x] Expanded the embedded complete-system catalog to 21 profiles and added the
  exact MacBook Pro M4 Max 14-core CPU / 32-core GPU / 36 GB anchor.
- [x] Added up to six cost-ordered safe candidates with Intel preference, AMD and
  OEM diversity where compatible, and NVIDIA selection only when the pipeline
  evidence supports it.
- [x] Extended PDF, XLSX and JSON 2.3 reports with evidence status, anchors,
  confidence, range, bottleneck and componentized cost.
- [x] Implemented the packaged Perceptrum runner in its separate isolated
  worktree and imported its real macOS calibration in the packaged desktop
  smoke.
- [x] Reviewed Windows and Ubuntu native package/CI paths. Physical homologation
  remains intentionally future work on those machines.

## Execution notes

Baseline was commit `0d11a20`, 40 tests and a green build. Archon run
`a68f480b9bbf2908369f48e600b02150` created the isolated worktree; its configured
provider paused for unavailable credit, so execution continued manually in the
same Archon branch and worktree without broadening scope.

The first macOS evidence attempt exposed inaccurate frame counters and tool
version reporting and was rejected. After correction, the final Node 24 package
produced calibration `d3d84103-bfb3-4175-bdfb-58143916b6b5`, which the Qual
Hardware package imported as `validated_local` for
`apple-macbook-pro-m4max-14c-32gpu-36gb`.

No historical row, database, source file or user data was deleted. Generated
build directories were replaced only by their own packaging commands.
