# skills/ — QA phase task skills

Thin **task skills** (see `../templates/task-skill.template.md`). Each references its methodology in
`docs/ai/**` (source of truth) and honors the artifact contract. Read-heavy skills run as **subagents**
that return the artifact **by path**, keeping the orchestrating workflow's context lean.

| Skill | Phase | Workflow | runsAs | consumes (artifacts / sources / domains) | produces |
|---|---|---|---|---|---|
| `story-analysis` | Requirements | W1 | subagent | jira | `requirements` |
| `figma-analysis` | Figma | W1 | subagent | figma | `figma-analysis` |
| `impact-analysis` | Impact | W1 | subagent | `requirements`, `figma-analysis` | `impact` |
| `exploratory-testing` | Exploratory analysis (A, **conditional**) / testing (B) | W1 + W2 | inline | app, `requirements`, `figma-analysis`, `impact` | `exploratory-notes` |
| `test-design` | HLS (A) + Test Cases (B) + Reconciliation (C) | A/B = W1, C = W2 | subagent | `requirements`, `figma-analysis`, `impact`, `clarifications`, `exploratory-notes` | `hls`, `testcases`, `testcase-reconciliation` |
| `testcase-review` | Test-case review **gate** | W1 | subagent | `testcases` + every design input | `testcase-review` |
| `browserstack-mgmt` | BrowserStack import (A) / sync (B) | A = W1, B = W2 | inline | `testcase-review`, `testcase-reconciliation` | `browserstack-import` |
| `automation-gen` | Automation | W2 | subagent | `testcases` | `automation` |
| `framework-conformance` | Automation (gate) | W2 | subagent | `automation` | (none — `automation/conformance-review.md`) |
| `visual-testing` | Visual | W2 | subagent | `figma-analysis`, screenshots | `visual-findings` + evidence |
| `defect-reporting` | Defects | W2 | inline | `execution`, `visual-findings` | `defects` |

> **Clarification** is the existing **grill-me** skill (inline, interactive) — invoked by the workflow, not re-authored here.

**Coverage is defined in W1, maintained in W2 (2026-08-09).** `test-design` Phases A+B, `testcase-review`
and the BrowserStack import all run **before** development; W2 reconciles that approved baseline
(Phase C + sync) instead of regenerating it. Two skills therefore span both workflows — `exploratory-testing`
and `browserstack-mgmt` — each with an explicitly different **mode** per workflow. See
[`../../docs/ai/architecture/qa-artifact-contract.md`](../../docs/ai/architecture/qa-artifact-contract.md) §1–2.
