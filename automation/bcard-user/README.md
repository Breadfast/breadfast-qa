# bcard-user — create a BCard test user at any stage

One command, all by API, on the **testing** environment:

```
node automation/bcard-user/create_bcard_user.js [--stage <stage>] [--phone <number>]
npm run bcard-user -- --stage registered --phone 01150211684
```

| `--stage` | What you get | Typical time |
|---|---|---|
| `account` | Breadfast account, no card record (card status `NA`) | ~3 s |
| `pending` | + invitation code consumed + `createCardUser` | ~10 s |
| `registered` | + Pay passcode set (`--kyc` also completes KYC) | ~11 s |
| `received` | + KYC + a pool card collected at the pickup location | ~16 s |
| `linked` | + card linked to the user | ~18 s |
| `active` *(default)* | + set-pin + activate | **~20 s** |

Every step reads the card status back and stops if it is not the expected one.

## Phone

- **No `--phone`** → a random EG number is registered.
- **`--phone` of an existing account** → used as-is. Its `breadfast_id` is read from the DB (`--breadfast-id` skips that).
- **A phone that already has a card record resumes**, so `--phone X --stage active` on a Registered user runs only
  the remaining steps, and a user already at or past the stage is left alone.

Accepted spellings: `01150211684`, `1150211684`, `+201150211684`.

## What the run prints

Phone, breadfast id, card status, national id, **Pay passcode** (`123321`), **Pay OTP** (last 4 digits of the
phone), package / BCID. Each user is also appended to `output/created-users.jsonl` (gitignored), which is how a
later run finds the BCID of a card it collected.

## Card PIN: mock MDP vs real MDP

Testing runs on **mock MDP**: `set-pin` returns a static page that never reaches card-service. The default
`--pin-mode mock` therefore opens no browser and calls `activate` straight after `set-pin`.

When testing moves to **real MDP**, use `--pin-mode webview` (or `BCARD_PIN_MODE=webview`). It opens the
`set-pin` link in headless Chromium, enters and confirms `--card-pin` (default `1111`; `--headed` to watch),
then activates. Its locators come from the Java `SetCardPinPage` and **have not run against real MDP yet**,
so check the first run. If the link is still the mock page, it says so.

## Known limit: brand-new registration is blocked right now

`send-otp` refuses every request from outside the app with `422 "Something went wrong"`. The app sends a
reCAPTCHA token with it, and the API version gate needs `accept-version` ≥ the app's calendar version
(`1.0.0` → `426`). It has been like this since about 2026-09-13 (B10-59340, E-1). Until backend gives testing a
reCAPTCHA bypass, **register the number in the app once and pass it with `--phone`**. Every card stage works
from there. The registration code is already in place and will work again once the bypass exists.

## Other options

`--national-id`, `--bcid` (resume a Received user this script did not collect), `--count <n>` (n users in
parallel; random phones only), `--json`.

## Reused, not rebuilt

Card-service calls come from [`CardUserFactory`](../helpers/CardUserFactory.js), wp-json registration from
[`BreadfastUserRegistrar`](../helpers/BreadfastUserRegistrar.js), and the DB from [`DbHelper`](../helpers/DbHelper.js)
(bastion key `~/.ssh/id_rsa`). URLs and secrets come from the Java framework's property files via
[`CardConfig`](../helpers/CardConfig.js). Nothing is stored here.
