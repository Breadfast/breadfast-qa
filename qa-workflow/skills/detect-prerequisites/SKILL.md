---
name: detect-prerequisites
description: Prerequisite Gate (runs FIRST, before any other phase). Enumerate every input the run will need — credentials, tokens, URLs, app IDs, destinations, test data, backend state — determine which are actually missing, and ASK the operator for them up front. Prevents late-breaking "blocked" outcomes. Runs inline in every workflow.
metadata:
  type: gate
  version: 1.0
  phase: Phase 0 — Prerequisite Gate
  workflow: [qa-shift-left, qa-implementation-validation, qa-full]
  runsAs: inline
  consumes:
    sources: [jira]
    artifacts: []
    domains: []
  produces:
    artifacts: []
  methodology: docs/ai/QA_PROCESS.md
---

# detect-prerequisites (gate skill)

> Ported from the QA Platform's `detect_prerequisites` node (`packages/shared/src/prompts.ts` in the
> retired `qa-platform` app — removed from this repo 2026-08-10; see
> [architecture/legacy-qa-platform/](../../../docs/ai/architecture/legacy-qa-platform/)),
> which `qa-workflow/` was missing. Added 2026-07-26 after B10-56750 shipped a QA summary containing
> **two** avoidable "blocked" outcomes — see *Why this exists*.

## Purpose
Find out **before doing the work** what the run will need and does not have, and **ask the operator for
it**. This gate exists to make "blocked" a thing that gets *resolved at the start* rather than
*reported at the end*.

## Governing rule — never block, always ask
Per [[ask-never-block]] and the operator instruction of 2026-07-26:

> **Do not report a task as blocked without having asked for the missing input first.**

A run may end with "asked, awaiting X". It must not end with a flat "blocked on X" that the operator
was never given the chance to unblock.

## Why this exists (the failure it prevents)
On **B10-56750** two items were reported as blocked in the final QA summary:

1. **BrowserStack test-case upload** — reported as *"blocked: Test Management API returns 401/SSO"*.
   The credentials were **fine**. Our own `import_browserstack_csv.js` targeted the **v1** API, which
   returns `401 + auth/start-sso` for valid keys. A prerequisite check would have exercised the
   destination up front, found the 401 in minute one, and asked — instead of after execution, on a
   wrong diagnosis, having never asked.
2. **AC-14 data migration** — reported *"Not Testable: the environment has zero perks"*. Asking
   "does this environment contain the perks AC-14 refers to?" at the start would have had them seeded
   before execution. They were seeded on request afterwards, and AC-14 then **passed**.

Both were discoverable in the first minutes. Neither needed to reach a report.

## What to enumerate
Walk these categories and, for each, state **needed / have / how verified**:

| Category | Typical items |
|---|---|
| **Access** | App/portal URL, username + password, API tokens (Jira, Figma, BrowserStack **Test Management**), DB/API read permission |
| **Destinations** | BrowserStack project + **folder** id, Jira project/parent key, report output path |
| **Targets** | Mobile app IDs (iOS + Android), build/version under test, device/OS matrix |
| **Test data** | Records the ACs reference **by name** (e.g. AC-14's "General cashback 1%" perk), seeded lists, a disposable/unique-name strategy, a cleanup path |
| **Backend state** | Migrations run? Feature flags on? Account in the required status? |
| **Design** | Figma file key + node ids for **this** story; is the Jira design link alive? |
| **Locale/platform scope** | Does the surface under test even support the default locales? (B10-56750: the card panel has **no Arabic UI** — a scope fact worth settling at minute one) |
| **Automation framework** | The Breadfast Java framework location resolves (`QA_FRAMEWORK_PATH` → `automation/config/framework.js`, default `D:\projects`; verified by its `pom.xml`) — if not, **ask for the path**; plus any one-time wiring the story's automation needs (e.g. the story-class `TypeName` checkstyle suppression — [automation-generation.md](../../../docs/ai/automation/automation-generation.md) §2, §5) |

## Method
1. **Read the story and the ACs for named dependencies.** Any AC that names a record, a migration, or a
   downstream surface is a prerequisite question, not an execution detail.
2. **Prefer the credential loader over asking.** Check `automation/config/credentials.js` and env vars
   first — most things are already configured. Never ask for what is already available.
3. **Verify each access item with the cheapest possible live call** — one authenticated request to the
   real destination. A prerequisite is "have" only when a call succeeded, not when a value merely exists.
4. **When a call fails, diagnose before escalating.** A `401`/`403`/`404` is at least as likely to be a
   wrong base URL, API **version**, path or payload shape as it is a permission problem. Check the
   vendor's current API reference before declaring an access blocker. *(This is the exact mistake that
   produced failure 1 above.)*
5. **Ask for everything still missing in ONE batch**, via `AskUserQuestion` where possible, naming the
   value and where it comes from (e.g. *"a Test Management API token from BrowserStack → Profile → API
   tokens"*). One round trip, not a trickle.
6. **Record the outcome** in the story folder (`prerequisites.md`) so a retest inherits it.

## Report shape
```markdown
# Prerequisites — <TICKET>
| # | Prerequisite | Status | How verified / What's needed |
|---|---|---|---|
| 1 | Admin Portal URL + creds | ✅ have | GET /#/dashboard authenticated as `agent` |
| 2 | BrowserStack TM token | ✅ have | GET /api/v2/projects → 200 |
| 3 | BrowserStack destination folder | ❓ ASK | operator must name the project + folder |
| 4 | Perks referenced by AC-14 | ❓ ASK | perks list returns 0 rows — need them seeded |
```

## Exit criteria
- Every category above is explicitly **have / ask / not-applicable** — none silently skipped.
- Every "have" for an access item is backed by a **successful live call**, not just a present value.
- Everything still missing has been **asked** in one batch.
- Nothing is labelled "blocked" that the operator was not asked about.

## Bookkeeping
This gate produces no tracked artifact (it is a gate, not a deliverable), so there is no
`qa-cli.js record` step. Write `prerequisites.md` into the story folder and reference it from the
execution report.
