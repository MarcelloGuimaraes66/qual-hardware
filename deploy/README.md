# Private deployment boundary

This service has no end-user login and therefore must never be publicly reachable. The reference Compose file binds the application to loopback only. Terminate TLS in the private reverse proxy and restrict it to the actual Aiquimist VPN/firewall ranges before enabling access.

Required secrets belong in the host secret store or a protected `.env`, never in source control:

- `ADMIN_TOKEN`
- `PUBLIC_BASE_URL` (private HTTPS origin)

The Compose stack persists the dedicated `/data/qual-hardware.sqlite` file in the `qual_hardware_data` volume. It is intended for API and worker processes on the same Docker host; do not place SQLite on a shared network filesystem. Qual Hardware is a separate private service and is never copied into Perceptrum installation artifacts.

Run the price worker only from the administration network. Schedule `POST /api/internal/catalog/collect` daily with `X-Admin-Token`, or enqueue the same job from an approved internal scheduler. Source hosts must be explicitly listed in `PRICE_ALLOWLIST`; disabled or quotation-only sources remain “quotation required.”

Reports and `qual-hardware.sqlite` are written to the private `qual_hardware_data` volume. Stop the API and worker before a file-level backup, then copy the SQLite file and reports according to Aiquimist's internal retention policy.

This project intentionally contains no Drakon target, port `4999`, or retired PM2 service operation. Provision a new private hostname and host for it.
