# Memory — GitHub desktop catalog integration

Status: local integration complete and validated on macOS; native Windows/Ubuntu release gates pending.

- Source refactor: `9b610bd`.
- Integrated GitHub commit: `e4e038c`.
- Branch target: `archon/integrate-github-desktop-catalog`.
- Official calculator desktops remain Windows, macOS and Ubuntu.
- Recommendation target OS is independent from the calculator host OS.
- Product is desktop-only; catalog collection/signing remain explicit publisher utilities, not a hosted service.
- Never move or recreate an existing `qual-hardware.sqlite` to make a test pass.
- Local evidence: Node 24.18.0, 40 tests, final packaged smoke, mounted-DMG launch and native macOS quit passed.
- Final macOS artifact SHA-256: `39201d3ae0ad1f6f2a92ba58da47ee22e2ed210f2bc68a39dd5a55274fd04b25`.
- Release remains blocked until Windows confirms the existing portable's exact `userData` path and Windows/Ubuntu native CI plus manual checks pass.
- Archon created the isolated worktree; its hosted impact analysis could not continue because the external account had insufficient credits, so execution followed the same T4 controls manually and preserved this run record.
