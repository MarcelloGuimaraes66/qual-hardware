# Planning — cross-platform desktop

Risk: T3.

## Control points

- **Facts:** the macOS arm64 baseline was operational; Windows packaging existed; Linux packaging did not.
- **Blast radius:** desktop lifecycle/security, builder configuration, packaged smoke validation, native CI/release and operator documentation.
- **Change budget:** desktop entry point plus one helper; build metadata/assets; one smoke runner; two workflows; tests and documentation.
- **Excluded:** engine, HTTP API, reports, domain contracts, database schema and benchmark runner implementation.
- **Validation:** current tests, new helper tests, typecheck/build, native unpacked package smoke, native final package, standalone server and Docker regression.
- **Rollback:** revert this branch/PR. No database rollback or cleanup is required because schema and data location are unchanged.

## Sequence

1. Isolate from `main` in `archon/refactor-cross-platform-desktop`.
2. Extract testable desktop policy and harden lifecycle/security.
3. Move builder configuration to YAML and add brand assets.
4. Add packaged smoke and native workflows.
5. Update operating and architecture documentation.
6. Validate locally on macOS and defer native Windows/Linux evidence to their runners and real-machine gates.

Archon `archon-refactor-safely` created the isolated branch/worktree, but the hosted workflow stopped at impact analysis because its external credit balance was unavailable. Execution continued manually in the Archon worktree while preserving the workflow controls above.
