# Code record

- Added `SqlitePlannerStore` using the built-in `node:sqlite` API.
- Added versioned strict schema `database/sqlite-schema.sql`.
- Desktop selects its stable Windows profile path before opening the store.
- API health reports the active store instead of guessing from an environment variable.
- Removed `pg` and `@types/pg`; Electron packaging now includes the SQLite schema.
- Compose uses one local data volume shared by API and worker on the same host.
