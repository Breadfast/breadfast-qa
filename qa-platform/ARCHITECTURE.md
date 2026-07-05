# Breadfast QA Platform — Architecture

> **Governing principle — Platform Parity.** The canonical AI QA Companion (`CLAUDE.md` + `docs/ai/**` + the frozen 27-node workflow) is the **single source of truth**. This platform is an **orchestration layer over** that workflow, never a redesign. It must reach **100% functional parity** before any new capability is added. Every decision is judged by: *does this improve or preserve Platform Parity?*
>
> Companion review + full rationale: [ARCHITECTURE-REVIEW.md](./ARCHITECTURE-REVIEW.md). Phase-0 design specs: [docs/design/](./docs/design/). Parity baseline (DoD): [docs/design/parity-baseline.md](./docs/design/parity-baseline.md).

## Locked decisions (2026-07-05)

| Area | Decision |
|------|----------|
| **Deployment** | **Local-first** — each tester runs the full stack locally: own SQLite DB + own on-disk artifacts. Only the git repo (code + knowledge + automation) is shared. No shared-backend multi-tenancy. |
| **Repository** | **New clean repo `breadfast-qa`** (companion monorepo) + selective migration. Never `git init` the polluted working dir. → [repository-structure.md](./docs/design/repository-structure.md) |
| **Runtime workspace** | **Configurable per-user workspace OUTSIDE the repo** (DB, artifacts, logs, sessions). Changeable from Settings; folders auto-created. → [runtime-workspace.md](./docs/design/runtime-workspace.md) |
| **Secrets** | **Encrypt at rest (AES-256-GCM via `SECRETS_ENCRYPTION_KEY`) + progressive prompt.** Guard `/settings/resolved`. Just-in-time `config.needed` with Use-once / Save-to-me / Save-as-project-default. → [settings-registry.md](./docs/design/settings-registry.md) |
| **Settings** | **One declarative registry** drives UI + validation + runtime; every field carries what/why/when/where help. → [settings-registry.md](./docs/design/settings-registry.md) |
| **Frameworks** | **Generic Framework Registry** (name/platform/type/path/validation/lastScan/description). No hardcoded folder names. → [framework-registry.md](./docs/design/framework-registry.md) |
| **Project Profiles** | **Primary entry point for story creation**; selecting a profile auto-configures Jira/BS/frameworks/URLs/env/exec, per-story overrides allowed. → [project-profiles.md](./docs/design/project-profiles.md) |
| **Diagnostics** | **Pre-execution gate + page** with Fix Suggestions (why/how/re-test). → [diagnostics.md](./docs/design/diagnostics.md) |
| **Onboarding** | **First-run wizard** ending in an Environment Health Report + readiness score. → [onboarding.md](./docs/design/onboarding.md) |
| **Versioning** | **Platform / Workflow / Knowledge / CLAUDE.md versions recorded on every run.** |
| **Canonical workflow** | **Frozen.** Changes require updating `nodes.ts` + `domain.ts` + the parity baseline + `CLAUDE.md` together, with a parity justification. |
| AI engine | **Local `claude` CLI** (per-user subscription), headless `-p`; cwd = repo root so `CLAUDE.md` + `docs/ai/**` auto-load. |
| Auth | **Google SSO**, restricted to `@breadfast.com` (local dev header bypass). |
| Human-in-loop | **Gate external writes** (Jira / BrowserStack / bug filing) + M1b review checkpoints. |

## The engine (keystone)

Each reasoning step is a scoped headless run:

```
claude -p "<scoped task: produce JSON matching <schema>>" \
  --output-format json --permission-mode plan --model <model>
# cwd = repo root  →  CLAUDE.md + docs/ai/** auto-load as project instructions
```

The JSON envelope yields `result`, `session_id` (`--resume`), `total_cost_usd`, `usage`. `@qa/engine` validates `result` against the relevant `@qa/shared` zod schema and retries once on mismatch. Runs on the tester's own subscription — no API key.

## Components

- **`@qa/shared`** — domain enums/types, zod schemas, the `LIFECYCLE_GRAPH` (27 nodes), the `RunEvent` SSE protocol, and (new) the **Settings registry** + path-resolution helpers.
- **`@qa/db`** — Prisma schema (SQLite, per-user workspace file). Models: `User`, `Story`, `Run`, `RunStep`, `Approval`, `Clarification`, `TestCase`, `Artifact`, `Defect`, `KnowledgeDoc`, `KnowledgeProposal`, `Setting`, `TestDataItem`, `AuditLog`, (new) `Framework`, repurposed `Project`/profiles.
- **`@qa/engine`** — `runClaude()` (CLI adapter) + `runAiTask()` (schema-validated).
- **`@qa/api`** — NestJS: Google SSO, `stories`, `runs` (+ SSE + worker claim/ingest + gate/answer), `settings`, `figma-auth`, `dashboard`, (new) `frameworks`, `profiles`, `diagnostics`, `onboarding`.
- **`@qa/worker`** — local poll-claim loop → walks `LIFECYCLE_GRAPH`: code nodes do local work, ai nodes call the engine, ask/gate/`config.needed` nodes pause and resume on tester input.
- **`@qa/web`** — Next.js: shell, dashboard, profile-first new-story wizard, settings, frameworks, diagnostics, onboarding, live run timeline.

## Workflow graph (canonical, frozen)

27 nodes, in the order defined by `LIFECYCLE_GRAPH` (`packages/shared/src/domain.ts`) — enumerated in [parity-baseline.md](./docs/design/parity-baseline.md) §2. Every node persists input/output to `RunStep` → runs are resumable and audited. Gates block on an `Approval` row; clarifications and `config.needed` block on a `Clarification`-style row.

## Data separation

| Shared (git) | Personal (runtime workspace, gitignored) |
|---|---|
| `CLAUDE.md`, `docs/ai/**`, `docs/design/**` | `qa.db` (stories, runs, settings, secrets) |
| `qa-platform/` source | `stories/<TICKET>/` artifacts, reports, screenshots, videos, evidence |
| `automation/` shared scripts + page objects | `logs/`, `cache/`, `auth/figma-auth.json`, `browser-sessions/` |
| `project-defaults.json` (non-secret) | user Settings + encrypted secrets |

## Phase roadmap

- **Phase 0 (current):** repository & architecture finalization — this doc + design specs + parity baseline. No behavior change.
- **Phase A:** shareability & security — clean repo migration, secret scrub, dry-run defaults, kill `D:\` paths.
- **Phase B:** cross-platform — portable launchers, de-Windows worker prompts.
- **Phase C:** secrets & settings — encryption, settings registry, progressive `config.needed`.
- **Phase D:** framework registry + project profiles + diagnostics + onboarding.
- **Phase E:** cleanup + versioning + final parity audit.

## Security

Domain-restricted SSO; secrets encrypted at rest (AES-256-GCM); `/settings/resolved` guarded by a local worker token; every external write gated + recorded in `AuditLog`; DRY-RUN default on fresh installs; secrets and personal data never enter git (clean-repo migration + `.gitignore`).
