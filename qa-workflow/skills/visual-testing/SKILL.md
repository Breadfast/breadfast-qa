---
name: visual-testing
description: Visual Testing (QA_PROCESS Phase 5). Compare each actual screen to its Figma design, apply the dynamic-vs-defect rules, and produce annotated Design-Bug evidence. Runs as a subagent.
metadata:
  type: task
  version: 1.1
  phase: Phase 5 — Visual Testing
  workflow: [qa-implementation-validation]
  runsAs: subagent
  consumes:
    sources: []
    artifacts: [figma-analysis]
    domains: []          # business-agnostic — see "Responsibility boundary" below
  produces:
    artifacts: [visual-findings]
  methodology: docs/ai/visual-testing/CLAUDE_CODE_OPERATOR.md
---

# visual-testing (task skill)

> Thin wrapper. The **how** is the operator playbook
> [`docs/ai/visual-testing/CLAUDE_CODE_OPERATOR.md`](../../../docs/ai/visual-testing/CLAUDE_CODE_OPERATOR.md)
> (identify → pair → re-baseline → reconstruct → compare 18 dimensions → **dynamic-vs-defect exclusion
> rules** → finding schema → group → annotated evidence → Design Bug). Do not re-inline it.
>
> **Deterministic-first (ADR-003 §3.4).** Comparison runs the **Conformance pipeline** first — the
> `visual-compare` CLI ([`qa-workflow/bin/qa-cli.js`](../../bin/qa-cli.js)) resolves L1 identity and runs
> L2 component-tree · L3 visibility · L4 layout · L5 copy · L6 styles **deterministically** (same two
> images ⇒ same findings). The **LLM is confined to the residual**: coverage-gaps, unstructured surfaces,
> and an optional audit sample. This closes the operator↔engine fork — "primary path" means Claude Code
> *orchestrates* and calls the deterministic core, not that it eyeballs the comparison.

## Responsibility boundary — business-agnostic
Visual testing is **design-conformance**: the Figma baseline is the source of truth. Business rules do
**not** enter the comparison. They flow *upstream* into the baseline — `requirements` / `figma-analysis`
/ `test-design` decide *what* is correct and *which* frame is expected for a given state; execution +
screen identity tag each screenshot with its `screenId`+state so it pairs to the right frame. This skill
then compares the paired Expected↔Actual using only the **comparison rules** (dynamic-content
exclusions, tolerances). A missing expected state or wrong Figma copy is a **baseline gap** to fix in
`figma-analysis` (or a coverage gap) — never a reason to inject domain knowledge here. Hence `domains: []`.

## Inputs (by path)
`figma-analysis` (Expected frames + analysis) + captured screenshots (Actual, from Execution) + the
comparison rules (dynamic-content exclusion taxonomy + tolerances, per the operator playbook §6).

## Steps (deterministic-first — ADR-003 §3.4)
1. **Run the full evaluation (single entry point).** Assemble the story input — either `useRegistry` (the
   Screen Registry supplies curated `components` + per-screen `ValidationProfile`; live Figma ids are
   resolved from the ticket URL via `--figma-url`, Decision 2) or explicit `expected` screens — plus the
   Actual side (`rawDumps` = raw a11y/Appium-XML, or `dumps`/`actual`). Then run:
   ```
   node qa-workflow/bin/qa-cli.js visual-evaluate --in <input.json> --judge claude --figma-url <ticket-figma-url>
   ```
   This runs the deterministic pipeline (L1 pairing → L2/L3/L4/L5/L6/L7) **then** the L8 residual runner.
   It returns reproducible findings, per-screen `verdict`, `coverageGaps`, a `residual` worklist, and
   `health`. **The deterministic findings are reproducible — never re-derive them by eye.**
   (Omit `--judge claude` for a deterministic-only pass — the default; or use `visual-compare` for the
   deterministic bridge without the story-assembly conveniences.)
2. **Residual AI only (already wired).** `--judge claude` injects **`ClaudeJudge`**
   ([`qa-workflow/capabilities/visual/claude-judge.js`](../../capabilities/visual/claude-judge.js)) into
   `evaluateStory` — it runs the Claude Code CLI `Read` workflow over the paired frame + screenshot for
   **only** the `residual` screens (`unstructured-surface` / `no-expected-model`), and **classifies /
   confirms / explains** — never re-detecting what L2–L6 already found. The deterministic engine imports no
   AI transport; the judge is injected (a Messages-API transport can replace it with zero engine change).
3. On the residual, **classify each observed difference as DEFECT vs DYNAMIC DATA / STATE** (exclude the
   latter) per the operator playbook §6.
4. **Merge** deterministic + residual findings; record (Component · Category · Severity · Expected ·
   Actual · Root Cause · Recommendation); group recurring by shared component/token.
5. Generate annotated side-by-side evidence via `automation/helpers/VisualComparisonHelper.js`
   (`compareScreenWithFindings` → red-annotated PNGs for Jira). Only confirmed defects are annotated.
6. Write `evidence/visual-findings.md` (+ evidence files).

## Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" visual-findings \
     --path evidence/visual-findings.md --generator visual-testing@1.1 \
     --derive-artifacts figma-analysis
```
Returns `{ screens, confirmedDefects, excludedStateDiffs }` (compact).
