# lib/ — QA workflow machinery

Authoring/validation machinery (Node, zero-dependency, run by the workflow orchestration).
**Not** runtime automation — Playwright/Appium helpers live in `../../automation/**` and are invoked
during execution.

| Module | Purpose | Status | Migrates to |
|---|---|---|---|
| `freshness/` | fingerprint sources → invalidate → list-stale (the `Reconcile()` engine) | **implemented** (tested) | plugin `drift` internals |
| `freshness/generators.js` | reads skill/domain frontmatter → the inputs for staleness rules **(d)** generator-version and **(e)** domain-changed (ADR-001 §3.3's `lock` seam) | **implemented** (tested) — wired 2026-08-09 | plugin `lock`/`drift` |
| `testcases/` | canonical BrowserStack CSV reader + the **mechanical half of the test-case review gate** (`testcase-lint`) | **implemented** (tested) | plugin `lib/` |
| `schema/` | `validateQaState()` for `qa-state.json` (mirrors the canonical JSON Schema) | **implemented** (tested) | plugin `lib/schema/` |
| `qa-state.js` | read / write (validated) / checksum helper + `makeIo` + `applyModified` | **implemented** (tested) | plugin lib |
| `conformance/` | generic Conformance Engine contract — `Finding` · `computeHealth`/`detectPatterns` · `ConformanceCapability` (ADR-003; visual = instance #1) | **implemented** (tested) | plugin `lib/` |

## Tests
```
node --test "qa-workflow/**/*.test.js"
```
(170 tests; built-in `node:test`, no test-framework dependency. Note `node --test <dir>` does not
recurse the way the glob does — use the quoted glob.)
