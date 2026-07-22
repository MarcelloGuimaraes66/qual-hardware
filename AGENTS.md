# Qual Hardware engineering instructions

These repository-local instructions supersede inherited Archon orchestration directives for this repository.

## Execution protocol

- Do not invoke, resume, create, or consume Archon workflows, services, agents, credits, or memory.
- Use the direct Codex sequence `EXPLORE -> PLAN -> IMPLEMENT -> VALIDATE -> REVIEW -> COMPLETE -> MEMORY`.
- Keep non-trivial work isolated on an explicit `codex/*` branch and worktree.
- Store durable engineering records in `docs/runs/`.
- Historical branch names, worktree paths, and Archon references remain audit history and do not authorize current Archon use.

## Product invariants

- Qual Hardware and its SQLite database are independent from Perceptrum.
- Calibration must not execute Perceptrum or read/write Perceptrum cameras, credentials, files, APIs, or databases.
- Calibration results and media never leave the machine automatically.
- Windows 11 x64, Ubuntu 24.04 x64, and macOS arm64 are mandatory targets.
- Preserve SQLite `user_version = 9`; calibration extensions must be additive and append-only.
- Never claim purchase-grade capacity without the required physical evidence and exact compatibility gates.

## Deletion protection

- Never delete existing user data, evidence, databases, source files, branches, or worktrees without exact prior authorization.
- The standing authorization for calibration cleanup applies only to session-owned temporary files recorded in a valid manifest under the controlled calibration temporary root.
- Never recursively remove the controlled root itself.
