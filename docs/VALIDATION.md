# Validation policy

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
- Missing seller quotes use a visibly identified, dated and sourced componentized reference estimate; values are never presented as a firm offer and purchase quotation remains required.
- Minimum, recommended and N+1 use different primary hardware templates whenever compatible non-downgrade alternatives exist. Capacity constraints always take precedence over diversity.
- A hardware template is rejected if any compute, memory, decoder or network dimension exceeds its policy-adjusted capacity.
- Laptops and mini PCs participate in CPU-decode/remote-model sizing. The exact ASUS S5606CA profile can be forced and must never be silently replaced by another template.
- Apple templates are considered only after explicit macOS selection; shared/unified memory is not dedicated VRAM and current local AiQ/NVIDIA decode demand rejects them.
- Every PDF, XLSX and JSON proposal export contains the complete current set of minimum, recommended and N+1 designs; a partial recommendation set is rejected.
- Hardware catalog imports require a configured Ed25519 public key and never replace the active catalog when signature verification fails.
