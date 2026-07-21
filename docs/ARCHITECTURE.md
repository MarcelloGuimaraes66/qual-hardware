# Architecture and invariants

## Project identity

- Repository: `qual-hardware`
- Product: standalone **Qual Hardware** specification calculator
- Process authority: Archon global configuration; no repository-local Archon memory was available when this project was created.
- Risk: T4, because this adds persistence, hardware-cost calculations, background collection and a benchmark trust boundary.

## Invariants

1. Existing Perceptrum camera, Jobs, chat, authentication and deployment flows remain unchanged.
2. Qual Hardware never receives video, still images, RTSP URLs, RTSP credentials or model API keys.
3. `validated_local` means that exact computer ran the local Perceptrum calibration; extrapolated machines are never labeled physically validated.
4. The effective backend execution contract wins over UI-only combinations.
5. Every displayed price carries source URL, currency, condition and observation time; otherwise the component requires a quotation.
6. No code in this project can deploy to `/var/www/drakonsite`, operate `drakonsite-backend`, or use port `4999`.
7. Qual Hardware runs only as its own desktop executable. Its loopback API is an internal implementation detail and is never hosted, deployed or bundled into any Perceptrum EXE, MSIX, backend, installer or distribution.
8. Persistent data exists only in the local file `qual-hardware.sqlite`. Any other database filename is rejected before use; no Perceptrum database is opened or modified.
9. Public catalog releases are append-only, signed with Ed25519 and linked by sequence and previous-bundle SHA-256. A failed or malicious publication never replaces the active snapshot.
10. Store discovery and Qwen classification run only in the central publisher. No project, camera, credential, calibration or other user datum leaves the desktop.
11. Manufacturer specifications and independent benchmarks are different evidence classes: a datasheet may prove compatibility or a procurement requirement, but never substitutes sustained performance evidence.
12. The separated neutral annex cannot contain manufacturer, brand, model, MPN, SKU, seller, price, URL or product-revealing internal code. A blocked recommendation remains blocked in every export.

## Blast radius and change budget

- Allowed: this `qual-hardware` project and the isolated local-calibration adapter in the Perceptrum desktop runtime.
- Excluded: production deployment scripts, normal camera bootstrap, command routing, billing and account authentication.
- Change budget: targeted Qual Hardware session/UI work plus the isolated additive Perceptrum calibration, protocol-registration and packaging adapter.

## Platform matrix

| Surface / recommendation target | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Qual Hardware desktop | Windows 11 x64 | macOS 26 arm64 | Ubuntu 24.04 x64 |
| Perceptrum computer workload being sized | supported | opt-in; native build + local calibration | native build + local calibration required |
| Planned Perceptrum rack workload being sized | conditional | not applicable | matching server build + benchmark required |
| Local calibration-plan generation | supported | supported | supported |
| Perceptrum local calibration runner | native package/CI | validated on this Mac | native package/CI |

## Data flow

1. A consultant defines camera groups and one or more agents per group.
2. The engine normalizes the scenario against `perceptrum-workload/3.1.0`, generated from the production Perceptrum pipeline. Older contracts remain readable but cannot silently approve a purchase.
3. Demand is calculated independently for RTSP receive/decode, BGR processing, encode, frame extraction, CPU, RAM, GPU inference, VRAM/unified memory, disk read/write/capacity, LAN, Jobs, Steps, Agents, Intelligence, database/dashboard concurrency, queues and sustained thermals. RTSP FPS and AiQ inference FPS remain independent.
4. Candidate hardware nodes are filtered by platform and runtime compatibility and evaluated with multidimensional compute/network allocation. Laptops and mini PCs compete for small CPU-decode/remote-model loads. Apple is opt-in; integrated/shared memory is never counted as dedicated NVIDIA VRAM. Every BOM still includes a modest NVMe workspace for the operating system and temporary inference files.
5. The service emits minimum, recommended and N+1 designs, each with up to six compatible cost-ordered machines and Intel/AMD/OEM diversity after safety filtering.
6. Qual Hardware creates an expiring authenticated session and opens `perceptrum://calibration/run`. Perceptrum downloads one exact plan over loopback, uses synthetic RTSP plus the real local AiQ/Qwen/Intelligence pipeline, saves `.qhcal.json` append-only in Documents and returns aggregate evidence and progress. Manual plan/result files remain recovery paths.
7. Signed public stage observations scale physical anchors by a per-stage rule of three; the most conservative anchor and bottleneck win, followed by 20/30/40% margins and leave-one-out error checks.
8. GitHub Actions checks the approved source registry every 15 days, validates structured observations, signs one immutable catalog bundle and publishes it as a `catalog-*` Release plus an append-only `catalog-data` history.
9. At startup and every 24 hours, all three desktop packages inspect that same public channel with ETag, verify every bundle checksum/signature/sequence link, then activate hardware, components, benchmarks, prices and sources atomically. SQLite v8 preserves all v1-v7 data and adds normalized manufacturer fields, artifact hashes, specification history, completeness, neutral requirements and market-competition evidence.
10. Every option is exported twice in the combined report: an internal commercial reference followed by a workload-derived neutral specification. The separated DOCX/PDF/JSON annex removes all commercial identifiers and is blocked when the benchmark gate, component-completeness gate or competition gate fails.

## Security model

There is no application login because there is no hosted surface. Public or LAN exposure is unsupported and no deployment artifacts are shipped.

The desktop binds its internal API to a random `127.0.0.1` port. Its renderer is sandboxed, isolated, has no Node.js integration, rejects unused permissions and cannot navigate away from its loopback origin. The official GitHub owner, Release prefix and an Ed25519 public-key ring are compiled into the application; the private key exists only as the protected publisher secret. Catalog snapshots are verified before transactionally adding the new publication and switching the active pointer. The desktop database lives in Electron's native per-user `userData` directory and survives application restarts on all three supported systems.

Only one desktop instance may own the database. Windows and Ubuntu quit after the last window closes. On macOS, closing the last window keeps the application active, Dock activation recreates the window, and `Cmd+Q` closes the API and SQLite before exit.

Calibration tokens are random 256-bit values, stored only as SHA-256 hashes, compared in constant time and expired after two hours. Plans, progress and results stay on loopback. A completed session cannot be replayed or overwritten. If the callback is interrupted, the next Qual Hardware launch reconciles only a saved result whose plan UUID matches a known pending session and whose schema/checksum is valid.
