# Advice Message Simulator

Fires MDP authorization advice messages at a running Card-Hades backend, the same way
MDP does in production. Useful for creating transactions on a card without a real POS:
each advice lands as a transaction request, updates balance history and triggers the
user's push notification.

It hits the two endpoints handled by
`src/api/controllers/integrations/MDP/AdviceMessagesController.ts`:

- `POST /api/v1/mdp/oauth2/token` — client-credentials login
- `POST /api/v1/mdp/authorization-advice` — the advice itself

No dependencies. Node 18+ (uses the built-in `fetch`).

## Setup

```bash
cd advice-simulator
cp .env.example .env
# then fill in BASE_URL, MDP_CLIENT_SECRET and CARD_ID
```

`.env` is git-ignored, so the secret stays local.

## Run

```bash
node simulate-advice-messages.js
```

That uses everything from `.env`. Override any of it per run with flags:

```bash
# one purchase on a specific card
node simulate-advice-messages.js --card 100002166102 --type PURCHASE --count 1

# ten refunds of 20 EGP each, no pause between them
node simulate-advice-messages.js --type REFUND --count 10 --amount 20 --delay 0

# simulate a decline
node simulate-advice-messages.js --responseCode 116
```

Precedence: **CLI flags → shell env vars → `.env` → built-in defaults.**

| Flag | `.env` key | Meaning |
| --- | --- | --- |
| `--card` | `CARD_ID` | MDP card id (`Cards.externalId`), **not** our internal card UUID |
| `--to` | `RECEIVER_CARD_ID` | Receiver's MDP card id for `--type P2P` (`cardId2`) |
| `--date` | — | Back-date the advice: `DD/MM/YYYY` or `YYYY-MM-DD` |
| `--type` | `TRANSACTION_TYPE` | Name (`PURCHASE`, `REFUND`, …) or raw MDP code (`774`) |
| `--count` | `REQUEST_COUNT` | How many advices to fire, sequentially |
| `--amount` | `AMOUNT_EGP` | Amount in EGP; empty = random 1–1000 per request |
| `--delay` | `DELAY_MS` | Pause between requests |
| `--responseCode` | `RESPONSE_CODE` | `-1` = approved, anything else = declined |
| — | `BASE_URL` | Target environment |
| — | `MDP_CLIENT_ID` / `MDP_CLIENT_SECRET` | Must match `mdp.adviceMessage` in the target env's `config/local.js` |
| — | `MERCHANT_ID` | Acquirer merchant id in the payload |

## Reversals

`simulate-reversal.js` sends an `0420` to `POST /api/v1/mdp/reversal` with the **same
`utrnno`, `retrievalReferenceNumber` and `stan`** as the original advice, so it hits the
same transaction. Every accepted advice is stored in `sent-advices.json` (local only, keep
it out of git), tagged with its `BASE_URL`, so the reversal can pick it up:

```bash
# reverse the last advice sent to BASE_URL (full amount)
node simulate-reversal.js

# reverse a specific one (leading zeros optional), or only part of it
node simulate-reversal.js --utrnno 001234567890
node simulate-reversal.js --utrnno 001234567890 --amount 20

# an advice not sent by this simulator (Postman, real MDP...): give the references yourself
node simulate-reversal.js --utrnno 319925 --rrn 508403 --amount 77.80 --card 100002114740 --type REFUND
```

Extra flags: `--stan` (only for the manual case, random otherwise) and `--responseCode`.

## Environments

| Env | `BASE_URL` |
| --- | --- |
| Local | `http://localhost:1337` |
| Testing (via panel host) | `https://card-panel-testing.breadfast.tech` |
| Testing (backend host) | `https://card-backend-testing.breadfast.tech` |

You can also override per run without touching `.env`:

```bash
BASE_URL=https://card-panel-testing.breadfast.tech node simulate-advice-messages.js --count 1
```

## Transaction types

Mirrored from `src/api/enums/cards/providers/MDP/TransactionType.ts`:

`PURCHASE` (774), `PRE_PURCHASE_AUTHORIZATION` (736), `PURCHASE_COMPLETION` (737),
`DEBIT_PRESENTMENT` (659), `CASH_WITHDRAWAL` (700), `P2P_DEBIT` (781), `CASH_DEPOSIT` (618),
`REFUND` (775), `P2P_CREDIT` (785), `CREDIT_PRESENTMENT` (760), `FUNDS_TRANSFER` (703),
`CARD_TO_CARD_MONEY_TRANSFER` (689), `BALANCE_INQUIRY` (702), `CARD_ACTIVATION` (644),
`ACCOUNT_VERIFICATION_REQUEST` (796), `CARD_STATUS_CHANGE` (672), `PIN_COUNTERS_RESET` (748),
`FORCED_PIN_CHANGE` (603), `CARD_VALIDATION` (782).

Special cases the script handles for you:

- **`P2P`** (not an MDP code) — a user-to-user transfer. Sends two advices with the same
  rrn/stan: `P2P_DEBIT` (781) then `P2P_CREDIT` (785), both with `cardId` = sender
  (`--card` / `CARD_ID`) and `cardId2` = receiver (`--to` / `RECEIVER_CARD_ID`).
  `--to` takes the receiver's MDP card id; there is no phone-number lookup.

  ```bash
  node simulate-advice-messages.js --type P2P --to 100002114739 --amount 50
  ```

- **`P2P_CREDIT` (785)** — the backend reads the card from `cardId2`. With `--to` that's the
  receiver; without it the script puts your `--card` there, crediting it.
- **`P2P_DEBIT` (781)** — the controller returns early and ignores it. The request will
  still answer `200`, but nothing is stored.

## Gotchas

- **The card must exist in the target environment.** The endpoint always answers
  `200 {"responseCode":"00"}`, even when the card is unknown — the failure only shows up
  in the app logs as `Invalid Card Id: <id>`. So a green run is not proof a transaction
  was created; check the logs or the user's transaction list the first time.
- **Each request is a new transaction.** `utrnno`, `retrievalReferenceNumber` and `stan`
  are randomised per request, because `utrnno` (with leading zeros trimmed) becomes the
  transaction's `external_id` — reusing one updates the previous transaction instead of
  creating a new one.
- **Testing is shared, and pushes are real.** Every approved advice sends a push
  notification to the card's user. Start with `--count 1` and keep `--delay` at its
  default before firing batches.
- **`Login failed (400)`** means `MDP_CLIENT_ID` / `MDP_CLIENT_SECRET` don't match
  `sails.config.mdp.adviceMessage` in that environment.
