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

## Where the work splits (updated 2026-08-09)

```
qa-shift-left  ── establish the coverage baseline ────────────────────────────────────┐
  requirements → figma → clarification GATE → impact → [exploratory analysis] → HLS   │
  → test cases → REVIEW + APPROVAL GATE → BrowserStack import                         │
                                                                                      ▼
                                                                              development
                                                                                      │
qa-validate  ── reconcile & maintain that baseline ◄──────────────────────────────────┘
  reconcile (8 baseline keys) → exploratory testing → test-case reconciliation
  → re-review + re-approve → BrowserStack sync → automation → execution
  → visual → defects → QA summary
```

**Shift left = establish the initial QA coverage baseline. Validate = reconcile and maintain it
against the implemented product.** `qa-full` runs both in one pass and is contract-identical to the pair.

Two gates on that path are mechanical, not advisory (`qa-cli.js`): `browserstack-import` cannot be
recorded until `testcase-review` is `complete` **and** an operator approval exists, and `complete-check`
fails a run whose **approved** suite changed with no `testcase-reconciliation` recorded. Reviewing is the
agent's job; approving is the operator's.

```
node qa-workflow/bin/qa-cli.js status         "<storyDir>"                        # where is this story?
node qa-workflow/bin/qa-cli.js testcase-lint  "<storyDir>" --acs-from <reqs.md>   # mechanical review checks
node qa-workflow/bin/qa-cli.js approve        "<storyDir>" testcases --by "<operator>"
node qa-workflow/bin/qa-cli.js complete-check "<storyDir>" --profile shift-left   # W1 done?
node qa-workflow/bin/qa-cli.js complete-check "<storyDir>" --profile validate     # W2 / full done?
```

`status` reports and never gates (exit 0); `testcase-lint` and `complete-check` gate (exit 1).
`reconcile` honours the **`lock` seam**: an artifact produced by a superseded skill `version:` — or one
consuming a bumped business domain — comes back stale (contract §5 rules d/e, wired 2026-08-09).

## Two seams that keep coupling at zero
- **`lock` → `version:` field** in each skill's frontmatter (bump forces targeted artifact regen).
- **`host-emitter` → thin CLAUDE.md** (authored by hand now; generated later).

## Runnable entrypoints
Claude Code entrypoints under `.claude/` point into this tree (the only Claude-Code-specific glue,
discarded on migration). Wiring is done in the implementation phase.
