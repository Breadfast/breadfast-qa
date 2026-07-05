# Design — Onboarding Wizard

> **Status:** LOCKED (Phase 0). First-run wizard ending in an **Environment Health Report** with an overall readiness score.

## 1. Steps

1. **Welcome** — what the platform is; parity principle in one line.
2. **Prerequisites** — run Core diagnostics (Node, Git, Claude CLI signed-in). Red items link to Fix Suggestions.
3. **Workspace** — choose the runtime workspace location (default pre-filled per OS); create it; write the bootstrap config. See [runtime-workspace](./runtime-workspace.md).
4. **Frameworks** — register frameworks (point at / `git clone` the Playwright + optional Java/Appium repos); auto-scan each. See [framework-registry](./framework-registry.md).
5. **Integrations** — configure Jira / BrowserStack / Figma / AI. Each field shows its help (what/why/when/where) and a **Test connection** button. Secrets encrypted on save. Optional fields skippable (collected later via progressive `config.needed`).
6. **Project profiles** — pick the profiles this tester works on (Card Service, Customer App, …); optionally set personal path overrides.
7. **Initialize** — `db:generate` + `db:push` against the workspace `qa.db`; generate the encryption key if absent; create the local user.
8. **Health Report** (finish) — see §2.

Onboarding is resumable; a tester can skip optional steps and finish later. Completion is recorded so the wizard doesn't re-show.

## 2. Environment Health Report (final screen)

A single readiness dashboard:

- **Installed components** — Node, Git, Claude CLI, Java, Android SDK, Xcode (with versions / not-installed).
- **Connected integrations** — Jira, BrowserStack, Figma, AI — connected / not / error.
- **Configured frameworks** — each registry entry with its scan status.
- **Missing requirements** — the consolidated list of `fail`/`warn` checks, each with its Fix Suggestion.
- **Overall readiness score** — a clear verdict:
  - `Ready` — all required-core + at least one full platform path (web or mobile) green.
  - `Web-ready` / `Mobile-ready` — one platform path green, the other missing.
  - `Not ready` — a required-core check fails; execution is blocked until resolved.

The score is computed by the same diagnostics engine (weighted: required-core must all pass for anything above "Not ready"). The tester leaves onboarding knowing exactly whether — and for which platforms — they can execute stories.

## 3. API / UI

- `GET /onboarding/state`, `POST /onboarding/complete`.
- Reuses `GET /diagnostics`, the Framework Registry, and the Settings registry endpoints — onboarding is an orchestrated view over those, not a parallel implementation.

## 4. Parity note

Onboarding configures the environment the canonical workflow needs (knowledge base reachable, frameworks/integrations valid). It adds no workflow steps and changes no node behavior.
