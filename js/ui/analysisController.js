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
import { HubManager } from '../modules/hubManager.js';
import {
    calculateOutcomeFromAnalyses,
    getGuruAnalysisValues,
    getAnalysisLabel
} from '../domain/analyses.js';
import {
    getCurrentColorAnalysis,
    getCurrentColorSignature,
    setColourAnalysis,
    setColourSignature,
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
    rowHasMyDiscrepancy,
    allGurusHaveMatchingResults,
    isMatchAvailableForAnalysis,
    isCurrentMatchAvailableForAnalysis,
    isAnalysisComplete,
    findFirstEmptyAnalysis,
    findFirstDiscrepancy,
    findNextDeck,
    findMirrorMatchIndex,
    getDeckStats
} from '../domain/matchRows.js';
import { isInverseErrorSuspected, describeInverseResult } from '../domain/inverseCheck.js';
import { processDeckNotes, calculateColorStatistics } from '../domain/deckNotes.js';
import { AnalysisView } from './analysisView.js';
import { AnalysisWriter } from './analysisWriter.js';
import { CardPresenter } from './cardPresenter.js';
import { GuruColorSelector } from './guruColorSelector.js';
import { MatchTableModal } from './matchTableModal.js';
import { MatchTablePresenter } from './matchTablePresenter.js';
import { ThreadModal } from './threadModal.js';
import { ThreadPresenter } from './threadPresenter.js';

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
        // Analysis buttons
        document.getElementById('win-btn').addEventListener('click', () => this.setAnalysis(1.0));
        document.getElementById('tie-btn').addEventListener('click', () => this.setAnalysis(0.5));
        document.getElementById('loss-btn').addEventListener('click', () => this.setAnalysis(0.0));

        // Navigation buttons
        document.getElementById('prev-btn').addEventListener('click', () => this.previousRow());
        document.getElementById('next-btn').addEventListener('click', () => this.nextRow());
        document.getElementById('skip-btn').addEventListener('click', () => this.skipToNextIncomplete());
        document.getElementById('discrepancy-btn').addEventListener('click', () => this.skipToNextDiscrepancy());
        document.getElementById('mirror-match-btn').addEventListener('click', () => this.skipToMirrorMatch());
        document.getElementById('next-deck-btn').addEventListener('click', () => this.skipToNextDeck());

        // Guru color selector (owns its own document-level dismiss listeners)
        this.guruColorSelector = new GuruColorSelector({
            onChange: (colour) => this.changeGuruColor(colour)
        });

        // --- MATCH TABLE MODAL ---
        document.getElementById('current-row-info').addEventListener('click', () => this.showMatchTableModal());

        // --- CREATE THREAD TEXT MODAL ---
        // Use event delegation since the button is created dynamically in the view.
        document.addEventListener('click', (e) => {
            if (e.target.closest('.create-thread-btn')) {
                const btn = e.target.closest('.create-thread-btn');
                const rowIndex = parseInt(btn.dataset.rowIndex);
                this.showCreateThreadModal(rowIndex);
            }
            if (e.target.closest('.close-thread-modal')) {
                this.closeCreateThreadModal();
            }
            if (e.target.classList.contains('thread-modal-overlay')) {
                this.closeCreateThreadModal();
            }
        });
    }

    async changeGuruColor(newColor) {
        if (newColor === this.currentGuruColor) {
            return; // No change needed
        }

        try {
            const oldColor = this.currentGuruColor;
            this.currentGuruColor = newColor;

            console.log(`Switching guru color from ${oldColor} to ${newColor}`);

            // Update the display immediately
            this.updateGuruColorDisplay();
            // Show the current row with the new guru color perspective
            await this.showCurrentRow();

            this.uiController.showStatus(`Switched to ${newColor} guru`, 'success');

        } catch (error) {
            console.error('Error changing guru color:', error);
            this.uiController.showStatus(`Error switching guru color: ${error.message}`, 'error');

            // Revert to old color on error
            this.currentGuruColor = oldColor;
            this.updateGuruColorDisplay();
        }
    }

    updateGuruColorDisplay() {
        this.view.renderGuruColor(this.currentGuruColor);
        this.guruColorSelector?.update(this.currentGuruColor);
    }

    /**
     * Update the browser URL with current pod ID, guru color, and row number
     */
    updateURL() {
        if (!this.currentData?.sheetId) return;

        const newUrl = new URL(window.location);
        // Remove all existing query parameters
        newUrl.search = '';
        newUrl.searchParams.set('pod', this.currentData.sheetId);

        if (this.currentRowIndex !== undefined && this.allRows?.length > 0) {
            newUrl.searchParams.set('match', (this.currentRowIndex + 1).toString());
        }

        if (this.currentGuruColor) {
            newUrl.searchParams.set('guru', this.currentGuruColor);
        }

        window.history.replaceState({
            podId: this.currentData.sheetId,
            guruColor: this.currentGuruColor,
            rowIndex: this.currentRowIndex
        }, '', newUrl);

        // Update title with current spreadsheet title
        const podName = this.currentData?.metadata?.podName || this.currentData?.title || 'Unknown Pod';
        const matchId = this.currentRowIndex === null ? '' : this.currentRowIndex + 1;
        document.title = `${podName} ${matchId}`;
    }

    async loadData(sheetData, guruColor = null, rowNumber = 0) {
        this.currentData = sheetData;

        if (sheetData.sheets.some(sheet => sheet.title === 'Merged Gurus' && sheet.hidden)) {
            const notesData = sheetData.sheets.find(sheet => sheet.title === 'Deck Notes');
            if (notesData) {
                // Show deck notes editor if available
                this.showDeckNotesEditor(notesData);
                return false;
            } else {
                this.uiController.showError('No Deck Notes sheet found. Please ensure it exists to continue.');
                return false;
            }
        }

        if (sheetData.metadata?.guruHubLink && sheetData.metadata?.podName) {
            if (!this.hub) {
                this.hub = new HubManager(sheetData.metadata.guruHubLink, sheetData.metadata.podName);
            }
            this.hub.loadThreads();
        }

        if (rowNumber !== null && rowNumber > 0) {
            this.currentRowIndex = rowNumber - 1;
        }

        if (guruColor === null) {
            try {
                // Determine the current guru color from the actual sheet data
                this.currentGuruColor = this.determineGuruColorFromSheet(sheetData);
                console.log(`Determined guru color: ${this.currentGuruColor}`);
            } catch (error) {
                // Check if this is a "signature not found" error - offer color selection
                if (error.message.includes('not found in any analysis column')) {
                    this.showGuruColorSelection(sheetData);
                    return false;
                } else {
                    // For other errors, show a generic error message
                    console.error('Error determining guru color:', error);
                    this.uiController.showError('An error occurred while determining guru color');
                    return false;
                }
            }
        } else if (guruColor !== null) {
            this.currentGuruColor = guruColor.toLowerCase();
        }

        this.allRows = [];

        // Process deck notes for reference
        const deckNotesResult = this.processDeckNotes(sheetData);
        this.deckNotesMap = deckNotesResult.deckNotesMap;
        this.deckNotesColumnMap = deckNotesResult.columnMap;
        console.log('Loaded deck notes:', this.deckNotesMap.size, 'entries');

        this.parseSheets(sheetData);

        if (this.allRows.length === 0) {
            this.view.showNoDataMessage();
        } else {
            if (this.currentRowIndex === null || this.currentRowIndex === undefined || this.currentRowIndex < 0 || this.currentRowIndex >= this.allRows.length) {
                // Find the first row with empty Guru Analysis
                let firstEmpty = this.findFirstEmptyAnalysis();
                if (firstEmpty == null) {
                    this.currentRowIndex = 0;
                    this.showCompletionMessage();
                } else {
                    this.currentRowIndex = firstEmpty;
                }
            }
        }
        return true;
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

    calculateOutcomeFromAnalyses(...guruAnalyses) {
        return calculateOutcomeFromAnalyses(...guruAnalyses);
    }

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
        // Update URL with current state
        this.updateURL();

        // Show sheet header
        this.view.renderSheetInfo({
            sheetId: this.currentData.sheetId,
            title: this.currentData.title,
            podName: this.currentData.metadata?.podName,
            matchNumber: this.currentRowIndex + 1
        });

        if (this.currentRowIndex >= this.allRows.length || this.currentRowIndex < 0) {
            this.showMatchTableModal();
            return;
        }

        const currentRow = this.allRows[this.currentRowIndex];

        // Update progress info
        this.view.renderProgress(this.currentRowIndex, this.allRows.length);
        this.updateGuruColorDisplay();

        // Load card images for both players
        const cards1Loaded = this.cards.loadPlayerCards('player1', currentRow.player1);
        const cards2Loaded = this.cards.loadPlayerCards('player2', currentRow.player2);
        this.displayDeckInfo('player1', currentRow.player1);
        this.displayDeckInfo('player2', currentRow.player2);

        // Update current outcome display
        this.view.renderOutcome(currentRow.outcomeValue);

        // Show current guru's analysis with other gurus' analyses
        await this.renderAnalysisDisplay(currentRow);

        // Button visibility based on row ownership
        const currentAnalysis = this.getCurrentColorAnalysis(currentRow);
        const currentAnalysisValue = currentAnalysis ? parseFloat(currentAnalysis) : null;
        this.view.renderButtons({
            row: currentRow,
            colour: this.currentGuruColor,
            signature: this.guruSignature,
            analysisValue: currentAnalysisValue,
            deckStats: this.getDeckStats()
        });

        // Update navigation buttons
        this.view.renderNavigation(this.currentRowIndex, this.allRows.length);

        // Show/hide discrepancy button based on number of discrepancies
        this.view.renderDiscrepancyButton(this.numDiscrepancies);

        // Update inverse result display on mirror match button
        this.updateInverseResultDisplay();

        await cards1Loaded;
        await cards2Loaded;

        // Preload card images for adjacent matches in the background
        this.cards.preloadRows(this.allRows, this.rowsToPreload());
    }

    /** Build the analysis list, fetching its Discord thread link if any. */
    async renderAnalysisDisplay(currentRow) {
        const showOtherGurus = !this.isMatchAvailableForAnalysis(currentRow);
        const threadUrl = await this.getThreadUrl(currentRow);
        this.view.buildAnalysisList({
            row: currentRow,
            outcomeValue: currentRow.outcomeValue || '',
            colour: this.currentGuruColor,
            showOtherGurus,
            threadUrl,
            rowIndex: this.currentRowIndex
        });
    }

    async getThreadUrl(currentRow) {
        if (!this.hub) {
            return null;
        }
        try {
            const rowId = currentRow.rowIndex || this.currentRowIndex + 1;
            return await this.hub.getThreadById(rowId);
        } catch (error) {
            console.warn('Failed to fetch thread link:', error);
            return null;
        }
    }

    /**
     * Claim all unclaimed matches with the same Player 1 deck as the current row
     */
    async claimDeckRows() {
        if (this.currentRowIndex >= this.allRows.length) return;

        const currentRow = this.allRows[this.currentRowIndex];
        const player1Deck = currentRow.player1;
        if (!player1Deck) return;


        // Find all rows with the same Player 1 deck (total for this deck)
        const rowsToClaim = this.allRows.filter(row => row.player1 === player1Deck);

        if (rowsToClaim.length === 0) {
            this.uiController.showStatus(`No matches found for deck "${player1Deck}".`, 'error');
            return;
        }

        try {
            this.uiController.showStatus(`Claiming ${rowsToClaim.length} matches for deck...`, 'loading');
            const result = await this.writer.claimRows({
                sheetId: this.currentData.sheetId,
                rows: rowsToClaim.map(row => row.originalRowIndex),
                col: this.getCurrentGuruColIndex('signature'),
                signature: this.guruSignature,
                guruSheetIds: this.currentData.sheets.find(s => s.title === 'Merged Gurus')?.guruSheetIds
            });

            // Update local data for only those that were actually claimed
            let actuallyClaimed = 0;
            if (result && result.updatedCells) {
                rowsToClaim.forEach((row) => {
                    // Find the matching row in this.allRows by originalRowIndex and sheetId
                    const match = this.allRows.find(r => r.originalRowIndex === row.originalRowIndex && r.sheetId === row.sheetId);
                    if (!match) return;
                    // Find the matching row in the skipped ones
                    const skipped = result.skipped && result.skipped.find(s => s.row === row.originalRowIndex + 1);
                    if (skipped) {
                        // This row is already claimed, set the signature to the value from skipped
                        setColourSignature(match, this.currentGuruColor, skipped.currentValue);
                    } else {
                        // Successfully claimed this row, set the signature to user's guru signature
                        setColourSignature(match, this.currentGuruColor, this.guruSignature);
                        actuallyClaimed++;
                    }
                });
            }

            this.uiController.showStatus(`Claimed ${actuallyClaimed} of ${rowsToClaim.length} matches for this deck.`, 'success');
            console.log(`🎯 Claimed ${actuallyClaimed} matches for deck "${player1Deck}" (${rowsToClaim.length} total)`);
            this.showCurrentRow();

        } catch (error) {
            console.error('Error claiming deck matches:', error);
            this.uiController.showStatus(`Error claiming deck matches: ${error.message}`, 'error');
        }
    }

    /** Indices worth warming: the next empty, plus the adjacent rows. */
    rowsToPreload() {
        const indices = new Set();

        const nextEmptyIndex = this.findFirstEmptyAnalysis(this.currentRowIndex + 1);
        if (nextEmptyIndex != null) {
            indices.add(nextEmptyIndex);
        }

        for (const offset of [1, -1]) {
            const index = this.currentRowIndex + offset;
            if (index >= 0 && index < this.allRows.length) {
                indices.add(index);
            }
        }

        return indices;
    }

    async setAnalysis(value) {
        if (this.currentRowIndex >= this.allRows.length) return;

        const currentRow = this.allRows[this.currentRowIndex];

        try {
            this.uiController.showStatus('Saving guru analysis...', 'loading');

            // Use helper to get analysis column index
            const analysisColIndex = this.getCurrentGuruColIndex('analysis');
            console.log('🎯 Updating cell:', {
                sheetTitle: currentRow.title,
                originalRowIndex: currentRow.originalRowIndex,
                filteredRowIndex: currentRow.rowIndex,
                analysisColIndex,
                guruColor: this.currentGuruColor,
                value: value
            });

            await this.writer.writeAnalysis({
                sheetId: currentRow.sheetId,
                row: currentRow.originalRowIndex,
                col: analysisColIndex,
                value,
                guruSheetIds: this.currentData.sheets.find(s => s.title === 'Merged Gurus')?.guruSheetIds
            });

            // Update the specific guru analysis in the local data
            setColourAnalysis(currentRow, this.currentGuruColor, value.toString());

            // Calculate and update the outcome value based on all guru analyses
            const newOutcome = this.calculateOutcomeFromAnalyses(...getGuruAnalysisValues(currentRow));
            currentRow.outcomeValue = newOutcome;

            // Update button highlighting immediately based on the new analysis value
            this.view.highlightAnalysisButton(value);
            // Update the analysis list
            await this.renderAnalysisDisplay(currentRow);

            this.uiController.showStatus(`Analysis saved: ${this.getAnalysisLabel(value)}`, 'success');

            // Check if analysis is now complete
            if (this.isAnalysisComplete()) {
                this.showCompletionMessage();
                return;
            }

            // Reload data in the background to get fresh updates without moving to next row
            this.reloadAllDataInBackground();

        } catch (error) {
            console.error('Error saving analysis:', error);
            this.uiController.showStatus(`Error saving analysis: ${error.message}`, 'error');
        }
    }

    getAnalysisLabel(value) {
        return getAnalysisLabel(value);
    }

    async claimRow() {
        if (this.currentRowIndex >= this.allRows.length) return;

        const currentRow = this.allRows[this.currentRowIndex];

        // Show spinner on claim button
        const claimButton = this.view.beginSpinner('claim-button', 'Claiming...');

        try {
            this.uiController.showStatus('Claiming match...', 'loading');

            // Use helper to get signature column index
            const signatureColIndex = this.getCurrentGuruColIndex('signature');
            console.log('🎯 Claiming match:', {
                sheetTitle: currentRow.title,
                originalRowIndex: currentRow.originalRowIndex,
                filteredRowIndex: currentRow.rowIndex,
                signatureColIndex,
                guruColor: this.currentGuruColor,
                userSignature: this.guruSignature
            });

            // Use checked update to atomically claim the match only if signature is still empty
            const result = await this.writer.claimRow({
                sheetId: currentRow.sheetId,
                row: currentRow.originalRowIndex,
                col: signatureColIndex,
                signature: this.guruSignature,
                guruSheetIds: this.currentData.sheets.find(s => s.title === 'Merged Gurus')?.guruSheetIds
            });

            if (result && result.skippedCells > 0) {
                // Someone else claimed the match first
                this.uiController.showStatus('Match was already claimed by someone else', 'info');
                // Refresh the display to show the updated state
                await this.reloadAllDataInBackground();
                return;
            }

            // Update local data with the new signature
            setColourSignature(currentRow, this.currentGuruColor, this.guruSignature);

            this.uiController.showStatus('Match claimed successfully!', 'success');

            // Refresh the display to show scoring buttons now that the match is claimed
            await this.showCurrentRow();

        } catch (error) {
            console.error('Error claiming match:', error);

            // Reset claim button on error
            this.view.endSpinner(claimButton);
            this.uiController.showStatus(`Error claiming match: ${error.message}`, 'error');
        }
    }

    async unclaimRow() {
        if (this.currentRowIndex >= this.allRows.length) return;

        const currentRow = this.allRows[this.currentRowIndex];


        // Verify that the current user owns this match
        const currentRowSignature = this.getCurrentColorSignature(currentRow);
        if (currentRowSignature !== this.guruSignature) {
            this.uiController.showStatus('You can only unclaim matches that you have claimed.', 'error');
            return;
        }

        // Check if user has already scored this match
        const currentAnalysis = this.getCurrentColorAnalysis(currentRow);
        if (currentAnalysis && currentAnalysis.trim() !== '') {
            this.uiController.showStatus('Cannot unclaim a match that has already been scored.', 'error');
            return;
        }

        // Show spinner on unclaim button
        const unclaimButton = this.view.beginSpinner('unclaim-button', 'Unclaiming...');

        try {
            this.uiController.showStatus('Unclaiming match...', 'loading');

            // Use helper to get signature column index
            const signatureColIndex = this.getCurrentGuruColIndex('signature');
            console.log('🎯 Unclaiming match:', {
                sheetTitle: currentRow.title,
                originalRowIndex: currentRow.originalRowIndex,
                filteredRowIndex: currentRow.rowIndex,
                signatureColIndex,
                guruColor: this.currentGuruColor,
                userSignature: this.guruSignature
            });

            // Clear the signature using clearCell helper
            await this.writer.clearCell({
                sheetId: currentRow.sheetId,
                row: currentRow.originalRowIndex,
                col: signatureColIndex,
                guruSheetIds: this.currentData.sheets.find(s => s.title === 'Merged Gurus')?.guruSheetIds
            });

            // Update local data to clear the signature
            setColourSignature(currentRow, this.currentGuruColor, '');

            this.uiController.showStatus('Match unclaimed successfully!', 'success');

            // Refresh the display to show claim button now that the match is unclaimed
            await this.showCurrentRow();

        } catch (error) {
            console.error('Error unclaiming match:', error);

            // Reset unclaim button on error
            this.view.endSpinner(unclaimButton);

            this.uiController.showStatus(`Error unclaiming match: ${error.message}`, 'error');
        }
    }

    /**
     * Clear the current user's analysis for the current row (when they've already scored)
     */
    async clearCurrentUserAnalysis() {
        if (this.currentRowIndex >= this.allRows.length) return;

        const currentRow = this.allRows[this.currentRowIndex];


        // Verify that the current user owns this match
        const currentRowSignature = this.getCurrentColorSignature(currentRow);
        if (currentRowSignature !== this.guruSignature) {
            this.uiController.showStatus('You can only clear results for matches you own.', 'error');
            return;
        }

        // Check if user actually has an analysis to clear
        const currentAnalysis = this.getCurrentColorAnalysis(currentRow);
        if (!currentAnalysis || currentAnalysis.trim() === '') {
            this.uiController.showStatus('No analysis to clear for this match.', 'info');
            return;
        }

        // Disable the clear button and show spinner
        const clearButton = this.view.beginSpinner('clear-result-button', 'Clearing...');

        try {
            this.uiController.showStatus('Clearing your analysis...', 'loading');

            // Use helper to get analysis column index
            const analysisColIndex = this.getCurrentGuruColIndex('analysis');

            await this.writer.clearCell({
                sheetId: currentRow.sheetId,
                row: currentRow.originalRowIndex,
                col: analysisColIndex,
                guruSheetIds: this.currentData.sheets.find(s => s.title === 'Merged Gurus')?.guruSheetIds
            });

            // Update local data to clear the analysis for the current guru
            setColourAnalysis(currentRow, this.currentGuruColor, '');

            // Recalculate outcome
            const oldOutcome = currentRow.outcomeValue;
            currentRow.outcomeValue = this.calculateOutcomeFromAnalyses(...getGuruAnalysisValues(currentRow));

            // Update the number of discrepancies
            if (oldOutcome === 'discrepancy' && currentRow.outcomeValue !== 'discrepancy') {
                this.numDiscrepancies--;
            } else if (oldOutcome !== 'discrepancy' && currentRow.outcomeValue === 'discrepancy') {
                this.numDiscrepancies++;
            }

            // Reload data in the background to get fresh updates without moving to next row
            this.reloadAllDataInBackground();

            this.uiController.showStatus('Your analysis was cleared.', 'success');

            // Hide clear button after clearing
            if (clearButton) clearButton.style.display = 'none';

            // Update UI for current row
            await this.showCurrentRow();

        } catch (error) {
            console.error('Error clearing analysis:', error);
            this.view.endSpinner(clearButton);
            this.uiController.showStatus(`Error clearing analysis: ${error.message}`, 'error');
        }
    }

    async reloadAllDataInBackground() {
        // Run the reload in the background without blocking the UI
        try {
            console.log('🔄 Starting background data refresh...');

            // Get fresh data for the entire sheet
            const freshSheetData = await this.sheetsAPI.getSheetData(this.currentData.sheetId);

            // Store the current row info to find it again after reload
            const currentRow = this.allRows[this.currentRowIndex];
            const currentRowIdentifier = {
                sheetId: currentRow.sheetId,
                originalRowIndex: currentRow.originalRowIndex,
                player1: currentRow.player1,
                player2: currentRow.player2
            };

            // Rebuild data with fresh information
            this.currentData = freshSheetData;

            this.parseSheets(freshSheetData);

            // Find the current row in the fresh data
            let newRowIndex = 0;
            for (let i = 0; i < this.allRows.length; i++) {
                const row = this.allRows[i];
                if (row.sheetId === currentRowIdentifier.sheetId &&
                    row.originalRowIndex === currentRowIdentifier.originalRowIndex &&
                    row.player1 === currentRowIdentifier.player1 &&
                    row.player2 === currentRowIdentifier.player2) {
                    newRowIndex = i;
                    break;
                }
            }

            // Update current position to the refreshed row
            this.currentRowIndex = newRowIndex;

            // Silently update the current row display with fresh data
            await this.showCurrentRow();

            console.log('🔄 Background data refresh completed successfully');

        } catch (error) {
            console.warn('Background data refresh failed:', error);
            // Don't show error to user since this is background operation
        }
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
        if (this.currentRowIndex < this.allRows.length - 1) {
            this.currentRowIndex++;
            await this.showCurrentRow();
        }
    }

    async previousRow() {
        if (this.currentRowIndex > 0) {
            this.currentRowIndex--;
            await this.showCurrentRow();
        }
    }

    async skipToNextIncomplete() {
        // Find the next empty starting from after current row
        const nextIncompleteIndex = this.findFirstEmptyAnalysis(this.currentRowIndex + 1);

        // Check if we found a row after the current one
        if (nextIncompleteIndex != null && nextIncompleteIndex != this.currentRowIndex) {
            this.currentRowIndex = nextIncompleteIndex;
            await this.showCurrentRow();
        } else {
            // No more incomplete rows found after current, show completion message
            this.showCompletionMessage();
        }
    }

    async skipToNextDiscrepancy() {
        // Find the next row with discrepancy starting from after current row
        const targetIndex = this.findFirstDiscrepancy(this.currentRowIndex + 1);
        if (targetIndex >= 0) {
            this.currentRowIndex = targetIndex;
        }
        // If the row we jump to has a discrepancy but the guru is in a different color,
        // change to that color
        const targetRow = this.allRows[this.currentRowIndex];
        if (this.rowHasDiscrepancy(targetRow)) {
            const color = this.getGuruColorInRow(targetRow);
            if (color) {
                this.currentGuruColor = color;
            }
        }
        await this.showCurrentRow();
    }

    /**
     * Find the first unclaimed match with a different P1 deck from the current one
     * @returns {number} - Index of the next deck match, or current index if none found
     */
    findNextDeck() {
        return findNextDeck(this.allRows, this.currentGuruColor, this.currentRowIndex);
    }

    async skipToNextDeck() {
        const nextDeckIndex = this.findNextDeck();
        if (nextDeckIndex !== this.currentRowIndex) {
            this.currentRowIndex = nextDeckIndex;
            await this.showCurrentRow();
        } else {
            this.uiController.showStatus('No other unclaimed decks found', 'info');
        }
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

    async skipToMirrorMatch() {
        // Jump to the match where player1 and player2 are swapped
        const mirrorIndex = this.findMirrorMatchIndex(this.currentRowIndex);

        if (mirrorIndex !== -1) {
            this.currentRowIndex = mirrorIndex;
            await this.showCurrentRow();
        } else {
            this.uiController.showStatus('No mirror match found for this game.', 'info');
        }
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
        const deckInfo = this.deckNotesMap?.get(deckString) || null;
        this.view.renderDeckInfo(playerId, deckString, deckInfo, {
            onSaveField: (deck, type, oldValue, newValue, span) =>
                this.saveDeckInfoField(deck, type, oldValue, newValue, span)
        });
    }

    async saveDeckInfoField(deckString, type, currentValue, newValue, span) {
        this.uiController.showStatus(`Saving ${type} changes...`, 'loading');
        const deckInfo = this.deckNotesMap.get(deckString) || {};
        const row = deckInfo.row;
        const colMap = this.deckNotesColumnMap;
        const col = colMap[type];
        const deckNotesSheet = this.currentData.sheets.find(sheet =>
            sheet.title && sheet.title.toLowerCase().includes('deck notes')
        );

        // Checked update so a concurrent edit is not clobbered.
        const result = await this.writer.saveDeckField({
            sheetId: this.currentData.sheetId,
            sheet: deckNotesSheet,
            row,
            col,
            value: newValue,
            expectedValue: currentValue
        });

        if (result && result.skippedCells == 0) {
            if (type === 'notes') deckInfo.notes = newValue;
            else if (type === 'additionalNotes') deckInfo.additionalNotes = newValue;
            else if (type === 'clock') {
                deckInfo.goldfishClock = newValue;
                if (colMap.goldfishSignature > -1) {
                    // Automatically sign this clock with the guru signature
                    this.writer.signGoldfishClock({
                        sheetId: this.currentData.sheetId,
                        sheet: deckNotesSheet,
                        row,
                        col: colMap.goldfishSignature,
                        signature: this.guruSignature
                    });
                    deckInfo.goldfishSignature = this.guruSignature;
                }
            }
            this.deckNotesMap.set(deckString, { ...deckInfo });
            this.view.updateDeckInfoValue(span, newValue);
            this.uiController.showStatus(`${type.charAt(0).toUpperCase() + type.slice(1)} saved successfully!`, 'success');
        } else {
            this.uiController.showStatus(`Failed to save ${type} changes. The original data may have been modified.`, 'info');
            console.warn(`Failed to save ${type} changes:`, result);
        }
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

    rowHasMyDiscrepancy(row) {
        return rowHasMyDiscrepancy(row, this.currentGuruColor, this.guruSignature);
    }

    getGuruAnalysisValues(row) {
        return getGuruAnalysisValues(row);
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
