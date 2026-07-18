# Validation — GitHub desktop catalog integration

Status: local implementation validated on macOS 26 arm64; Windows and Ubuntu native release gates pending.

Evidence:

- `origin/main` was rechecked immediately before finalization and still resolved to the approved `e4e038cafd10ab0fb0e64fbe8ff84ac51d47673e`.
- Node `24.18.0` and npm `11.9.0`: `npm ci` installed 462 packages with zero audit vulnerabilities.
- Typecheck passed for renderer and server configurations.
- Vitest passed 6 files and 40 tests, including legacy scenarios, partial catalog restoration, unchanged schema boundary, exact ASUS, explicit Apple selection, differentiated hardware and exact component/total reconciliation for reference estimates and market quotes.
- Vite/TypeScript build passed; the final package was rebuilt with Node 24 after the last engine change.
- Packaged smoke passed on `darwin/arm64`: loopback-only origin, rendered UI, CSP/navigation protection, bundled catalog with 14 items and four Macs, exact ASUS presence, three distinct proposals, explicit macOS scenario, JSON 2.2/PDF/XLSX, SQLite persistence, second-instance protection and forbidden standalone server/worker ASAR entries.
- Final DMG: `release/Qual-Hardware-0.1.0-macos-arm64.dmg`, 134,371,203 bytes, SHA-256 `39201d3ae0ad1f6f2a92ba58da47ee22e2ed210f2bc68a39dd5a55274fd04b25`; `hdiutil verify` passed.
- The read-only mounted DMG launched without external Node, returned `{"status":"ok","storage":"sqlite"}` from its random `127.0.0.1` origin, wrote only to an isolated temporary `userData` directory and exited through the native macOS quit event.
- The packaged executable is Mach-O arm64 with bundle identifier `ai.aiquimist.qualhardware` and product name `Qual Hardware`.
- `database/sqlite-schema.sql`, the Electron entry point and desktop runtime helpers have no integration diff from `9b610bd`.

Release gates not executable on this Mac remain mandatory: Windows 11 x64 CI/manual validation including equality with the existing portable's real `userData` path; Ubuntu 24.04 x64 CI/Xvfb plus AppImage/DEB GNOME/Wayland validation; and human macOS confirmation of the visible Dock, close/reopen and `Cmd+Q` interaction. No release should be published before those gates pass.
