# Process Parity Audit — Claude Code (`qa-workflow/`) vs QA Platform (`qa-platform/`)

> **HISTORICAL (2026-08-10).** The QA Platform was removed from this repo — it was a deferred
> legacy engine with zero runtime coupling to the workflow. This audit is kept because its
> *resolved decisions* are still in force in `CLAUDE.md` and `docs/ai/**`; the `qa-platform/**`
> paths it cites no longer exist here. See
> [architecture/legacy-qa-platform/](architecture/legacy-qa-platform/).


**Date:** 2026-07-26 · **Trigger:** operator request to confirm every step, working method and
upload/creation mechanism matches what the QA Platform did, and to surface mismatches for a decision.
**Method:** read qa-platform's authoritative implementations — `packages/shared/src/prompts.ts`
(17-entry prompt registry) and `apps/worker/src/jira-write.ts` (the defect filer) — and compared them
against the current `qa-workflow/` skills, the DAG in `qa-workflow/lib/freshness/dag.js`, and what was
actually executed on B10-56750.

**Verdict:** the *methodology* matches closely. The mismatches are in **four** places, one of which is
a live bug in qa-platform's code, plus **six lifecycle steps that exist only in qa-platform**.

---

## A. Bug reporting — 4 mismatches (1 is a qa-platform defect)

| Aspect | qa-platform `jira-write.ts` | Claude Code (B10-56750, 2026-07-26) | Status |
|---|---|---|---|
| Issue type | `10084` Bug **sub-task**, `parent` = story | same | ✅ match |
| Components / Squad `cf_10183` / Platform `cf_10467` | from settings | `Bcard Dashboard` / `Card Core` / `FE`\|`BE`\|`FE/BE` | ✅ match |
| Environment `cf_10348` | region select, only when configured | `{value:'Egypt'}` | ✅ match |
| Attachments | `attachFiles()` + `mimeForFile()` by extension | same, with explicit per-part Content-Type | ✅ match |
| **Field encoding** | **ADF objects** for `cf_10042/43/44` | **plain strings** | ❌ **qa-platform is broken** |
| **Title prefix** | `` `[${combo ?? 'web'}] ${title}` `` → `[web]`, `[ios-en]` | `[System Testing] …` | ⚠️ **differs** |
| **Steps field content** | ADF **bullet list of steps only** | Environment + Build number + Precondition + **numbered** steps | ⚠️ **differs** |
| **Severity `cf_10076`** | **not set** | set (`Major`/`Minor`) | ⚠️ **added** |
| **Priority** | **not set** | set (`High`/`Medium`/`Low`) | ⚠️ **added** |

### A1 · 🔴 qa-platform's ADF encoding cannot work against the current schema — proven
`jira-write.ts` builds `adfBulletList()` / `adfText()` for Steps, Actual and Expected. Those three
fields are **plain `textarea` customfields** (`/editmeta`: `schema.type = "string"`,
`custom = …:textarea`). Tested live on a filed bug:

```
PUT customfield_10043 = <ADF object>       → 400  "Operation value must be a string"
PUT customfield_10043 = <ADF as a string>  → 204  but stored as literal raw JSON text
```
(the probe was restored immediately)

So qa-platform's defect filer would **400 on create**, or — if anything stringifies the ADF en route —
render raw JSON in the ticket. **Plain multi-line strings are the only correct encoding**, which is
what this run used and what `docs/ai/bug-reporting.md` §4.1 now documents. The doc's earlier "rich
text (ADF)" claim came from this same code and was wrong.

**Recommendation:** keep plain strings; fix `jira-write.ts` if the platform is ever re-activated.

### A2 · Title prefix
qa-platform prefixes the **execution combo** (`[web]`, `[ios-en]`, `[android-ar]`), which is genuinely
useful on mobile stories where the same defect may be platform-specific. The operator has instructed
**`[System Testing]`**. These serve different purposes and could coexist
(`[System Testing][web] …`) — needs a decision.

### A3 · Steps field content
qa-platform puts **only the steps** in `cf_10042` as a bullet list. This run put
`Environment` + `Build number` + `Precondition` + numbered steps in it, because
`docs/ai/bug-reporting.md` §4.1 describes exactly that composition and there is no separate
build/precondition field on the Bug type. Needs a decision on which is canonical.

### A4 · Severity + Priority
qa-platform sets **neither**. This run set both (`cf_10076` Severity and Priority), because the
bug-reporting standard's template has a Severity/Priority line and triage benefits from it. This is an
**addition**, not a conflict.

---

## B. Test cases — 2 mismatches

qa-platform's `generate_testcases` schema:
```json
{"cases":[{"title","description","preconditions","type","priority",
           "automationStatus","steps":[{"action","expectedResult"}],
           "sources":[{"kind":"ac","ref":"AC-1"}]}]}
```

| Aspect | qa-platform | This run | Status |
|---|---|---|---|
| Granular standard (one action per step, own Expected Result) | required | followed (28 cases / 197 steps) | ✅ match |
| `preconditions`, `description`, `priority` | required | present | ✅ match |
| `automationStatus` default `Not Automated` | yes | yes | ✅ match |
| **`type` vocabulary** | Functional / **Acceptance** / **Regression** / Usability / Smoke & Sanity | **all 28 set `Functional`** | ⚠️ **differs** |
| **`sources` AC citation** | structured per case (`{kind:'ac',ref:'AC-1'}`) | AC refs in **prose** in the description + a coverage table | ⚠️ **differs** |

- **B1 · `type`:** TC27/TC28 are explicitly regression cases and should be `Regression`; the
  end-to-end happy path is arguably `Acceptance`. All were uploaded as `Functional` — understated.
- **B2 · `sources`:** qa-platform carries machine-readable AC traceability per case. This run has the
  mapping in `testcases/coverage-notes.md` and in each case's description text, which a human can read
  but a tool cannot join on. BrowserStack's own `issues` field only holds the story key
  (`B10-56750`), not the AC.

---

## C. BrowserStack upload — no mismatch, and a corrected fact

qa-platform **never implemented** a BrowserStack uploader (it only references BrowserStack in prompts,
knowledge and citations). So the v2 API uploader built here is **new capability**, not a divergence.

The important correction: `docs/ai/browserstack-process.md` §10.6 previously asserted the Test
Management **REST API is SSO-gated for this org**. That was wrong — the `401 + auth/start-sso` came
from calling the non-existent **v1** path. **v2 works with plain Basic auth.** Verified: 28 cases /
197 steps created in project `PR-5`, folder `53074476`. See §10.6 for the endpoints and the four
schema traps (notably: steps must go in `test_case_steps`, and a `steps` payload returns **200 while
silently saving zero steps**).

---

## D. Lifecycle steps that exist ONLY in qa-platform

qa-platform's registry has 16 lifecycle prompts; `qa-workflow/` has 9 skills. Six qa-platform steps
have no counterpart skill:

| qa-platform node | Covered in qa-workflow? |
|---|---|
| `parse_instructions` (compile free-text execution instructions → structured directives) | ❌ absent — handled ad hoc by reading the prompt |
| `detect_prerequisites` (flag genuinely-missing, undecidable prerequisites up front) | ❌ absent — surfaced late, inside clarifications |
| `acceptance_criteria` (extract each AC + mark testable + gaps) | ⚠️ folded into `story-analysis` |
| `comments_analysis` (comment-driven overrides / new requirements) | ⚠️ folded into `story-analysis` |
| `linked_stories` | ⚠️ ad hoc (done manually for B10-56729/56757 on this story) |
| `knowledge_update` (persist reusable knowledge at the end) | ❌ absent as a step — done by hand |

`detect_prerequisites` is the notable gap: it is exactly the step that would have surfaced
"BrowserStack Test Management token" and "are there perks in this environment?" **before** execution
rather than as late-breaking blockers — the failure mode that hit this run twice.

Conversely, `qa-workflow` has three artifacts with no qa-platform prompt: `browserstack-import`,
`defects` (qa-platform does it in code, not a prompt) and `qa-summary`.

---

## Decisions — RESOLVED 2026-07-26 (operator)

| # | Decision | Outcome | Applied |
|---|---|---|---|
| 1 | Bug title prefix | **`[System Testing][<combo>]`** — keeps the phase marker *and* qa-platform's platform signal | ✅ all 7 bugs retitled to `[System Testing][web] …` |
| 2 | Steps field `cf_10042` | **Keep** `Environment` + `Build number` + `Precondition` + numbered steps (the Bug type has no separate field for these) | ✅ already filed that way; documented as canonical |
| 3 | Severity + Priority | **Keep them — but as Jira FIELD ATTRIBUTES ONLY, never restated in the description text** | ✅ verified: no severity/priority line in any of the 7 bodies |
| 4 | Test-case `type` | **Leave all `Functional`** — no retro-fit | ✅ no change |
| 5 | Per-case AC citation | **Leave as prose + `coverage-notes.md`** — no structured `sources` field | ✅ no change |
| 6 | Missing lifecycle steps | **Adopt `detect_prerequisites`** as a real gate | ✅ `qa-workflow/skills/detect-prerequisites/SKILL.md` added and wired as the FIRST step of all three workflows |

**Also verified as a side effect of decision 1/3:** none of the 7 filed bugs contain an `AC-\d+`
reference in the summary, description, Steps, Actual or Expected fields — checked programmatically.

### Decision 6 — implemented
**`detect_prerequisites` is now a real gate** in `qa-workflow/`:
[`skills/detect-prerequisites/SKILL.md`](../../qa-workflow/skills/detect-prerequisites/SKILL.md), wired as
the **first step of all three workflows** (`qa-shift-left` step −1, `qa-implementation-validation`
step −1 before Reconcile, `qa-full` Phase 0). It enumerates access / destinations / targets / test data /
backend state / design links / locale scope, requires **one real authenticated call** per access item,
and **asks the operator in a single batch** for whatever is missing. Governing rule: *never report a step
as blocked without asking first*, and diagnose a `401`/`404` as a possible wrong URL/API-version/path on
our side before calling it a permissions blocker.

**Still not adopted** (lower value, no decision taken): `parse_instructions`, `linked_stories`,
`knowledge_update`. `acceptance_criteria` and `comments_analysis` remain folded into `story-analysis`.

### Not carried over deliberately
qa-platform's **ADF encoding** for `cf_10042/43/44` is a defect, not a convention (§A1) — plain strings
are canonical. If the platform is reactivated, `jira-write.ts` needs fixing before it can file bugs.

---

## E. Automation Generation re-based onto the Java framework — RESOLVED 2026-07-27 (operator)

**Directive:** replace **only the Automation Generation implementation** — web → **Java + Selenium**,
mobile → **Java + Appium** (unchanged), inside the Breadfast Java framework (path configurable, default
`D:\projects`); Playwright generated only on explicit request. Every other phase, the artifact contract
(`testcases` → `automation`), and workflow orchestration stay exactly as they were.

**Applied in `qa-workflow`/docs (the primary execution environment):** canonical contract
[`docs/ai/automation/automation-generation.md`](automation/automation-generation.md); `automation-gen`
skill bumped to **v2.0** (same consumes/produces); framework discovery added to the
`detect-prerequisites` gate + `automation/config/framework.js`; CLAUDE.md §0/§1/§3/§4/§8,
`coding-standards.md` (2026-06-22 two-framework resolution amended), `playwright-framework.md`
(legacy for new generation), `testing-process.md` §3.8, `release-validation.md` §6 updated.

**qa-platform divergence (recorded, deliberately NOT patched):** the platform's
`automation_generation` prompt (`packages/shared/src/prompts.ts` v1.1.0) still routes **web →
Playwright specs** and for mobile writes only a `framework-reference.md` ("DO NOT write Java files").
The platform is a frozen legacy engine in Certification Mode — changing its prompt registry mid-
certification would invalidate the baseline and add a new platform capability against the standing
freeze. **If the platform is ever reactivated, `automation_generation` must be re-pointed at
`automation-generation.md` (Java routing) first.**

**One-time framework wiring surfaced (needs framework-owner approval before the first generated
story class):** `checkstyle.xml`'s `TypeName` format `^[A-Z][a-zA-Z0-9]*$` rejects the mandated
`B10_<id>_<Feature>Tests` class names and fails the Maven build at `validate` — add a scoped
`TypeName` suppression to `checkstyle-suppressions.xml` (precedent: existing `MemberName` suppression).
