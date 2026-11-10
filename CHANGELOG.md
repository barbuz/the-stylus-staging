# Changelog

The Stylus is versioned by CalVer: `YYYY.MM`, with `YYYY.MM.PATCH` for a fix
shipped between monthly releases.

The top release heading is the release identity. The release workflow reads it
and tags that commit `v<version>`. Add a new `## [YYYY.MM]` section when cutting
a release; `## [Unreleased]` may sit above it and is ignored.

Each release lists what changed for a guru, with the PR number that carried it.
Compare this file between the two deployments to see what production is missing.

## [Unreleased]

### Added

- An **Unclaim Incomplete (N)** button, shown next to Unclaim Match while a
  match you have claimed is open. It releases every match you have claimed but
  not yet scored, in one action, so you can hand back claims you have not got to

### Fixed

- Scoring a match no longer briefly flashes the match you were just on, and
  moving quickly through matches no longer shows a previous match's cards: an
  overlapping background refresh or a slow card load could paint its row over
  the one you had moved to. Renders are now generation-guarded, so only the
  newest one writes after an await

## [2026.10.1] - 2026-11-10

### Fixed

- Clear My Result and Unclaim Match sit after Next again, as they did before the
  analysis-screen split moved them
- The "Choose Your Guru Color" screen no longer appears twice when a pod load is
  started twice in quick succession (a double-click or double Enter), or when a
  double-click on Start guruing hands off from the deck-notes gate with an
  unknown signature

## [2026.10] - 2026-10-23

First monthly promotion to production. It carries the whole analysis-screen
refactor plus the deck-notes gate, the guru-colour registry, the diagnostic log
and the preview deployment switch.

### Added

- Deck Notes gate: one deck at a time, with clocks, notes and goldfish
  signatures, shown before guruing starts (#11, #12, #13, #14)
- A jump-to-deck table on the gate, and card preloading for neighbouring decks
  (#13, #16)
- A downloadable diagnostic log for bug reports, redacted and versioned (#8)
- A preview deployment switch in the footer, with deep-link routing (#28)
- The guru-colour registry, so the sheet schema derives from one definition

### Changed

- The analysis screen is split into an app-shell state object and view modules
  (#23)
- The guru signature is a single immutable session value
- Recent pods and hubs persist `spreadsheetId`; legacy `sheetId` is still read

### Fixed

- Win/Tie/Loss writes no longer send the tab id where the file id belongs
- Deck notes no longer truncated when a decklist starts with a number (#12)
- Next no longer snaps back while guruing, and status refreshes immediately
  (#15)
