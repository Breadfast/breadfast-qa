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

## Readiness — the environment, BEFORE the story (mandatory, every workflow)

A colleague who just cloned the repo has no team, no credentials and maybe no `npm install`. None of that
may surface as a script failing halfway through a story. **Before reading the story**, settle the
environment. (Added 2026-11-16, operator instruction: *"Claude should check if everything is installed and
added before running the workflow — even when the team or the credentials are not added, detect it and ask."*)

1. **Run the doctor in machine mode** — always, even if the session-start brief said "ready" (the operator
   may have changed something since):
   ```
   node scripts/doctor.mjs --json
   ```
   It returns `{ ready, blocking[], warnings[], ok[] }`; every problem carries a `fix` saying exactly what
   to set or run. It never prints a credential value, and neither do you.
2. **Check the connections the story needs**, with one cheap call each: Atlassian (e.g. the current-user
   lookup) always; Figma (`whoami`) when the story has a design. If a server is missing or "requires
   authentication", that is a step **only the user can do**: tell them to run `/mcp`, pick the server and
   **Authenticate** in the browser, then continue.
3. **Pick what this story needs.** Everything in `blocking` is needed. From `warnings`, take what the
   story's surface needs: a mobile story needs the App Automate username + access key; automation needs
   the Java framework path and its config files; web execution needs Playwright browsers. Ignore the rest.
4. **Ask for all of it in ONE batch** (`AskUserQuestion` for choices, plain questions for values), handling
   each `fix.type` like this:

   | `fix.type` | What to do |
   |---|---|
   | `team` | Ask which team, offering `fix.available` plus "a new team". Write `team: '<id>'` into `automation/config/credentials.local.js` (create it from the template first if it is missing). A new team: copy `teams/_template.json` to `teams/<id>.json` and continue with `team-values` |
   | `team-values` | Ask for each field in `fix.fields` (non-secret; `teams/_template.json` says where each comes from) and write them into `teams/<team>.json`. Tell the user to **commit that file** so their teammates get it |
   | `credential`, `secret: false` | Ask for the value (an email, a username) and write it under `fix.key` in `credentials.local.js` |
   | `credential`, `secret: true` | **Do not ask the user to paste a token or password into the chat** — chat history keeps it. Create the file if needed, then tell them the exact key (`fix.key`), where to get the value (`fix.where`), and to paste it into `automation/config/credentials.local.js` themselves and reply when done. If they paste it into the chat anyway, write it into the file and never repeat it back |
   | `command` | Ask once ("install now?"), then run `fix.run` (`npm install`, `npm run playwright:install`, the template copy) |
   | `path` | Ask for the folder (`fix.what`), or offer to clone `fix.clone`; set `QA_FRAMEWORK_PATH` |
   | `file` | The credentials file doesn't load — show the user the error line (never the file's contents) and fix it together |

5. **Re-run `node scripts/doctor.mjs --json` until `ready` is `true`** and the story-relevant warnings are
   cleared — or the user has explicitly said to go on without one *for this run* (record that in
   `prerequisites.md`). Only then continue with the story-specific checks below.

Never read `credentials.local.js` aloud, print it, or copy values out of it; check keys, not values.

## What to enumerate
Walk these categories and, for each, state **needed / have / how verified**:

| Category | Typical items |
|---|---|
| **Team profile (check FIRST)** | Which QA team runs this story, and is its `teams/<team>.json` complete? Selected via `team` in `automation/config/credentials.local.js` or `QA_TEAM`. It supplies the Jira project, bug issue type, squad + components per surface, and BrowserStack project + suite folder. **No team's values are ever a default** — if none is selected, ask which team; if fields still read `TODO`, ask for them in the same batch, write them into the team file, and tell the operator to commit it. `npm run doctor` lists what is missing ([teams/README.md](../../../teams/README.md)) |
| **Access** | App/portal URL, username + password, API tokens (Jira, Figma, BrowserStack **Test Management**), DB/API read permission |
| **Destinations** | BrowserStack project (from the team profile) + this story's **folder** id, Jira parent key (must be in the team's Jira project), report output path |
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
| 0 | Environment readiness | ✅ have | `node scripts/doctor.mjs --json` → `ready: true`; team `payment`, no TODO; Atlassian + Figma MCP answered |
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
