# Qual Hardware desktop on Windows, macOS and Ubuntu

## Support contract

The repository has one source tree, `package-lock.json` and build command for Windows 11 x64, macOS 26 Apple Silicon and Ubuntu 24.04 x64. Use Node.js 24 LTS and npm from that installation.

```sh
npm ci
npm run desktop:package
```

Build each platform on its native operating system. The project intentionally does not cross-compile all release packages from one machine.

## Outputs

| System | Package | Output |
| --- | --- | --- |
| Windows 11 x64 | Portable executable | `release/Qual-Hardware-${version}-windows-x64-portable.exe` |
| macOS 26 arm64 | Disk image | `release/Qual-Hardware-${version}-macos-arm64.dmg` |
| Ubuntu 24.04 x64 | AppImage | `release/Qual-Hardware-${version}-linux-x64.AppImage` |
| Ubuntu 24.04 x64 | Debian package | `release/qual-hardware_${version}_amd64.deb` |

`desktop:package:dir` produces an unpacked application for automated validation. `desktop:smoke` opens that application with a temporary user directory and proves its runtime, 21-item catalog, Windows/Ubuntu/macOS recommendation targets, API, calculations, reports, single-instance protection and persistence.

## Installation and first launch

### Windows 11

Copy and run the portable `.exe`. Because it is unsigned, Windows SmartScreen may require the internal-user confirmation flow. Do not distribute it as a Perceptrum component.

### macOS 26

Open the DMG, copy **Qual Hardware** to Applications and use the organization's approved first-open flow for an unsigned internal application. Closing the last window keeps the application in the Dock; click the Dock icon to recreate the window and use `Cmd+Q` to quit completely.

### Ubuntu 24.04

Either mark the AppImage executable and launch it, or install the `.deb` with the system package tool. Validate both formats in GNOME/Wayland; CI provides an additional Xvfb/X11 smoke test.

## Runtime and data

The packaged application contains Electron and does not use a separately installed Node.js. It starts Hono on an operating-system-assigned port bound only to `127.0.0.1`. The renderer is sandboxed and can reach only the application origin. A single-instance lock prevents two applications from concurrently owning SQLite.

Qual Hardware is exclusively desktop: it has no standalone server, Docker image or hosted deployment. The operating system chosen in a scenario is the target for the planned Perceptrum machine and is independent from the operating system running the calculator.

The database filename remains `qual-hardware.sqlite` under Electron's native `userData` directory:

- Windows: `%APPDATA%\Qual Hardware\qual-hardware.sqlite` (expected; confirm against the current portable before merge).
- macOS: `~/Library/Application Support/Qual Hardware/qual-hardware.sqlite`.
- Ubuntu: `~/.config/Qual Hardware/qual-hardware.sqlite`.

No build or launch flow migrates, copies or removes an existing database. Back up only while Qual Hardware is fully closed.

## Validation commands

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run desktop:package:dir
npm run desktop:smoke
npm run desktop:package
```

On Ubuntu, use `xvfb-run --auto-servernum npm run desktop:smoke` in headless environments. GitHub Actions executes the native matrix for every pull request. Tags named `v*` create four release files plus `SHA256SUMS` in a draft GitHub Release; a person publishes the draft only after the three manual checklists pass.

## Manual release checklist

### Windows 11 x64

- Compare the data path printed by the current portable and the candidate; any difference blocks merge.
- Open the portable, inspect all 21 bundled catalog entries, calculate Windows and macOS target scenarios, import signed catalog/evidence snapshots, export PDF/XLSX/JSON and restart.
- Confirm persisted data, single-instance focus behavior and complete exit after closing the window.

### macOS 26 arm64

- Mount the DMG, copy the app to Applications and complete the unsigned first-open flow.
- Validate Dock activation, last-window close, recreation and `Cmd+Q`.
- Validate the Apple Silicon opt-in, exact-existing-hardware flow, three differentiated proposals and reconciled component costs.
- Import a catalog, download all reports, restart and confirm persistence.

### Ubuntu 24.04 x64

- Run the AppImage and install the DEB in GNOME/Wayland.
- Validate menu integration, window lifecycle, the ASUS exact-hardware flow, catalog import, all exports, persistence and exit.

For all systems, verify that only loopback is listening, the package runs without user-installed Node.js, the expected icon appears, all current tests pass and no existing database is changed or removed.

## Troubleshooting

- **SmartScreen or Gatekeeper warning:** expected for the accepted unsigned internal distribution. Do not bypass organizational policy.
- **Application opens but no window appears on macOS:** click the Dock icon; the application remains active after its last window closes.
- **Second launch does not open another window:** the existing instance should be restored and focused by design.
- **Smoke test cannot find the package:** run `npm run desktop:package:dir` on the same native platform first.
- **Ubuntu has no display in CI:** run the smoke command under Xvfb; still complete the separate GNOME/Wayland check.
- **Database path differs on Windows:** stop the release. Do not copy or move the database automatically; restore path compatibility in code/configuration.

## Local calibration

The same `.qhplan.json`/`.qhcal.json` protocol works with the native Perceptrum
desktop on macOS, Windows and Ubuntu. The runner packages MediaMTX, FFmpeg and
ffprobe, uses the local AiQ/Qwen service and accepts loopback only. macOS is
homologated in this run; Windows and Ubuntu remain subject to native CI plus
future physical validation. The old PowerShell benchmark is retained only as a
legacy laboratory path.
