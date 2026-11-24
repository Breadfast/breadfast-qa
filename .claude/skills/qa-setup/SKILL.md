---
name: qa-setup
description: >-
  One-time setup workflow for the QA process on a new machine (any squad). Runs ONCE, at the first install:
  automatically when the session brief says "FIRST RUN", or when the user asks to set up / install / configure
  the QA process, or types /qa-setup. Installs what it can, then asks for everything else in one batch —
  team, credentials, Jira/Figma sign-in, Figma browser session, Java framework, team onboarding. Every
  question can be skipped; nothing blocks, and a skipped item is asked again right before the step that needs it.
---

# qa-setup — first-run setup workflow

> Runs once per machine (operator decision 2026-11-24: *"make the setup a workflow that runs once at the first
> installation"* and *"if the tester did not add any step the process should ask for it, and not block the setup
> or the execution"*). After it finishes, `scripts/setup.mjs --done` records it and the doctor stops asking.
> Re-running it later is safe: it only asks for what is still missing.

## Rules
- **Never block.** Every question offers **"skip for now"** and says what waits if it is skipped. Only a doctor
  `blocking` item (Node < 20, no Git, an incomplete clone, the wrong folder open) stops setup: tell the user the
  one fix, then continue once it is fixed.
- **Never take a secret in chat.** For a token or password, name the key and where to get it, and let the user
  paste it into `automation/config/credentials.local.js` themselves. If one is pasted into the chat anyway,
  write it into the file and never repeat it.
- **One batch.** Collect every question first, ask once (`AskUserQuestion` for choices, plain text for values).
- Short, plain messages. The user may be new to all of this.

## Steps

### 1 · Install what needs no answer
```
node scripts/setup.mjs --non-interactive
```
It installs npm packages and Chromium, switches on the pre-commit secret check and creates the credentials file
from the template. It skips anything already done. A step that fails is reported and the rest carry on.

### 2 · See what is still missing
```
node scripts/doctor.mjs --json
```
Take **every** item in `ask[]` (setup covers all of them, whatever their `fix.when`). Then check the two
connections with one cheap call each: Atlassian (current-user lookup) and Figma (`whoami`). Then check the Figma
browser session: `node qa-workflow/bin/figma-connect.js --status`.

### 3 · Ask for all of it in one batch
Ask in this order, skipping anything already in place:

| Item | Ask / do | If skipped |
|---|---|---|
| **Team** (`fix.type: team`) | Which squad? Offer `fix.available` plus "a new squad". Write `team: '<id>'` into `credentials.local.js` | asked at the start of the next run; core knowledge only meanwhile |
| **New squad** | Ask the squad name, surfaces (web / mobile / backend), Jira Squad + Components for web and mobile bugs, BrowserStack project (`PR-<n>`), numeric project id and suite folder id. Run `node qa-workflow/bin/qa-cli.js team-init <id> --name … --surfaces … --web-squad … --web-components … --mobile-squad … --mobile-components … --bs-project … --bs-numeric-project … --bs-folder …`, leaving out any flag the user skips (it becomes `TODO`) | each `TODO` is asked before the step that needs it |
| **Team values still TODO** (`team-values`) | Ask for each field in `fix.fields`; write them into `teams/<team>.json` (`teams/_template.json` says where each comes from) | asked before the BrowserStack import / bug filing |
| **Jira email + API token** | Email: ask and write it. Token: send them to id.atlassian.com → Security → API tokens, key `jiraApiToken` | defects are written locally; filed once the token exists |
| **BrowserStack Test Management** | `bsTmUsername` (login email; falls back to `browserstackUsername`) and `bsTmApiToken` (BrowserStack → Profile → API tokens → *Test Management*, not the App Automate key) | approved cases stay on disk; the import waits |
| **BrowserStack App Automate** | `browserstackUsername` + `browserstackAccessKey`, or the framework's `browserStackConfigs.properties` | mobile sessions wait |
| **Jira / Figma connection** | If a call failed: "type `/mcp`, pick atlassian (or figma), Authenticate in the browser". A claude.ai connector also works | asked again when the run first needs it |
| **Figma browser session** | If not `FRESH`: offer to run `node qa-workflow/bin/figma-connect.js` (opens a browser to log in) | design export waits; asked at the Figma step |
| **Java framework** (`path`) | Folder with `pom.xml`, or offer to clone `https://github.com/Breadfast/QA_Automation_Framework.git` next to the repo as `projects` | automation waits; manual execution still runs |
| **Framework config files** (`framework-files`) | Ask them to copy `fix.files` from the QA team vault into `fix.dir` | automation waits |
| **Java / Maven** (`install`) | Offer to run `fix.run` | automation waits |
| **Anything else in `ask[]`** | Handle by `fix.type` as in [`detect-prerequisites`](../../../qa-workflow/skills/detect-prerequisites/SKILL.md) *Readiness* | — |

### 4 · Team onboarding (only if `Team context` is in `ask[]`)
Tell the user their squad has no team context yet, and offer to run
[`team-onboarding`](../../../qa-workflow/skills/team-onboarding/SKILL.md) now (about ten minutes of questions about
the product, surfaces, environments and repos). Skipped → it is offered again at the start of their first story.
If a teammate may already have done it: suggest `git pull` first.

### 5 · Confirm and record
1. Run `node scripts/doctor.mjs --json` again.
2. Show a short table: **done** / **skipped — asked again before <fix.when>**.
3. Record the run, listing the names of the skipped items:
   ```
   node scripts/setup.mjs --done --deferred "<item>,<item>"
   ```
4. If a new team file or team context was created: tell the user to commit `teams/<team>.json` and
   `teams/<team>/` through a pull request so their squad shares it (offer to do it).
5. Close with the next step, in one line: *"You're set. Start a story with `/qa-shift-left B10-XXXXX` (before
   development), `/qa-validate B10-XXXXX` (after, with a baseline) or `/qa-full B10-XXXXX`."*

## Exit criteria
- `scripts/setup.mjs --done` has run (the doctor's `firstRun` is `false`).
- Every item in `ask[]` was either set up or shown to the user as skipped, with the step that will ask again.
- No secret value appeared in the chat or in any file other than `credentials.local.js`.
