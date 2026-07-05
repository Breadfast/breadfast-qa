# Running the platform

The platform runs locally on **Windows, macOS, and Linux**.

## Start / stop

| Action | Command (any OS) | Double-click |
|--------|------------------|--------------|
| Start (api + worker + web, opens the app) | `npm start` | Windows: **Breadfast QA Platform.cmd** · macOS/Linux: **start.command** |
| Stop all services | `npm run stop` | Windows: **Stop QA Platform.cmd** · macOS/Linux: **stop.command** |

Starting opens your browser at the dashboard (first start takes a few seconds). Closing
the launcher window also stops the services. Both start and stop are the same
cross-platform Node scripts (`launcher/launch.mjs`, `launcher/stop.mjs`) under the hood.

> macOS: the first time you double-click `start.command`/`stop.command` you may need to
> allow it in **System Settings → Privacy & Security**, or run `chmod +x *.command` once.

## What runs

- API on `http://localhost:4000`
- local worker (executes QA runs on your Claude subscription)
- web app on `http://localhost:3000`

then opens the local dev sign-in → dashboard.

## Requirements (one-time, fresh machine)

```
cd qa-platform
cp .env.example .env       # safe defaults; no absolute paths; dry-run ON
npm install
npm run build              # dependency-ordered build of all workspaces
npm run db:generate && npm run db:push   # creates the SQLite DB in your workspace
```

The SQLite database and all runtime artifacts live in your per-user **workspace**
(`~/BreadfastQA/Workspace` on macOS/Linux, `%USERPROFILE%\BreadfastQA\Workspace` on
Windows; override with `QA_WORKSPACE_DIR`) — outside the repo.

## Notes

- Local-first: the URL is `localhost`, not a hosted address.
- Each **Run QA** uses Opus calls on your Claude subscription. For cheap trials set
  `ENGINE_MODEL=claude-haiku-4-5-20251001` in `.env`.
