---
name: team-onboarding
description: Team onboarding (Phase 0b, once per team, refreshed when stale). Learn the team's product before its first story — product, surfaces and locale support, environments, architecture, stack, repositories, documentation, test data — by looking first, asking only what is missing, reading authorized repositories, and writing confidence-tagged team context (teams/<team>/context.md). Never invents project context. Runs inline (interactive).
metadata:
  type: gate
  version: 1.0
  phase: Phase 0b — Team onboarding
  workflow: [qa-shift-left, qa-implementation-validation, qa-full]
  runsAs: inline
  consumes:
    sources: [jira]
    artifacts: []
    domains: team
  produces:
    artifacts: []
  methodology: docs/ai/QA_PROCESS.md
---

# team-onboarding (gate skill)

## When it runs
- `node scripts/doctor.mjs --json` reports **`Team context`** with `fix.type: team-context` (no
  `teams/<team>/context.md` yet) — **blocking**: no story is analysed for a team the workflow knows nothing about.
- `fix.type: team-context-stale` (older than the threshold, or confirmed facts cite code that changed —
  `qa-cli.js knowledge-status`) — offer a refresh; if the operator declines, record that in the story's
  `prerequisites.md` and continue.
- The operator asks to (re)onboard a team.

It writes **only** `teams/<team>/context.md`, `teams/<team>/repos.json`, and — when the team needs a new
product domain — a new `qa-workflow/domains/<domain>/` scaffold registered in `knowledge.json` with
`owner: <team>`. It **never** edits core files (`CLAUDE.md`, `docs/ai/**`, skills, workflows) or a domain
another team owns: changes there are proposed to their owner.

## Governing rules
1. **Look before asking.** Never ask for what the repo, the team profile, granted repositories or the team's
   Jira project already answer.
2. **Never invent.** Every fact is tagged (format below). Anything not established is `[unknown]` **and** an
   open question. An empty section is better than a plausible guess.
3. **Explain every question.** Say why it is needed and what becomes unavailable if it is skipped.
4. **Skipping is allowed and recorded.** A skipped optional item becomes `[unknown]` + an open question and is
   copied into every story's `prerequisites.md` as a stated limitation. It never blocks.
5. **Repositories are read only when this tester grants them**, per repository, read-only. A clone existing on
   disk is not a grant.
6. **No secrets in team context, ever.** Name a key and where it is configured; never copy a value. The lint
   rejects credential-looking literals.

## Steps

### 1 · Look first
- `teams/<team>.json` → `surfaces`, `domains`; any existing `teams/<team>/context.md` / `repos.json`.
- `node qa-workflow/bin/qa-cli.js knowledge --team <team>` → which domains already exist for this team.
- Jira (read-only): `searchJiraIssuesUsingJql` on the team's recent stories → the components, labels and recurring
  nouns of their product. Record what this suggests as `[inferred: <evidence>; <date>]`, never as confirmed.
- Docs the tester links (Confluence, READMEs) → facts as `[confirmed: doc:<url>; <date>]` when the doc is
  authoritative for that fact.

### 2 · Ask what is still missing — ONE batch, tiered, filtered by surface
**Required** (the session cannot test accurately without them):
| Question | Why |
|---|---|
| Product name and what it does, in two sentences | frames every requirement and risk |
| Surfaces in scope (web / mobile / backend), and per surface its **locale support** (does the UI have Arabic?) | sets the platform × locale scope; prevents planning an AR sweep of an EN-only UI |
| Environments + their URLs (testing/staging) | where execution and evidence happen |
| The product domain: an existing one (from the registry) or a new one to create | which business rules load |

**Optional** (each improves accuracy; skipping is recorded as a limitation):
| Question | What is lost when skipped |
|---|---|
| Repositories (backend, web, Android, iOS, shared libs, API contracts, DB schema) — URL + role + the product components each owns | requirement detail, cross-layer impact, real validation rules |
| Architecture / API specs (OpenAPI, Postman) / DB schema location | API-level test design; impact radius |
| Test-data strategy: how records/users are created and cleaned up, shared test accounts (**names only**) | stable, isolated execution |
| Known recurring defects / fragile areas | sharper exploratory charters and regression scope |
| Existing test cases (BrowserStack folder) | reuse instead of regeneration |

Filtering: a **backend-only** team gets no device/locale/Figma questions; a **mobile-UI** team gets API questions
only when `backend` is also a surface; anything step 1 answered is shown for confirmation, not asked.

Use `AskUserQuestion` for choices, plain questions for values — the same single-batch protocol as
[`detect-prerequisites`](../detect-prerequisites/SKILL.md).

### 3 · Repository grants and discovery
For each repository the tester names: add `{ id, url, role, components }` to `teams/<team>/repos.json`
(committed — no paths), then ask **"may I read `<id>`, read-only?"**. On yes, the tester records the grant
locally — `credentials.local.js → repos: { '<id>': { path: '/abs/clone', granted: true, grantedAt: 'YYYY-MM-DD' } }`
— and `node qa-workflow/bin/qa-cli.js repos` confirms it (only `git rev-parse HEAD` runs). Then run
[`repo-discovery`](../repo-discovery/SKILL.md) (subagent, read-only) on the granted repositories and fold its
cited facts into the context.

### 4 · Confirm the important assumptions
Show a table of every `[inferred]` fact plus anything that changes test scope (surfaces, locale support,
environments). The tester confirms (→ `[tester: <name>; <date>]`) or corrects each. Nothing inferred reaches
the final file as if it were confirmed.

### 5 · Write, lint, hand over
1. Write `teams/<team>/context.md` in the shape below (copy `teams/_template/context.md`).
2. `node qa-workflow/bin/qa-cli.js knowledge-lint teams/<team>` — fix until it exits 0.
3. If the team needs a new domain, create it with the tool — never by hand:
   `node qa-workflow/bin/qa-cli.js domain-init <domain> --owner <team> --description "…" --markers "<re>,…" --terms "<re>,…"`.
   It creates the folder, a versioned `SKILL.md`, a provenance-headed `business-rules.md`, the registry entry and
   adds the domain to the team's `domains`. **Markers** = identifiers only this product uses (internal service
   names, tables, codes) — they keep your knowledge out of core and out of other squads' contexts. **Terms** =
   your product vocabulary other squads may also say (kept out of core only). Then run
   `node scripts/knowledge-isolation.mjs`.
4. `node scripts/doctor.mjs --json` → `Team context` is ok.
5. Tell the tester to **commit** `teams/<team>/` (and the domain, if new) so the whole squad shares it.

## Team-context shape (enforced by `knowledge-lint`)
```markdown
# <Team> — team context
verifiedAt: YYYY-MM-DD · verifiedBy: <name>

## Product
## Surfaces & locale support
## Environments (URLs only — no credentials)
## Architecture
## Tech stack
## Repositories
## Documentation
## Test data strategy
## Integrations & dependencies
## Open questions / unknowns
```
Every bullet outside *Open questions* ends with one tag:

| Tag | Meaning |
|---|---|
| `[confirmed: repo:<id>@<sha>:<path>[:line]; <date>]` · `[confirmed: doc:<url-or-path>; <date>]` · `[confirmed: jira:<KEY>; <date>]` | directly supported by source code or an authoritative document |
| `[inferred: <evidence>; <date>]` | derived from behaviour or several signals — must be shown to the tester |
| `[tester: <name>; <date>]` | stated by the team |
| `[unknown]` | not established — needs a matching open question |
| `[outdated: <superseded by>; <date>]` | known to be stale; kept so nobody re-learns it |

## Exit criteria
- `knowledge-lint teams/<team>` exits 0; `doctor` shows `Team context` ok.
- No fact without a tag; every `[unknown]` has an open question; every `[inferred]` was shown to the tester.
- Nothing written outside `teams/<team>/` and the team's own domain.
