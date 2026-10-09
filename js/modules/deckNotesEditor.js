/**
 * Deck-notes gate controller.
 *
 * Orchestrates the one-deck-at-a-time clocks & notes screen: it owns the
 * grouped deck list, the current index, the resolved column map and the poll
 * timer, and delegates all DOM work to DeckNotesView and card loading to
 * CardPresenter. It reuses the analysis screen's deck-info panel (via the
 * shared deckInfoView) and its save workflow (analysisActions.saveDeckInfoField),
 * so the two screens share their presentation and write paths.
 *
 * When the guru sheets are hidden this is the pre-guruing gate: every goldfish
 * clock must be filled before "Start guruing" unhides the sheets and hands off
 * to analysis. The same screen can also be opened from an active analysis
 * session, in which case it offers "Back to analysis" instead.
 */
import {
    processDeckNotes,
    groupDeckNotes,
    allClocksFilled,
    deckNotesProgress
} from '../domain/deckNotes.js';
import { getElement } from '../utils/domUtils.js';
import { DeckNotesView } from '../ui/deckNotesView.js';
import { CardPresenter } from '../ui/cardPresenter.js';
import { OverviewTableModal } from '../ui/overviewTableModal.js';
import { DeckTablePresenter } from '../ui/deckTablePresenter.js';
import { isDeckInfoEditing } from '../ui/deckInfoView.js';

export class DeckNotesEditor {
    constructor({ analysisInterface, uiController, scryfallAPI, sheetsAPI, spreadsheetId }) {
        this.analysisInterface = analysisInterface;
        this.uiController = uiController;
        this.scryfallAPI = scryfallAPI;
        this.sheetsAPI = sheetsAPI;
        this.spreadsheetId = spreadsheetId;

        this.notesData = null;
        this.columnMap = {};
        this.entries = [];
        this.values = [];
        this.deckIndex = 0;
        this.sheetTitle = '';
        this.fromAnalysis = false;
        this._clockMessageShown = false;

        this.deckTableModal = new OverviewTableModal();
        this.deckTablePresenter = new DeckTablePresenter(this.deckTableModal);

        this.view = new DeckNotesView({
            onPrev: () => this.previousDeck(),
            onNext: () => this.nextDeck(),
            onNextEmptyClock: () => this.nextWithoutClock(),
            onShowDeckTable: () => this.showDeckTable(),
            onStart: () => this.startGuruing(),
            onBack: () => this.close(false),
            onExit: () => this.close(true)
        });
        this.cards = new CardPresenter(scryfallAPI, this.view);
    }

    /**
     * @param {object} notesData { title, sheetId, values }
     * @param {object} options
     * @param {string} options.sheetTitle
     * @param {boolean} [options.fromAnalysis] opened from an active session
     * @param {string} [options.startDeckString] decklist to open on, after grouping
     */
    show(notesData, { sheetTitle = '', fromAnalysis = false, startDeckString = null } = {}) {
        this.notesData = notesData;
        this.spreadsheetId = this.analysisInterface.state.spreadsheetId || this.spreadsheetId;
        this.sheetTitle = sheetTitle;
        this.fromAnalysis = fromAnalysis;

        const values = notesData?.values || [];
        if (!values.length) {
            this.uiController.showStatus('No deck notes found. Check the spreadsheet.', 'error');
            return;
        }

        const sheetData = this.analysisInterface.state.sheetData || {
            sheets: [{ title: notesData.title || 'Deck Notes', sheetId: notesData.sheetId, values }]
        };
        const { deckNotesMap, columnMap } = processDeckNotes(sheetData);
        this.columnMap = columnMap;
        this.values = values;
        this.analysisInterface.state.setDeckNotes(deckNotesMap, columnMap);

        this.deckIndex = 0;
        this._regroup();
        if (startDeckString) {
            this.jumpToDeckString(startDeckString);
        }

        if (!this.view.ensureScreen()) {
            this.uiController.showStatus('Could not open the deck notes screen.', 'error');
            return;
        }

        this._clockMessageShown = allClocksFilled(this.entries, this.columnMap);
        this.renderCurrent();

        this.stopPeriodicUpdate();
        this._updateInterval = setInterval(() => {
            if (this.notesData) {
                this.pullUpdates();
            }
        }, 3000);
    }

    /** Jump to the entry for a Player 1 deck string, if present. */
    jumpToDeckString(deckString) {
        if (!deckString) {
            return;
        }
        const index = this.entries.findIndex(entry => entry.deckString === deckString);
        if (index >= 0) {
            this.deckIndex = index;
        }
    }

    /** Grouped deck list as a jump-to-deck table, opened from the header. */
    async showDeckTable() {
        await this.deckTablePresenter.open({
            entries: this.entries,
            currentRow: this.deckIndex,
            onSelect: (idx) => {
                if (idx >= 0 && idx < this.entries.length) {
                    this.deckIndex = idx;
                    this.renderCurrent();
                }
            }
        });
    }

    /** Rebuild the grouped entries from the current values, keeping position. */
    _regroup() {
        const anchor = this.entries[this.deckIndex];
        this.entries = groupDeckNotes(this.values, this.columnMap);
        this.analysisInterface.state.setDeckNotesEntries(this.entries, this.values);

        if (anchor) {
            const index = this.entries.findIndex(
                entry => entry.deckString === anchor.deckString && entry.row === anchor.row
            );
            if (index >= 0) {
                this.deckIndex = index;
            }
        }
        if (this.deckIndex >= this.entries.length) {
            this.deckIndex = Math.max(0, this.entries.length - 1);
        }
    }

    /** Render the header, the current deck's cards and its info panel. */
    async renderCurrent() {
        if (!this.entries.length) {
            this.uiController.showStatus('No decks found in the notes sheet.', 'error');
            return;
        }

        const entry = this.entries[this.deckIndex];
        const total = this.entries.length;

        this.view.renderHeader({
            spreadsheetId: this.spreadsheetId,
            sheetTitle: this.sheetTitle,
            podName: this.analysisInterface.state.sheetData?.metadata?.podName
        });

        this.view.renderDeck({
            deckString: entry.deckString,
            deckInfo: entry.deckInfo,
            index: this.deckIndex,
            total,
            clockSignature: entry.signatures,
            onSaveField: async (deck, type, oldValue, newValue, span) => {
                await this.analysisInterface.saveDeckInfoField(deck, type, oldValue, newValue, span, entry);
                // A clock edit can flip the gate, so refresh the controls.
                this.renderChrome();
            }
        });

        this.renderChrome();
        this._renderCards(entry.deckString);
    }

    renderChrome() {
        const canStart = allClocksFilled(this.entries, this.columnMap);
        this.view.renderProgress(this.deckIndex, this.entries.length);
        this.view.renderClockProgress(deckNotesProgress(this.entries));
        this.view.renderNavigation({
            index: this.deckIndex,
            total: this.entries.length,
            canStart,
            showBack: this.fromAnalysis
        });

        if (canStart && !this._clockMessageShown) {
            this._clockMessageShown = true;
            this.uiController.showStatus('All goldfish clocks are filled. You can now start guruing!', 'success');
        }
    }

    async _renderCards(deckString) {
        this.scryfallAPI.preloadCards(deckString);
        // The view's card container is #deck-notes-cards, i.e. playerId 'deck-notes'.
        await this.cards.loadPlayerCards('deck-notes', deckString);
    }

    async previousDeck() {
        if (this.deckIndex > 0) {
            this.deckIndex--;
            await this.renderCurrent();
        }
    }

    async nextDeck() {
        if (this.deckIndex < this.entries.length - 1) {
            this.deckIndex++;
            await this.renderCurrent();
        }
    }

    /** Jump to the next deck with an empty clock, wrapping to the first. */
    async nextWithoutClock() {
        const count = this.entries.length;
        for (let offset = 1; offset <= count; offset++) {
            const index = (this.deckIndex + offset) % count;
            if (!this.entries[index].deckInfo?.goldfishClock) {
                this.deckIndex = index;
                await this.renderCurrent();
                return;
            }
        }
        this.uiController.showStatus('Every clock is filled.', 'success');
    }

    /** Gate action: unhide the guru sheets and enter analysis. */
    async startGuruing() {
        if (!allClocksFilled(this.entries, this.columnMap)) {
            this.uiController.showStatus('All goldfish clocks must be filled before guruing can begin.', 'info');
            return;
        }
        await this.unhideGuruSheets();
    }

    close(backToHome = false) {
        this.stopPeriodicUpdate();
        this.deckTableModal.close();
        this.view.destroy();

        if (backToHome) {
            this.uiController.showSheetInputSection();
        }
    }

    stopPeriodicUpdate() {
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
            this._updateInterval = null;
        }
    }

    /** Re-fetch the notes sheet and re-render without losing the current deck. */
    async pullUpdates() {
        const updated = await this.sheetsAPI.getDeckNotes(this.spreadsheetId, this.notesData);
        if (!updated?.values?.length) {
            return;
        }
        this.notesData = updated;
        this.values = updated.values;
        this._regroup();

        // A re-render would tear out an in-progress inline edit, so hold off
        // while the guru is typing.
        if (this.view.screen && !isDeckInfoEditing(getElement('deck-notes-deck-info'))) {
            await this.renderCurrent();
        }
    }

    async unhideGuruSheets() {
        await this.sheetsAPI.unhideGuruSheets(this.spreadsheetId);
        // Hand off to the analysis session, which will re-fetch the now-visible
        // sheets and render the scoring screen.
        this.close(false);

        const sheetData = await this.sheetsAPI.getSheetData(this.spreadsheetId);
        this.analysisInterface.loadData(sheetData);
    }
}
