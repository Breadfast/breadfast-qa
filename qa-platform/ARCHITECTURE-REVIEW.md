# Breadfast QA Platform — Architecture & Deployment Review

> **Date:** 2026-07-05 · **Type:** Architecture / deployment / shareability review (not a coding task)
> **Scope:** production-readiness, team-shareability, cross-platform support, maintainability
> **Status:** review complete · architecture LOCKED (round 2, 2026-07-05) · Phase 0 finalization next · **no code changed yet**
>
> ## ⭐ Governing principle — Platform Parity
> The canonical AI QA Companion (`CLAUDE.md` + `docs/ai/**` + the frozen workflow) is the **single source of truth**. The web platform is an **orchestration layer over** that workflow, not a redesign of it. It must reach **100% functional parity** with the canonical Companion before any new capability is added. Every architectural or implementation decision is evaluated against one question: **"Does this improve or preserve Platform Parity with the canonical QA Companion?"** If no — reconsider the design before implementing.

---

## 0. The finding that reframes everything

The docs (`ARCHITECTURE.md`, `README.md`) describe a **shared PostgreSQL backend** where every tester connects to one server. **The code does not do that.**

- `packages/db/prisma/schema.prisma:11` → `provider = "sqlite"`
- `.env` and `packages/db/.env` → `DATABASE_URL="file:D:/BreadfastQA/qa-platform/packages/db/dev.db"`

So **today each tester is already a fully local island** — own SQLite DB, own on-disk artifacts. The "shared backend + user isolation" machinery was designed but never realized. This *matches* the requirement that story executions must not be shared — only reusable knowledge. The right move is to **embrace local-first and make it clean**, not to build out multi-tenancy.

---

## 1. Current architecture review

**What it is:** npm-workspaces monorepo at `qa-platform/` — `packages/{shared,db,engine}` + `apps/{api,worker,web}`. The engine (`packages/engine/src/claude-runner.ts`) shells out to the local `claude` CLI in headless `-p` mode with `cwd = QA Companion dir`, so `CLAUDE.md` + `docs/ai/**` auto-load. The worker (`apps/worker/src/nodes.ts`) walks a ~20-node lifecycle graph; `ai` nodes call the engine, `gate`/`ask` nodes pause and persist to the DB, resume on tester response. The core engine + workflow is production-quality and resumable/audited.

**Docs vs. reality:**

| Claimed (docs) | Actual (code) |
|---|---|
| Shared Postgres backend | Local SQLite file at an absolute `D:/` path |
| Per-user OAuth via `Integration` table (encrypted) | `Integration` / `SharedSecret` tables are **dead code** — zero source references |
| Secrets "encrypted at rest" | **No encryption anywhere** — `SECRETS_ENCRYPTION_KEY` defined but never read; `Setting.value` + `Story.credentials` plaintext |
| User attribution / isolation | `ownerId`/`triggeredById` written but **never used in any query filter** |

The deployment, isolation, secrets, and portability layers are the gap — expected, since it was built single-user on one Windows machine.

---

## 2. External dependency audit

| Dependency | Why needed | Verdict |
|---|---|---|
| `QA_COMPANION_DIR = D:\BreadfastQA` (hardcoded in nodes.ts:55, figma.ts:23, jira.ts:19, stories.service.ts:11, smoke.mjs:13) | Root for knowledge base + artifacts | **Configurable, no `D:\` default** — default to auto-detected repo root |
| `D:\projects` (Java/Appium framework) | Mobile automation reference | **External + configurable**, degrade gracefully when absent |
| `D:\Playwright\b55168_pom` (`BF_B55168_DIR`); its `node_modules` (mysql2/ssh2/properties-reader) borrowed by the provisioner (nodes.ts:1560-1568) | Web Playwright framework | **External + configurable**; borrowing another repo's `node_modules` is fragile |
| External scripts: `automation/import_browserstack_csv.js`, `provision_for_execution.js`, `helpers/FigmaExporter.js`, `config/credentials.js`, `bs_helper.js` | BS import, provisioning, Figma REST, Jira creds, mobile driver | **Move into the shared repo** (`automation/`) — first-class platform tools |
| `auth/figma-auth.json` | Saved Figma browser session cookies | **Runtime-only, per-user, out of git** (currently 31 KB unignored) |
| Local `claude` CLI (`CLAUDE_BIN`) | The AI engine (per-user subscription) | **External by design** — add onboarding check |
| SQLite `dev.db` | All story/run/settings/secret data | **Personal, local, out of git** (currently absolute `D:/`, unignored) |
| Jira/Figma/Slack/BrowserStack creds | External integrations | See §5 |
| MySQL over SSH bastion | Card-user provisioning teardown | **External by design** (internal network) |
| `.env` secrets incl. **plaintext `BS_TM_UI_PASSWORD=Fintech@12345`** | BrowserStack login | **Rotate + never commit** |

~40 `process.env.*` reads total; the problem set is the 9 `D:\` defaults and the unconsumed Settings keys.

---

## 3. Cross-platform compatibility review

Good baseline: `path.join` used almost everywhere, `launcher/launch.mjs` already branches on `process.platform`, generated files use LF + explicit `utf8`.

**Blockers (won't start on macOS/Linux):**
- 9 hardcoded `D:\` drive-letter fallbacks.
- `DATABASE_URL="file:D:/..."` absolute path.
- Only Windows launchers: `Breadfast QA Platform.cmd` / `Stop QA Platform.cmd` (`%~dp0`, `Get-NetTCPConnection`, `Stop-Process`, `timeout`).

**Moderate:**
- PowerShell `Expand-Archive` embedded in the Figma-export agent prompt (nodes.ts:298).
- Hand-built backslash paths + literal `D:\...` paths written into AI instructions (nodes.ts:1100-1153, 1263).

**Cosmetic:** `windowsHide:true`, BOM stripping, `\`→`\\` no-op escaping.

---

## 4. Automation framework references

Make the two big frameworks (`D:\projects`, `b55168_pom`) **external, configurable, optional**:
- Per-user workspace config (or wire the already-present-but-unused `automation.*` Settings keys) mapping logical names → local paths: `javaFramework`, `playwrightFramework`, `companionDir`.
- Worker reads these instead of `D:\` literals; AI prompts interpolate resolved paths.
- Validate at onboarding ("framework detected / not found"); degrade gracefully when absent.
- Not git submodules (heavy, 663 files, independent cadence) — document a `git clone` step and point config at it.

---

## 5. Settings & credentials strategy

**Current state:** one flat global `Setting` key/value table (no scoping), **plaintext**, exposed via an **unguarded `GET /settings/resolved`** returning real secrets. Many catalog fields (`figma.token`, `integrations.slackToken`, `ai.model*`, `jira.auth`, `integrations.*`) shown in UI but **never consumed**. No help text, no scoping, no "use once / save" choice, no progressive collection. Encryption declared but unimplemented.

**Proposed redesign (local-first):**

1. **Single settings registry** — each key declares `label`, `help` (what / why / when-in-workflow / where-to-obtain), `scope`, `secret`, `requiredByNode`. UI + API validation + runtime all read one registry (no more UI/worker drift).
2. **Scope model:**
   | Scope | Stored where | Committed? |
   |---|---|---|
   | User (my creds/prefs) | local `Setting` table (per-machine SQLite) | No |
   | Project default (non-secret) | committed `project-defaults.json` | Yes (non-secret only) |
   | Story-specific | `Story` columns (already there) | No |
   | Runtime-only ("use once") | run state, never persisted | No |
3. **Encrypt secrets at rest** — implement the declared `SECRETS_ENCRYPTION_KEY` (AES-256-GCM) for secret `Setting.value` + `Story.credentials`; **guard `/settings/resolved`** with a worker token.
4. **Progressive collection** — new runtime event kind `config.needed` alongside `ask`/`gate`, reusing the existing `PausedForInput` pause/resume. When a node hits a missing required credential it pauses and the UI shows the field + help text + three buttons: **Use once** / **Save to my settings** / **Save as project default** (last offered only for non-secret keys).
5. **Per-field help** on every registry entry.
6. **Wire or remove dead keys** so the UI doesn't imply features that don't exist.

Example help copy:
- *BrowserStack Username* — used for Test Management + execution. Obtain from BrowserStack → Account Settings.
- *Figma Personal Access Token* — used to fetch designs via REST when browser export is rate-limited. Generate at Figma → Settings → Personal Access Tokens.
- *Jira API Token* — used to read/update stories and file defects. Generate at Atlassian → Account Security.

---

## 6. Shared vs personal data strategy

| Shared (committed to git) | Personal (never committed) |
|---|---|
| `CLAUDE.md`, `docs/ai/**` | `dev.db` (all story/run data) |
| `qa-platform/` source code | per-story artifact folders |
| `automation/` scripts + page objects + helpers | reports, screenshots, videos, CSVs, evidence |
| `project-defaults.json` (non-secret) | `.env`, `auth/figma-auth.json`, any secret |
| prompt templates, schemas | `*.log`, run cache, temp artifacts, user Settings |

**Strategy:** knowledge + code + shared automation in one git repo; everything personal lives outside the tracked tree and is fully gitignored.

---

## 7. User isolation strategy

Under **local-first**, isolation is inherent — each tester runs the stack on their own machine with their own SQLite + local artifacts. Cross-checks:
- Relax `Story.jiraKey @unique` (scope per-owner) so nothing surprises later, and note the unfiltered global queries are harmless per-machine.
- Artifacts keyed by ticket only under the shared companion dir — fine per-machine; ensure gitignored.
- A team dashboard, if ever wanted, is an **optional read-only aggregation** — not a retrofit of multi-tenancy.

(A true shared backend would need `userId` scoping on every query, composite keys, artifacts→object storage, per-user vaults, RBAC — recommended against; contradicts requirement #5.)

---

## 8. Team onboarding workflow

First-run **welcome wizard** (web UI, gated until complete):
1. Prerequisites — Node ≥20, `claude` CLI installed & signed in, git.
2. Locate frameworks — point at / `git clone` `b55168_pom` + optional `D:\projects`; auto-validate.
3. Knowledge base check — confirm `CLAUDE.md` + `docs/ai/**` present.
4. Configure integrations — Jira / BrowserStack / Figma / AI, each with help text + **Test connection**; secrets encrypted on save.
5. Initialize local DB — auto `db:generate` + `db:push` (SQLite, no server).
6. Create local user + preferences → dashboard.

Plus cross-platform launch (`npm run start`/`stop` + optional `.command`/`.sh`) and a one-step bootstrap script.

---

## 9. Risks in the current implementation

**🔴 Security / must-fix-before-sharing**
- Live plaintext secret `BS_TM_UI_PASSWORD=Fintech@12345` (shared `qc.fintech@breadfast.com`) in `.env` — **rotate now**.
- `auth/figma-auth.json` (live cookies) + `dev.db` (all data) **not gitignored** — a naive `git add .` leaks them. No `.git` exists yet → clean start possible.
- `GET /settings/resolved` is **unauthenticated** and returns real secrets.
- **No encryption at rest** despite schema claims.
- `QA_DRY_RUN=false` + `JIRA_BUG_DRY_RUN=false` in `.env` → **live** Jira/BS writes; fresh clones must default to dry-run.

**🟠 Portability / correctness**
- 9 `D:\` paths + Windows-only launchers + PowerShell in prompts.
- 372 MB `qa-platform.zip`, `.mp4`, loose media in the companion dir a naive `git add` would swallow.
- Provisioner borrows `b55168_pom`'s `node_modules`.

**🟡 Design debt**
- Dead tables (`Integration`, `SharedSecret`, `Project`) + dead Settings keys imply nonexistent capabilities.
- Docs claim Postgres/shared/encrypted — correct them to local-first.

---

## 10. Locked decisions (approved 2026-07-05)

| Decision | Choice |
|---|---|
| **Deployment model** | **Local-first** — each tester runs locally (own SQLite + artifacts); only the git repo is shared. No shared-backend multi-tenancy. |
| **Repo boundary** | **Companion monorepo** — one repo: `CLAUDE.md` + `docs/ai/**` + `qa-platform/` + `automation/` + `project-defaults.json`; frameworks external + configurable. |
| **Secrets** | **Encrypt at rest + progressive prompt** — AES-256-GCM via `SECRETS_ENCRYPTION_KEY`, guard `/settings/resolved`, just-in-time `config.needed` with Use-once / Save-to-me / Save-as-project-default. |
| **Canonical workflow** | **Frozen as the single source of truth.** The web app orchestrates it, never redesigns it. Changes require updating the workflow definition + preserving parity. |
| **Platform Parity** | **100% functional parity with the canonical Companion is a precondition** for any new capability. Parity is the litmus test for every decision. |
| **Repo structure** | **New clean repository + selective migration** (see §14) — the current `D:\BreadfastQA` is too polluted to `git init` safely. |
| **Runtime workspace** | **Configurable per-user workspace OUTSIDE the repo** (see §15) — DB, artifacts, logs, sessions live there; the repo holds only code/knowledge/automation/docs. |
| **Project Profiles** | **Introduce project profiles** (see §16) — selecting a project auto-populates Jira/BS/framework/URL/env defaults. |
| **Versioning** | **Record Platform / Workflow / Knowledge / CLAUDE.md versions on every run** (see §17) for traceability + reproducibility. |
| **Diagnostics** | **Environment diagnostics gate before execution** (see §18) — validate toolchain + integrations, show a diagnostics page. |

---

## 11. Target repository layout

```
breadfast-qa/                      ← the git repo
├── CLAUDE.md                      ✓ shared      (knowledge)
├── docs/ai/**                     ✓ shared      (knowledge base)
├── project-defaults.json          ✓ shared      (NON-secret defaults: Jira base URL, BS project id…)
├── automation/                     ✓ shared      (import_browserstack_csv.js, provision_for_execution.js,
│   ├── pages/ helpers/ config/                    FigmaExporter.js, bs_helper.js, shared page objects)
│   └── config/credentials.example.js             (template only — real creds gitignored)
├── qa-platform/                    ✓ shared      (the app: packages/ + apps/)
│   └── .env.example                ✓ shared      (no D:\ paths, no real secrets, dry-run defaults true)
├── runtime/                        ✗ personal    (gitignored: dev.db, logs, cache)
├── stories/<TICKET>/               ✗ personal    (gitignored: all per-story artifacts)
└── auth/figma-auth.json            ✗ personal    (gitignored: session cookies)

External, referenced by configurable path (NOT in repo):
  D:\projects (Java/Appium)  ·  b55168_pom (Playwright)  ·  claude CLI
```

Root `.gitignore` covers: `runtime/`, `stories/`, `**/dev.db`, `.env*` (except `.env.example`), `auth/`, `*.log`, `*.zip`, media, `node_modules/`, `**/credentials.local.js`, `**/credentials.js`.

---

## 12. Revised implementation roadmap

> Sequencing rule: nothing ships until Phase 0 is approved. Every major phase (A–E) is validated against Platform Parity before it is considered complete — specifically against the **official validation stories B10-56336 (card-service web) and B10-55570 (Card Portal adjustments)**; a regression against either blocks the phase. See [parity-baseline §5](./docs/design/parity-baseline.md).

**Phase 0 — Repository & architecture finalization (design-lock, mostly docs + scaffolding):**
- 0.1. Lock repo structure — define the new clean repo's tree + `.gitignore` + migration manifest (what moves in, what stays out). See §14.
- 0.2. Lock runtime-workspace strategy — path resolution + OS defaults + what lives there. See §15.
- 0.3. Lock settings architecture — the registry schema (label/help/scope/secret/requiredByNode). See §5.
- 0.4. Lock Project Profiles model. See §16.
- 0.5. Lock versioning model (Platform / Workflow / Knowledge / CLAUDE.md). See §17.
- 0.6. Lock diagnostics checklist + gating rule. See §18.
- 0.7. Lock onboarding flow + git strategy + cross-platform path resolution.
- 0.8. Update canonical docs (`ARCHITECTURE.md`, `README.md`) to match all locked decisions; establish the parity baseline (enumerate the canonical workflow so parity is measurable).
- **Exit criterion:** this document + the updated canonical docs approved; migration manifest reviewed. No behavior change yet.

**Phase A — Shareability & security (P0):**
- A1. Rotate BrowserStack `qc.fintech` password; strip real secrets from `.env`, keep `.env.example` (no `D:\`, dry-run defaults `true`).
- A2. Create the new clean repo; migrate only shareable assets per the 0.1 manifest; `git init` there (nothing sensitive ever enters history).
- A3. Replace 9 `D:\` defaults with repo-root + runtime-workspace resolution; `DATABASE_URL` → workspace path.

**Phase B — Cross-platform (P1):**
- B1. Cross-platform launch (`npm run start`/`stop` + optional `.command`/`.sh`); portable port-kill.
- B2. De-Windows worker prompts: `path.join` everywhere; replace PowerShell `Expand-Archive` with Node unzip / platform branch.

**Phase C — Secrets & settings (P1, largest):**
- C1. AES-256-GCM encryption at rest (wire `SECRETS_ENCRYPTION_KEY`) for secret `Setting.value` + `Story.credentials`; guard `/settings/resolved`.
- C2. Single settings registry driving UI + validation + runtime; wire or delete dead keys.
- C3. Progressive `config.needed` runtime event (reuse pause/resume) with Use-once / Save-to-my-settings / Save-as-project-default.

**Phase D — Framework integration & onboarding (P1/P2):**
- D1. Config-driven framework paths + Project Profiles + validation + graceful degradation.
- D2. Environment diagnostics page + gate.
- D3. First-run onboarding wizard (incl. workspace selection + profile selection).

**Phase E — Cleanup & parity hardening (P2):**
- E1. Relax `Story.jiraKey` uniqueness (per-owner); remove/finish dead tables (`Integration`/`SharedSecret`/`Project` — or repurpose `Project` for profiles).
- E2. Versioning stamped on every run.
- E3. Final parity audit vs the canonical baseline from 0.8.

---

## 13. Open items (need confirmation before Phase 0 exit → Phase A)

1. **New repo target path** — where should the clean repo live? Proposed: `D:\breadfast-qa` (Windows) as the working clone; the canonical name is `breadfast-qa`. Confirm or name it.
2. **BrowserStack password rotation (A1)** — external action on a shared account; the `.env` scrub is prepped here, but the rotation in BrowserStack itself is yours to perform.
3. **Parity baseline** — confirm the canonical workflow enumerated in 0.8 (the ~20 lifecycle nodes in `nodes.ts` + CLAUDE.md steps 0–7) is the authoritative parity checklist, or point me at a different definition.

---

## 14. Repository structure — new clean repo + selective migration (Decision #1)

**Recommendation: create a NEW clean repository and migrate only shareable assets.** Do **not** `git init` in the current `D:\BreadfastQA`.

**Why (evidence from the current folder):** it is a working scratch directory intermixing shareable and personal/generated content —
- 372 MB `qa-platform.zip` + `Flow Enhancements.zip` (1.6 MB) + `2026-06-28 …mp4` (3.5 MB)
- ~15 loose screenshots (`*_export.png`, `figma_*.png`, `settings-figma-auth*.png`, `full_canvas.png`, …)
- 9+ ticket folders: `B10-48764/48764 51595 55168 55294 55570 55570-verify 56336 56337 77777`, plus `BUILD-SMOKE-20260624/`, `FigmaCheck/`, `_validation/`, `figma-export-test/`, `presentation/`
- a **nested framework** `b55168_pom/` (also lives at `D:\Playwright\b55168_pom`), `node_modules/`, `playwright-report/`, `test-results/`, `.history/`, `.playwright-mcp/`, `log/`
- loose `*.csv`, `*.html`, `*.mjs`, `*.yml`, `*.xlsx`, `dev.db`, `.env`, `auth/figma-auth.json`

`git init` here — even with a `.gitignore` — is high-risk: one mistaken `git add`, a pre-existing `.history`, or an over-broad glob leaks personal data or secrets into history, which is hard to purge. A clean target repo makes leakage **structurally impossible**: only explicitly-migrated files exist to commit.

**Migration manifest (what moves into the new repo):**

| Source (in `D:\BreadfastQA`) | → New repo path | Notes |
|---|---|---|
| `CLAUDE.md`, `AGENTS.md` | `/CLAUDE.md`, `/AGENTS.md` | knowledge |
| `docs/**` | `/docs/**` | knowledge base |
| `qa-platform/**` (minus `node_modules`, `dist`, `.next`, `.env`, `dev.db`, `auth/`, logs, `*.zip`, `PARITY-PROPOSAL.pdf`) | `/qa-platform/**` | the app |
| `automation/**` (minus real `credentials.js`, any secrets) | `/automation/**` | shared scripts + page objects; ship `credentials.example.js` |
| `bs_helper.js`, `gen_report.js` | `/automation/` | first-class tools |
| *(new)* | `/project-defaults.json` | non-secret project profiles (§16) |
| *(new)* | `/.gitignore`, `/README.md` | root scaffolding |

**Explicitly NOT migrated:** all `B10-*` + `*-verify` folders, `BUILD-SMOKE-*`, `FigmaCheck`, `_validation`, `figma-export-test`, `presentation`, every loose screenshot/mp4/zip/xlsx/csv/html at root, `dev.db`, `.env`, `auth/figma-auth.json`, `node_modules`, `playwright-report`, `test-results`, `.history`, `.playwright-mcp`, the nested `b55168_pom` (stays external, referenced by config).

The old `D:\BreadfastQA` stays as-is (untouched working history); the new repo is the shareable artifact.

---

## 15. Runtime workspace (Decision #2)

Runtime data lives in a **configurable per-user workspace OUTSIDE the git repo**, chosen during onboarding.

**Defaults:**
- Windows: `C:\Users\<user>\BreadfastQA\Workspace`
- macOS/Linux: `~/BreadfastQA/Workspace`

**Contents (all gitignored / never in repo):**
```
<workspace>/
├── qa.db                    SQLite database (was packages/db/dev.db)
├── stories/<TICKET>/        story history, reports, screenshots, videos, evidence
├── cache/                   runtime cache + temp files
├── logs/                    api/worker/web logs
├── auth/figma-auth.json     Figma session cookies
└── browser-sessions/        any persisted browser profile/state
```

**Resolution order:** `QA_WORKSPACE_DIR` env → value saved at onboarding (stored in a small bootstrap config in the OS config dir, e.g. `~/.config/breadfast-qa/config.json` / `%APPDATA%\breadfast-qa\config.json`) → OS default above. The repo holds **only** source code, shared knowledge, shared automation, and docs. `DATABASE_URL` and all artifact paths derive from `<workspace>`, never from the repo tree or a `D:\` literal.

---

## 16. Project Profiles (Decision #3)

A **profile** bundles the per-project defaults so selecting a project auto-populates the wizard.

**Profile fields:** `name`, `jiraProject`, `bsProject`, `bsDefaultFolder`, `frameworkPaths` (`playwright`, `appium/java`), `defaultUrls` (per environment), `defaultEnvironment`, `platforms`, optional `credentialRefs` (pointers to encrypted secrets, never inline secrets).

**Storage split (respects Shared vs Personal, §6):**
- **Non-secret profile defaults** → committed `project-defaults.json` in the repo (shared: Card Service, Customer App, Control Room, Chatbot…). Candidate to repurpose the currently-dead `Project.defaultsJson` table as the loaded form.
- **Secret credential refs** → resolved from the per-user encrypted secret store at run time; never in the committed profile.

**Behavior:** onboarding + the story wizard show a **Project selector**; choosing one fills Jira/BS/framework/URL/env fields (still editable per story). New profiles can be added by editing `project-defaults.json` (shared) or as a personal profile locally.

---

## 17. Platform versioning (Decision #4)

Stamp four versions on **every run** (persisted on `Run`, surfaced in reports + audit) for traceability + reproducibility:

| Version | Source |
|---|---|
| **Platform Version** | `qa-platform` package version (semver, bumped per release) |
| **Workflow Version** | version field on the frozen workflow/graph definition (bump only with an intentional, parity-preserving workflow change) |
| **Knowledge Version** | content hash / version of `docs/ai/**` (ties into the existing `KnowledgeDoc.contentHash`) |
| **CLAUDE.md Version** | content hash of `CLAUDE.md` at run time |

A run record therefore answers "which platform + workflow + knowledge produced this result?" — required for reproducibility and for detecting when a run predates a workflow/knowledge change.

**Minimum supported versions (refinement #2):** the platform declares a **minimum supported Workflow Version** and **minimum supported Knowledge Version**. Before a run, the current versions are compared against these minimums; if either is below, the run is blocked (stale knowledge base / out-of-date workflow) rather than producing a non-parity result. The minimums in force are recorded on each `Run` alongside the four versions. Enforced via the Platform Parity Health diagnostic. Detail: [parity-baseline §6](./docs/design/parity-baseline.md).

---

## 18. Environment diagnostics (Decision #5)

A **diagnostics page** + a **pre-execution gate**: story execution is blocked (with a clear, actionable message) until required checks pass.

**Checks (grouped, each: present? version? valid?):**
- Core: Node.js (≥20), Git, Claude CLI (installed + signed in)
- Integrations: BrowserStack (auth), Jira (auth), Figma (session/token)
- Frameworks: Playwright (`b55168_pom`), Appium/Java framework (`D:\projects`), Java, Android SDK, Xcode (macOS only)

**Gating rule:** **required** checks (Node, Claude CLI, workspace writable, DB reachable) block execution; **optional** checks (Appium/Java/Android/Xcode) only block *mobile* stories, and web-only stories proceed. The page shows each item green/red with remediation hints (what's missing, where to get it) — feeding the same help copy as the settings registry (§5).

---

## 19. Canonical workflow protection (Decision #6)

The QA Companion workflow is **frozen as the canonical implementation**:
- The web app is an **orchestration layer over** the canonical workflow (CLAUDE.md steps 0–7 + the `nodes.ts` lifecycle graph), never a redesign.
- Any future enhancement that would change workflow behavior must first **update the workflow definition** and **preserve Platform Parity** — verified against the parity baseline established in Phase 0.8.
- The **Platform Parity litmus** (governing principle, top of doc) applies to every decision: if a change does not improve or preserve parity with the canonical Companion, it is reconsidered before implementation.
```
