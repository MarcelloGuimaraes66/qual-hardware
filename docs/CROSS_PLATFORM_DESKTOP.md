# Qual Hardware desktop on Windows, macOS and Ubuntu

## Support contract

The repository has one source tree, `package-lock.json` and build command for Windows 11 x64, macOS 26 Apple Silicon and Ubuntu 24.04 x64. Development and CI use Node.js `24.18.0`, npm `11.16.0` and Go `1.26.5`.

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

`desktop:package:dir` produces an unpacked application for automated validation. `desktop:smoke` opens the native unpacked application and, on Windows, the real portable executable with a temporary user directory. It proves the official automatic catalog channel, 22-item fallback catalog, Windows/Ubuntu/macOS recommendation targets, loopback API, reports, CSP, sandbox, single-instance protection, persistence and terminal cleanup. Its shortened synthetic calibration is explicitly non-importable and is not a physical qualification.

## Installation and first launch

### Windows 11

Copy and run the portable `.exe`. Because it is unsigned, Windows SmartScreen may require the internal-user confirmation flow. Do not distribute it as a Perceptrum component. The portable uses a private extraction directory per launch; the application lock focuses the first instance without replacing files used by it.

### macOS 26

Open the DMG, copy **Qual Hardware** to Applications and use the organization's approved first-open flow for an unsigned internal application. Closing the last window keeps the application in the Dock; click the Dock icon to recreate the window and use `Cmd+Q` to quit completely.

### Ubuntu 24.04

Either mark the AppImage executable and launch it, or install the `.deb` with the system package tool. Validate both formats in GNOME/Wayland; CI provides an additional Xvfb/X11 smoke test.

## Runtime and data

The packaged application contains Electron and does not use a separately installed Node.js. It starts Hono on an operating-system-assigned port bound only to `127.0.0.1`. The renderer is sandboxed and can reach only the application origin. A single-instance lock prevents two applications from concurrently owning SQLite. FFmpeg, MediaMTX, Qwen/llama and the telemetry probe are distributed separately in a signed target-specific `.qhruntime`; they are never stored in ASAR.

Qual Hardware is exclusively desktop: it has no standalone server, Docker image or hosted deployment. The operating system chosen in a scenario is the target for the planned Perceptrum machine and is independent from the operating system running the calculator.

All packages use the same public `catalog-*` GitHub Releases. They check automatically at startup and every 24 hours, download nothing when the ETag is unchanged and preserve the active snapshot after any network, schema, checksum, signature, sequence or database failure. Collection and Qwen never execute on the user's computer.

The database filename remains `qual-hardware.sqlite` under Electron's native `userData` directory:

- Windows: `%APPDATA%\@aiquimist\qual-hardware\qual-hardware.sqlite` (confirmed with the 0.3 unpacked and portable applications).
- macOS: `~/Library/Application Support/@aiquimist/qual-hardware/qual-hardware.sqlite` (confirmed by the final packaged app).
- Ubuntu: `~/.config/@aiquimist/qual-hardware/qual-hardware.sqlite` (expected from the same package name; confirm on the native package).

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

## Autonomous local calibration

The permanent **Calibração de capacidade** area is the only calibration runner. The operator first sizes a project, opens that area, selects the exact physical profile when available and chooses one of three modes: 10-minute diagnostic, 60-minute engineering validation or adaptive 6–7 hour qualification with sequential CPU/GPU phases and three repetitions. The application itself owns the session and never opens or modifies Perceptrum.

Install the target-specific signed package with **Instalar runtime de arquivo**. The file path stays in the Electron main process. Installation streams validation for signature, target, minimum app version, limits, duplicate names, traversal, links, expansion, space, licenses, SBOMs and every SHA-256 before atomic activation. Candidate packages run diagnostics; only production-trusted packages can make a completed v4 result commercially eligible.

The application starts the calibration worker as an isolated utility process. Its MediaMTX, FFmpeg, llama/Qwen and telemetry children are owned by the session and remain offline except for loopback traffic. Missing sensors are reported as `null` plus a reason. Results are saved append-only under the operating system's real Documents folder at `Qual Hardware/Calibracoes`; `.qhcal` and `.qhcalset` remain signed interchange formats.

While a run is active, **Interromper e limpar temporários** sends a private IPC cancellation. The app stops its workload processes, saves an append-only `-interrompido.partial.json` diagnostic, removes session-owned temporary files and only then confirms cancellation. Partial files never become capacity anchors or purchase evidence.
