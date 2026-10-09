/**
 * Analysis controller.
 *
 * Owns the analysis session state (on `this.state`, see js/app/appState.js) and
 * orchestrates the services and views for the single-row scoring screen. It
 * contains no DOM construction: rendering is delegated to AnalysisView, modals
 * to MatchTableModal / ThreadModal, the colour dropdown to GuruColorSelector,
 * and pure logic to js/domain/.
 *
 * Extracted from the former guruAnalysisInterface.js god class (phase 3 of #18);
 * its loose fields were consolidated into AppState in phase 4.
 */
import { ScryfallAPI } from '../modules/scryfallAPI.js';
import { DeckNotesEditor } from '../modules/deckNotesEditor.js';
import {
    getCurrentColorAnalysis,
    getCurrentColorSignature,
    getCurrentGuruColIndex,
    getGuruColorInRow,
    determineGuruColorFromSheet
} from '../domain/guruColor.js';
import {
    parsePodSheets,
    getRowThreadId,
    hasDiscordThreadForRow,
    hasCurrentColorResult,
    rowHasDiscrepancy,
    allGurusHaveMatchingResults,
    isMatchAvailableForAnalysis,
    isCurrentMatchAvailableForAnalysis,
    isAnalysisComplete,
    findFirstEmptyAnalysis,
    findFirstDiscrepancy,
    findMirrorMatchIndex,
    getDeckStats
} from '../domain/matchRows.js';
import { isInverseErrorSuspected, describeInverseResult } from '../domain/inverseCheck.js';
import { processDeckNotes, calculateColorStatistics } from '../domain/deckNotes.js';
import { AnalysisView } from './analysisView.js';
import { AnalysisWriter } from './analysisWriter.js';
import { CardPresenter } from './cardPresenter.js';
import { MatchTableModal } from './matchTableModal.js';
import { MatchTablePresenter } from './matchTablePresenter.js';
import { ThreadModal } from './threadModal.js';
import { ThreadPresenter } from './threadPresenter.js';
import { AnalysisActions } from './analysisActions.js';
import { AnalysisNavigation } from './analysisNavigation.js';
import { AnalysisSessionLoader } from './analysisSessionLoader.js';
import { AnalysisRowRenderer } from './analysisRowRenderer.js';
import { AnalysisEventBinder } from './analysisEventBinder.js';
import { AppState } from '../app/appState.js';
import { logger } from '../utils/log.js';

export class AnalysisController {
    constructor(sheetsAPI, uiController, guruSignature) {
        this.sheetsAPI = sheetsAPI;
        this.uiController = uiController;
        // All session state lives on one object (phase 4 of #18).
        this.state = new AppState();
        this.state.setSignature(guruSignature);
        this.scryfallAPI = new ScryfallAPI();

        this.view = new AnalysisView({
            onClaim: () => this.claimRow(),
            onClaimDeck: () => this.claimDeckRows(),
            onUnclaim: () => this.unclaimRow(),
            onClear: () => this.clearCurrentUserAnalysis()
        });
        this.writer = new AnalysisWriter(sheetsAPI);
        this.cards = new CardPresenter(this.scryfallAPI, this.view);
        this.guruColorSelector = null;
        this.matchTableModal = new MatchTableModal();
        this.matchTablePresenter = new MatchTablePresenter(this.matchTableModal);
        this.threadModal = new ThreadModal();
        this.threadPresenter = new ThreadPresenter(this.scryfallAPI, this.threadModal);
        this.actions = new AnalysisActions(this);
        this.navigation = new AnalysisNavigation(this);
        this.sessionLoader = new AnalysisSessionLoader(this);
        this.rowRenderer = new AnalysisRowRenderer(this);
        this.eventBinder = new AnalysisEventBinder(this);

        this.bindEvents();
    }

    reset() {
        this.state.reset();
    }

    destroy() {
        this.eventBinder.destroy();
        this.guruColorSelector?.destroy();
        this.matchTableModal.destroy();
        this.threadModal.destroy();
    }

    /**
     * The guru signature this session was opened with. A snapshot taken at load;
     * it does not change while a pod is open (phase 5 of #18).
     */
    get guruSignature() {
        return this.state.signature;
    }

    determineGuruColorFromSheet(sheetData) {
        return determineGuruColorFromSheet(sheetData, this.state.signature, this.state.rowIndex);
    }

    bindEvents() {
        return this.eventBinder.bind();
    }

    async changeGuruColor(newColor) {
        if (newColor === this.state.guruColor) {
            return;
        }

        try {
            const oldColor = this.state.guruColor;
            this.state.setGuruColor(newColor);

            this.updateGuruColorDisplay();
            await this.showCurrentRow();

            this.uiController.showStatus(`Switched to ${newColor} guru`, 'success');
        } catch (error) {
            logger.error('Error changing guru color:', error);
            this.uiController.showStatus(`Error switching guru color: ${error.message}`, 'error');

            this.state.setGuruColor(oldColor);
            this.updateGuruColorDisplay();
        }
    }

    updateGuruColorDisplay() {
        return this.rowRenderer.updateGuruColorDisplay();
    }

    /**
     * Update the browser URL with current pod ID, guru color, and row number
     */
    updateURL() {
        return this.rowRenderer.updateURL();
    }

    async loadData(sheetData, guruColor = null, rowNumber = 0) {
        return this.sessionLoader.loadData(sheetData, guruColor, rowNumber);
    }

    processDeckNotes(sheetData) {
        return processDeckNotes(sheetData);
    }

    /** Build the row model and column index for the selected guru colour. */
    parseSheets(sheetData) {
        const { rows, columnIndex, numDiscrepancies } = parsePodSheets(
            sheetData, this.state.guruColor, this.state.signature
        );
        this.state.setRows(rows);
        this.state.setNumDiscrepancies(numDiscrepancies);
        this.state.setColumnIndex(columnIndex);
    }

    // The methods below delegate to js/domain/. They are kept on the class so
    // the rendering and event call sites do not need to change in this phase.

    getCurrentColorAnalysis(row) {
        return getCurrentColorAnalysis(row, this.state.guruColor);
    }

    getCurrentColorSignature(row) {
        return getCurrentColorSignature(row, this.state.guruColor);
    }

    isCurrentMatchAvailableForAnalysis() {
        return isCurrentMatchAvailableForAnalysis(
            this.state.rows, this.state.guruColor, this.state.signature, this.state.rowIndex
        );
    }

    isMatchAvailableForAnalysis(row) {
        return isMatchAvailableForAnalysis(row, this.state.guruColor, this.state.signature);
    }

    isAnalysisComplete() {
        return isAnalysisComplete(this.state.rows, this.state.guruColor);
    }

    findFirstEmptyAnalysis(startFromIndex = 0) {
        return findFirstEmptyAnalysis(this.state.rows, this.state.guruColor, this.state.signature, startFromIndex);
    }

    findFirstDiscrepancy(startFromIndex = 0) {
        return findFirstDiscrepancy(this.state.rows, this.state.guruColor, this.state.signature, startFromIndex);
    }

    async showCurrentRow() {
        return this.rowRenderer.render();
    }

    /** Build the analysis list, fetching its Discord thread link if any. */
    async renderAnalysisDisplay(currentRow) {
        return this.rowRenderer.renderAnalysisDisplay(currentRow);
    }

    async getThreadUrl(currentRow) {
        return this.rowRenderer.getThreadUrl(currentRow);
    }

    /**
     * Claim all unclaimed matches with the same Player 1 deck as the current row
     */
    async claimDeckRows() {
        return this.actions.claimDeckRows();
    }

    /** Indices worth warming: the next empty, plus the adjacent rows. */
    rowsToPreload() {
        return this.rowRenderer.rowsToPreload();
    }

    async setAnalysis(value) {
        return this.actions.setAnalysis(value);
    }

    async claimRow() {
        return this.actions.claimRow();
    }

    async unclaimRow() {
        return this.actions.unclaimRow();
    }

    /**
     * Clear the current user's analysis for the current row (when they've already scored)
     */
    async clearCurrentUserAnalysis() {
        return this.actions.clearCurrentUserAnalysis();
    }

    /**
     * Re-fetch the pod and rebuild the row model, staying on the current match
     * unless `preservePosition` is false. The single reload implementation; the
     * former background refresh is a thin wrapper over it.
     */
    async reload({ preservePosition = true } = {}) {
        return this.actions.reload({ preservePosition });
    }

    getDeckStats() {
        return getDeckStats(this.state.rows, this.state.guruColor, this.state.rowIndex);
    }

    /**
     * Returns the column index for the current guru color and type ('analysis' or 'signature')
     */
    getCurrentGuruColIndex(type = 'analysis') {
        return getCurrentGuruColIndex(this.state.guruColor, this.state.columnIndex, type);
    }

    /**
     * Returns the color that the current guru has claimed in a particular row, or null
     * if that row does not have the current guru's signature.
     */
    getGuruColorInRow(row) {
        return getGuruColorInRow(row, this.state.signature);
    }

    async nextRow() {
        return this.navigation.nextRow();
    }

    async previousRow() {
        return this.navigation.previousRow();
    }

    async skipToNextIncomplete() {
        return this.navigation.skipToNextIncomplete();
    }

    async skipToNextDiscrepancy() {
        return this.navigation.skipToNextDiscrepancy();
    }

    async skipToNextDeck() {
        return this.navigation.skipToNextDeck();
    }

    async skipToMirrorMatch() {
        return this.navigation.skipToMirrorMatch();
    }

    /**
     * Find the index of the mirror match (inverse) for a given row
     * @param {number} rowIndex - Index of the row to find the mirror for
     * @returns {number} - Index of the mirror match, or -1 if not found
     */
    findMirrorMatchIndex(rowIndex) {
        return findMirrorMatchIndex(this.state.rows, rowIndex);
    }

    /** Update the inverse display on the mirror-match button. */
    updateInverseResultDisplay() {
        const currentRow = this.state.rows[this.state.rowIndex];
        const mirrorIndex = this.findMirrorMatchIndex(this.state.rowIndex);
        const inverseRow = this.state.rows[mirrorIndex];

        this.view.renderMirrorButton(describeInverseResult(
            currentRow.outcomeValue,
            inverseRow?.outcomeValue,
            mirrorIndex >= 0,
            this.isCurrentMatchAvailableForAnalysis()
        ));
    }

    showCompletionMessage() {
        this.uiController.showStatus('All rows analysed! Great work!', 'success');
    }

    showDeckNotesEditor(notesData) {
        this.updateURL();
        this._ensureDeckNotesEditor();
        this.deckNotesEditor.show(notesData, { sheetTitle: this.state.sheetData.title });
    }

    /** Open the deck-notes screen from an active analysis session. */
    openDeckNotes() {
        const deckNotesSheet = this.state.sheetData.sheets.find(sheet =>
            sheet.title && sheet.title.toLowerCase().includes('deck notes')
        );
        const notesData = {
            title: deckNotesSheet?.title || 'Deck Notes',
            sheetId: deckNotesSheet?.sheetId,
            values: deckNotesSheet?.values || this.state.deckNotesValues || []
        };
        this._ensureDeckNotesEditor();
        // Land on the deck the open match is about (Player 1's deck).
        this.deckNotesEditor.show(notesData, {
            sheetTitle: this.state.sheetData.title,
            fromAnalysis: true,
            startDeckString: this.state.currentRow?.player1
        });
    }

    _ensureDeckNotesEditor() {
        if (!this.deckNotesEditor) {
            this.deckNotesEditor = new DeckNotesEditor({
                analysisInterface: this,
                uiController: this.uiController,
                scryfallAPI: this.scryfallAPI,
                sheetsAPI: this.sheetsAPI,
                spreadsheetId: this.state.spreadsheetId,
            });
            return;
        }
        // Update references in case they changed
        this.deckNotesEditor.uiController = this.uiController;
        this.deckNotesEditor.scryfallAPI = this.scryfallAPI;
        this.deckNotesEditor.sheetsAPI = this.sheetsAPI;
        this.deckNotesEditor.spreadsheetId = this.state.spreadsheetId;
    }

    calculateColorStatistics(sheetData) {
        return calculateColorStatistics(sheetData);
    }

    showGuruColorSelection(sheetData) {
        this.view.showColorSelection({
            stats: this.calculateColorStatistics(sheetData),
            sheetTitle: sheetData.title || 'Unknown Sheet',
            onSelect: (colour) => this.selectGuruColor(colour, sheetData)
        });
    }

    async selectGuruColor(color, sheetData) {
        logger.debug(`User selected guru color: ${color}`);

        // Set the guru color
        this.state.setGuruColor(color);

        // Remove the color selection container
        this.view.hideColorSelection();

        // Ensure the sheet editor is visible before loading data
        this.uiController.showSheetEditor();

        // Continue with the normal data loading process, but skip guru color determination
        await this.loadData(sheetData, color);
        await this.showCurrentRow();
    }

    getTotalRows() {
        return this.state.totalRows;
    }

    getCurrentProgress() {
        return {
            current: this.state.rowIndex + 1,
            total: this.state.totalRows
        };
    }

    displayDeckInfo(playerId, deckString) {
        return this.rowRenderer.displayDeckInfo(playerId, deckString);
    }

    async saveDeckInfoField(deckString, type, currentValue, newValue, span, entry = null) {
        return this.actions.saveDeckInfoField(deckString, type, currentValue, newValue, span, entry);
    }

    // --- MATCH TABLE MODAL ---
    async showMatchTableModal() {
        const threadMap = await this.getMatchTableThreadMap();

        await this.matchTablePresenter.open({
            rows: this.state.rows,
            currentRowIndex: this.state.rowIndex,
            colour: this.state.guruColor,
            signature: this.state.signature,
            threadMap,
            statusFor: (row, idx) => ({
                signature: (getCurrentColorSignature(row, this.state.guruColor) || '').trim(),
                hasResult: this.hasCurrentColorResult(row),
                hasDiscrepancy: this.rowHasDiscrepancy(row),
                hasThread: this.hasDiscordThreadForRow(threadMap, row, idx),
                inverseSuspected: this.isInverseErrorSuspected(idx),
                allMatching: this.allGurusHaveMatchingResults(row)
            }),
            onSelect: (idx) => {
                if (idx >= 0) {
                    this.state.setRowIndex(idx);
                    this.showCurrentRow();
                }
            }
        });
    }

    closeMatchTableModal() {
        this.matchTablePresenter.close();
    }

    async getMatchTableThreadMap() {
        if (!this.state.hub) {
            return null;
        }

        try {
            return await this.state.hub.getThreads();
        } catch (error) {
            logger.warn('Failed to load thread data for match table:', error);
            return this.state.hub.threadsCache || null;
        }
    }

    getRowThreadId(row, fallbackIndex) {
        return getRowThreadId(row, fallbackIndex);
    }

    hasDiscordThreadForRow(threadMap, row, fallbackIndex) {
        return hasDiscordThreadForRow(threadMap, row, fallbackIndex);
    }

    hasCurrentColorResult(row) {
        return hasCurrentColorResult(row, this.state.guruColor);
    }

    rowHasDiscrepancy(row) {
        return rowHasDiscrepancy(row);
    }

    allGurusHaveMatchingResults(row) {
        return allGurusHaveMatchingResults(row);
    }

    isInverseErrorSuspected(rowIndex) {
        return isInverseErrorSuspected(this.state.rows, rowIndex, (index) => this.findMirrorMatchIndex(index));
    }

    /**
     * Shows modal with Discord thread text for the current match
     * @param {number} rowIndex - Index of the row to create thread text for
     */
    showCreateThreadModal(rowIndex) {
        if (rowIndex < 0 || rowIndex >= this.state.rows.length) {
            logger.warn('Invalid row index for thread creation');
            return;
        }

        const currentRow = this.state.rows[rowIndex];
        this.threadPresenter.open({
            row: currentRow,
            rowIndex,
            spreadsheetId: this.state.spreadsheetId,
            podName: this.state.sheetData.metadata?.podName || 'Pod',
            mainSheetLink: this.state.sheetData.metadata?.mainSheetLink,
            currentAnalysis: this.getCurrentColorAnalysis(currentRow)
        });
    }

    /**
     * Closes the create thread modal
     */
    closeCreateThreadModal() {
        this.threadModal.close();
    }
}
