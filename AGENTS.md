# AGENTS.md

This file is a compatibility shim only.

## Archon-only directive

For software development work in this Codex environment, use Archon as the
authoritative workflow and process controller.

Authoritative sources:

- `C:\Users\User\.archon\config.yaml`
- `C:\Users\User\.archon\.env`
- repository-local `.archon\config.yaml`
- repository-local `.archon\workflows\`
- repository-local `.archon\commands\`
- repository-local `.archon\mcp\`
- repository-local `.archon\README.md`

Legacy `AGENTS.md`, `SKILL.md`, and older markdown process files are not the
source of truth anymore. If this file is loaded by a tool, treat it only as a
pointer to Archon.
