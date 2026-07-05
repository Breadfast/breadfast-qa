# Design — Environment Diagnostics

> **Status:** LOCKED (Phase 0). A diagnostics page + a pre-execution gate. Every failed check carries **Fix Suggestions** (why / how / re-test button).

## 1. Checks

Each check returns `{ id, group, label, status: 'pass'|'warn'|'fail'|'skip', detail, version?, fix }`.

| Group | Check | Required? |
|---|---|---|
| Core | Node.js ≥ 20 | required |
| Core | Git installed | required |
| Core | Claude CLI installed **and signed in** | required |
| Core | Workspace dir resolvable + writable | required |
| Core | `qa.db` reachable / migratable | required |
| Core | Knowledge base present (`CLAUDE.md` + `docs/ai/`) at repo root | required |
| Core | **Platform Parity Health** (see §3.1) | required |
| Integrations | BrowserStack auth valid | required for BS upload / mobile exec |
| Integrations | Jira auth valid | required for fetch / HLS push / bug filing |
| Integrations | Figma session/token valid | required for `figma_analysis` when the story has a Figma URL |
| Frameworks | Playwright framework valid (registry scan) | required for **web** stories |
| Frameworks | Appium/Java framework valid | required for **mobile** stories |
| Frameworks | Java (JDK) present | required for mobile |
| Frameworks | Android SDK present | required for Android |
| Frameworks | Xcode present | required for iOS **on macOS**; `skip` on Windows |

## 2. Gating rule

- **Required-core** failures block **all** execution.
- **Web-only** stories are blocked only by web-relevant failures (Playwright, app URL, BrowserStack for CSV upload if that step is enabled).
- **Mobile** stories additionally require Appium/Java/Android (+ Xcode on macOS for iOS).
- Non-blocking issues surface as `warn`. A story cannot enter `execution` while any of ITS required checks are `fail`.

## 3.1 Platform Parity Health (refinement #6)

A dedicated check that guards the canonical source of truth is present and compatible before any run:

- **Presence:** `CLAUDE.md`, `docs/ai/**` (expected files), `docs/design/**` (design docs), and required prompt assets (schema hints / node prompt templates) all exist at the repo root.
- **Compatibility:** current Knowledge Version + Workflow Version ≥ the platform's minimum supported versions ([parity-baseline](./parity-baseline.md) §6). Flags a stale knowledge base or an out-of-date workflow definition.
- **Integrity:** `CLAUDE.md` content hash resolvable (feeds the run's CLAUDE.md Version); `LIFECYCLE_GRAPH` intact (27 nodes, expected order).

`fail` here blocks ALL execution — a run without the canonical assets would not be at parity. Fix Suggestion points at the missing/stale asset and how to restore/update it.

## 3. Fix Suggestions

Every non-pass check includes a `fix`:
```ts
interface Fix {
  why: string;        // why it failed / what's missing
  how: string;        // concrete remediation steps
  docsUrl?: string;   // where to get it (reuses settings-registry help.where)
  retestAction: string; // check id to re-run
}
```
The UI renders per failed check: **why**, **how**, and a **Re-test** button that re-runs just that check (and its dependents) without a full page reload. Example — *Claude CLI not signed in* → why: "engine can't run without a signed-in CLI"; how: "run `claude` in a terminal and complete sign-in, then Re-test"; button re-runs the Core→Claude check.

## 4. API / UI

- `GET /diagnostics` — run all checks.
- `POST /diagnostics/:id/retest` — re-run one check (+ dependents).
- Diagnostics page: grouped list, per-check status pill, expandable Fix panel, "Re-test all" + per-check re-test. Same check engine feeds the onboarding Health Report (see [onboarding](./onboarding.md)).

## 5. Parity note

Diagnostics is a **precondition guard**, not part of the 27-node workflow. It prevents low-quality/failed runs from starting (e.g. missing knowledge base → the canonical Companion would run "blind"), which directly protects parity.
