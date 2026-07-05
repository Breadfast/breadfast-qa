# Breadfast QA Platform

The enterprise platform that turns the Claude-driven QA Companion into the single
entry point for the QA team. A tester picks a **Project Profile**, provides a Jira
story, hits **Run QA**, and the platform orchestrates the canonical lifecycle —
analysis → Figma → clarify → impact → HLS → test cases → BrowserStack → execution →
report → defects — pausing only for clarifications, missing config, and approvals
before any external write.

> **This is an orchestration shell over a frozen canonical workflow, not a rewrite.**
> The reasoning stays in `CLAUDE.md` + `docs/ai/**`; the platform invokes it via the
> **local `claude` CLI in headless mode** (the tester's own subscription) and wires the
> existing scripts/frameworks in as tools. The canonical workflow is the single source
> of truth and the platform must preserve **100% Platform Parity** with it.
> See [ARCHITECTURE.md](./ARCHITECTURE.md), [docs/design/](./docs/design/), and the
> parity baseline [docs/design/parity-baseline.md](./docs/design/parity-baseline.md).

## Architecture at a glance

- **Local-first:** each tester runs the full stack locally — own SQLite DB + own artifacts. Only the git repo (code + knowledge + automation) is shared.
- **Runtime workspace:** all personal/runtime data lives in a configurable workspace **outside** the repo (default `~/BreadfastQA/Workspace` · `C:\Users\<user>\BreadfastQA\Workspace`).
- **Secrets:** encrypted at rest; collected progressively, only when a step needs them.
- **Cross-platform:** Windows + macOS, no hardcoded drive paths.

```
Tester workstation (local, cross-platform)
  @qa/web  (Next, :3000)     ── new story via Project Profile
  @qa/api  (NestJS, :4000)   ── SSO, stories, runs+SSE, settings, frameworks, diagnostics, onboarding
  @qa/worker ──claims runs──► walks the 27-node LIFECYCLE_GRAPH
   └─ @qa/engine ─► claude -p   (cwd = repo root; CLAUDE.md + docs/ai/** auto-load)
  SQLite qa.db + artifacts ──► the configurable runtime workspace (outside the repo)
```

## Prerequisites

- Node ≥ 20 · Git · the `claude` CLI installed and signed in (per-user subscription)
- Optional per platform: Playwright framework (web), Java/Appium framework + Java + Android SDK + Xcode-on-macOS (mobile) — registered in the **Framework Registry**

The **onboarding wizard** validates all of this and ends with an Environment Health Report.

## Setup (first run)

```bash
cd qa-platform
cp .env.example .env          # no D:\ paths, no secrets; dry-run defaults ON
npm install
npm run build
# then start the app and complete the onboarding wizard (workspace, frameworks,
# integrations, profiles) — it runs db:generate + db:push against your workspace qa.db.
npm run engine:smoke          # optional: prove the engine loads CLAUDE.md
```

## Run

```bash
npm run dev            # api + worker + web together
# or individually: npm run dev:api | dev:worker | dev:web
```

Cross-platform launch scripts (`npm run start` / `stop`, plus optional `.command`/`.sh`)
land in Phase B; the Windows `.cmd` launchers remain until then.

## Layout

```
breadfast-qa/                    # the repo (= companion root = engine cwd)
├── CLAUDE.md  docs/ai/**        # canonical workflow + knowledge (source of truth)
├── project-defaults.json       # non-secret Project Profiles
├── automation/                 # shared scripts + page objects (no secrets)
└── qa-platform/                # the app
    ├── ARCHITECTURE.md  README.md  docs/design/**   # architecture + Phase 0 design specs
    ├── packages/{shared,db,engine}
    └── apps/{api,worker,web}
```

Personal/runtime data (DB, `stories/<TICKET>/`, logs, sessions) lives in the configurable
workspace, **never** in the repo.

## Status

Phase 0 (repository & architecture finalization) complete and locked. Phases A→E follow;
see [ARCHITECTURE.md](./ARCHITECTURE.md) → Phase roadmap. Nothing changes the frozen
27-node canonical workflow without a parity justification.
