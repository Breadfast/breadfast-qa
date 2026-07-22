# skills/ — QA phase task skills

Thin **task skills** (see `../templates/task-skill.template.md`). Each references its methodology in
`docs/ai/**` (source of truth) and honors the artifact contract. Read-heavy skills run as **subagents**
that return the artifact **by path**, keeping the orchestrating workflow's context lean.

| Skill | Phase | runsAs | consumes (artifacts / sources / domains) | produces |
|---|---|---|---|---|
| `story-analysis` | Requirements | subagent | jira | `requirements` |
| `figma-analysis` | Figma | subagent | figma | `figma-analysis` |
| `impact-analysis` | Impact | subagent | `requirements`, `figma-analysis` | `impact` |
| `test-design` | HLS + Test Cases | subagent | `requirements`, `figma-analysis`, `impact`, `clarifications` | `hls`, `testcases` |
| `exploratory-testing` | Exploratory | inline | app, `requirements` | (notes) |
| `visual-testing` | Visual | subagent | `figma-analysis`, screenshots | `visual-findings` + evidence |
| `browserstack-mgmt` | BrowserStack | inline | `testcases` | `browserstack-import` |
| `automation-gen` | Automation | subagent | `testcases` | `automation` |
| `defect-reporting` | Defects | inline | `execution`, `visual-findings` | `defects` |

> **Clarification** is the existing **grill-me** skill (inline, interactive) — invoked by the workflow, not re-authored here.

Each skill's `SKILL.md` is currently a **scaffold stub**; bodies are authored in the implementation phase.
