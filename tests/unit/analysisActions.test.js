import test from 'node:test';
import assert from 'node:assert/strict';

import { AnalysisActions } from '../../js/ui/analysisActions.js';
import { AppState } from '../../js/app/appState.js';
import { parsePodSheets } from '../../js/domain/matchRows.js';
import { makeSheetData } from '../fixtures/sheetData.js';

/**
 * Host double for the write workflows. It records the render call order and can
 * hold the reload re-fetch open so we can prove the button flip does not wait
 * for it.
 */
function makeHost({ sheetData, holdReload = false } = {}) {
    const events = [];
    const host = {
        events,
        state: new AppState(),
        writer: {
            async writeAnalysis() { events.push('write'); return { success: true }; },
            async clearCell() { events.push('clear'); return { success: true }; }
        },
        sheetsAPI: {
            async getSheetData() {
                if (holdReload) await new Promise(() => {});
                return sheetData;
            }
        },
        uiController: { showStatus() {} },
        view: {
            highlightAnalysisButton() { events.push('highlight'); },
            beginSpinner() { return { style: {} }; },
            endSpinner() {}
        },
        getCurrentGuruColIndex() { return 4; },
        getCurrentColorAnalysis(row) { return row.redAnalysis; },
        getDeckStats() { return { totalMatches: 1, unclaimedMatches: 0 }; },
        isAnalysisComplete() { return false; },
        renderCurrentButtons() { events.push('renderCurrentButtons'); },
        async renderAnalysisDisplay() { events.push('renderAnalysisDisplay'); },
        reload() { events.push('reload'); },
        parseSheets(fresh) {
            const { rows, numDiscrepancies } = parsePodSheets(fresh, this.state.guruColor, this.state.signature);
            this.state.setRows(rows);
            this.state.setNumDiscrepancies(numDiscrepancies);
        },
        async showCurrentRow() { events.push('showCurrentRow'); }
    };
    host.state.setSheetData(sheetData);
    host.state.setGuruColor('red');
    host.state.setSignature('alice');
    return host;
}

test('a score flips the ownership button before the background reload returns', async () => {
    const sheetData = makeSheetData({ guruRows: [
        ['1', 'Deck A', 'Deck B', '', 'alice', '', '', '', '']
    ] });

    // Reload's re-fetch never resolves: if the button refresh depended on it,
    // 'renderCurrentButtons' would never appear in the event log.
    const host = makeHost({ sheetData, holdReload: true });
    host.parseSheets(sheetData);
    host.state.setRowIndex(0);

    await new AnalysisActions(host).setAnalysis(1.0);

    assert.ok(
        host.events.indexOf('renderCurrentButtons') < host.events.indexOf('reload'),
        'buttons are re-rendered from local state before the reload runs'
    );
});

test('clearing a result updates the row model before reload', async () => {
    const sheetData = makeSheetData({ guruRows: [
        ['1', 'Deck A', 'Deck B', '1', 'alice', '', '', '', '']
    ] });

    const host = makeHost({ sheetData, holdReload: true });
    host.parseSheets(sheetData);
    host.state.setRowIndex(0);

    await new AnalysisActions(host).clearCurrentUserAnalysis();

    assert.equal(host.state.currentRow.redAnalysis, '', 'analysis cleared locally');
    assert.ok(host.events.includes('clear'));
});
