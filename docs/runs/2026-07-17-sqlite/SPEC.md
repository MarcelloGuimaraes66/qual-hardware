# Specification

- Database filename must be exactly `qual-hardware.sqlite`.
- Desktop path: `%APPDATA%\@aiquimist\qual-hardware\qual-hardware.sqlite`.
- Development default: `data/qual-hardware.sqlite`.
- Schema v1 persists scenarios, recommendations, benchmarks, hardware, prices and work queue.
- Catalog replacement is atomic. No media, RTSP URL or credential field is introduced.
- A newer unknown schema version must fail closed.
