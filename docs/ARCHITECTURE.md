# Architecture and invariants

## Project identity

- Repository: `perceptrum_desktop_aspp`
- Product: standalone **Qual Hardware** specification calculator
- Process authority: Archon global configuration; no repository-local Archon memory was available when this project was created.
- Risk: T4, because this adds persistence, hardware-cost calculations, background collection and a benchmark trust boundary.

## Invariants

1. Existing Perceptrum camera, Jobs, chat, authentication and deployment flows remain unchanged.
2. Qual Hardware never receives video, still images, RTSP URLs, RTSP credentials or model API keys.
3. A recommendation is `validated` only after a matching benchmark passes the documented validation gate.
4. The effective backend execution contract wins over UI-only combinations.
5. Every displayed price carries source URL, currency, condition and observation time; otherwise the component requires a quotation.
6. No code in this project can deploy to `/var/www/drakonsite`, operate `drakonsite-backend`, or use port `4999`.
7. Qual Hardware runs only as its own desktop executable. Its loopback API is an internal implementation detail and is never hosted, deployed or bundled into any Perceptrum EXE, MSIX, backend, installer or distribution.
8. Persistent data exists only in the local file `qual-hardware.sqlite`. Any other database filename is rejected before use; no Perceptrum database is opened or modified.

## Blast radius and change budget

- Allowed: the new `qual-hardware` project and the isolated benchmark adapter in the desktop runtime.
- Excluded: Perceptrum packaging/distribution, production deployment scripts, normal camera bootstrap, command routing, billing and account authentication.
- Change budget: targeted redesign in the new project; minimal additive integration in Perceptrum.

## Platform matrix

| Surface / recommendation target | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Qual Hardware desktop | supported | out of scope | out of scope |
| Perceptrum computer workload being sized | supported | opt-in, port + benchmark required | user-observed on ASUS; matching build + benchmark required |
| Planned Perceptrum rack workload being sized | conditional | not applicable | matching server build + benchmark required |
| Active benchmark runner | planned/matching runtime | planned/matching runtime | planned/matching runtime |

## Data flow

1. A consultant defines camera groups and one or more agents per group.
2. The engine normalizes the scenario against the versioned Perceptrum workload contract.
3. Demand is calculated for CPU, RAM, GPU compute, VRAM, decoder capacity, LAN and Internet. Disk metrics remain observable in benchmarks, but storage capacity and throughput do not participate in node sizing.
4. Candidate hardware nodes are filtered by platform and runtime compatibility and evaluated with multidimensional compute/network allocation. Laptops and mini PCs compete for small CPU-decode/remote-model loads. Apple is opt-in; integrated/shared memory is never counted as dedicated NVIDIA VRAM. Every BOM still includes a modest NVMe workspace for the operating system and temporary inference files.
5. The service emits minimum, recommended and N+1 designs, each with balanced, lower-CAPEX and expansion alternatives.
6. A one-time benchmark manifest can be exported. The isolated Windows runner executes it locally and returns aggregate metrics.

## Security model

There is no application login because there is no hosted surface. Public or LAN exposure is unsupported and no deployment artifacts are shipped.

The Windows desktop binds its internal API to a random loopback-only port and closes it with the application. Its renderer is sandboxed and has no Node.js integration. Catalog snapshots are verified with an Ed25519 public key before transactionally replacing the local SQLite catalog. The desktop database lives in the Windows user profile and survives application restarts.
