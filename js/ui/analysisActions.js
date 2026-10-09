/**
 * Analysis actions.
 *
 * Owns the write/score workflows for the scoring screen: setting an analysis,
 * claiming / unclaiming a match, claiming a whole deck, clearing a result,
 * refreshing in the background and saving a deck-notes field. Each action
 * mutates the controller's session state and asks the controller to re-render,
 * so the controller stays a thin wiring layer.
 *
 * The controller is passed as `host`; this class reads its state and calls its
 * render helpers rather than keeping its own copy.
 */
import {
    calculateOutcomeFromAnalyses,
    getGuruAnalysisValues,
    getAnalysisLabel
} from '../domain/analyses.js';
import {
    getCurrentColorAnalysis,
    getCurrentColorSignature,
    setColourAnalysis,
    setColourSignature
} from '../domain/guruColor.js';
import { logger } from '../utils/log.js';

// The deck-info field names used by the edit buttons -> deckNotes columnMap keys.
const DECK_INFO_COLUMNS = {
    clock: 'goldfishClock',
    notes: 'notes',
    additionalNotes: 'additionalNotes'
};

export class AnalysisActions {
    constructor(host) {
        this.host = host;
    }

    get state() {
        return this.host.state;
    }

    get mergedGuruSheetIds() {
        return this.state.sheetData.sheets.find(s => s.title === 'Merged Gurus')?.guruSheetIds;
    }

    async setAnalysis(value) {
        const host = this.host;
        const state = this.state;
        if (state.rowIndex >= state.rows.length) return;

        const currentRow = state.currentRow;

        try {
            host.uiController.showStatus('Saving guru analysis...', 'loading');

            const analysisColIndex = host.getCurrentGuruColIndex('analysis');

            await host.writer.writeAnalysis({
                spreadsheetId: state.spreadsheetId,
                sheetId: currentRow.sheetId,
                row: currentRow.originalRowIndex,
                col: analysisColIndex,
                value,
                guruSheetIds: this.mergedGuruSheetIds
            });

            setColourAnalysis(currentRow, state.guruColor, value.toString());
            currentRow.outcomeValue = calculateOutcomeFromAnalyses(...getGuruAnalysisValues(currentRow));

            host.view.highlightAnalysisButton(value);
            await host.renderAnalysisDisplay(currentRow);

            host.uiController.showStatus(`Analysis saved: ${getAnalysisLabel(value)}`, 'success');

            if (host.isAnalysisComplete()) {
                host.showCompletionMessage();
                return;
            }

            host.reload();
        } catch (error) {
            logger.error('Error saving analysis:', error);
            host.uiController.showStatus(`Error saving analysis: ${error.message}`, 'error');
        }
    }

    async claimRow() {
        const host = this.host;
        const state = this.state;
        if (state.rowIndex >= state.rows.length) return;

        const currentRow = state.currentRow;
        const claimButton = host.view.beginSpinner('claim-button', 'Claiming...');

        try {
            host.uiController.showStatus('Claiming match...', 'loading');

            const result = await host.writer.claimRow({
                spreadsheetId: state.spreadsheetId,
                sheetId: currentRow.sheetId,
                row: currentRow.originalRowIndex,
                col: host.getCurrentGuruColIndex('signature'),
                signature: state.signature,
                guruSheetIds: this.mergedGuruSheetIds
            });

            if (result && result.skippedCells > 0) {
                host.uiController.showStatus('Match was already claimed by someone else', 'info');
                await host.reload();
                return;
            }

            setColourSignature(currentRow, state.guruColor, state.signature);
            host.uiController.showStatus('Match claimed successfully!', 'success');
            await host.showCurrentRow();
        } catch (error) {
            logger.error('Error claiming match:', error);
            host.view.endSpinner(claimButton);
            host.uiController.showStatus(`Error claiming match: ${error.message}`, 'error');
        }
    }

    async unclaimRow() {
        const host = this.host;
        const state = this.state;
        if (state.rowIndex >= state.rows.length) return;

        const currentRow = state.currentRow;

        if (getCurrentColorSignature(currentRow, state.guruColor) !== state.signature) {
            host.uiController.showStatus('You can only unclaim matches that you have claimed.', 'error');
            return;
        }

        const currentAnalysis = getCurrentColorAnalysis(currentRow, state.guruColor);
        if (currentAnalysis && currentAnalysis.trim() !== '') {
            host.uiController.showStatus('Cannot unclaim a match that has already been scored.', 'error');
            return;
        }

        const unclaimButton = host.view.beginSpinner('unclaim-button', 'Unclaiming...');

        try {
            host.uiController.showStatus('Unclaiming match...', 'loading');

            await host.writer.clearCell({
                spreadsheetId: state.spreadsheetId,
                sheetId: currentRow.sheetId,
                row: currentRow.originalRowIndex,
                col: host.getCurrentGuruColIndex('signature'),
                guruSheetIds: this.mergedGuruSheetIds
            });

            setColourSignature(currentRow, state.guruColor, '');
            host.uiController.showStatus('Match unclaimed successfully!', 'success');
            await host.showCurrentRow();
        } catch (error) {
            logger.error('Error unclaiming match:', error);
            host.view.endSpinner(unclaimButton);
            host.uiController.showStatus(`Error unclaiming match: ${error.message}`, 'error');
        }
    }

    async clearCurrentUserAnalysis() {
        const host = this.host;
        const state = this.state;
        if (state.rowIndex >= state.rows.length) return;

        const currentRow = state.currentRow;

        if (getCurrentColorSignature(currentRow, state.guruColor) !== state.signature) {
            host.uiController.showStatus('You can only clear results for matches you own.', 'error');
            return;
        }

        const currentAnalysis = getCurrentColorAnalysis(currentRow, state.guruColor);
        if (!currentAnalysis || currentAnalysis.trim() === '') {
            host.uiController.showStatus('No analysis to clear for this match.', 'info');
            return;
        }

        const clearButton = host.view.beginSpinner('clear-result-button', 'Clearing...');

        try {
            host.uiController.showStatus('Clearing your analysis...', 'loading');

            await host.writer.clearCell({
                spreadsheetId: state.spreadsheetId,
                sheetId: currentRow.sheetId,
                row: currentRow.originalRowIndex,
                col: host.getCurrentGuruColIndex('analysis'),
                guruSheetIds: this.mergedGuruSheetIds
            });

            setColourAnalysis(currentRow, state.guruColor, '');

            const oldOutcome = currentRow.outcomeValue;
            currentRow.outcomeValue = calculateOutcomeFromAnalyses(...getGuruAnalysisValues(currentRow));

            if (oldOutcome === 'discrepancy' && currentRow.outcomeValue !== 'discrepancy') {
                state.setNumDiscrepancies(state.numDiscrepancies - 1);
            } else if (oldOutcome !== 'discrepancy' && currentRow.outcomeValue === 'discrepancy') {
                state.setNumDiscrepancies(state.numDiscrepancies + 1);
            }

            host.reload();
            host.uiController.showStatus('Your analysis was cleared.', 'success');

            if (clearButton) clearButton.style.display = 'none';

            await host.showCurrentRow();
        } catch (error) {
            logger.error('Error clearing analysis:', error);
            host.view.endSpinner(clearButton);
            host.uiController.showStatus(`Error clearing analysis: ${error.message}`, 'error');
        }
    }

    async claimDeckRows() {
        const host = this.host;
        const state = this.state;
        if (state.rowIndex >= state.rows.length) return;

        const currentRow = state.currentRow;
        const player1Deck = currentRow.player1;
        if (!player1Deck) return;

        const rowsToClaim = state.rows.filter(row => row.player1 === player1Deck);
        if (rowsToClaim.length === 0) {
            host.uiController.showStatus(`No matches found for deck "${player1Deck}".`, 'error');
            return;
        }

        try {
            host.uiController.showStatus(`Claiming ${rowsToClaim.length} matches for deck...`, 'loading');
            const result = await host.writer.claimRows({
                spreadsheetId: state.spreadsheetId,
                sheetId: currentRow.sheetId,
                rows: rowsToClaim.map(row => row.originalRowIndex),
                col: host.getCurrentGuruColIndex('signature'),
                signature: state.signature,
                guruSheetIds: this.mergedGuruSheetIds
            });

            let actuallyClaimed = 0;
            if (result && result.updatedCells) {
                rowsToClaim.forEach((row) => {
                    const match = state.rows.find(r => r.originalRowIndex === row.originalRowIndex && r.sheetId === row.sheetId);
                    if (!match) return;
                    const skipped = result.skipped && result.skipped.find(s => s.row === row.originalRowIndex + 1);
                    if (skipped) {
                        setColourSignature(match, state.guruColor, skipped.currentValue);
                    } else {
                        setColourSignature(match, state.guruColor, state.signature);
                        actuallyClaimed++;
                    }
                });
            }

            host.uiController.showStatus(`Claimed ${actuallyClaimed} of ${rowsToClaim.length} matches for this deck.`, 'success');
            host.showCurrentRow();
        } catch (error) {
            logger.error('Error claiming deck matches:', error);
            host.uiController.showStatus(`Error claiming deck matches: ${error.message}`, 'error');
        }
    }

    /**
     * Re-fetch the pod and rebuild the row model. When `preservePosition` is
     * true, stay on the same match by its stable key (sheet id + original row
     * index) rather than a fuzzy four-field match. A failed refresh is
     * non-fatal: the screen keeps showing the data it already has.
     */
    async reload({ preservePosition = true } = {}) {
        const host = this.host;
        const state = this.state;
        try {
            const key = preservePosition ? state.currentRowKey() : null;
            const freshSheetData = await host.sheetsAPI.getSheetData(state.spreadsheetId);

            state.setSheetData(freshSheetData);
            host.parseSheets(freshSheetData);

            const newRowIndex = state.findRowIndexByKey(key);
            state.setRowIndex(newRowIndex >= 0 ? newRowIndex : 0);
            await host.showCurrentRow();
        } catch (error) {
            logger.warn('Background data refresh failed:', error);
        }
    }

    async saveDeckInfoField(deckString, type, currentValue, newValue, span, entry = null) {
        const host = this.host;
        const state = this.state;
        host.uiController.showStatus(`Saving ${type} changes...`, 'loading');

        const grouped = entry
            || (state.deckNotesEntries || []).find(item => item.deckString === deckString)
            || null;
        const deckInfo = grouped?.deckInfo || state.deckNotesMap.get(deckString) || {};
        const rows = grouped?.rows || [deckInfo.row];
        const colMap = state.deckNotesColumnMap;
        const col = colMap[DECK_INFO_COLUMNS[type] ?? type];
        const deckNotesSheet = state.sheetData.sheets.find(sheet =>
            sheet.title && sheet.title.toLowerCase().includes('deck notes')
        );

        const result = await host.writer.saveDeckField({
            spreadsheetId: state.spreadsheetId,
            sheet: deckNotesSheet,
            rows,
            col,
            value: newValue,
            expectedValue: currentValue
        });

        if (result && result.skippedCells == 0) {
            this.applyDeckInfoChange(deckInfo, type, newValue, colMap, deckNotesSheet, rows);
            state.deckNotesMap.set(deckString, { ...deckInfo });
            host.view.updateDeckInfoValue(span, newValue);
            host.uiController.showStatus(`${type.charAt(0).toUpperCase() + type.slice(1)} saved successfully!`, 'success');
        } else {
            host.uiController.showStatus(`Failed to save ${type} changes. The original data may have been modified.`, 'info');
            logger.warn(`Failed to save ${type} changes:`, result);
        }
    }

    /**
     * Mirror a saved deck-info edit into the local model: the info object, the
     * raw sheet values (if held) and every grouped entry that shares the row.
     * A clock edit also writes the goldfish signature to column C across all
     * rows, matching the old single-row behaviour.
     */
    applyDeckInfoChange(deckInfo, type, newValue, colMap, deckNotesSheet, rows) {
        const host = this.host;
        const state = this.state;

        if (type === 'notes') deckInfo.notes = newValue;
        else if (type === 'additionalNotes') deckInfo.additionalNotes = newValue;
        else if (type === 'clock') {
            deckInfo.goldfishClock = newValue;
            if (colMap.goldfishSignature > -1) {
                host.writer.signGoldfishClock({
                    spreadsheetId: state.spreadsheetId,
                    sheet: deckNotesSheet,
                    rows,
                    col: colMap.goldfishSignature,
                    signature: state.signature
                });
                deckInfo.goldfishSignature = state.signature;
            }
        }

        for (const item of state.deckNotesEntries || []) {
            if (item.deckInfo && rows.includes(item.deckInfo.row)) {
                item.deckInfo = { ...item.deckInfo, ...deckInfo };
                if (type === 'clock' && colMap.goldfishSignature > -1) {
                    item.signatures = [state.signature];
                }
            }
        }

        this.writeDeckInfoToValues(deckInfo, type, newValue, colMap, rows);
    }

    /** Keep the raw Deck Notes values in step so a re-group sees the new data. */
    writeDeckInfoToValues(deckInfo, type, newValue, colMap, rows) {
        const values = this.state.deckNotesValues;
        if (!values) {
            return;
        }
        const col = type === 'clock' ? colMap.goldfishClock
            : type === 'notes' ? colMap.notes
                : colMap.additionalNotes;
        if (col === undefined || col === -1) {
            return;
        }
        for (const row of rows) {
            if (!values[row]) values[row] = [];
            values[row][col] = newValue;
            if (type === 'clock' && colMap.goldfishSignature > -1) {
                values[row][colMap.goldfishSignature] = this.state.signature;
            }
        }
    }
}
