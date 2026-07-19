# Research — cross-platform desktop

Date: 2026-07-18

## Verified baseline

- The desktop entry point embeds the existing Hono application and chooses a random `127.0.0.1` port.
- Persistence already uses built-in `node:sqlite`; no native npm SQLite addon is present.
- The packaged database path is derived from Electron `userData` and the filename is enforced as `qual-hardware.sqlite`.
- Electron is pinned by the lockfile at `43.1.1`.
- Before this refactor, the builder configuration exposed only a Windows x64 portable target.
- The React renderer uses ordinary Chromium downloads/file selection and needs no platform-specific IPC.
- The PowerShell benchmark runner depends on a Windows Perceptrum executable and remains outside the portable desktop runtime.

## Environment evidence

The pre-change macOS 26 arm64 baseline completed dependency installation, typecheck, 28 tests, web/server build, arm64 Electron packaging and a real packaged launch with API, catalog and SQLite. Windows and Ubuntu require their native GitHub-hosted runners and final real-machine checklists.

## Constraints

- One source tree and npm lockfile.
- Native packaging on each target OS; no promise of three-platform cross-compilation on one host.
- No database migration, HTTP contract, calculation, report or schema changes.
- Unsigned internal packages and manual GitHub Release publication.
