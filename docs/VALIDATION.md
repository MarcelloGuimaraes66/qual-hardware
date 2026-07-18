# Validation policy

## Cross-platform desktop gate

Pull requests run the same typecheck, test suite, build, unpacked package and packaged smoke test on `windows-2025`, `macos-26` and `ubuntu-24.04`. Linux executes Electron under Xvfb. The smoke runner validates the native binary architecture, required ASAR resources, loopback origin, health, bundled catalog, SQLite, calculation, PDF/XLSX/JSON exports, single-instance behavior and persistence after restart.

```sh
npm ci
npm run typecheck
npm test
npm run build
npx electron-builder --dir --publish never
npm run desktop:smoke
```

On Ubuntu, run the final command through `xvfb-run --auto-servernum`. A release remains blocked until the manual Windows 11, macOS 26 and Ubuntu 24.04 checklist in `CROSS_PLATFORM_DESKTOP.md` is approved. Windows validation must additionally prove that the existing release and the refactored release resolve the exact same `app.getPath("userData")` directory before merge.

## Recommendation confidence

- `estimated`: produced by the reference capacity model or interpolation.
- `validated`: exact CPU, GPU, driver, Perceptrum build and an equal-or-heavier workload completed the benchmark gate.

## Benchmark gate

1. 15 minutes warm-up.
2. 60 minutes at 100% of the declared scenario.
3. 15 minutes at 120% of scheduled inference pressure.
4. No OOM, sustained queue growth, media/credential leakage or inference SLA breach.
5. Capture FPS, p95/p99 stage latency, process-tree CPU/RAM/I/O and GPU/VRAM/decoder telemetry are present.

The upload challenge is single-use and expires after 24 hours. Native benchmark mode suppresses external events and retained media; a replay controller is required for a certifying 120% surge. Shortened runner-development sessions intentionally fail validation.

The current automatic validation seal is restricted to single-active-node recommendations. Multi-node and N+1 recommendations remain estimated until the coordinated per-node/failover laboratory runner is implemented; a successful sample from only one node must never validate a cluster design.

## Audited source baseline

Run `npm run audit:source` whenever Perceptrum, DrakonSite, or AppHost source changes. The current filtered first-party inventory contains 498 files and has aggregate hash `fbb53b53525549138a65bae8f807f3dc3509ad0a37a3042573504952894ee381`. Generated files, dependencies, binaries, build folders, and package caches are explicitly excluded and recorded in the inventory itself.

## Design policies

- Minimum: 15% capacity reserve.
- Recommended: 30% capacity reserve.
- N+1: 30% reserve after loss of one compute node.
- Storage capacity and disk throughput are never node-count, headroom or bottleneck dimensions. The BOM includes only an operational NVMe workspace because inference media is short-lived and alert media is sparse.
- Legacy `storeVideo`, `retentionDays` and `raidFactor` scenario fields remain readable but are ignored by the sizing engine.
- Missing prices never become zero-cost parts; reports mark them as quotation required.
- A hardware template is rejected if any compute, memory, decoder or network dimension exceeds its policy-adjusted capacity.
- Every PDF, XLSX and JSON proposal export contains the complete current set of minimum, recommended and N+1 designs; a partial recommendation set is rejected.
- Hardware catalog imports require a configured Ed25519 public key and never replace the active catalog when signature verification fails.
