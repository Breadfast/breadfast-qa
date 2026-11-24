# Card User Creation & Activation

A small local web UI over [`automation/bcard-user/create_bcard_user.js`](../bcard-user/create_bcard_user.js).
Create a BCard test user (typed number or a freshly registered one), drive it to any card stage, choose
Mock vs Real MDP for the card-PIN step, and watch a live table of everyone this page has created.

```bash
npm run card-sandbox          # or: node automation/card-sandbox/server.js
# → opens http://localhost:4100 in your browser (OPEN=0 to skip; PORT=xxxx to change)
```

Built on Node's built-in `http` — **no new dependencies**. It reuses the repo's `DbHelper` (card DB over
SSH) for read-only status and enrichment, and spawns `create_bcard_user.js --json` for every creation, so
all card-service logic stays in one place and no endpoints/payloads are re-implemented here.

### Open it through an HTML file

`public/index.html` is self-contained — **double-click it** (opens as `file://…`) and it talks to the local
server. You still start the server once; the HTML is only the UI. From disk it calls `http://localhost:4100`
by default — on another port open `index.html?port=5000` (or `?api=http://localhost:5000`).

## How it maps to the flow (discovered, not assumed)

- **Register** → `BreadfastUserRegistrar` (WordPress `send-otp`/`verify-otp`/`register`, OTP from Google Chat).
  *Generate a new number* runs the tool with no `--phone`; EG prefixes come from the existing generator.
- **Card ladder** → `account → pending → registered → received → linked → active`. The tool **resumes** from
  the current status to the target; it never skips a stage and never re-registers an existing user (so no
  duplicates). `Closed` is terminal. An entered number already at/above the target is a **no-op**.
- **Passcode** → the per-user **Pay passcode** (6 digits), default `123321` from the framework's
  `cardServiceConfigs_testing.properties` (test data, not an app secret). If an app-registered account set
  its own, the default is rejected at login and the page asks you for the correct one — it never auto-retries.
- **Status** → read live from the card DB (`wallet_users.status`). The current-status check is **read-only**:
  it never registers or changes anything.

## Mock vs Real MDP — important

There is **one** card-services backend on testing (`card-panel-testing.breadfast.tech`) wired to **one** MDP.
There is no mock-vs-real MDP *environment* to select at user/card creation. The only mock/real lever is the
**card-PIN step at Active** (the tool's `--pin-mode`):

- **Mock MDP** → `--pin-mode mock`: a static mock PIN page; nothing is stored at the processor.
- **Real MDP** → `--pin-mode webview`: the live PIN webview at `devcarduat.mdp.global`.

The mode is passed **explicitly** (never `auto`), so there is **no silent fallback** between mock and real.

**Safety:** a Real-MDP activation runs **only** after you confirm it in the review modal (the server rejects
`active + real` without `confirmReal`). It can never be triggered by opening the page, checking status,
generating a number, or changing a field. Every attempt (success or failure) is written to
`attempts.jsonl` with its chosen MDP mode — **no passcode or token is ever logged**.

## Card pool (no user)

The **Card pool** panel issues 1–50 free cards (`create_bcard_user.js --pool-only`) and shows each card's
package number, BCID, UID (the MDP card id, `cards.externalId`) and card row id. Click any cell to copy it,
or use **Copy all** to copy the batch. The table below the panel lists every pool card issued from this page
(saved in `pool.jsonl`, gitignored), with its live state read from the card DB:
**Free** (still in the pool), **Collected** (a user picked up the package) or **Linked** (bound to a wallet
user). The holder's phone is shown once the card has one.

## Created-users table

Each creation is saved to `created.jsonl` and enriched live from the card DB on load: phone, card status,
requested target, PIN-MDP mode, Breadfast user id, wallet user id, BCID, card id, MDP card id, national id,
passcode, card PIN, Pay OTP, created date. Newest first; search by phone or user id; refresh button; loading /
empty / error states. Both `.jsonl` files are **gitignored** (per-user, not shared).

## Limitations / configuration

- **Real MDP must be up.** When the processor's customer-creation endpoint errors (seen as `something went
  wrong` on link, `PL/SQL: could not find program unit` in `provider_logs`), link/activation fail and the user
  is left at its last good stage — the page reports the **partial** status reached, verbatim error included.
  This is true for both mock and real PIN modes, because card *creation* always goes through the one backend.
- **History** lives in `created.jsonl` (simple append log) since no card API returns "users created by this
  tool". It survives refreshes and is re-enriched from the DB each load.
- The card DB connection is the repo's configured `credentials.cardDb` (live card-panel store). It only reads;
  every card state change goes through `create_bcard_user.js`.
