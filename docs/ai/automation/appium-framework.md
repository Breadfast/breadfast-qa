# Appium / BrowserStack Mobile Layer (`bs_helper.js`)

> Reference for the mobile automation layer. This is **separate** from the Playwright POM framework ([playwright-framework.md](playwright-framework.md)) — it drives the Breadfast mobile app on real BrowserStack devices.

## What this is

[bs_helper.js](bs_helper.js) is a thin set of helper functions that speak the **WebDriver protocol over raw HTTPS REST** to **BrowserStack App Automate** (`hub-cloud.browserstack.com`). It is **NOT a Page Object Model** — there are no page classes, no fixtures, and no test runner. Each session script `require()`s these helpers and drives the device with explicit `findElement`/`tap`/`getSource` calls.

- Transport: Node `https.request` against `hub-cloud.browserstack.com:443` with Basic auth (`BS_USER:BS_KEY`).
- Appium endpoints: standard `/wd/hub/session/{sid}/...` WebDriver routes.
- Session creation / capabilities (iOS XCUITest, Android UiAutomator2, `appium:language`/`appium:locale`) are **not** in this file. See **[docs/ai/browserstack-process.md](../browserstack-process.md)** for session setup, capabilities, OTP handling, and the platform × language matrix.

The module's BrowserStack credentials are hard-coded constants at the top of the file (`BS_USER`, `BS_KEY`, `HUB`).

## Exported functions

`module.exports = { bsReq, sleep, screenshot, getSource, findElement, findElements, clickEl, typeText, tap, getAttr }`

### `bsReq(method, path, body)`
Core REST primitive. Issues an HTTPS request to the BrowserStack hub with Basic auth and JSON `Content-Type`. Returns a Promise resolving to the parsed JSON response (falls back to the raw string if the body is not JSON). Has a 90s timeout that rejects with `bsReq timeout after 90s: ...`. All other helpers are built on this.
- `method` — HTTP verb (`'GET'`, `'POST'`).
- `path` — WebDriver path, e.g. `` `/wd/hub/session/${sid}/source` ``.
- `body` — optional object, JSON-encoded into the request.

```js
const r = await bsReq('GET', `/wd/hub/session/${sid}/screenshot`);
const b64 = r.value;
```

### `sleep(ms)`
Returns a Promise that resolves after `ms` milliseconds. Used between actions/transitions.

```js
await sleep(3000);
```

### `screenshot(sid, filename)`
Captures a device screenshot (`GET /screenshot`), writes the decoded PNG to `filename`, logs the path, and **returns the raw base64 string** (for storing in a JSON accumulator).
- `sid` — session id; `filename` — local PNG path.

```js
const b64 = await screenshot(sid, 'ios_en_s01_home.png');
```

### `getSource(sid)`
Fetches the live XML page source (`GET /source`). Returns the source string, or `''` if absent. Use for element discovery and label verification.

```js
const src = await getSource(sid);
const labels = (src.match(/label="([^"]+)"/g) || []);
```

### `findElement(sid, strategy, value)`
Finds a single element (`POST /element`). Returns the element id (unwraps both `ELEMENT` and the W3C `element-6066-11e4-a52e-4f735466cecf` key) or `null` if not found.
- `strategy` — e.g. `'accessibility id'`, `'xpath'`, `'class name'`.
- `value` — the locator value.

```js
const el = await findElement(sid, 'xpath', `//*[@label='Start']`);
if (el) await clickEl(sid, el);
```

### `findElements(sid, strategy, value)`
Finds all matching elements (`POST /elements`). Returns an array of element ids (possibly empty).

```js
const fields = await findElements(sid, 'class name', 'android.widget.EditText');
```

### `clickEl(sid, elId)`
Clicks an element by id (`POST /element/{elId}/click`). Returns the raw `bsReq` result.

### `typeText(sid, elId, text)`
Types into an element (`POST /element/{elId}/value`) sending both `text` and `value: text.split('')`. Returns the raw `bsReq` result.

```js
await typeText(sid, fieldId, '29506150112499');
```

### `tap(sid, x, y)`
Taps at absolute screen coordinates via W3C pointer actions (touch: move → down → 80ms pause → up). Use for custom keypads and unlabeled buttons.

```js
await tap(sid, 195, 540); // Pay home "Get started" card widget
```

### `getAttr(sid, elId, attr)`
Reads an element attribute (`GET /element/{elId}/attribute/{attr}`). Returns the attribute value.

```js
const selected = await getAttr(sid, optId, 'aria-selected');
```

## Notes for reuse

- There is **no `tapByLabel`, `tapDigit`, or OTP helper inside `bs_helper.js`** — those patterns live in per-session scripts and in the project [CLAUDE.md](CLAUDE.md) (Sections 2.4–2.6). Compose them from `getSource` + `tap`/`findElement` as needed.
- iOS uses `XCUIElementType*` and `-ios class chain`/`accessibility id`; Android uses `android.widget.*` and `class name`/`-android uiautomator`. See [CLAUDE.md](CLAUDE.md) §11.3–11.4.
- For capabilities, session lifecycle, and the four platform × language combinations, **always** cross-reference [docs/ai/browserstack-process.md](../browserstack-process.md).
