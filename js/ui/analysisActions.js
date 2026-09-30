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
            console.error('Error saving analysis:', error);
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
            console.error('Error claiming match:', error);
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
                sheetId: currentRow.sheetId,
                row: currentRow.originalRowIndex,
                col: host.getCurrentGuruColIndex('signature'),
                guruSheetIds: this.mergedGuruSheetIds
            });

            setColourSignature(currentRow, state.guruColor, '');
            host.uiController.showStatus('Match unclaimed successfully!', 'success');
            await host.showCurrentRow();
        } catch (error) {
            console.error('Error unclaiming match:', error);
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
            console.error('Error clearing analysis:', error);
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
                sheetId: state.sheetId,
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
            console.error('Error claiming deck matches:', error);
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
            const freshSheetData = await host.sheetsAPI.getSheetData(state.sheetId);

            state.setSheetData(freshSheetData);
            host.parseSheets(freshSheetData);

            const newRowIndex = state.findRowIndexByKey(key);
            state.setRowIndex(newRowIndex >= 0 ? newRowIndex : 0);
            await host.showCurrentRow();
        } catch (error) {
            console.warn('Background data refresh failed:', error);
        }
    }

    async saveDeckInfoField(deckString, type, currentValue, newValue, span) {
        const host = this.host;
        const state = this.state;
        host.uiController.showStatus(`Saving ${type} changes...`, 'loading');
        const deckInfo = state.deckNotesMap.get(deckString) || {};
        const row = deckInfo.row;
        const colMap = state.deckNotesColumnMap;
        const col = colMap[type];
        const deckNotesSheet = state.sheetData.sheets.find(sheet =>
            sheet.title && sheet.title.toLowerCase().includes('deck notes')
        );

        const result = await host.writer.saveDeckField({
            sheetId: state.sheetId,
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
                    host.writer.signGoldfishClock({
                        sheetId: state.sheetId,
                        sheet: deckNotesSheet,
                        row,
                        col: colMap.goldfishSignature,
                        signature: state.signature
                    });
                    deckInfo.goldfishSignature = state.signature;
                }
            }
            state.deckNotesMap.set(deckString, { ...deckInfo });
            host.view.updateDeckInfoValue(span, newValue);
            host.uiController.showStatus(`${type.charAt(0).toUpperCase() + type.slice(1)} saved successfully!`, 'success');
        } else {
            host.uiController.showStatus(`Failed to save ${type} changes. The original data may have been modified.`, 'info');
            console.warn(`Failed to save ${type} changes:`, result);
        }
    }
}
