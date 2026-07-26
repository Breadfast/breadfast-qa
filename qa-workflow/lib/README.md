# lib/ — QA workflow machinery

Authoring/validation machinery (Node, zero-dependency, run by the workflow orchestration).
**Not** runtime automation — Playwright/Appium helpers live in `../../automation/**` and are invoked
during execution.

| Module | Purpose | Status | Migrates to |
|---|---|---|---|
| `freshness/` | fingerprint sources → invalidate → list-stale (the `Reconcile()` engine) | **implemented** (tested) | plugin `drift` internals |
| `schema/` | `validateQaState()` for `qa-state.json` (mirrors the canonical JSON Schema) | **implemented** (tested) | plugin `lib/schema/` |
| `qa-state.js` | read / write (validated) / checksum helper + `makeIo` + `applyModified` | **implemented** (tested) | plugin lib |
| `conformance/` | generic Conformance Engine contract — `Finding` · `computeHealth`/`detectPatterns` · `ConformanceCapability` (ADR-003; visual = instance #1) | **implemented** (tested) | plugin `lib/` |

## Tests
```
node --test qa-workflow/lib/freshness/freshness.test.js \
            qa-workflow/lib/schema/validate.test.js \
            qa-workflow/lib/qa-state.test.js \
            qa-workflow/lib/conformance/finding.test.js \
            qa-workflow/lib/conformance/capability.test.js \
            qa-workflow/lib/conformance/resolver.test.js \
            qa-workflow/lib/conformance/pipeline.test.js \
            qa-workflow/lib/conformance/run.test.js \
            qa-workflow/lib/conformance/residual.test.js
```
(62 tests; built-in `node:test`, no test-framework dependency.)
