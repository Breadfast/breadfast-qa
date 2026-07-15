# Workstream A — Production Readiness Audit

> Static audit of the Breadfast QA Platform against a production-readiness rubric, grounded in the codebase (not live runs). Prepared 2026-07-15. Scale: **PASS** (ready) · **WARN** (works; address before/at pilot) · **FAIL** (blocks pilot).

## Scorecard

| # | Dimension | Status | Evidence | Action before pilot |
|---|-----------|:------:|----------|---------------------|
| 1 | **Build** | PASS | Full monorepo `npm run build` exit 0 (shared→db→engine→apps incl. web); 81/81 tests green. | — |
| 2 | **Runnability / one-click start** | PASS | `npm start` → `launcher/launch.mjs` spawns api+worker+web (prod builds), waits for health, opens browser signed-in. `npm stop` to tear down. | — |
| 3 | **Configuration & secrets** | WARN | Settings registry drives UI+validation+runtime; secrets AES-256-GCM at rest; `/settings/resolved` guarded. **But** `SESSION_SECRET` defaults to `dev-secret`. | Set `SESSION_SECRET` (+ real `SECRETS_ENCRYPTION_KEY`) for pilot. |
| 4 | **Authentication** | WARN | Google SSO restricted to `breadfast.com` (`ALLOWED_EMAIL_DOMAIN`); dev bypass (`/api/auth/dev` → `dev@breadfast.com`) for local use. | Configure real Google OAuth client for a multi-tester pilot; keep dev bypass for local only. |
| 5 | **Diagnostics / pre-flight** | PASS | `DiagnosticsService` checks node, git, Claude CLI, workspace, DB, parity health, integrations (Jira/BS/Figma), frameworks, tools (Java/Android SDK); readiness = ready / web-ready / mobile-ready / not-ready; each fail carries a why/how Fix. | — |
| 6 | **Onboarding** | PASS | First-run wizard (`/onboarding`) → environment health + readiness. | Validate the wizard flow during the campaign (UX). |
| 7 | **Workflow reliability (resume/cancel/gate)** | PASS | `runner.ts`: resume from `RunStep` status; cancel via status-poll + `AbortController`; gate/ask → `paused` + release worker; rejected gate → `paused`; error → `failed` with logged message; `directives.skipNodes` honored, never silent. | Prove each path once in the campaign. |
| 8 | **AI engine robustness** | PASS | `runClaude` + `runAiTask` with tolerant JSON repair (`parseJsonTolerant`) before any re-invoke; retry-once on schema mismatch; 0-spec write guard. | — |
| 9 | **Integrations wiring** | WARN | Jira (`jira.ts`/`jira-write.ts`), Figma (`figma.ts` REST + saved session), BrowserStack (creds), Slack OTP (MCP), Claude CLI. Missing creds **warn** (graceful degrade), not crash. | Live-verify each integration in the campaign; several MCP connectors need per-user auth. |
| 10 | **Observability** | WARN | `LlmRequestLog` (redacted prompt/response/tokens/cost/status); per-step logs over SSE; run status transitions; version stamps + `workflowDefJson` per run. **But** no log retention/pruning. | Add `LlmRequestLog` retention before long-term use (non-blocking for pilot). |
| 11 | **Data safety / separation** | PASS | Local-first per-user SQLite; story artifacts folder vs runtime workspace cleanly separated; secrets encrypted at rest; guarded resolved-settings route. | — |
| 12 | **Error handling (API)** | PASS | `AllExceptionsFilter` + zod validation at controller/service boundaries. | — |
| 13 | **Schema management** | WARN | Applied via `prisma db push` (no migration files). | Adopt Prisma migrations before scaling past a couple of testers (drift risk across local DBs). |
| 14 | **Automated E2E of the live workflow** | WARN | 81 deterministic/integration tests (incl. live SQLite via the real API service). No automated test drives the *live* AI+integrations workflow end-to-end. | The Story Campaign (Workstream C) is the intended human-run E2E; acceptable for pilot. |
| 15 | **Platform Parity self-measurement** | PASS | `computeParityCertification` scores every run; diagnostics surfaces parity health; parity baseline DoD documented. | Use it as a scoring input in Workstream B. |

## Summary
**PASS 9 · WARN 6 · FAIL 0.**

No blocking (FAIL) findings. The platform is operationally coherent — one-click start, strong diagnostics/onboarding, a resilient resume/cancel/gate worker, robust AI-output handling, encrypted local-first data, and self-measured parity. The six WARNs are pilot-hardening items, not defects.

## Pilot-hardening checklist (from the WARNs)
1. Set `SESSION_SECRET` + `SECRETS_ENCRYPTION_KEY` (not defaults). *(config)*
2. Configure real Google OAuth for multi-tester sign-in. *(auth)*
3. Complete per-user MCP/integration authorization (Jira/Figma/Slack/BrowserStack) and verify each live. *(integrations)*
4. Adopt Prisma migrations before scaling past initial testers. *(schema)*
5. Add `LlmRequestLog` retention/pruning. *(observability — non-blocking)*
6. Treat the Story Campaign as the live E2E acceptance gate. *(validation)*

## Verdict (Workstream A)
**Production-ready for a controlled pilot, conditional on the pilot-hardening checklist.** No architectural or blocking defects found in the static audit; readiness now hinges on the live Story Campaign (Workstream C) + Parity scoring (Workstream B).
