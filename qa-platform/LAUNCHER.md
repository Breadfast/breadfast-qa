# Running the platform with one click

Two shortcuts are on your **Desktop**:

| Shortcut | What it does |
|----------|--------------|
| **Breadfast QA Platform** | Starts api + worker + web (production) and opens the app in your browser, already signed in. |
| **Stop QA Platform** | Stops all platform services. |

Double-click **Breadfast QA Platform** → a minimized window starts the services, then your browser opens at the dashboard. First start takes a few seconds.

To stop: double-click **Stop QA Platform**, or close the launcher window.

## What runs

The launcher (`launcher/launch.mjs`, invoked by `Breadfast QA Platform.cmd`) starts:
- API on `http://localhost:4000`
- local worker (executes QA runs on your Claude subscription)
- web app on `http://localhost:3000`

and opens `http://localhost:4000/auth/dev` (local dev sign-in → redirects to the dashboard).

## Requirements (one-time)

Already done on this machine. On a fresh machine:
```
cd qa-platform
npm install
npm run build            # build all workspaces
npm run db:generate && npm run db:push
npm run build -w @qa/web # production web build
```
Then double-click the shortcut.

## Notes

- It runs locally (per the "each tester runs locally" decision) — the URL is `localhost`, not a hosted address.
- Each **Run QA** uses Opus calls on your Claude subscription. For cheap trials set
  `ENGINE_MODEL=claude-haiku-4-5-20251001` in `.env`.
- To recreate the desktop shortcuts, re-run the shortcut-creation step (see project history) or
  point a new shortcut at `Breadfast QA Platform.cmd`.
