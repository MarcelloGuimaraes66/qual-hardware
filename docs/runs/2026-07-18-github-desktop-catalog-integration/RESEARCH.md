# Research — GitHub desktop catalog integration

Date: 2026-07-18

- Local cross-platform refactor: `9b610bd` from base `2fc55ab`.
- Approved GitHub change: `e4e038c`, one commit ahead of that base.
- The GitHub change passed dependency installation, typecheck and 33 tests in an isolated snapshot before integration.
- Its functional additions affect catalog, capacity selection, public types, UI and all report formats; it does not change the SQLite schema or Electron entry point.
- Direct overlap with the local refactor was limited to packaging, Docker/desktop-only policy and current documentation.
- `origin/main` was verified as `e4e038c` immediately before execution.
