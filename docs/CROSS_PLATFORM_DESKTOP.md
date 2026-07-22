# Qual Hardware desktop on Windows, macOS and Ubuntu

## Support contract

The repository has one source tree, `package-lock.json` and build command for Windows 11 x64, macOS 26 Apple Silicon and Ubuntu 24.04 x64. Use Node.js `24.18.0` and npm `11.16.0`.

```sh
npm ci
npm run desktop:package
```

Build each platform on its native operating system. The project intentionally does not cross-compile all release packages from one machine.

On Windows, the project-scoped launcher first honors an existing `QUAL_HARDWARE_NODE_HOME`, otherwise it provisions the exact official portable Node runtime into `QUAL_HARDWARE_TOOLS_DIR`, `.tools`, or `C:\dev\tools` without changing the machine-global Node installation:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\qual-hardware.ps1 setup
powershell -ExecutionPolicy Bypass -File .\scripts\qual-hardware.ps1 check
```

## Outputs

| System | Package | Output |
| --- | --- | --- |
| Windows 11 x64 | Portable executable | `release/Qual-Hardware-${version}-windows-x64-portable.exe` |
| macOS 26 arm64 | Disk image | `release/Qual-Hardware-${version}-macos-arm64.dmg` |
| Ubuntu 24.04 x64 | AppImage | `release/Qual-Hardware-${version}-linux-x64.AppImage` |
| Ubuntu 24.04 x64 | Debian package | `release/qual-hardware_${version}_amd64.deb` |

`desktop:package:dir` produces an unpacked application for automated validation. `desktop:smoke` opens that application with a temporary user directory and proves its runtime, official automatic catalog channel, 39-source registry, 21-item fallback catalog, Windows/Ubuntu/macOS recommendation targets, API, calculations, reports, single-instance protection and persistence. On Windows, `QUAL_HARDWARE_SMOKE_PORTABLE=1` additionally launches the real portable wrapper with temporary user data.

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

All packages use the same public `catalog-*` GitHub Releases. They check automatically at startup and every 24 hours, download nothing when the ETag is unchanged and preserve the active snapshot after any network, schema, checksum, signature, sequence or database failure. Collection and Qwen never execute on the user's computer.

The database filename remains `qual-hardware.sqlite` under Electron's native `userData` directory:

- Windows: `%APPDATA%\@aiquimist\qual-hardware\qual-hardware.sqlite` (confirmed with the packaged 0.2.0 application and restart validation).
- macOS: `~/Library/Application Support/@aiquimist/qual-hardware/qual-hardware.sqlite` (confirmed by the final packaged app).
- Ubuntu: `~/.config/@aiquimist/qual-hardware/qual-hardware.sqlite` (expected from the same package name; confirm on the native package).

Opening a persistent v1-v8 database migrates it additively to v9 only after SQLite creates a consistent `schema-backups/qual-hardware-pre-v9-*.sqlite` copy. The application never deletes or relocates the database. Back up only while Qual Hardware is fully closed; an older executable must use the preserved pre-v9 copy rather than open the migrated file.

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
- Open the portable, confirm the automatic-channel status and source health, inspect the active catalog, calculate Windows and macOS target scenarios, export PDF/XLSX/JSON and restart.
- Confirm persisted data, single-instance focus behavior and complete exit after closing the window.

### macOS 26 arm64

- Mount the DMG, copy the app to Applications and complete the unsigned first-open flow.
- Validate Dock activation, last-window close, recreation and `Cmd+Q`.
- Validate the Apple Silicon opt-in, exact-existing-hardware flow, three differentiated proposals and reconciled component costs.
- Verify the official catalog automatically, download all reports, restart and confirm publication/project persistence.

### Ubuntu 24.04 x64

- Run the AppImage and install the DEB in GNOME/Wayland.
- Validate menu integration, window lifecycle, the ASUS exact-hardware flow, automatic catalog status, all exports, persistence and exit.

For all systems, verify that only loopback is listening, the package runs without user-installed Node.js, the expected icon appears, all current tests pass and no existing database is changed or removed.

## Troubleshooting

- **SmartScreen or Gatekeeper warning:** expected for the accepted unsigned internal distribution. Do not bypass organizational policy.
- **Application opens but no window appears on macOS:** click the Dock icon; the application remains active after its last window closes.
- **Second launch does not open another window:** the existing instance should be restored and focused by design.
- **Smoke test cannot find the package:** run `npm run desktop:package:dir` on the same native platform first.
- **Ubuntu has no display in CI:** run the smoke command under Xvfb; still complete the separate GNOME/Wayland check.
- **Database path differs on Windows:** stop the release. Do not copy or move the database automatically; restore path compatibility in code/configuration.

## Local calibration

The permanent **Capacity calibration** area uses the same authenticated handoff
on macOS, Windows and Ubuntu. It opens `perceptrum://calibration/run`, but the
URI carries only the handoff version, loopback Qual Hardware origin, session
UUID and a one-time 256-bit nonce. Perceptrum must first claim the session over
loopback, then fetch control/plan data, show live progress and automatically
import the result after saving it append-only under the operating system's real
Documents folder at `Qual Hardware/Calibracoes`. `.qhplan.json` and manual
`.qhcal.json` import remain recovery paths.

The Windows protocol/control-plane adapter is packaged and smoke-tested, but its
current runner is readiness/diagnostic-only. It exposes unavailable measurements
as `null` with a reason and never turns executable discovery into capacity. Its
`developmentOnly` and partial artifacts are rejected by Qual Hardware. The
10/60-minute production gate remains blocked until pinned MediaMTX, ffprobe,
FFmpeg and AiQ/Qwen payloads (architecture, license and SHA-256) are bundled and
the real fifteen-stage pipeline is physically validated. macOS and Ubuntu retain
their contract tests but have not received physical homologation in this run.

While a run is active, **Stop and keep partial data** requests a protected
loopback cancellation. Perceptrum signals its isolated child and saves
an append-only `-interrompido.partial.json` diagnostic before confirming the
stop. Partial files are never imported as capacity anchors and never justify a
purchase; only a new completed run can do that.
