# qa-workflow/ — QA Process (independent build, plugin-aligned)

> **Status:** scaffold (structure only; skills/workflows are stubs pending implementation).
> **Design authority:** [`../docs/ai/architecture/adr-001-qa-workflow-independent-plugin-aligned.md`](../docs/ai/architecture/adr-001-qa-workflow-independent-plugin-aligned.md)
> **Reuse contract:** [`../docs/ai/architecture/qa-artifact-contract.md`](../docs/ai/architecture/qa-artifact-contract.md) · schema [`../docs/ai/architecture/qa-state.schema.json`](../docs/ai/architecture/qa-state.schema.json)
> **Methodology (source of truth):** [`../docs/ai/QA_PROCESS.md`](../docs/ai/QA_PROCESS.md) — skills here are **thin wrappers** that reference it, never re-inline it.

This tree is the independent QA workflow, built today and shaped to migrate into the
**breadfast-workflow** plugin with moves (not rewrites) when the plugin matures.

## Layout → plugin migration target

| Dir | Purpose | Migrates to |
|---|---|---|
| `workflows/` | the two QA workflows (shift-left, implementation-validation) + `qa-full` (composes both) | plugin `workflows/` |
| `skills/` | phase procedures = **task skills** (thin, ref `docs/ai/**`) | plugin task skills |
| `domains/` | business-domain **knowledge skills** (wrap `docs/ai/business/**`); *consumed* by QA | plugin `domains/` |
| `templates/` | task/knowledge skill templates (mirror plugin) | realign to plugin `templates/` |
| `registry/` | `domains.yaml` — domains + skill/workflow index | plugin `registry/` |
| `lib/freshness/` | fingerprint + invalidate engine (drift-shaped) | plugin `drift` internals |
| `lib/schema/` | `qa-state` + skill-frontmatter validators | plugin `lib/schema/` |

## Two seams that keep coupling at zero
- **`lock` → `version:` field** in each skill's frontmatter (bump forces targeted artifact regen).
- **`host-emitter` → thin CLAUDE.md** (authored by hand now; generated later).

## Runnable entrypoints
Claude Code entrypoints under `.claude/` point into this tree (the only Claude-Code-specific glue,
discarded on migration). Wiring is done in the implementation phase.
