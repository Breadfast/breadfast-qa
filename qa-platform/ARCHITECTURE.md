# Breadfast QA Platform — Architecture

> **Governing principle — Platform Parity.** The canonical AI QA Companion (`CLAUDE.md` + `docs/ai/**` + the frozen 27-node workflow) is the **single source of truth**. This platform is an **orchestration layer over** that workflow, never a redesign. It must reach **100% functional parity** before any new capability is added. Every decision is judged by: *does this improve or preserve Platform Parity?*
>
> Companion review + full rationale: [ARCHITECTURE-REVIEW.md](./ARCHITECTURE-REVIEW.md). Phase-0 design specs: [docs/design/](./docs/design/). Parity baseline (DoD): [docs/design/parity-baseline.md](./docs/design/parity-baseline.md).

## Non-Negotiable Architecture Principles

These are the platform's core philosophy — the filter every proposed feature is checked against **before** design. A proposal that violates one of these is rejected or reworked; overriding any of them requires an explicit, recorded decision (a new/amended ADR).

1. **Platform Parity is the highest priority.** 100% functional parity with the canonical companion before any new capability. → [governing principle](#), [parity-baseline.md](./docs/design/parity-baseline.md)
2. **The canonical AI QA Companion defines workflow behavior.** `CLAUDE.md` + `docs/ai/**` + the frozen 27-node workflow are the single source of truth; this platform orchestrates, never redesigns.
3. **One AI reasoning step should feed multiple deterministic capabilities.** → [ADR-001](#adr-001--ai-reasoning-frugality-one-reasoning-step--many-deterministic-capabilities)
4. **Deterministic processing is preferred over additional AI invocations.** New AI calls only when deterministic derivation cannot reasonably produce the result; every AI-related proposal carries an AI Impact Statement. → [ADR-001](#adr-001--ai-reasoning-frugality-one-reasoning-step--many-deterministic-capabilities)
5. **The Prompt Registry is the single source of truth for prompts.** Versioned/owned/changelogged; prompts evolve without workflow changes.
6. **The Workflow Registry is the single source of truth for workflow definitions.** Declarative manifest; the canonical graph stays frozen.
7. **Every AI-generated artifact must be explainable and traceable.** Citations (why/what it came from) + Explainability (why generated, under which versions) are mandatory, not optional.
8. **Review Confidence and evaluation are deterministic, never model-estimated.** Scores derive from persisted evidence, so the same evidence always yields the same score.
9. **Local-first.** Each tester runs the full stack locally (own SQLite + on-disk artifacts); only the git repo is shared. No shared-backend multi-tenancy.
10. **Backward compatibility is preserved unless explicitly approved.** New schema fields are additive/optional; old runs must keep validating.
11. **Human approval gates protect external side effects.** Jira / BrowserStack / bug filing and review checkpoints block on explicit approval.
12. **Documentation is updated alongside architecture changes.** Code, `docs/ai/**`, `docs/design/**`, and this file move together; no silent overrides (governance & conflict protocol).

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
| **Versioning** | **Platform / Workflow / Prompt / Knowledge / Framework versions recorded on every run** (+ a `workflowDefJson` snapshot). → [phase1-foundation.md](./docs/design/phase1-foundation.md) |
| **Prompt Registry** | **Single source of truth for every AI prompt** — versioned/owned/changelogged `PromptDef` in `@qa/shared`; prompts evolve without workflow changes. → [phase1-foundation.md](./docs/design/phase1-foundation.md) §1 |
| **Run Evaluation** | **Deterministic Parity Certification** (score + missing dimensions + status) from authoritative `RunStep.status`; shared substrate for Review Confidence / Story Health / Analytics. → [phase1-foundation.md](./docs/design/phase1-foundation.md) §3 |
| **LLM Request Log** | **Every AI interaction captured** (prompt/version/model/response/tokens/cost/status), secrets redacted; powers Replay / Explainability / Cost. → [phase1-foundation.md](./docs/design/phase1-foundation.md) §4 |
| **AI Reasoning Frugality** | **Every new capability first attempts to derive its outputs from existing AI reasoning; a new Claude invocation is added only when deterministic processing cannot reasonably produce the result.** One AI reasoning step → many deterministic downstream capabilities. Every AI-related proposal must carry an **AI Impact Statement**. → [ADR-001](#adr-001--ai-reasoning-frugality-one-reasoning-step--many-deterministic-capabilities) |
| **Canonical workflow** | **Frozen.** Changes require updating `nodes.ts` + `domain.ts` + the parity baseline + `CLAUDE.md` together, with a parity justification. |
| AI engine | **Local `claude` CLI** (per-user subscription), headless `-p`; cwd = repo root so `CLAUDE.md` + `docs/ai/**` auto-load. |
| Auth | **Google SSO**, restricted to `@breadfast.com` (local dev header bypass). |
| Human-in-loop | **Gate external writes** (Jira / BrowserStack / bug filing) + M1b review checkpoints. |

## Architecture Decision Records (ADR)

### ADR-001 — AI Reasoning Frugality (one reasoning step → many deterministic capabilities)

**Status:** Locked · Accepted 2026-07-15 (established while closing Visual Testing Intelligence M3.5).

**Principle.** *Every new capability should first attempt to derive its outputs from existing AI reasoning. Additional AI model invocations should only be introduced when deterministic processing cannot reasonably produce the required result.*

**Preferred design.**

```
One AI reasoning step  →  Multiple deterministic downstream capabilities
   (NOT:  Multiple AI reasoning steps)
```

**Context.** Runs execute on each tester's own Claude subscription; token consumption and runtime are first-class architectural constraints. The platform already separates non-deterministic *reasoning* (schema-validated AI output) from deterministic *aggregation* around it (Run Evaluation, Parity Certification, Review Confidence, Visual Health, Explainability). M3.5 confirmed the pattern: it added Design-System Awareness, Component Awareness, Pattern Detection, and root-cause recommendations with **zero** new AI invocations — enriching the single existing `visual_comparison` output and processing everything else deterministically.

**Consequences.**
- New features reuse existing AI outputs (persisted `RunStep` output, the LLM Request Log, Visual Comparison, Citations) via deterministic code wherever possible.
- When enrichment is needed, prefer *extending an existing reasoning step's output schema/prompt* over adding a new reasoning step.
- A genuinely new AI reasoning step is permitted only with an explicit justification in the AI Impact Statement (below) showing deterministic derivation is not reasonable.

**AI Impact Statement (required for every AI-related proposal).** Each proposal MUST state:
1. **Number of new AI invocations** per normal story execution (target: 0).
2. **Expected token increase** (input + output, and whether bounded, e.g. by `QA_VISUAL_MAX_SCREENS`).
3. **Expected runtime increase**.
4. **Whether the capability can instead be derived deterministically** from existing AI outputs — and if a new invocation is proposed, why deterministic derivation is not reasonable.

This statement is part of the **Phase Quality Standard** and the **architecture review checklist**: a phase/milestone is not complete, and a feature is not approved, until its AI Impact Statement is provided and reviewed against this ADR.

## The engine (keystone)

Each reasoning step is a scoped headless run:

```
claude -p "<scoped task: produce JSON matching <schema>>" \
  --output-format json --permission-mode plan --model <model>
# cwd = repo root  →  CLAUDE.md + docs/ai/** auto-load as project instructions
```

The JSON envelope yields `result`, `session_id` (`--resume`), `total_cost_usd`, `usage`. `@qa/engine` validates `result` against the relevant `@qa/shared` zod schema and retries once on mismatch. Runs on the tester's own subscription — no API key.

## Components

- **`@qa/shared`** — domain enums/types, zod schemas, the `LIFECYCLE_GRAPH` (27 nodes), the `RunEvent` SSE protocol, the **Settings registry** + path-resolution helpers, and (Phase 1) the **Prompt Registry** (`prompts.ts`), **Workflow Registry & versioning** (`workflow.ts`), **Run Evaluation** engine (`run-evaluation.ts`), and **secret redaction** (`redact.ts`). → [phase1-foundation.md](./docs/design/phase1-foundation.md)
- **`@qa/db`** — Prisma schema (SQLite, per-user workspace file). Models: `User`, `Story`, `Run` (+ version stamps + `parityJson`), `RunStep`, `Approval`, `Clarification`, `TestCase`, `Artifact`, `Defect`, `KnowledgeDoc`, `KnowledgeProposal`, `Setting`, `TestDataItem`, `AuditLog`, `Framework`, (Phase 1) `LlmRequestLog`, repurposed `Project`/profiles.
- **`@qa/engine`** — `runClaude()` (CLI adapter) + `runAiTask()` (schema-validated, with tolerant JSON repair via `parseJsonTolerant` before any re-invoke).
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

### Platform Intelligence roadmap (distinct from the infra phases above)
- **Phase 1 — Foundation:** ✅ tolerant JSON repair · Prompt Registry · Workflow Registry & versioning · Run Evaluation (Parity Certification) · LLM Request Log · citation foundation. → [phase1-foundation.md](./docs/design/phase1-foundation.md)
- **Phase 2 — Platform Intelligence (M1–M8):** ✅ citations · explainability + review confidence · visual testing intelligence · story health · recommendations · activity timeline · enhanced reports · knowledge lint. → [phase2-platform-intelligence.md](./docs/design/phase2-platform-intelligence.md) · [validation](./docs/design/phase2-validation-review.md)
- **Phase 3 — QA Analytics (incl. Team Insights):** ✅ deterministic cross-run aggregation; `GET /analytics` + web. → [phase3-analytics.md](./docs/design/phase3-analytics.md)
- **Phase 4 — Coverage Matrix:** ✅ deterministic cross-story coverage; `GET /coverage` + web. → [phase4-coverage.md](./docs/design/phase4-coverage.md)
- All four are deterministic (ADR-001, 0 new AI beyond the bounded visual comparator) and leave the frozen 27-node workflow + Platform Parity unchanged. **Certification phase** (docs/certification) validates pilot readiness.

## Security

Domain-restricted SSO; secrets encrypted at rest (AES-256-GCM); `/settings/resolved` guarded by a local worker token; every external write gated + recorded in `AuditLog`; DRY-RUN default on fresh installs; secrets and personal data never enter git (clean-repo migration + `.gitignore`).
