---
name: repo-discovery
description: Read-only, targeted discovery over repositories the tester has GRANTED — architecture, routes and contracts, validation and business rules, schema, flags, existing tests and fixtures — returning facts cited as repo@sha:path:line. Used by team onboarding (team context) and, per story, by story/impact analysis (source evidence). Never reads an ungranted repo, never writes, never copies a secret. Runs as a read-only subagent.
metadata:
  type: task
  version: 1.0
  phase: Discovery (Phase 0b / story analysis support)
  workflow: [qa-shift-left, qa-implementation-validation, qa-full]
  runsAs: subagent
  consumes:
    sources: [repos]
    artifacts: []
    domains: team
  produces:
    artifacts: []
  methodology: docs/ai/QA_PROCESS.md
---

# repo-discovery (task skill)

## Authorization — check before the first read
1. `node qa-workflow/bin/qa-cli.js repos --json` → only rows with `granted: true` **and** `located: true` may be read.
   Record each repo's `headSha`: every citation uses it.
2. A repository that is on disk but not granted is **never** opened — not even its README. Ask for the grant
   instead (the calling skill batches the question).

## Read-only, by construction
Run as a read-only subagent (no edit tools). Allowed: `git -C <path> rev-parse | ls-files | log -n <k> | grep |
show <sha>:<path>`, and reading files. **Forbidden:** `checkout`, `pull`, `fetch`, `switch`, builds, installs,
test runs, writes of any kind — the tester's clone is left exactly as it was.

## Targeted, not exhaustive — stop when the question is answered
Start from the question (the story's components / AC nouns / API paths, or the onboarding section being filled)
and walk this order:
1. README, architecture docs, ADRs.
2. Entry points and module map (`ls-files` + build files) → languages and frameworks.
3. Routes / controllers / handlers for the endpoints in scope; OpenAPI / Postman / proto contracts.
4. DTOs and validation (required fields, limits, formats, error codes).
5. Service rules (state transitions, eligibility, calculations).
6. Migrations / schema for the tables in scope.
7. Feature flags and config — **key names only**.
8. Existing tests, fixtures and factories for the unit in scope (what is already covered; how data is made).
9. For a changed contract field: its **producers and consumers** across every granted repository.

## Secrets
Files matching `.env*`, `*.pem`, `*.key`, `*secret*`, `*credential*`, `*.properties`, `application*.yml` may be
read for **key names** only. Never copy a value into any output. `knowledge-lint` rejects credential-looking
literals as a backstop, not as permission.

## Output
- For team onboarding: facts for `teams/<team>/context.md`, each tagged
  `[confirmed: repo:<id>@<sha>:<path>:<line>; <date>]` (code says so) or `[inferred: <evidence>; <date>]`
  (behaviour suggests so). Unknowns come back as open questions, never as guesses.
- For a story: `<storyDir>/requirements-analysis/source-evidence.md` — the same tagged facts, plus the
  producer/consumer list for changed fields. New or corrected **team** facts go to
  `<storyDir>/knowledge-proposals.md`; they reach `teams/<team>/context.md` only when the operator says so
  (then `knowledge-lint`, then commit). Never into core files or another team's domain.
- Return to the caller: `{ evidencePath, repos: [{ id, headSha }], openQuestions }` — compact, by path.

## When source access is not needed
Documentation, an API contract or existing test artifacts are enough when the story changes copy/layout with a
design, or an endpoint whose contract fully states the behaviour. Ask for source access when the story changes a
business rule, a state machine, validation limits or a contract consumed by another layer — or when the team
has little documentation.
