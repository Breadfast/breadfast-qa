# Migration Impact Report — Phase A3 (cross-platform path resolution)

> Commit `36f931b` · 2026-07-05 · repo `D:\breadfast-qa`
> Scope: portability refactor only. No workflow behavior change. Platform Parity preserved.

## Files modified

**New (2):**
- `qa-platform/packages/shared/src/paths.ts` — the single path resolver.
- `qa-platform/packages/db/scripts/prisma-run.mjs` — cross-platform Prisma CLI wrapper.

**Renamed (2):** `automation/bs_helper.js`, `automation/gen_report.js` → repo root (match CLAUDE.md quick-ref + `companionPath('bs_helper.js')`).

**Edited (14):**
- `packages/shared/package.json` (+`./paths` export), `packages/db/package.json` (+`@qa/shared` dep, CLI wrapper), `packages/db/src/index.ts` (DB URL default), `packages/engine/smoke.mjs` (repo-root autodetect)
- `apps/worker/src/nodes.ts`, `apps/worker/src/figma.ts`, `apps/worker/src/jira.ts`
- `apps/api/src/stories/stories.service.ts`, `apps/api/src/figma-auth/figma-auth.service.ts`, `apps/api/tsconfig.json` (→ nodenext)
- `apps/web/app/settings/page.tsx` (OS-neutral placeholders), `auth/connect-figma.js` (error hints)
- `package.json` (dependency-ordered build), `scripts/create-clean-repo.mjs` (root placement)

## Summary of changes

Introduced one source of truth (`@qa/shared/paths`, server-only subpath) that **separates the repo/companion root** (auto-detected via `CLAUDE.md` walk-up; engine cwd; knowledge base) **from a per-user runtime workspace** (`~/BreadfastQA/Workspace` or `QA_WORKSPACE_DIR` — SQLite DB, story artifacts, logs, Figma session, browser sessions). Every hardcoded `D:\` default in platform code was replaced with a resolver call; framework locations resolve from env/Framework Registry with graceful fallbacks. `DATABASE_URL` and the Prisma CLI derive from the workspace when unset. `api` moved to `nodenext` resolution (emit stays CommonJS) so the `@qa/shared/paths` subpath resolves; the resolver stays out of the shared index so the web client bundle never pulls Node built-ins.

## Remaining Windows-specific items
- **Platform code:** none functional (3 explanatory comments only).
- PowerShell `Expand-Archive` + "Bash (PowerShell)" phrasing in the Figma batch-export prompt → **Phase B**.
- `.cmd`-only launchers (no `.sh`/`.command`) → **Phase B**.
- `windowsHide: true` on spawns — harmless no-op off-Windows. Line endings normalized via `.gitattributes`.

## Remaining macOS blockers
Confined to the **kept-as-is team-shared `automation/` scripts** that depend on the external Java/Appium framework:
- `automation/helpers/CardConfig.js` (`ENV_DIR`), `automation/config/environments/cardServiceConfigs_testing.js` (`bfPropertiesPath`), `PropertiesReader.js` + `import_browserstack_csv.js` (both already have env fallbacks), `TestDataInventory.js` (deprecated) hardcode `D:\projects\resources\environments\…` and `D:\BreadfastQA\test_data_inventory.csv`.
- **Impact:** affects only Java-framework-backed flows (card-user provisioning, mobile execution) on macOS. **Web QA runs fully cross-platform.** Proper fix = parameterize via the Framework Registry (Phase D) or env vars.

## Validation performed
- `npm install` (509 pkgs) — OK.
- Full monorepo build in dependency order — **GREEN**, all six packages incl. `@qa/web` ("Compiled successfully"). Confirms the web bundle does not pull the Node-only resolver.
- Prisma CLI wrapper — generated the client via resolver-derived `DATABASE_URL`.
- Resolver runtime check — `companionDir=D:\breadfast-qa`, `workspaceDir=~/BreadfastQA/Workspace`, `workspaceDbUrl=file:…/qa.db`, all artifact paths under the workspace; **zero `D:\`**.
- Source grep — platform `apps/`+`packages/` free of functional `D:\` (comments only).
- (Per direction: no unit tests added for the resolver at this stage.)

## Risk assessment
- **Low.** Pure path/config refactor; no lifecycle-node logic changed → parity preserved.
- **Behavioral note (intended):** story artifacts now land in `<workspace>/stories/<KEY>` instead of `D:\BreadfastQA\<KEY>`. Same 10-subfolder structure and contents — only the root moved (out of the repo, per design). Historical artifacts in the old `D:\BreadfastQA` are untouched.
- **`api` → nodenext:** emit remains CommonJS (package is CJS); all relative imports already used `.js`; build verified. Node 22 `require(esm)` already handled the ESM `@qa/shared` import.
- **Residual:** macOS runs of Java-framework flows need the `automation/` script paths parameterized (Phase D). Not a blocker for web QA or the platform itself.
