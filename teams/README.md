# Team profiles

The QA process is the same for every team. What differs between teams is a handful of values: the Jira
project, the squad and component names on bugs, and the BrowserStack project and folder. Those values live
here, one file per team, so no script or document assumes a particular squad.

| File | Team |
|---|---|
| [`card-core.json`](card-core.json) | Card Core (BCard) |
| [`payment.json`](payment.json) | Payment (skeleton: fill in on first use) |
| [`_template.json`](_template.json) | Blank, with a description of every field |

This table is informational — **any** squad can add itself without editing it (the tooling reads `teams/*.json`).

## Use an existing team

Pick your team once, in either place:

```js
// automation/config/credentials.local.js  (gitignored, your own copy)
team: 'payment',
```

```bash
export QA_TEAM=payment      # macOS / Linux
setx QA_TEAM payment        # Windows
```

`npm run doctor` shows which team is selected and lists any value that is still `TODO`.

## Add a new team

Any squad (growth, shopping, logistics, …) does exactly this:

1. `node qa-workflow/bin/qa-cli.js team-init <team-id> --name "<Squad>" --surfaces web,mobile,backend`
   (lowercase, hyphens). Jira `B10` and bug type `10084` are org-wide and pre-filled; pass your bug squad /
   components and BrowserStack project / folder as flags (`--web-squad`, `--bs-project`, … — see
   `qa-cli.js team-init`), or leave them TODO and the doctor asks for them.
2. Replace any remaining `TODO`. Ask your squad lead for anything you don't know. `_template.json` explains
   where each value comes from.
3. Delete `jira.bug.mobile` if your team doesn't test mobile. **Keep `jira.bug.web` even for a backend-only
   team** — backend (`be`) bugs use the web squad/components.
4. Commit the file so your teammates get it.
5. **Onboard the team once** — until `teams/<team-id>/context.md` exists, Claude offers onboarding at the start of
   every run (skippable; it never blocks). Run the
   `team-onboarding` skill (`qa-workflow/skills/team-onboarding/SKILL.md`): it learns the product, surfaces,
   environments, repos and docs, and writes a confidence-tagged context (`_template/context.md` shows the
   shape). Commit `teams/<team-id>/` too.
6. Set `domains` to the product domains your stories need (ids from `qa-workflow/registry/knowledge.json`),
   or `[]` and let onboarding create yours with `qa-cli.js domain-init <domain> --owner <team-id> --markers …`.
   Your sessions load **only** those domains; another squad's domain needs a per-story `qa-cli.js cross-domain`.

## What happens when something is missing

Nothing falls back to another team's values. If no team is selected, or a value a script needs still reads
`TODO`, the script stops and names the field. At the start of a story, the prerequisite step
(`qa-workflow/skills/detect-prerequisites`) asks for the missing values in one batch.

Code reads profiles through [`automation/config/team.js`](../automation/config/team.js).
