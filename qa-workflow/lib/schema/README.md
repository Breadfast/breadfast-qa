# lib/schema/ — qa-state validator

`validate.js` exports `validateQaState(state) → { valid, errors[] }`.

**Zero-dependency by design:** it mirrors the canonical JSON Schema
[`../../../docs/ai/architecture/qa-state.schema.json`](../../../docs/ai/architecture/qa-state.schema.json)
(which remains the formal spec) so `qa-workflow` needs no `ajv` install. Keep the two in sync — if the
schema changes, update this validator and `validate.test.js`.

Tested in `validate.test.js`. Used by `../qa-state.js` `save()` before every write.

> On plugin migration, both the canonical schema and this validator consolidate into the plugin's
> `lib/schema/` (which may swap the hand-rolled validator for ajv against the same JSON Schema).
