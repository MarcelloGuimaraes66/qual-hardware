# Implementation — GitHub desktop catalog integration

Status: implementation complete; native release gates remain separate.

- Merged the pinned GitHub commit into the isolated cross-platform branch.
- Preserved Node 24, native three-platform builder configuration and hardened Electron runtime.
- Adopted desktop-only scripts and removed the specifically authorized hosted/Docker surfaces.
- Added ASAR exclusions for stale standalone server and worker outputs.
- Extended packaged smoke coverage for the 14-item catalog, Apple Silicon, reconciled costs and JSON 2.2.
- Added explicit legacy scenario defaults and compatibility regression.
- Reconciled real-quote component allocation to the quoted project total after currency rounding, with a dedicated regression.
- Updated current documentation to remove hosted service, Docker, reverse-proxy and continuous-worker operation while retaining explicit catalog collection/signing utilities.
- Preserved the SQLite schema, Electron application identity, native `userData` resolution and all desktop runtime protections from `9b610bd`.
