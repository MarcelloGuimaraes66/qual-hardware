# Memory — cross-platform desktop

Status: implementation complete and locally validated; ready for native CI and manual homologation.

Continuity facts:

- Worktree: `/Users/marcellogmfreire/.archon/workspaces/Documents/qual-hardware/worktrees/archon/task-archon-refactor-cross-platform-desktop`
- Branch: `archon/refactor-cross-platform-desktop`
- Base: `main` at `2fc55ab`
- Scope remains T3 desktop/runtime/distribution only.
- Do not publish a release until native CI is green and all three real-machine checklists pass.
- Windows merge is blocked until old/new `app.getPath("userData")` equality is proven.
- Future work: T4 benchmark runners for macOS/Linux, conditional on native Perceptrum executable contracts.

Validation continuity:

- Node 24 typecheck/build and all 34 tests passed.
- The final macOS arm64 package and DMG passed the packaged smoke, persistence and artifact checks.
- Standalone API regression passed; local Docker validation was unavailable and is enforced in Ubuntu CI.
- No API, engine, report, shared contract or database schema file changed.
- Do not claim Windows/Linux runtime completion until their native matrix jobs and real-machine checklists are green.
