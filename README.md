# the stylus

A browser tool for gurus editing 3 Card Blind MTG result sheets from
[3cardblind.com](https://www.3cardblind.com). It runs entirely in the browser,
with no server of its own.

## How to use

### 1. Sign in

- click **Sign in with Google**
- grant access to Google Sheets
- your session is remembered between visits

Your sign-in is renewed in the background before it expires, so a long guruing
session does not interrupt you. Your browser only allows that renewal after a
recent tap or keypress, so if you step away it renews on your next interaction.
You are never dropped back to the home screen, and never left on a Google page
you cannot get past. If a renewal is not possible, you are simply asked to sign
in again.

**Installed app:** if you have installed the stylus to your home screen, it
signs you in the same way as the browser. As long as you ticked "Remember me for
automatic sign-in" when you last signed in, reopening the installed app restores
your session on its own, with no popup to tap through. If you are ever asked to
sign in again inside the installed app and the Google screen does not complete,
sign in once from the normal browser. The installed app reuses that session.

You need a Google account because you need to be signed in to edit sheets, and
because the app stores its configuration in your Google appData. That also means
you can change devices and keep guruing.

### 2. Set guru signature

- enter your guru username
- it filters the sheet to show only your matches
- the signature is saved locally for future sessions

### 3. Load pod sheet

- paste the Google Sheets URL from 3cardblind.com
- the app loads and parses the pod data
- only matches assigned to your guru signature are shown

### 4. Fill the goldfish clocks

- before analysis, the app opens the Deck Notes screen one deck at a time
- the deck's cards are shown large, with its clock and notes on the right
  (under the cards on mobile)
- click anywhere in the clock or notes box to edit it; a frame marks each field
- every deck's goldfish clock must be filled before **Start guruing** unlocks
- repeated consecutive decks are shown once; your edits apply to each of them
- **Next without clock** jumps to the next deck still missing a clock, and
  disappears once every clock is filled
- click the **Deck N of M** line in the header to open a table of every deck and
  jump straight to one; it shows each deck's clock (and, when there is room, its
  signature and notes), highlighting decks you have already clocked
- hover a clock to see who filled it

### 5. Analyse matches

- view card images for both players
- use Win / Tie / Loss to score matches
- navigate between matches with Previous / Next
- use the **Deck notes** button in the controls to revisit the clocks and notes
  screen, opening on the current match's first player deck, then **Back to
  analysis** to return
- while a match you have claimed is open, **Unclaim all (N)** releases every
  match you have claimed but not yet scored, in one action
- changes are saved automatically to the Google Sheet

### 6. Track progress

- see the current match number and total matches
- view completion status
- restart analysis if needed

### 7. Report a bug

- click the small **Log** button in the footer, or in the analysis screen's
  top-right controls while a pod is open
- this downloads `the-stylus-log-YYYYMMDD-HHMMSS.txt`, a plain-text diagnostic
  log with the app version, the current URL and recent activity
- attach that file to your bug report; access tokens and email addresses are
  removed automatically, but the file may still contain match data

## Day and night mode

The stylus has a day (light) and night (dark) face. It starts on whichever your
device prefers, and a **Day / Night** switch in the header lets you choose. The
same switch appears in the analysis and deck-notes controls, because the header
is hidden while a pod is open. Night is a cool blue-black face; day keeps the
existing light look with the same blue family.

Your choice is remembered for next time. The first time you switch, it becomes
an explicit choice and no longer follows your device; leave it alone and the app
keeps matching your device as that changes.

## Browser requirements

- a modern browser with ES modules and localStorage
- JavaScript enabled
- an internet connection for Google APIs and card images

## Contributing

This is an open-source project. Contributions are welcome.

### Development setup

1. clone the repository:
   ```bash
   git clone https://github.com/barbuz/the-stylus.git
   cd the-stylus
   ```

2. serve it locally:
   ```bash
   python -m http.server 8000
   ```

### Version management

`APP_VERSION` at the top of `sw.js` is a **service-worker cache token, not a
release name**. Bump it when a change should reach installed clients:

1. update the `APP_VERSION` constant in `sw.js`
2. this changes the service worker file, so the browser detects a new version
3. `main.js` fetches and parses the version and displays it in the app footer
4. the service worker activates on the next page reload with the new cache

A refactor with no user-visible effect need not bump it, so the same value can
legitimately appear on more than one commit. It does not identify what shipped;
the release tag does.

### Releases

Releases are named by CalVer (`YYYY.MM`, or `YYYY.MM.PATCH` for a fix between
monthly releases) and listed in [`CHANGELOG.md`](CHANGELOG.md).

To cut a release, add a `## [YYYY.MM] - YYYY-MM-DD` section to the top of
`CHANGELOG.md` and merge it to `main`. The [Release workflow](.github/workflows/release.yml)
then creates the `vYYYY.MM` git tag and a GitHub Release whose notes are that
changelog section. Nothing else is needed: the app has no build step, so the tag
records what is already deployed. Re-running is safe; an existing tag is left
alone.

The heading must be exactly `## [YYYY.MM]`: the bracket content is the version,
so `## [v2026.10]` is skipped rather than tagged with a doubled `v`.

### Production and preview versions

There are two live versions of the app on the same GitHub Pages origin:

| Version | URL |
| --- | --- |
| production | https://barbuz.github.io/the-stylus/ |
| preview | https://barbuz.github.io/the-stylus-staging/ |

New work is tested in **preview** first and promoted to production once testers
are happy. Both versions share the same login, guru signature and recent pods,
so you can switch between them without signing in again.

The footer shows which version you are on and offers a switch button. That
button also records your choice for this browser, so links you open afterwards
(the pod links posted to Discord) take you to the same version. The choice is
per browser and is not synced to your Google account; clearing site data resets
it to production.

---

Part of the [barbuz family of small tools](https://barbuz.github.io).
If it saved you some clicks, you can [leave a tip](https://donate.stripe.com/9B6eVd1madcF8Dt8yp1gs00).
