# Specification — cross-platform desktop

## Target

Support Windows 11 x64, macOS 26 arm64 and Ubuntu 24.04 x64 with `npm ci && npm run desktop:package` on the native target. Produce one portable EXE, one DMG, one AppImage and one DEB with stable names.

## Invariants

- Preserve `ai.aiquimist.qualhardware`, `Qual Hardware` and `qual-hardware.sqlite`.
- Preserve random loopback binding, sandboxing, context isolation and renderer Node.js denial.
- Preserve HTTP, shared schema, sizing, reporting and SQLite behavior.
- Preserve existing Windows data by retaining the Electron application identity; an actual old/new path comparison is a merge gate.
- Never move, copy, delete or recreate user data.

## Runtime acceptance

- A second launch focuses the existing instance and cannot create a second API/store owner.
- Windows/Linux quit on last-window close; macOS recreates a window on Dock activation and quits resources on `Cmd+Q`.
- Shutdown is idempotent and closes timer, server and store once.
- Startup failures have a native dialog.
- Permissions, unexpected navigation and unsafe external URL schemes are denied.

## Distribution acceptance

- Native CI packages and smokes every target.
- Tag builds consolidate checksums and packages into an unpublished draft Release.
- No update feeds or automatic publisher exist.
