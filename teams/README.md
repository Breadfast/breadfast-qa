# Team profiles

The QA process is the same for every team. What differs between teams is a handful of values: the Jira
project, the squad and component names on bugs, and the BrowserStack project and folder. Those values live
here, one file per team, so no script or document assumes a particular squad.

| File | Team |
|---|---|
| [`card-core.json`](card-core.json) | Card Core (BCard) |
| [`payment.json`](payment.json) | Payment (skeleton: fill in on first use) |
| [`_template.json`](_template.json) | Blank, with a description of every field |

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

1. Copy `_template.json` to `teams/<team-id>.json` (lowercase, hyphens, e.g. `orders`).
2. Replace every `TODO`. Ask your squad lead for anything you don't know. `_template.json` explains
   where each value comes from.
3. Delete `jira.bug.web` or `jira.bug.mobile` if your team doesn't test that surface.
4. Commit the file so your teammates get it.

## What happens when something is missing

Nothing falls back to another team's values. If no team is selected, or a value a script needs still reads
`TODO`, the script stops and names the field. At the start of a story, the prerequisite step
(`qa-workflow/skills/detect-prerequisites`) asks for the missing values in one batch.

Code reads profiles through [`automation/config/team.js`](../automation/config/team.js).
