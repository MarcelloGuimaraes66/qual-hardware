# Validation policy

## Cross-platform desktop gate

Pull requests use Node.js `24.18.0`, npm `11.16.0` and Go `1.26.5` for the same typecheck, complete test suite, build, unpacked package and packaged smoke on `windows-2025`, `macos-26` and `ubuntu-24.04`. Linux executes Electron under Xvfb. The smoke runner validates native architecture, desktop-only ASAR, random loopback origin, health, CSP, sandbox, the automatic catalog channel, 22-profile fallback catalog, Windows/Ubuntu/macOS recommendation targets, SQLite v10, reports, single-instance behavior, persistence and worker cleanup. On Windows it also launches the real portable bootstrap.

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

1. `quick` is a 10-minute non-commercial diagnostic; `validation` is a 60-minute single engineering repetition; `qualification` runs CPU and GPU sequentially through four phases, three repetitions, cooldowns and at most 10% accepted variability, taking approximately 6–7 hours.
2. MediaMTX, FFmpeg and the real AiQ/Qwen backend remain on `127.0.0.1`; external/OpenAI count is zero.
3. Delivered frames and completed inferences reach at least 99.5%; no OOM, sustained queue growth or critical throttling occurs, and p99 inference latency stays below 75% of the configured interval.
4. All fifteen stages, four phase summaries, exact fingerprint/build/model hashes, temperatures and frame counters are present. The stages include frame extraction, Jobs, Intelligence, database persistence and concurrent dashboard queries in addition to media, memory, storage, network and thermal work.
5. The local anchor never claims more cameras than were physically sustained. A development smoke uses shortened phases, is explicitly marked non-importable and never creates physical evidence.
6. Import rejects a selected catalog profile when CPU, GPU or form factor does not match the measured fingerprint.
7. Legacy local results v1–v3 remain readable as historical diagnostic evidence. Only `qual-hardware-local-calibration/4.0.0`, plan `3.0.0`, kernel `2.0.0` and a production-trusted runtime can be purchase-eligible; new `.qhcal` and `.qhcalset` exports use version `2.0.0`.
8. Session tests cover single active ownership, append-only transitions, IPC progress, cancellation, interruption recovery, resume compatibility, native Documents paths, atomic result persistence, replay rejection and cleanup retry. No external claim/control callback, custom protocol, bearer token or fixed calibration port exists.
9. Runtime-package tests cover invalid signatures, wrong target, candidate classification, corruption, duplicate paths, traversal, links, expansion limits, low disk, interruption, concurrent installation, atomic activation and rollback.
10. Physical qualification is initiated only from the application interface. Build/test tooling must not act as an external calibration coordinator.

## Audited source baseline

Run `PERCEPTRUM_SOURCE_ROOT=/path/to/perceptrum npm run audit:source` whenever Perceptrum, DrakonSite, or AppHost source changes. The command records the current count and aggregate hash in `audit/perceptrum-source-inventory.json`; generated files, dependencies, binaries, build folders and package caches are explicitly excluded and recorded in the inventory itself. Never reuse a previously documented hash after the Perceptrum source changes.

## Design policies

- Validated/high-confidence purchase results apply at least 20% reserve; planning-only results use at least 30%; cross-architecture/reference results use at least 40% and never claim purchase capacity.
- Workload v3 includes rolling clip write/read, frame extraction, Jobs, Steps, Agents, Intelligence, database/dashboard concurrency and at least one day of workspace. Explicit retention and RAID increase demand; legacy workload versions remain readable without silently changing prior sizing or approving purchase.
- Missing seller quotes use a visibly identified, dated and sourced componentized reference estimate; values are never presented as a firm offer and purchase quotation remains required.
- Minimum, recommended and N+1 use different primaries when possible. Each policy exposes up to six cost-ordered qualified options, preferring four Intel, one AMD and multiple OEMs only after capacity safety.
- A hardware template is rejected if any compute, memory, decoder or network dimension exceeds its policy-adjusted capacity.
- Laptops and mini PCs participate in CPU-decode/remote-model sizing. The exact ASUS S5606CA profile can be forced and must never be silently replaced by another template.
- Apple templates are considered only after explicit macOS selection; shared/unified memory is not dedicated VRAM and current local AiQ/NVIDIA decode demand rejects them.
- Every PDF, XLSX and JSON proposal export contains the complete current set of minimum, recommended and N+1 designs; a partial recommendation set is rejected.
- Hardware catalog imports require a configured Ed25519 public key and never replace the active catalog when signature verification fails.
- Automatic catalog tests cover day 0/14/15/retry scheduling, concurrent-publication protection, HTTPS/host/redirect/robots/CAPTCHA limits, deterministic Qwen evidence, price freshness/outliers, SHA-256, Ed25519, full-chain anti-rollback and additive migration without row loss.
- The smoke accepts the bundled fallback when no public Release exists and requires a persisted publication as soon as the official channel has activated one.
- A manufacturer datasheet never counts as a performance benchmark. Procurement-ready components require all critical official fields, while purchase-ready recommendations independently require benchmark/calibration eligibility.
- The neutral annex must contain no manufacturer, brand, model, MPN, SKU, seller, price, commercial URL or identifying component ID. Competition is adequate only with at least three matching products and two manufacturers; a restricted/no-coverage result is blocked.
- PDF, XLSX, JSON, DOCX and neutral PDF/JSON are generated from the same decorated recommendation set. Every format preserves quantities, proof method, acceptance criteria, status and market gate.
- A specification is official only when an immutable field observation resolves to the exact SKU/MPN through a deterministic parser. Component-level links and legacy JSON values remain ambiguous.
- The primary PDF contains only the complete original comparative report, with alternatives and all six blocks of every proposal. It must not contain a Part II or the neutral annex. Internal audit and detailed specifications stay in XLSX/JSON, while neutral requirements stay in their clearly separated annex. Visual review and searchable-text extraction are required.
- SQLite v10 migration must preserve every v1–v9 row and create a consistent pre-migration backup before opening a persistent older database.
