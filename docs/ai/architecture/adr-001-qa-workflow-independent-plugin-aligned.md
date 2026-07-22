# ADR-001 — QA Workflow: Independent Build, Plugin-Aligned

- **Status:** Proposed (design-only; no code)
- **Date:** 2026-07-22
- **Deciders:** QA Lead (Ahmed Essam) + Claude Code
- **Supersedes:** none · **Related:** [`../QA_PROCESS.md`](../QA_PROCESS.md), [`../visual-testing/CLAUDE_CODE_OPERATOR.md`](../visual-testing/CLAUDE_CODE_OPERATOR.md), [`../../../CLAUDE.md`](../../../CLAUDE.md)

---

## 1. Context

The QA process is executed **chat-driven through Claude Code** today (the `qa-platform/` execution engine is legacy). We need to (a) split the process into a **Pre-Development (shift-left)** workflow and a **Post-Development (implementation-validation)** workflow, and (b) make Post-Dev **reuse** Pre-Dev artifacts instead of regenerating expensive analysis.

Separately, a **Breadfast Workflow Plugin** (`breadfast-workflow`) is under development. Its architecture uses these primitives:

| Plugin primitive | Purpose |
|---|---|
| `SKILL.md` | subcommand router |
| `commands/` | lifecycle: `onboard`, `onboard-domain`, `lock`, `drift` (conformance + **freshness**), `setup-mcp`, `status` |
| `templates/` | `knowledge-skill` + `task-skill` templates |
| `workflows/` | centrally-authored shared workflows (`figma-to-design`, `test-to-e2e`, …) |
| `domains/` | one knowledge skill per business domain (card, payment, marketing …) |
| `adapters/` | `host-emitter` (writes CLAUDE.md), `reanchor-hook` (re-injects domain ref on compaction) |
| `registry/` | `domains.yaml` seed |
| `lib/` | `scan` (pattern detectors), `schema` (validators) |

**The plugin is not ready for integration.** The long-term vision is that this QA process becomes **one of the plugin's workflows** once the plugin matures.

> **Assumptions (to re-verify when the plugin is available):** the plugin structure above is inferred from an architecture *diagram*, not its files. Before migration, confirm against the real `templates/task-skill.template.md` + `lib/schema` (skill shape), `commands/drift.md` (freshness engine contract), and `workflows/figma-to-design.md` + `test-to-e2e.md` (so QA *composes* them rather than overlapping). The isomorphic layout here is a best-effort target; treat template/schema shapes as provisional until verified.

## 2. Problem

How do we build the QA workflow **now**, standalone, **without** depending on the unfinished plugin — yet **without** painting ourselves into a corner that forces a rewrite when we migrate into the plugin later?

## 3. Decision

**Build an independent QA workflow today, structurally isomorphic to the plugin, and isolate the single real coupling point (host-file emission) behind a seam that is a no-op today.**

Governing principle: **structural isomorphism + dependency inversion.**
- *Isomorphism:* mirror the plugin's names, shapes, and contracts, so migration is mostly `git mv` + one schema re-validation + one adapter swap.
- *Dependency inversion:* depend on nothing the plugin hasn't shipped; keep methodology in `docs/ai/**` (stable) and let only **thin wrappers** conform to plugin-shaped templates, so a future template change is a localized edit, never a methodology rewrite.

### 3.1 Two workflows (the split)

- **Workflow 1 — Pre-Development (shift-left):** Requirements Analysis → Figma Analysis → Clarification → Impact Analysis → HLS → publish HLS checklist to Jira. Outputs are **reusable story artifacts**.
- **Workflow 2 — Post-Development (implementation-validation):** **Reconcile** (reuse Pre-Dev artifacts unless invalid) → Exploratory → Test Case Generation → BrowserStack Import → Automation → Execution → Functional + Design Bug Reporting → QA Summary.

Reuse/regeneration is governed by the **artifact contract** ([`qa-artifact-contract.md`](qa-artifact-contract.md)) and its machine schema ([`qa-state.schema.json`](qa-state.schema.json)).

### 3.2 Build-today layout (self-contained, migratable)

Methodology stays in `docs/ai/**` (source of truth); runtime helpers stay in `automation/**`. A **thin** new tree holds wrappers + contracts + engine:

```
qa-workflow/                              # today: independent · tomorrow: → breadfast-workflow/
├── workflows/  qa-shift-left.md · qa-implementation-validation.md      → plugin workflows/
├── skills/     <phase>/SKILL.md  (task skills; thin, ref docs/ai/**)   → plugin task skills
├── domains/    card|payment|marketing/SKILL.md (wrap docs/ai/business) → plugin domains/
├── templates/  task-skill · knowledge-skill (mirror plugin)            → realign to plugin templates
├── registry/   domains.yaml (domains + skill/workflow index)           → plugin registry/
└── lib/        freshness/ (drift-shaped engine) · schema/ (validators) → plugin lib/ + drift
```

Runnable Claude Code entrypoints register under `.claude/` and point into this tree (the only Claude-Code-specific glue; discarded on migration).

### 3.3 What we build now vs defer (and the seams)

| Plugin concept | Now | Rationale / seam |
|---|---|---|
| `workflows/`, task `skills/`, `domains/`, `registry/domains.yaml`, `lib/schema`, `templates/` | ✅ Build | direct 1:1 migration targets |
| `lib/freshness` (the **drift** engine core) | ✅ Build | drift-shaped; plugin `drift` absorbs it later |
| `commands/status` | ✅ Build (light) | coverage/lock-state report |
| `commands/ onboard · onboard-domain · lock · setup-mcp` | ❌ Skip | plugin-authoring lifecycle; no standalone value |
| `adapters/host-emitter` | ❌ Skip → **seam** | keep CLAUDE.md **thin**; knowledge lives in skills/domains → emitter generates it later |
| `adapters/reanchor-hook` | ❌ Skip | existing memory + session-continuity covers it |
| `lib/scan` | ❌ Skip | not needed for QA runtime |

Two seams keep coupling at zero:
- **`lock` → a `version:` field** in each skill's frontmatter. Bumping it forces targeted artifact regeneration (contract §freshness rule *e*). The plugin's `lock` later formalizes the same field.
- **`host-emitter` → thin CLAUDE.md.** Authored by hand today but orchestration-only; regenerated from skills/domains later. The swap is small because CLAUDE.md carries no detail.

### 3.4 Execution model (plugin-agnostic, kept from prior design)

Read-heavy phases (story-analysis, figma-analysis, impact, test-design, visual-testing, automation) run as **subagents that return artifacts by path**, not by value. The orchestrating workflow thread shuttles **paths + compact summaries**, keeping context lean. This is orthogonal to the plugin and survives migration unchanged.

### 3.5 Domains are consumed, not re-encoded

Business rules live in `qa-workflow/domains/**` (thin knowledge skills wrapping `docs/ai/business/**`). QA phase skills **declare** `domains: [card, payment, …]` and read rules from there — one source of business truth. On migration these merge into the plugin's `domains/`.

## 4. Consequences

### Positive
- Buildable **today**, standalone; no dependency on unfinished plugin.
- Migration is mostly moves — see the checklist in [`qa-artifact-contract.md`](qa-artifact-contract.md) §7.
- Reuse-unless-changed eliminates repeated expensive analysis while guaranteeing latest story/design changes are reflected.
- Subagent isolation bounds token/context growth on long stories.

### Negative / risks
- **Schema-guess risk:** local `templates/` + `qa-state` schema are a best guess at the plugin's shape. *Mitigation:* methodology stays in `docs/ai/**`; only thin wrappers conform, so template drift is a small edit.
- **Small scaffolding tax now** (templates, registry, lib) vs a flat skill set — justified by turning a rewrite into moves.
- **Governance shift:** once QA is plugin-hosted, CLAUDE.md is **emitted**, not hand-authored. Until then we keep it thin and author by hand.

### Impact on already-committed work
`CLAUDE_CODE_OPERATOR.md` and the `QA_PROCESS.md` L5 edit remain valid; their **role** shifts to being the methodology that `qa-workflow/skills/visual-testing/SKILL.md` references. The CLAUDE.md pointer gets thinner. No content rework.

## 5. Alternatives considered

1. **Fold directly into the plugin now** — rejected: plugin is unfinished; couples QA to its timeline.
2. **Pure independent, plugin-agnostic** (original Turn-1 design) — rejected: guarantees a future rewrite (two orchestration models, two freshness engines, two business-rule stores that drift apart).
3. **Independent + plugin-isomorphic (this ADR)** — chosen: builds today, migrates cheaply.

## 6. Follow-ups (not in this ADR)
- Scaffold `qa-workflow/` (empty tree + templates + registry + `lib/` + thin skill wrappers).
- Author the two workflow files.
- Implement the freshness engine + schema validator (`lib/`).
- Confirm the exact Claude Code skill-discovery path for `.claude/` entrypoints.

---
*Design-only decision record. Detailed contract: [`qa-artifact-contract.md`](qa-artifact-contract.md). Machine schema: [`qa-state.schema.json`](qa-state.schema.json).*
