# domains/ — product (business-domain) knowledge

Each folder is one **domain**: the business rules, flows, test accounts, interaction quirks, regression
playbooks and incident history of one product area. A session reads a domain **only** when its team lists it
(`teams/<team>.json → domains`) or an operator approved a cross-domain read for the story
(`qa-cli.js cross-domain`). The index is [`../registry/knowledge.json`](../registry/knowledge.json); the plan
for a team is `node qa-workflow/bin/qa-cli.js knowledge --team <id>`.

| Domain | Owner |
|---|---|
| `card` | `card-core` |
| `payment` | `card-core` |
| `marketing` | `card-core` |

What each domain holds: its `description` and `files` in the registry (kept out of this always-loaded README
so no team reads another team's product knowledge by accident).

## Rules
- **Only the owner team edits a domain.** Another team proposes the change (PR to the owner).
- **No secrets.** Test phone numbers and test-environment passcodes are allowed; tokens and passwords never are
  (`npm test` runs the secret scan).
- **Provenance on every file** (header) and confidence tags on new facts: `[confirmed: <src>; <date>]`,
  `[inferred: …]`, `[tester: <name>; <date>]`, `[unknown]`, `[outdated: <superseded by>; <date>]`.
- **Incidents become lessons** in `history.md`; the core rule they produced cites `<domain>/L-xx`, never a ticket.
- Register every new file in `knowledge.json` (an unregistered domain file fails `scripts/knowledge-isolation.test.mjs`).

## Why the `SKILL.md` files still say they wrap `docs/ai/business/**`
Each domain's `SKILL.md` is the **freshness lock**: its `version` + checksum are recorded in every story's
`qa-state.json`, and changing it marks the artifacts that consumed the domain as stale (`reconcile` rule e).
When the content moved here on 2026-11-24 the `SKILL.md` files were deliberately **left untouched**, so the 11
in-flight Card stories were not re-opened by a move that changed no rule. The registry — not `SKILL.md` — is the
index now. The next real change to a domain's rules should update its `SKILL.md` and bump its `version`, which
is the intended "this domain changed" signal.
