# Design — Framework Registry

> **Status:** LOCKED (Phase 0). Generic registry of multiple frameworks. **No implementation depends on hardcoded folder names** (`D:\projects`, `b55168_pom` become registry entries, not literals).

## 1. Model

```ts
type FrameworkType = 'playwright' | 'appium' | 'api' | 'java-appium' | 'other';
type FrameworkPlatform = 'web' | 'android' | 'ios' | 'mobile' | 'api' | 'cross-platform';

interface Framework {
  id: string;
  name: string;                 // "Breadfast Web (b55168_pom)"
  platform: FrameworkPlatform;
  type: FrameworkType;
  localPath: string;            // absolute path on THIS machine
  description?: string;
  validationStatus: 'valid' | 'invalid' | 'not-found' | 'unscanned';
  lastScan?: string;            // ISO timestamp of the last validation scan
  scanDetails?: string;         // what was found / why invalid
  // ── provenance & health (refinement #3) ──
  version?: string;             // framework version (package.json version / pom version)
  gitCommit?: string;           // resolved HEAD commit hash when the path is a git repo
  gitBranch?: string;           // current branch, if a git repo
  lastSuccessfulGeneration?: string; // ISO ts of the last run that generated automation from this framework
  lastGenerationStory?: string; // jiraKey of that run — traceability
}
```

**Storage:** per-user, in workspace `qa.db` (a `Framework` table) — paths are machine-specific and personal, never committed. A committed `project-defaults.json` may reference frameworks **by name** (logical), which each user maps to their local registry entry.

## 2. API

- `GET /frameworks` — list with live-ish status.
- `POST /frameworks` — register (name, platform, type, path, description) → triggers a scan.
- `PATCH /frameworks/:id` — edit path/metadata → rescan.
- `DELETE /frameworks/:id`.
- `POST /frameworks/:id/scan` — re-validate on demand.

## 3. Validation (scan)

Each scan also records provenance: `version` (from `package.json`/`pom.xml`), and `gitCommit`/`gitBranch` when the path is a git working tree (`git rev-parse HEAD` / `--abbrev-ref HEAD`). `lastSuccessfulGeneration` + `lastGenerationStory` are stamped by the `automation_generation` node on a successful run — not by the scan.

Per type, cheap filesystem checks that set `validationStatus` + `scanDetails` + `lastScan`:
- **playwright:** path exists, has `package.json` with `@playwright/test`, a `pages/` or specs dir.
- **appium / java-appium:** path exists, has `pom.xml` (Maven) / expected `src` layout; note Java + Maven presence (ties into diagnostics).
- **api:** path exists, has the expected client/config entry points.
- **other:** path exists (best-effort).

Never throws — a missing/invalid framework is recorded, not fatal.

## 4. Consumption (replaces hardcoded paths)

The worker no longer reads `BF_B55168_DIR ?? 'D:\\Playwright\\b55168_pom'` or emits `D:\projects` literals into prompts. Instead:
- A **Project Profile** (see [project-profiles](./project-profiles.md)) references the frameworks it needs by id/name.
- At `automation_generation` / `execution`, the worker resolves the profile's framework → its `localPath` → interpolates that into the agent prompt (via `path.join`, platform-correct separators).
- If a required framework is `not-found`/`invalid`, the node degrades gracefully: it logs, writes a `framework-reference.md` plan instead of specs, and (for mobile) marks execution blocked with a precise reason — never crashes on an absent `D:\` path.

## 5. Migration

Seed two default (unvalidated) entries on first run so existing behavior is one click away:
- "Breadfast Web (Playwright)" → type `playwright`, platform `web`, path = user's `b55168_pom` clone.
- "Breadfast Mobile (Java/Appium)" → type `java-appium`, platform `mobile`, path = user's `D:\projects` clone.

Both start `unscanned`; onboarding/diagnostics validate them.

## 6. Parity note

The canonical Companion's "reuse-before-build against the framework catalogs" is preserved — the registry just makes the framework **location** configurable and multi-entry instead of hardcoded, and surfaces validity. The automation nodes still enforce reuse and follow the same catalogs in `docs/ai/automation/**`.
