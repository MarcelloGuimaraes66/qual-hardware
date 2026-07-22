# Implementation — Runtime intake provenance v2

## Executed

- Versioned intake/template to 2.0.0 and added an explicit v1 provenance error.
- Generated exact source-package rows for all targets: eight on macOS/Linux and nine on Windows.
- Validated exact package inventory, duplicates, SHA-256, size, symlinks and companion-group bindings before installation.
- Verified direct-file models against the lock and first-party binaries against pre-pinned manifest hashes.
- Persisted compact package hashes/sizes and companion mappings in the candidate manifest; no local path or large source archive is copied.
- Preserved atomic staging, backups, reserve checks, offline policy and commercial manifest approval gate.

## Files and deviations

Changed provisioning/runtime schemas, CLI summary, two test files and operator guides. Added the required planning/research/spec/code/implementation/memory artifacts. The implementation expanded the original spec by persisting compact provenance metadata after review showed that apply-time verification alone was insufficient for later audit.

## Validation

- Focused runtime/provisioning: 16 tests passed.
- Full suite: 25 files / 206 tests passed.
- Typecheck and production build passed.
- Source audit: `externalSourceAccess:false`.
- Asset audit remained intentionally fail-closed.
- Telemetry probe verified reproducibly for Mach-O/PE/ELF; temporary cleanup completed with zero bytes.
- CLI templates parsed for all targets without truncation.

Hosted native CI and physical approved-asset runs remain pending for this candidate.
