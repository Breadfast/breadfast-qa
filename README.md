# breadfast-qa

The canonical AI QA Companion — the **workflow**, not the story outputs.

- `CLAUDE.md` + `docs/ai/**` — the canonical workflow + knowledge base (single source of truth).
- `qa-workflow/` — workflow definitions, skills, and the `qa-cli.js` gate tooling.
- `.claude/skills/` — the Claude Code entrypoints (`/qa-shift-left`, `/qa-validate`, `/qa-full`).
- `automation/` — shared page objects, helpers, config, the BrowserStack tooling
  (`automation/browserstack/`) and the legacy Playwright suite (`automation/legacy/`).

Everything here is **self-contained**: no folder outside this repository is required. The one
external dependency is the Java/Appium framework used for automation generation, whose path is
configurable (`QA_FRAMEWORK_PATH` → [`automation/config/framework.js`](automation/config/framework.js))
and which reports a clear "not found" rather than assuming a drive letter.

**Per-story artifacts are not committed.** A story folder (`<TICKET>/`) is created at the repo root
during a run and is gitignored — requirements analysis, Figma captures, test cases, execution
reports, screenshots, evidence and defects all stay local to whoever ran the story. Reusable
tooling belongs in `automation/`; story data does not belong in git.

## Quick start

**New here? Follow [SETUP.md](SETUP.md)** — empty machine to first workflow, Windows and macOS.
The short version — three steps:
```bash
git clone https://github.com/Breadfast/breadfast-qa.git
git clone https://github.com/Breadfast/QA_Automation_Framework.git projects   # side by side
cd breadfast-qa && npm run setup            # installs, creates your credentials file, asks your team
```
Then open this folder in Claude Code and type **`/qa-setup`**. Claude asks for everything still missing
(credentials, Jira/Figma sign-in, your squad's values, onboarding) in one batch. **You can skip any of it**:
nothing blocks, and a skipped item is asked for again right before the step that needs it. Or go straight to
`/qa-shift-left`, `/qa-validate` or `/qa-full` — the same questions come first.

**Any squad** can use it: a squad with no team file gets one from `npm run setup` (or `/qa-setup`), and its
sessions load only its own product knowledge — [SETUP.md §4.2](SETUP.md#42-your-teams-knowledge--onboard-once-then-only-your-knowledge-loads).

Run the legacy Playwright suite:
```bash
npx playwright test --config=automation/legacy/playwright.config.js
```

## History

The `qa-platform/` app was removed on 2026-08-10 — a legacy execution engine, deferred since
2026-07-15 and superseded by Claude Code, with zero runtime coupling to this workflow. The design
documents still cited by live docs were kept at
[`docs/ai/architecture/legacy-qa-platform/`](docs/ai/architecture/legacy-qa-platform/); the app's own
history remains on `github.com/Breadfast/qa-platform`.
