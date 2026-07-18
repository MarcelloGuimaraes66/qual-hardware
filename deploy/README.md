# Private deployment boundary

This service has no end-user login and therefore must never be publicly reachable. The reference Compose file binds the application to loopback only. Terminate TLS in the private reverse proxy and restrict it to the actual Aiquimist VPN/firewall ranges before enabling access.

Required secrets belong in the host secret store or a protected `.env`, never in source control:

- `POSTGRES_PASSWORD`
- `ADMIN_TOKEN`
- `PUBLIC_BASE_URL` (private HTTPS origin)

The Compose stack provisions a dedicated PostgreSQL database and role named `qual_hardware`, an isolated `qual_hardware` SQL schema, and the `qual_hardware_database` volume. Do not point `DATABASE_URL` at any Perceptrum database or reuse a Perceptrum deployment host process. Qual Hardware is deployed as a separate private service and is never copied into Perceptrum installation artifacts.

Run the price worker only from the administration network. Schedule `POST /api/internal/catalog/collect` daily with `X-Admin-Token`, or enqueue the same job from an approved internal scheduler. Source hosts must be explicitly listed in `PRICE_ALLOWLIST`; disabled or quotation-only sources remain “quotation required.”

Reports are written to the private `qual_hardware_reports` volume. Back up PostgreSQL and the report volume according to Aiquimist's internal retention policy.

This project intentionally contains no Drakon target, port `4999`, or retired PM2 service operation. Provision a new private hostname and host for it.
