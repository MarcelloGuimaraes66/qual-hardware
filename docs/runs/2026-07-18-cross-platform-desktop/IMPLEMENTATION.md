# Implementation — cross-platform desktop

## Runtime

- Added pure helpers for resource/data paths, platform close policy, URL validation and idempotent shutdown.
- Added single-instance focus, native lifecycle, native startup error, Windows AppUserModelId and minimal macOS menu.
- Preserved loopback/random-port hosting and hardened the renderer with CSP, permission denial and navigation control.

## Packaging

- Centralized `electron-builder` configuration with Windows portable x64, macOS DMG arm64, Linux AppImage/DEB x64 and ASAR resources.
- Standardized Node.js 24 for development, CI and the server container while retaining Electron 43.1.1.
- Added deterministic AQ icon sources/outputs in SVG, PNG, ICO and ICNS formats.
- Added native package, unpacked package and packaged-smoke commands.

## Delivery

- Added pull-request native matrix with packaged smoke and Linux Xvfb.
- Added tag matrix with draft Release consolidation and SHA-256 inventory.
- Updated platform, database, validation and benchmark-boundary documentation.
