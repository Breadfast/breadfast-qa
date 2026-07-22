# lib/schema/ — validators (scaffold)

The canonical `qa-state` schema currently lives with the design docs:
[`../../../docs/ai/architecture/qa-state.schema.json`](../../../docs/ai/architecture/qa-state.schema.json)
(validated with Ajv 2020).

**To implement:**
- A validator wrapper that loads `qa-state.schema.json` and validates a story's `qa-state.json`
  before every write (Reconcile step 8).
- Skill-frontmatter validation against the `templates/` shapes.

On implementation the canonical schema **moves here** (single source), and the design doc links to it.
On plugin migration this folder merges into the plugin's `lib/schema/`.
