# lib/ — QA workflow machinery

Authoring/validation machinery (Node, zero-dependency, run by the workflow orchestration).
**Not** runtime automation — Playwright/Appium helpers live in `../../automation/**` and are invoked
during execution.

| Module | Purpose | Status | Migrates to |
|---|---|---|---|
| `freshness/` | fingerprint sources → invalidate → list-stale (the `Reconcile()` engine) | **implemented** (tested) | plugin `drift` internals |
| `schema/` | `validateQaState()` for `qa-state.json` (mirrors the canonical JSON Schema) | **implemented** (tested) | plugin `lib/schema/` |
| `qa-state.js` | read / write (validated) / checksum helper + `makeIo` + `applyModified` | **implemented** (tested) | plugin lib |

## Tests
```
node --test qa-workflow/lib/freshness/freshness.test.js \
            qa-workflow/lib/schema/validate.test.js \
            qa-workflow/lib/qa-state.test.js
```
(32 tests; built-in `node:test`, no test-framework dependency.)
