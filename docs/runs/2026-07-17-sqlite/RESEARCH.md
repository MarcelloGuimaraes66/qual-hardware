# Research

- Electron 43 embeds Node 24.18 and successfully loaded `node:sqlite`/`DatabaseSync` locally.
- Built-in SQLite avoids native addon rebuilds and keeps the portable executable self-contained.
- WAL plus `busy_timeout` supports the API and worker on one host. SMB/NFS and multi-host access remain unsupported.
- The desktop `userData` directory provides a stable per-user location outside the temporary portable extraction directory.
