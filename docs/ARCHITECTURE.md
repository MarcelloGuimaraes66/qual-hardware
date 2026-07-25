# Architecture and invariants

## Project identity

- Repository: `qual-hardware`
- Product: standalone **Qual Hardware** specification calculator
- Process authority: Codex goal, repository evidence and the engineering run record under `docs/runs/`.
- Risk: T4, because this adds persistence, hardware-cost calculations, background collection and a benchmark trust boundary.

## Invariants

1. Existing Perceptrum camera, Jobs, chat, authentication and deployment flows remain unchanged.
2. Qual Hardware never receives video, still images, RTSP URLs, RTSP credentials or model API keys.
3. `validated_local` means that exact computer completed autonomous result v6 with `exact_perceptrum` evidence and complete per-device measurements; extrapolated machines are never labeled physically validated.
4. The effective backend execution contract wins over UI-only combinations.
5. Every displayed price carries source URL, currency, condition and observation time; otherwise the component requires a quotation.
6. No code in this project can deploy to `/var/www/drakonsite`, operate `drakonsite-backend`, or use port `4999`.
7. Qual Hardware runs only as its own desktop executable. Its loopback API is an internal implementation detail and is never hosted, deployed or bundled into any Perceptrum EXE, MSIX, backend, installer or distribution.
8. Persistent data exists only in the local file `qual-hardware.sqlite`. Any other database filename is rejected before use; no Perceptrum database is opened or modified.
9. Public catalog releases are append-only, signed with Ed25519 and linked by sequence and previous-bundle SHA-256. A failed or malicious publication never replaces the active snapshot.
10. Store discovery and Qwen classification run only in the central publisher. No project, camera, credential, calibration or other user datum leaves the desktop.
11. Manufacturer specifications and independent benchmarks are different evidence classes: a datasheet may prove compatibility or a procurement requirement, but never substitutes sustained performance evidence.
12. The separated neutral annex cannot contain manufacturer, brand, model, MPN, SKU, seller, price, URL or product-revealing internal code. A blocked recommendation remains blocked in every export.
13. The application never attaches to a running Perceptrum or opens its production database, credentials or media. A compatible installation may be started only with `--hardware-benchmark-worker`, JSON Lines over standard I/O and a temporary isolated workspace.
14. A generic native benchmark is diagnostic estimation only. Commercial qualification requires the exact isolated Perceptrum worker and complete evidence for every eligible CPU/GPU.

## Blast radius and change budget

- Allowed: this `qual-hardware` project, including its internal calibration kernel, local SQLite extension, loopback API, UI, signed exchange, catalog coordination, packaging and tests.
- Excluded: every Perceptrum repository, runtime, database, camera, credential, API and deployment surface.
- Change budget: targeted redesign inside the standalone Qual Hardware calibration and evidence boundaries.

## Platform matrix

| Surface / recommendation target | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Qual Hardware desktop | Windows 11 x64 | macOS 26 arm64 | Ubuntu 24.04 x64 |
| Perceptrum computer workload being sized | supported | opt-in; native build + local calibration | native build + local calibration required |
| Planned Perceptrum rack workload being sized | conditional | not applicable | matching server build + benchmark required |
| Local calibration-plan generation | supported | supported | supported |
| Autonomous Qual Hardware runner | Windows 11 physical gate | Apple Silicon physical gate required | Ubuntu x64 physical gate required |

## Data flow

1. A consultant defines camera groups and one or more agents per group.
2. The engine normalizes the scenario against `perceptrum-workload/4.0.0`, whose frozen authority snapshot distinguishes VÍDEO FULL from FRAME and preserves group proportions. Older contracts remain readable but cannot silently approve a purchase.
3. Demand is calculated independently for RTSP receive/decode, BGR processing, encode, frame extraction, CPU, RAM, GPU inference, VRAM/unified memory, disk read/write/capacity, LAN, Jobs, Steps, Agents, Intelligence, database/dashboard concurrency, queues and sustained thermals. RTSP FPS and AiQ inference FPS remain independent.
4. Candidate hardware nodes are filtered by platform and runtime compatibility and evaluated with multidimensional compute/network allocation. Laptops and mini PCs compete for small CPU-decode/remote-model loads. Apple is opt-in; integrated/shared memory is never counted as dedicated NVIDIA VRAM. Every BOM still includes a modest NVMe workspace for the operating system and temporary inference files.
5. The service emits minimum, recommended and N+1 designs, each with up to six compatible cost-ordered machines and Intel/AMD/OEM diversity after safety filtering.
6. Qual Hardware creates one persistent autonomous session and starts an isolated Electron utility process. That worker owns the internal RTSP/RTP loopback, compatible local programs, native benchmark and local telemetry inside a private session directory; progress and cancellation travel only over Electron IPC. The UI reads public session state from the random loopback API. Results are committed atomically and append-only under the native Documents folder before all session-owned processes and temporary files are removed.
7. Signed public stage observations scale physical anchors by a per-stage rule of three; the most conservative anchor and bottleneck win, followed by 20/30/40% margins and leave-one-out error checks.
8. GitHub Actions checks the approved source registry every 15 days, validates structured observations, signs one immutable catalog bundle and publishes it as a `catalog-*` Release plus an append-only `catalog-data` history.
9. At startup and every 24 hours, all three desktop packages inspect that same public channel with ETag, verify every bundle checksum/signature/sequence link, then activate hardware, components, benchmarks, prices and sources atomically. SQLite v12 preserves all v1-v11 data and adds environment/component/self-test evidence to typed probes, diagnostic reports, multi-device topology, boundaries and fleet plans. A consistent SQLite backup is created before a persistent older database is migrated.
10. The primary PDF is only the original comparative recommendations report; it does not append a Part II or the neutral annex. Detailed component specifications and benchmark/BOM audit remain in XLSX/JSON. The separately labeled DOCX/PDF/JSON neutral annex removes all commercial identifiers and is blocked when the benchmark gate, component-completeness gate or competition gate fails.

## Security model

There is no application login because there is no hosted surface. Public or LAN exposure is unsupported and no deployment artifacts are shipped.

The desktop binds its internal API to a random `127.0.0.1` port. Its renderer is sandboxed, isolated, has no Node.js integration, rejects unused permissions and cannot navigate away from its loopback origin. The official GitHub owner, Release prefix and an Ed25519 public-key ring are compiled into the application; the private key exists only as the protected publisher secret. Catalog snapshots are verified before transactionally adding the new publication and switching the active pointer. The desktop database lives in Electron's native per-user `userData` directory and survives application restarts on all three supported systems.

Only one desktop instance may own the database. Windows and Ubuntu quit after the last window closes. On macOS, closing the last window keeps the application active, Dock activation recreates the window, and `Cmd+Q` closes the API and SQLite before exit.

The renderer never receives arbitrary executable URLs. The main process owns native file selection, canonicalizes local paths, executes discovered programs by absolute path without a shell, bounds time/output and opens only IDs from the embedded official-link catalog after an explicit click. Private calibration identity keys use Electron safe storage where available.

Only one calibration session can be active. Session state, events and checkpoints are append-only in SQLite; worker traffic is private IPC. Windows places the worker and its native descendants in an owned process tree, while macOS and Ubuntu use an owned process group. Cancellation stops media, AI and telemetry, writes an `-interrompido.partial.json` diagnostic that cannot become purchase evidence, and completes cleanup before the session reaches `cancelled`. A completed session cannot be replayed or overwritten.
