# Validation policy

## Cross-platform desktop gate

Pull requests run the same typecheck, test suite, build, unpacked package and packaged smoke test on `windows-2025`, `macos-26` and `ubuntu-24.04`. Linux executes Electron under Xvfb. The smoke runner validates the native binary architecture, desktop-only ASAR, loopback origin, health, the 21-item catalog, Windows/Ubuntu/macOS recommendation targets, SQLite, differentiated calculations, reconciled component costs, PDF/XLSX/JSON 2.3 exports, single-instance behavior and persistence after restart.

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

- `validated_local`: exact linked catalog profile, CPU, GPU, form factor, build/model hash and workload completed local calibration.
- `extrapolated_high`: class A with at least three eligible physical runs from three distinct, strongly comparable hardware profiles, complete stage coverage, leave-one-out safety and the greater of 20% or the measured empirical error reserve.
- `extrapolated_medium`: class B with at least two eligible runs from two distinct, strongly comparable hardware profiles and the greater of 30% or the measured empirical error reserve.
- `reference_only`: class C, incomplete coverage or cross-architecture evidence; at least 40% reserve and no purchase-capacity claim.

## Local calibration gate

1. Quick: 2 minutes warm-up, 5 sustained and 3 at 120%; full: 10, 40 and 10 minutes.
2. MediaMTX, FFmpeg and the real AiQ/Qwen backend remain on `127.0.0.1`; external/OpenAI count is zero.
3. Decoded frames reach at least 80% of planned RTSP throughput; inference success is at least 99%; no OOM or sustained queue growth.
4. All ten stages, phase metrics, exact fingerprint/build/model hashes, temperatures and frame counters are present.
5. The local anchor never claims more cameras than were physically sustained. A development smoke uses shortened phases but never creates importable evidence.
6. Import rejects a selected catalog profile when CPU, GPU or form factor does not match the measured fingerprint.

## Audited source baseline

Run `PERCEPTRUM_SOURCE_ROOT=/path/to/perceptrum npm run audit:source` whenever Perceptrum, DrakonSite, or AppHost source changes. The command records the current count and aggregate hash in `audit/perceptrum-source-inventory.json`; generated files, dependencies, binaries, build folders and package caches are explicitly excluded and recorded in the inventory itself. Never reuse a previously documented hash after the Perceptrum source changes.

## Design policies

- Minimum: 15% capacity reserve.
- Recommended: 30% capacity reserve.
- N+1: 30% reserve after loss of one compute node.
- Workload v2 includes rolling clip write/read and at least one day of workspace. Explicit retention and RAID increase demand; legacy workload versions remain readable without silently changing prior sizing.
- Missing seller quotes use a visibly identified, dated and sourced componentized reference estimate; values are never presented as a firm offer and purchase quotation remains required.
- Minimum, recommended and N+1 use different primaries when possible. Each policy exposes up to six cost-ordered qualified options, preferring four Intel, one AMD and multiple OEMs only after capacity safety.
- A hardware template is rejected if any compute, memory, decoder or network dimension exceeds its policy-adjusted capacity.
- Laptops and mini PCs participate in CPU-decode/remote-model sizing. The exact ASUS S5606CA profile can be forced and must never be silently replaced by another template.
- Apple templates are considered only after explicit macOS selection; shared/unified memory is not dedicated VRAM and current local AiQ/NVIDIA decode demand rejects them.
- Every PDF, XLSX and JSON proposal export contains the complete current set of minimum, recommended and N+1 designs; a partial recommendation set is rejected.
- Hardware catalog imports require a configured Ed25519 public key and never replace the active catalog when signature verification fails.
