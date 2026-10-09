# AGENTS.md

Guidance for AI agents working in this repository.

## Project Overview

**The Stylus** is a browser-based tool that lets 3 Card Blind MTG "gurus" edit result sheets for matches hosted on [3cardblind.com](https://www.3cardblind.com). It is a pure client-side application: no backend, no build step, no server dependencies.

- **Stack:** HTML5, CSS3, native ES6 modules
- **External APIs:** Google Sheets API v4, Google Drive API v3, Google OAuth 2.0 (GIS), Scryfall API (card images)
- **Persistence:** Google Sheets (match data) and Google appData / browser `localStorage` (config, signatures, recent pods/hubs)
- **Hosting:** static files, also installable as a PWA (`site.webmanifest` + `sw.js`)

## Domain Logic (read this before touching scoring code)

A 3 Card Blind match is between two players, each with a 3-card deck. The outcome is decided by human **gurus** who analyse the match and score it **Win / Tie / Loss** (`ANALYSIS_VALUES` = 1.0 / 0.5 / 0.0 in `js/utils/constants.js`).

- Three gurus cover each match, one per colour: **Red, Blue, Green** — each scores from their own perspective.
- A guru must **claim** a match by entering their **guru signature** before scoring it. The signature is what other gurus see to know the match is taken.
- A guru can only analyse matches they have claimed.
- A **pod** is a group of matches; a **hub** aggregates threads/pods (see `HubManager`).
- Matches may also be scored as **goldfish** (a signature variant) — preserve this behaviour.

## Domain Layer (`js/domain/`)

Pure functions only: no DOM, no `gapi`, no `fetch`, no instance state. Everything
takes the data it needs (row, colour, signature, column indices) as arguments.
`GuruAnalysisInterface` keeps thin delegating methods so its rendering and event
call sites are unchanged; new pure logic belongs here, not in the class.

### The colour registry

`js/domain/guruColor.js` is the single source of truth for what a guru colour is.
`GURU_COLORS` drives the sheet schema, not just the field names:

- `guruSheetName` / `colourFromSheetTitle` derive tab naming and matching.
- `mergedGuruHeader` / `mergedColumnMapping` / `mergedLastColumn` derive the
  merged-sheet header and column layout.

`googleSheetsAPI.js` consumes these rather than hard-coding `'Red Gurus'`,
`'Red Analysis'` or the 3..8 column numbers. Adding a fourth colour is a change
to `GURU_COLORS` in this module, plus the real spreadsheet gaining that tab and
its columns; the API module should need no edit. `calculateOutcomeFromAnalyses`
takes one analysis per colour (via spread) and compares against
`GURU_COLORS.length`, so it follows too — but note the scoring policy itself
(majority/tie handling for an even guru count) is deliberately undecided until a
colour is actually added. Do not add a colour without deciding that policy.

## App Shell (`js/app/`)

Phase 4 of #18 moved the analysis session's mutable state off the controller and
onto one object.

- `AppState` is the single source of truth for the open pod: `sheetData`
  (and its derived `spreadsheetId`), `rows`, `rowIndex`, `guruColor`,
  `signature`, `numDiscrepancies`, the deck-notes map/column map, the grouped
  `deckNotesEntries`/`deckNotesValues`, the resolved per-colour `columnIndex` and
  the `hub`. Mutate it only through its setters;
  `reset()` clears the per-pod fields but deliberately keeps `signature`, which
  belongs to the session rather than the pod. `currentRowKey()` /
  `findRowIndexByKey()` give a stable row identity (tab id + original row index)
  so a reload does not depend on the player names.
- `AnalysisController.state` is that object; the views (`analysisView`,
  `analysisRowRenderer`, ...) and the extracted services (`analysisActions`,
  `analysisNavigation`, `analysisSessionLoader`) read it via `host.state`.
- `reload({ preservePosition })` in `analysisActions.js` is the only reload
  path. A failed refresh is non-fatal by design: the screen keeps its data.
- `EventBus` / `APP_EVENTS` replace the `window` CustomEvents that used to carry
  the login / logout / signature flow. `main.js` subscribes in
  `setupEventSubscriptions()`; `AuthManager` and `GuruSignature` emit and
  subscribe through the bus they are handed. Handler registration in `main.js`
  is guarded by `_domBound` / `_signatureHandlersBound` so it is idempotent
  without the old reset-on-logout flags.

### The guru signature (phase 5 of #18)

The guru signature is session identity, not reactive state. It is set once,
persisted, and only changes in exceptional circumstances, so it is modelled as a
mostly immutable value rather than a live field.

- `GuruSignature` (`js/modules/guruSignature.js`) is the **single owner** of the
  current value. It keeps `this.signature` in memory and delegates persistence to
  `UserPreferences` (Google appData, with a `localStorage` fallback when
  preferences are unavailable). Nothing else stores a copy.
- `AuthManager` deliberately holds **no** signature string. `this.guruSignature`
  is the injected owner object, and `getGuruSignature()` reads through it, so
  there is no stale duplicate to keep in sync. `main.js` wires the owner in after
  constructing both.
- `initSignature()` takes no argument: the owner loads the persisted value
  itself. `main.js:onUserLoggedIn` calls it after `UserPreferences` initialises.
- `AnalysisController` receives a **snapshot string** at construction
  (`main.js` passes `guruSignature.getSignature()`), stored in
  `AppState.signature`. There is no `setGuruSignature`; a pod that is open cannot
  have its signature changed underneath it.
- Changing the signature is therefore an explicit restart. The change affordance
  is the header's `#guru-signature-display`, and the header is hidden while a pod
  is open (`#sheet-editor` fullscreen). To change it a guru leaves the pod first;
  the next `loadSheet` resolves the colour and rows against the new value.
- `APP_EVENTS` only needs `USER_LOGGED_IN`, `USER_LOGGED_OUT` and
  `REQUEST_GURU_SIGNATURE_CHANGE`. The old `GURU_SIGNATURE_LOADED` /
  `GURU_SIGNATURE_CHANGED` events were removed with the duality they carried.

### The clocks & notes gate (`js/modules/deckNotesEditor.js`)

While the guru sheets are hidden, the app shows the Deck Notes screen one deck
at a time before guruing can start. It is a gate and a view at once:

- `groupDeckNotes(values, columnMap)` in `js/domain/deckNotes.js` collapses each
  run of consecutive rows with the same decklist **and** identical editable data
  (clock + notes + additional notes) into one entry with `rows[]` write targets.
  The goldfish signature is not part of the identity. Non-consecutive repeats
  stay separate.
- `allClocksFilled` is the gate predicate; `deckNotesProgress` feeds the
  "X of M clocks filled" line. Gating is clocks-only (the signature is shown,
  not required).
- `DeckNotesView` (`js/ui/deckNotesView.js`) is DOM-only and reuses the analysis
  shell (`match-details` + `content-sidebar`) so one deck's cards sit on the left
  with the controls on the right, stacking under them on mobile.
- The deck-info panel is shared with the analysis screen via
  `js/ui/deckInfoView.js`; the gate passes `variant: 'prominent'` for larger,
  full-width edit affordances. Hovering the clock shows its goldfish
  signature(s) with the analysis screen's `.guru-signature-tooltip`.
- Saves go through `AnalysisController.saveDeckInfoField` →
  `AnalysisActions.saveDeckInfoField`, which resolves the grouped entry's
  `rows[]` and writes them all in one call (a clock edit also signs column C on
  every row). The gate therefore reuses the analysis write path rather than
  owning one.
- `AnalysisController.openDeckNotes()` opens the same screen from an active
  session; the **Deck Notes** button in the analysis controls triggers it and the
  screen offers **Back to analysis** instead of **Start guruing**.

## Characterization (intentional current quirks)

`tests/unit/characterization.test.js` pins these. Each is labelled CONTRACT
(must not change) or ACCIDENT (free to fix later, but only deliberately):

- **CONTRACT** — `calculateOutcomeFromAnalyses` compares raw strings, so `'1.0'`
  vs `'1'` is a `Discrepancy`.
- **CONTRACT** — `Incomplete` / `Discrepancy` are exact capitalised strings.
- **CONTRACT** — the app never reads columns D (Outcome) or K (Inverse Check);
  it fetches only `A1:C1000` and `E1:F1000` and recomputes the outcome locally.
- **ACCIDENT** — the metadata sheet is headerless, so the parser's "skip header
  if present" comment never fires on real data. A *headered* metadata sheet does
  produce a spurious `variableName` key; synthetic fixtures hit that, real sheets
  do not. Do not "fix" one case into breaking the other.
- **ACCIDENT** — every cell arrives as a FORMATTED_VALUE string (`"1"`, `"0.5"`,
  `"0"`), never a number. The exported `.xlsx` storing floats is a file-format
  artefact, not the wire format the app sees.

## Repository Structure

```
the-stylus/
├── index.html                  # Single-page app markup (loads Google APIs + js/main.js as a module)
├── js/
│   ├── main.js                 # Entry point: ThreeCardBlindGuruTool bootstrap + init flow
│   ├── config.js               # Google OAuth client ID, scopes, discovery docs, localStorage keys
│   ├── app/                    # App-shell plumbing (no DOM)
│   │   ├── appState.js         # Analysis session state: one object, explicit mutators + reset()
│   │   └── events.js           # Local pub/sub + APP_EVENTS (login / logout / signature)
│   ├── domain/                 # PURE: no DOM, no gapi, no fetch, no instance state
│   │   ├── analyses.js         # outcome calc, normalize, labels, css class, correction string
│   │   ├── deckNotes.js        # deck-notes parsing/grouping + per-colour statistics
│   │   ├── diagnosticLog.js    # diagnostic-log formatting + redaction (buffer cap, filename)
│   │   ├── guruColor.js        # colour registry: fields, sheet names, merged-column layout
│   │   ├── inverseCheck.js     # inverse-error detection helpers
│   │   ├── matchRows.js        # row model build + find first incomplete/discrepancy/mirror, deck stats
│   │   └── recentEntries.js    # recent-pod/hub record shape + legacy sheetId fallback
│   ├── modules/                # ES6 class-based feature modules
│   │   ├── authManager.js
│   │   ├── deckNotesEditor.js         # Deck Notes gate controller: grouping, index, poll, hand-off
│   │   ├── googleSheetsAPI.js
│   │   ├── guruSignature.js
│   │   ├── hubManager.js
│   │   ├── recentPods.js
│   │   ├── scryfallAPI.js
│   │   ├── uiController.js            # Centralised event handling / status UI
│   │   └── userPreferences.js
│   ├── ui/                     # View / controller split (phase 3 of #18); state lives in js/app/
│   │   ├── analysisController.js      # Slim orchestrator: state + service calls + view.render
│   │   ├── analysisActions.js         # Write/score workflows (set, claim, clear, reload)
│   │   ├── analysisNavigation.js      # Row movement: next/prev, skips, mirror, next deck
│   │   ├── analysisSessionLoader.js   # Sheet -> session state: colour, rows, start row
│   │   ├── analysisRowRenderer.js     # Per-row render pipeline + URL/title sync
│   │   ├── analysisEventBinder.js     # Scoring/nav button + thread-modal event wiring
│   │   ├── analysisView.js            # All DOM rendering for the scoring screen
│   │   ├── analysisWriter.js          # All spreadsheet writes for the scoring screen
│   │   ├── cardPresenter.js           # Scryfall card loading + preloading
│   │   ├── deckInfoView.js            # Shared deck-info panel (compact / prominent)
│   │   ├── deckNotesView.js           # All DOM rendering for the one-deck gate screen
│   │   ├── guruColorSelector.js       # Colour dropdown, owns its dismiss listeners
│   │   ├── matchStatus.js             # Pure match-status descriptors/markup
│   │   ├── matchTableModal.js         # Match table modal, open/close/destroy
│   │   ├── matchTablePresenter.js     # Row/status options for the match table
│   │   ├── threadModal.js             # Create-thread modal, open/close/destroy
│   │   └── threadPresenter.js         # Builds the Discord thread text for a row
│   ├── services/               # Small infrastructure helpers
│   │   └── storage.js          # localStorage/sessionStorage wrapper: get/set/remove + JSON, safe when unavailable
│   └── utils/                  # Pure helper functions
│       ├── constants.js        # STATUS_TYPES, ANALYSIS_VALUES, TIME_CONSTANTS
│       ├── domUtils.js         # Safe DOM access (getElement/waitForElement/addEventListenerSafe)
│       ├── log.js              # logger + bounded diagnostic buffer (debug gated by ?debug)
│       ├── podUtils.js         # pod name <-> code conversion
│       └── urlUtils.js         # Sheet URL validation/parsing/sanitising
├── styles/main.css             # All application styles
├── sw.js                       # Service worker: APP_VERSION, precache list, Scryfall cache
├── site.webmanifest            # PWA manifest
├── favicons/ images/           # Static assets
├── tests/
│   ├── unit/                   # node:test suites (node --test)
│   ├── e2e/                    # Playwright specs + in-browser Google/Scryfall stubs
│   └── fixtures/               # Shared sheet-data fixtures and fake gapi
├── playwright.config.js        # Playwright config (dev-only; serves files statically)
├── .github/
│   └── workflows/tests.yml     # CI: runs unit + e2e on push/PR to main
└── package.json                # Metadata + dev-only test scripts (no runtime deps)
```

## Development Workflow

No install or build is required. Serve the files statically:

```bash
python -m http.server 8000   # then open http://localhost:8000
```

- Always start by reading `index.html` and `js/main.js`.
- Modules use ES6 `import`/`export`; follow the import chain to understand dependencies. Import paths are **case-sensitive**.
- Google APIs are loaded from CDN, so the app needs network access to fully run.
- Verify syntax without a build tool: `node -c <file>` (no ESLint config exists; `node --check` is equivalent).
- There is a CI workflow at `.github/workflows/tests.yml` that runs both suites
  on pushes and pull requests to `main`. Ask before adding further workflows.

### Testing

The app has no backend and the public app ships zero dependencies, so tests must
run without Google credentials, without network access, and without adding
anything to the shipped bundle. Playwright is a **devDependency only** — never
add a runtime dependency or reference test files from `index.html`/`sw.js`.

```bash
npm install                    # installs Playwright (dev only)
npm run test:e2e:install       # one-time Chromium download
npm test                       # unit + e2e
npm run test:unit              # node:test only (fast, no browser)
npm run test:e2e               # Playwright only
```

**Unit tests** (`tests/unit/`, built-in `node:test`, no dependencies):
- `js/utils/*` and `js/domain/*` are pure and imported directly.
- `AnalysisController` UI-flow methods (e.g. `processDeckNotes`) are tested via
  `Object.create(AnalysisController.prototype)` and an explicit fake `this`. The
  constructor calls `bindEvents()` and needs a DOM, so do not `new` it in unit
  tests. Since Phase 1 and Phase 3 moved the scoring/row logic into
  `js/domain/`, only a few UI-flow methods still need this scaffolding.
- `GoogleSheetsAPI` is tested against a fake global `gapi` (`tests/fixtures/fakeGapi.js`)
  that records requests. Tests assert on the requests and the transformations.
  Change the module to read `gapi` lazily; do not capture it at import time.
- `characterization.test.js` pins the intentional current quirks (labelled
  CONTRACT or ACCIDENT) so a behaviour change shows up as a test diff. Read the
  header before changing one of its expectations.

**E2E tests** (`tests/e2e/`): Playwright drives the real app in Chromium over
`python -m http.server`. `tests/e2e/stubs.js` installs an in-browser model of a
spreadsheet plus stubs for `gapi`, Google Identity Services, Drive appData and
Scryfall images. The Google CDN scripts and OpenID endpoints are blocked by
`page.route`. Tests assert on real cells written by the app, which is what
catches off-by-one/column-mapping regressions.

Notes:
- The stub disables `navigator.serviceWorker`; otherwise its `controllerchange`
  handler reloads the page mid-test.
- Keep fixtures shaped like the real API payloads (ragged rows, header row at
  range index 0) so parsing paths stay honest.
- The stub records `spreadsheetId` but does not validate it, so a write that
  names the wrong spreadsheet still lands in the modelled cells. Assert on the
  batchUpdate `spreadsheetId` (as `app.spec.js` does) when touching a write
  path: the file id and the tab id are easy to swap and only the real API
  rejects the mix-up.
- The stub honours `updateSheetProperties` (sets the modelled `hidden` flag), so
  `unhideGuruSheets` is observable and the clocks gate can hand off to analysis.
  A synthetic fixture can seed hidden guru tabs with `realPodSpreadsheet({
  guruHidden: true })`.
- `values.batchGet` returns one cell per range; parsed A1 columns are 0-based,
  so it adds 1 when indexing the modelled cells. Keep that offset when adding a
  reader — an off-by-one here makes `checkedUpdateSheetData`'s precondition fail
  and silently skips the write.
- Some tests intentionally document current quirks rather than desired behaviour
  (look for the "Characterization:" comments). Update those deliberately.

**Real-pod fixtures** (`tests/fixtures/realPod.js`): a trimmed but structurally
faithful excerpt of a real exported pod workbook, used by `tests/unit/realPod.test.js`
and `tests/e2e/realPod.spec.js`. Hand-written fixtures encode guesses about the
sheet layout; these encode what a live sheet actually contains, and that is what
catches schema drift. Keep them in sync if the sheet format changes. Facts they
pin down, each of which a synthetic fixture had wrong or absent:
- Guru sheets are 13 columns wide (A:M). The app reads A:C (base, Red only) and
  E:F (per colour). Columns G:I mirror the other gurus; K/L are Inverse Check
  and Inverse ID#; M is a Discord thread link.
- Headers are prose ("Player 1 (On the Play)", "ID#"), matched by substring.
  Do not shorten them.
- The metadata sheet is **headerless**: row 1 is already data. The app's
  "skip header row" comment therefore never fires on real data, which is why
  the spurious `variableName` key seen with a headered fixture does not appear.
- Deck Notes header order is `Decklists | Goldfish Clock | Signature | Notes |
  Additional Notes`. "Signature" here is the *goldfish* signature; the app
  resolves it through its alias list.
- The real pod is **finished** — every row has three agreeing analyses. The
  completion path and the "nothing to write" path are only reachable with this
  fixture. To exercise scoring, blank a cell deliberately (see
  `blankFirstAnalysis` in `tests/e2e/realPod.spec.js`).
- **Derived columns are the trap when blanking.** The real sheet computes
  D (Outcome) and K (Inverse Check) from the E/G/I analysis cells, so clearing
  an analysis clears them via recalculation. The stub does not evaluate
  formulas, so deleting only column E leaves `Outcome = "1"` beside an empty
  analysis — a state the sheet cannot produce. Always blank through
  `clearAnalysisLikeRealSheet(sheet, row, analysisCol)`, which clears E, D and
  K together and leaves the hand-entered L (Inverse ID#) alone. `L` is a row
  reference, not derived.
- The app never reads D or K: it fetches only `A1:C1000` and `E1:F1000` and
  recomputes the outcome locally via `calculateOutcomeFromAnalyses`. The
  modelled K values in the fixture are `1 - mirror outcome` (only row 1's real
  K was observed) and exist purely so blanking stays honest. Do not write tests
  asserting that D or K affect the app — the app cannot see them.
- On write, the stub does not recompute D/K the way the real sheet would, so
  post-write assertions should target E/F (the columns the app actually writes).
- Cells arrive as FORMATTED_VALUE strings ("1", "0.5", "0"), never numbers. The
  exported .xlsx stores floats; that is a file-format artefact, not the wire
  format the app sees.
- Decklists are pipe-separated and rendered as separate card lines; the pipes
  are not shown to the user.

### CI billing

This repository is public, so standard GitHub-hosted runners are free and
unlimited for it; only the minutes cap applies to private repos. Storage is the
part that is *not* unlimited, even here. Consequences for the test workflow:

- Traces upload **only on failure** (`if: failure()`), with `retention-days: 7`.
  `trace: 'retain-on-failure'` means a green run writes no trace at all, and a
  failing test is ~500 KB, so this stays far inside the 500 MB GitHub Free
  allowance. Do not switch to uploading the HTML report on every run: it is
  ~4 MB per run and would accumulate.
- Artifacts share a pooled allowance with GitHub Packages and are billed by
  GB-hour. Keep `retention-days` low on any new upload step and set
  `if-no-files-found: ignore`.
- Avoid larger runners. They are always charged, even for public repositories or
  when plan quota is unused.

Traces capture request and response bodies verbatim. That is fine while the E2E
suite runs against synthetic stubs, but pointing it at a real spreadsheet would
put real match data in a downloadable artifact.

Keep `runs-on: ubuntu-latest` (a standard runner) and the browser cache stays
under the separate 10 GB-per-repository cache allowance.

### Updating the service worker cache

When you add, remove, or rename a file under `js/`, `styles/`, `images/`, or `favicons/`, you must keep the precache list in `sw.js` (`urlsToCache`) in sync, or the file will be missing offline.

### Bumping the version

`APP_VERSION` at the top of `sw.js` (format `vYYYYMMDD`) drives service worker updates. Bump it for any user-visible change so installed clients pick it up. `main.js` parses this value for the footer.

### Work happens in staging first, always

`barbuz/the-stylus-staging` is the working repository; `barbuz/the-stylus` is
production. **Do all work here first, get it tested, and only then merge to the
production repo.** This is the standing procedure for every change, not a
per-task choice:

1. Branch, implement and test in `the-stylus-staging`.
2. Merge to the staging `main` and let it deploy to the preview site.
3. Once the change has been verified on the preview, replay the same commits on
   the production repo (`barbuz/the-stylus`) and merge to its `main` to deploy.

Do not open PRs against or push to the production repo until the staging copy has
been tested. The two repositories are independent copies (see below), so a change
merged in staging does not appear in production by itself.

### Production and preview deployments

The app ships from two GitHub Pages project sites. Both live on the same origin
(`barbuz.github.io`) and differ only by path, which is deliberate: they share
`localStorage` and the Google appData preferences file, so a user keeps their
session, guru signature and recent pods across a switch.

- Production: `https://barbuz.github.io/the-stylus/`
- Preview: `https://barbuz.github.io/the-stylus-staging/`

Both use GitHub's *legacy* Pages build ("Deploy from a branch", `main` / root),
matching the app's no-build-step design: pushing to `main` is the deploy. Do not
add a Pages Actions workflow unless legacy builds are retired; the test workflow
in `tests.yml` is the only workflow the project needs.

`DEPLOYMENTS` in `js/config.js` is the source of truth for the paths and display
names; **if a path here is wrong, deep-link routing and the switch button break
silently**.

Because the two share an origin:

- The service-worker app-shell cache is namespaced by base path
  (`DEPLOYMENT_ID` in `sw.js`). Without that, one deployment's `activate` step
  evicts the other's shell once both run the same `APP_VERSION`.
- `preferred_deployment` in `localStorage` records which deployment *this
  browser* wants deep links to open in. It is only written by an explicit
  switch, never by merely visiting a site. Absent or unknown means "leave me
  where the link points", so ordinary visitors are never bounced. The routing
  rule itself is the pure `resolveDeploymentRedirect()` in `js/utils/urlUtils.js`.
- Shared links generated by the app (`showCreateThreadModal`) always point at the
  production path; the recipient's own preference decides where they land.

`js/main.js` calls `applyDeploymentPreference()` before authentication and
returns early when it redirects. Adding a third deployment means extending
`DEPLOYMENTS`; `alternateDeploymentUrl()` only knows how to flip between exactly
two, so it would need revisiting.

The leftover copy must not keep testers or automation away from the preview.
Leaving both deployments at the same `APP_VERSION` is fine, because the caches
are namespaced. Deploying preview actually looks like:

1. Merge `preview-deployment-switch` (and anything else that should be testable)
   into `phase2-consolidate-guru-colour` — or whichever branch is the candidate —
   on the **production** repo. The two are siblings off `8837792`, not stacked.
2. In the staging repo, create a PR from that branch into `main` and merge it.
   Pushing `main` is the deploy; Pages rebuilds by itself.
3. Open `https://barbuz.github.io/the-stylus-staging/?pod=<POD_ID>` and test.

**The preview repository is a manual copy.** It has never existed as a fork
(GitHub cannot fork a repository into the same owner account), no git remote
links it to production, and pushing to production does not update it. Whenever
`main` moves on production, staging drifts until someone repeats step 2. If a
preview-only fix becomes permanent, it is a change to the staging copy only and
must be replayed on production by hand.

### The deployment switch lives in the footer

The footer switch is a **convenience for testers, not a headline control**. It
belongs in the footer and nowhere else: the footer is below the fold, so a normal
user has to scroll to the very bottom to meet it and most never will. That is the
whole of the design intent — keep it out of the working area, don't go further.

- It offers a route to the *other* deployment and records the tester's choice, so
  the pod links they open afterwards land in the same version.
- It never appears on the login screen because `setupDeploymentSwitch()` runs
  from `bindEvents()` after authentication.
- Both deployments draw it (each offering the other), so a tester who followed a
  production link can still find their way back to preview.

Don't move it into the header or the scoring UI. Equally, don't gate it away or
fade it into invisibility: testers need to be able to find it once they know to
look, and hiding it outright strands them on whichever version a shared link
opened. If you add a third deployment, revisit `alternateDeploymentUrl()`, which
only flips between exactly two.

## Conventions

- **Indentation:** 4 spaces. Never tabs.
- **Quotes:** single quotes, with backticks for template literals. Double quotes only for HTML attributes inside template strings.
- **Modules:** `export class X` with a `constructor` that wires dependencies; shared helper functions live in `js/utils/` as named exports.
- **DOM access:** use helpers from `js/utils/domUtils.js` (`getElement`, `waitForElement`, `addEventListenerSafe`) rather than direct `document.getElementById`, so missing elements degrade gracefully.
- **Storage:** route browser persistence through `js/services/storage.js` (`getItem` / `setItem` / `removeItem` and the JSON variants) rather than calling `localStorage` directly; it degrades to a no-op when storage is unavailable or throws. Keys still come from `CONFIG.STORAGE_KEYS`.
- **Logging:** use `logger` from `js/utils/log.js`. `logger.debug` is suppressed from the console unless `?debug` is in the URL or `window.__stylusDebug = true`; `logger.warn` / `logger.error` always pass through, so keep genuine failure paths on those. Independently of the flag, every call is captured in a 500-entry ring buffer (oldest dropped) and mirrored into `sessionStorage`; a "Log" button on the analysis screen and in the footer downloads it as a redacted `.txt` for bug reports (`js/domain/diagnosticLog.js`). Never log whole response objects, tokens or emails — capture redacts known-sensitive keys and email shapes, but the call site should not rely on it.
- **Event handling:** register UI events in `uiController.js` / the owning module's setup method rather than inline `onclick` handlers.
- **Config:** `js/config.js` holds the public OAuth client ID and storage keys. Do not move secrets here; `public/js/config.local.js` is gitignored for local overrides.
- **Sheet ids:** `spreadsheetId` is the spreadsheet file id (the `batchUpdate` / `values.get` target); `sheetId` is the numeric tab id inside it (Google's own `updateCells.start.sheetId`). Never use `sheetId` for the file — passing the tab id where the file id belongs makes the real API 404, and the e2e stub does not catch it. The persisted recent-pods/hubs records are the one place the old key lingers: they are shared with production via localStorage and Drive appData, so new writes use `spreadsheetId` while reads still accept the legacy `sheetId` through `js/domain/recentEntries.js`. That fallback is temporary and marked `LEGACY`; drop it once no old records remain.
- **No new dependencies:** the project deliberately loads everything from CDNs and ships no bundler. Confirm with the user before adding a package. Playwright is the one agreed exception, and it is dev-only: it must never be imported by app code or added to `sw.js`/`index.html`.
- **Commits:** short imperative subjects, often `<Area>: <change>` (e.g. `Fix next button not going to current guru's matches first`).

## Keeping Docs in Sync

After code changes:

1. Update the Repository Structure above if files were added/removed/renamed.
2. Update `README.md` if user-facing behaviour or usage changed.
3. Bump `APP_VERSION` in `sw.js` if the change is user-visible.

This file is the single source of repo guidance; do not reintroduce a second
copy. `.github/copilot-instructions.md` existed for the same purpose and was
removed as a stale duplicate.

## Troubleshooting

- **`gapi is not defined` / `ERR_BLOCKED_BY_CLIENT`:** expected in sandboxed or offline environments where Google APIs cannot load. These are not app bugs; focus on whether the page structure and modules loaded.
- **Module fails to load:** check the exact path and casing of the import.
- **Stale behaviour after editing:** the service worker may be serving a cached build. Bump `APP_VERSION` and hard-reload, or unregister the worker in devtools.
- **Sheet fails to parse:** inspect the URL handling in `js/utils/urlUtils.js`; Discord-pasted links can carry trailing characters (previously handled by trimming extra `),`).
- **Syntax check:** `node -c <filename>`.