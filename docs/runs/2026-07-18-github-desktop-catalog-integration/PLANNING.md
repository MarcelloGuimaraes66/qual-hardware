# Planning — GitHub desktop catalog integration

Risk: T4 because recommendation selection, cost outputs and desktop distribution change together.

- **Isolation:** third Archon worktree and branch from the validated cross-platform commit; neither existing worktree is modified.
- **Invariants:** app identity, SQLite schema/filename/location, loopback binding, Electron sandbox, HTTP routes and benchmark boundary.
- **Blast radius:** catalog/types, capacity engine, reports, UI, desktop packaging, CI and current documentation.
- **Change budget:** merge only `e4e038c`, resolve known desktop-only conflicts, extend smoke/compatibility tests and create this run record.
- **Authorized removal:** `.dockerignore`, `Dockerfile`, `docker-compose.yml`, `deploy/README.md`, `deploy/nginx.qual-hardware.conf.example` and `src/server/index.ts`; all recoverable from Git history.
- **Rollback:** revert the integration commit or abandon this isolated branch; no database rollback exists or is needed.

Archon created the required worktree but its hosted analysis stopped for insufficient external credits. Execution continued manually under the same T4 controls.
