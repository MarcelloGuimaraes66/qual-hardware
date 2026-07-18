# Validation — cross-platform desktop

Status: local macOS implementation gate passed; native Windows/Ubuntu and three-system manual gates pending.

## Executed evidence

- Host: macOS 26 arm64.
- Node: `24.18.0` through the Node 24 validation environment.
- `npm ci`: 462 packages installed from the lockfile on Node 24, audit with 0 vulnerabilities; a subsequent dry run reported it up to date.
- Typecheck: passed for application and server configurations.
- Tests: 6 files and 34 tests passed, including desktop path, lifecycle, URL and shutdown policies.
- Build: Vite renderer and TypeScript server/desktop output passed.
- Unpacked package: Electron `43.1.1`, macOS arm64, ASAR enabled, unsigned by explicit configuration.
- Packaged smoke: passed against the real arm64 executable with a temporary `userData` directory.
- Smoke coverage: Mach-O arm64, required ASAR content, rendered React UI, blocked non-loopback navigation, loopback API, health, bundled catalog, SQLite, scenario calculation, PDF/XLSX/JSON signatures, second-launch behavior and persistence across restart.
- Final DMG: `release/Qual-Hardware-0.1.0-macos-arm64.dmg`, verified by `hdiutil`; SHA-256 `b94ac1154b29ac3ef51c65ff30796fcda01465a0d6864fb22326e8651bb7e37c`.
- Auto-update metadata: `dmg.writeUpdateInfo: false` verified by a package run that did not create or modify a blockmap.
- Standalone API: `/api/health` returned `{"status":"ok","storage":"sqlite"}` on Node 24 and the generated SQLite file reported schema user version 1.
- Configuration syntax: both GitHub workflows and `electron-builder.yml` parsed successfully as YAML.
- Source hygiene: `git diff --check` passed; generated `dist`, `release` and dependency files remain ignored.

## Environment limitation and remaining gates

The local Docker client has no available daemon, so Docker build/health could not be executed on this host. The Ubuntu CI job builds the Node 24 image, waits for its declared health check and calls `/api/health`.

Windows 11 x64 and Ubuntu 24.04 x64 native package evidence remains a required CI/manual gate and cannot be represented as locally executed evidence from this macOS host. The Windows old/new `app.getPath("userData")` comparison and Ubuntu GNOME/Wayland AppImage/DEB checks remain merge/release blockers.
