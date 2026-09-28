/**
 * Analysis controller.
 *
 * Owns the analysis session state and orchestrates the services and views for
 * the single-row scoring screen. It contains no DOM construction: rendering is
 * delegated to AnalysisView, modals to MatchTableModal / ThreadModal, the
 * colour dropdown to GuruColorSelector, and pure logic to js/domain/.
 *
 * Extracted from the former guruAnalysisInterface.js god class (phase 3 of #18).
 */
import { ScryfallAPI } from '../modules/scryfallAPI.js';
import { DeckNotesEditor } from '../modules/deckNotesEditor.js';
import {
    getCurrentColorAnalysis,
    getCurrentColorSignature,
    emptyColumnIndex,
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

export class AnalysisController {
    constructor(sheetsAPI, uiController, guruSignature) {
        this.sheetsAPI = sheetsAPI;
        this.uiController = uiController;
        this.guruSignature = guruSignature;
        this.hub = null;
        this.scryfallAPI = new ScryfallAPI();
        this.currentData = null;
        this.allRows = [];
        this.currentRowIndex = -1;
        this.currentGuruColor = null;
        this.numDiscrepancies = 0;
        this.deckNotesMap = new Map();
        this.deckNotesColumnMap = {};
        // Single per-colour column index: { red: { analysis, signature }, ... }
        this.columnIndex = emptyColumnIndex();

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
        this.hub = null;
        this.currentData = null;
        this.allRows = [];
        this.currentRowIndex = -1;
        this.currentGuruColor = null;
        this.numDiscrepancies = 0;
        this.deckNotesMap = new Map();
        this.deckNotesColumnMap = {};
        this.columnIndex = emptyColumnIndex();
    }

    destroy() {
        this.eventBinder.destroy();
        this.guruColorSelector?.destroy();
        this.matchTableModal.destroy();
        this.threadModal.destroy();
    }

    /**
     * Updates the guru signature used for filtering and claiming matches
     * @param {string} signature - The new guru signature
     */
    setGuruSignature(signature) {
        if (this.guruSignature !== signature) {
            this.guruSignature = signature;
            console.log(`Guru signature updated to: ${signature}`);
        }
    }

    determineGuruColorFromSheet(sheetData) {
        return determineGuruColorFromSheet(sheetData, this.guruSignature, this.currentRowIndex);
    }

    bindEvents() {
        return this.eventBinder.bind();
    }

    async changeGuruColor(newColor) {
        if (newColor === this.currentGuruColor) {
            return;
        }

        try {
            const oldColor = this.currentGuruColor;
            this.currentGuruColor = newColor;

            this.updateGuruColorDisplay();
            await this.showCurrentRow();

            this.uiController.showStatus(`Switched to ${newColor} guru`, 'success');
        } catch (error) {
            console.error('Error changing guru color:', error);
            this.uiController.showStatus(`Error switching guru color: ${error.message}`, 'error');

            this.currentGuruColor = oldColor;
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
            sheetData, this.currentGuruColor, this.guruSignature
        );
        this.allRows = rows;
        this.numDiscrepancies = numDiscrepancies;
        if (columnIndex) {
            this.columnIndex = columnIndex;
        }
    }

    // The methods below delegate to js/domain/. They are kept on the class so
    // the rendering and event call sites do not need to change in this phase.

    getCurrentColorAnalysis(row) {
        return getCurrentColorAnalysis(row, this.currentGuruColor);
    }

    getCurrentColorSignature(row) {
        return getCurrentColorSignature(row, this.currentGuruColor);
    }

    isCurrentMatchAvailableForAnalysis() {
        return isCurrentMatchAvailableForAnalysis(this.allRows, this.currentGuruColor, this.guruSignature, this.currentRowIndex);
    }

    isMatchAvailableForAnalysis(row) {
        return isMatchAvailableForAnalysis(row, this.currentGuruColor, this.guruSignature);
    }

    isAnalysisComplete() {
        return isAnalysisComplete(this.allRows, this.currentGuruColor);
    }

    findFirstEmptyAnalysis(startFromIndex = 0) {
        return findFirstEmptyAnalysis(this.allRows, this.currentGuruColor, this.guruSignature, startFromIndex);
    }

    findFirstDiscrepancy(startFromIndex = 0) {
        return findFirstDiscrepancy(this.allRows, this.currentGuruColor, this.guruSignature, startFromIndex);
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

    async reloadAllDataInBackground() {
        return this.actions.reloadAllDataInBackground();
    }

    getDeckStats() {
        return getDeckStats(this.allRows, this.currentGuruColor, this.currentRowIndex);
    }

    /**
     * Returns the column index for the current guru color and type ('analysis' or 'signature')
     */
    getCurrentGuruColIndex(type = 'analysis') {
        return getCurrentGuruColIndex(this.currentGuruColor, this.columnIndex, type);
    }

    /**
     * Returns the color that the current guru has claimed in a particular row, or null
     * if that row does not have the current guru's signature.
     */
    getGuruColorInRow(row) {
        return getGuruColorInRow(row, this.guruSignature);
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
        return findMirrorMatchIndex(this.allRows, rowIndex);
    }

    /** Update the inverse display on the mirror-match button. */
    updateInverseResultDisplay() {
        const currentRow = this.allRows[this.currentRowIndex];
        const mirrorIndex = this.findMirrorMatchIndex(this.currentRowIndex);
        const inverseRow = this.allRows[mirrorIndex];

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
        if (!this.deckNotesEditor) {
            // Create a new instance if it doesn't exist
            this.deckNotesEditor = new DeckNotesEditor({
                analysisInterface: this,
                uiController: this.uiController,
                scryfallAPI: this.scryfallAPI,
                sheetsAPI: this.sheetsAPI,
                spreadsheetID: this.currentData.sheetId,
            });
        } else {
            // Update references in case they changed
            this.deckNotesEditor.uiController = this.uiController;
            this.deckNotesEditor.scryfallAPI = this.scryfallAPI;
            this.deckNotesEditor.sheetsAPI = this.sheetsAPI;
            this.deckNotesEditor.spreadsheetID = this.currentData.sheetId;
        }
        this.deckNotesEditor.show(notesData, this.currentData.title);
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
        console.log(`User selected guru color: ${color}`);

        // Set the guru color
        this.currentGuruColor = color;

        // Remove the color selection container
        this.view.hideColorSelection();

        // Ensure the sheet editor is visible before loading data
        this.uiController.showSheetEditor();

        // Continue with the normal data loading process, but skip guru color determination
        await this.loadData(sheetData, color);
        await this.showCurrentRow();
    }

    getTotalRows() {
        return this.allRows.length;
    }

    getCurrentProgress() {
        return {
            current: this.currentRowIndex + 1,
            total: this.allRows.length
        };
    }

    displayDeckInfo(playerId, deckString) {
        return this.rowRenderer.displayDeckInfo(playerId, deckString);
    }

    async saveDeckInfoField(deckString, type, currentValue, newValue, span) {
        return this.actions.saveDeckInfoField(deckString, type, currentValue, newValue, span);
    }

    // --- MATCH TABLE MODAL ---
    async showMatchTableModal() {
        const threadMap = await this.getMatchTableThreadMap();

        await this.matchTablePresenter.open({
            rows: this.allRows,
            currentRowIndex: this.currentRowIndex,
            colour: this.currentGuruColor,
            signature: this.guruSignature,
            threadMap,
            statusFor: (row, idx) => ({
                signature: (getCurrentColorSignature(row, this.currentGuruColor) || '').trim(),
                hasResult: this.hasCurrentColorResult(row),
                hasDiscrepancy: this.rowHasDiscrepancy(row),
                hasThread: this.hasDiscordThreadForRow(threadMap, row, idx),
                inverseSuspected: this.isInverseErrorSuspected(idx),
                allMatching: this.allGurusHaveMatchingResults(row)
            }),
            onSelect: (idx) => {
                if (idx >= 0) {
                    this.currentRowIndex = idx;
                    this.showCurrentRow();
                }
            }
        });
    }

    closeMatchTableModal() {
        this.matchTablePresenter.close();
    }

    async getMatchTableThreadMap() {
        if (!this.hub) {
            return null;
        }

        try {
            return await this.hub.getThreads();
        } catch (error) {
            console.warn('Failed to load thread data for match table:', error);
            return this.hub.threadsCache || null;
        }
    }

    getRowThreadId(row, fallbackIndex) {
        return getRowThreadId(row, fallbackIndex);
    }

    hasDiscordThreadForRow(threadMap, row, fallbackIndex) {
        return hasDiscordThreadForRow(threadMap, row, fallbackIndex);
    }

    hasCurrentColorResult(row) {
        return hasCurrentColorResult(row, this.currentGuruColor);
    }

    rowHasDiscrepancy(row) {
        return rowHasDiscrepancy(row);
    }

    allGurusHaveMatchingResults(row) {
        return allGurusHaveMatchingResults(row);
    }

    isInverseErrorSuspected(rowIndex) {
        return isInverseErrorSuspected(this.allRows, rowIndex, (index) => this.findMirrorMatchIndex(index));
    }

    /**
     * Shows modal with Discord thread text for the current match
     * @param {number} rowIndex - Index of the row to create thread text for
     */
    showCreateThreadModal(rowIndex) {
        if (rowIndex < 0 || rowIndex >= this.allRows.length) {
            console.warn('Invalid row index for thread creation');
            return;
        }

        const currentRow = this.allRows[rowIndex];
        this.threadPresenter.open({
            row: currentRow,
            rowIndex,
            sheetId: this.currentData.sheetId,
            podName: this.currentData.metadata?.podName || 'Pod',
            mainSheetLink: this.currentData.metadata?.mainSheetLink,
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
