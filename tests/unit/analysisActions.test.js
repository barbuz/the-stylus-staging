import test from 'node:test';
import assert from 'node:assert/strict';

import { AnalysisActions } from '../../js/ui/analysisActions.js';
import { AppState } from '../../js/app/appState.js';
import { parsePodSheets, countMyDiscrepancies } from '../../js/domain/matchRows.js';
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
            async clearCell() { events.push('clear'); return { success: true }; },
            async unclaimRows(args) { events.push('unclaimRows'); this.lastUnclaim = args; return { success: true }; }
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
        async refreshCurrentRow() { events.push('refreshCurrentRow'); },
        reload() { events.push('reload'); },
        parseSheets(fresh) {
            const { rows } = parsePodSheets(fresh);
            this.state.setRows(rows);
            this.state.setNumDiscrepancies(countMyDiscrepancies(rows, this.state.guruColor, this.state.signature));
        },
        async showCurrentRow() { events.push('showCurrentRow'); }
    };
    host.state.setSheetData(sheetData);
    host.state.setGuruColor('red');
    host.state.setSignature('alice');
    return host;
}

test('a score refreshes the row before the background reload returns', async () => {
    const sheetData = makeSheetData({ guruRows: [
        ['1', 'Deck A', 'Deck B', '', 'alice', '', '', '', '']
    ] });

    // Reload's re-fetch never resolves: if the row refresh depended on it,
    // 'refreshCurrentRow' would never appear in the event log.
    const host = makeHost({ sheetData, holdReload: true });
    host.parseSheets(sheetData);
    host.state.setRowIndex(0);

    await new AnalysisActions(host).setAnalysis(1.0);

    assert.ok(
        host.events.indexOf('refreshCurrentRow') < host.events.indexOf('reload'),
        'the row is re-rendered from local state before the reload runs'
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

test('unclaimIncompleteRows clears only my claimed-but-unscored rows', async () => {
    const sheetData = makeSheetData({ guruRows: [
        // alice claimed, unscored -> unclaimed
        ['1', 'Deck A', 'Deck B', '', 'alice', '', '', '', ''],
        // alice claimed and scored -> kept
        ['2', 'Deck A', 'Deck C', '1', 'alice', '', '', '', ''],
        // unclaimed -> untouched
        ['3', 'Deck C', 'Deck A', '', '', '', '', '', ''],
        // bob's claim -> untouched
        ['4', 'Deck D', 'Deck E', '', '', '1', 'bob', '', ''],
        // alice claimed, unscored -> unclaimed
        ['5', 'Deck D', 'Deck F', '', 'alice', '', '', '', '']
    ] });

    const host = makeHost({ sheetData });
    host.parseSheets(sheetData);
    host.state.setRowIndex(0);

    await new AnalysisActions(host).unclaimIncompleteRows();

    // Rows 0 and 4 carry originalRowIndex 1 and 5 (the first data row sits at
    // sheet row 2, i.e. index 1).
    assert.deepEqual(host.writer.lastUnclaim.rows, [1, 5]);
    assert.equal(host.state.rows[0].redSignature, '', 'my incomplete row is released');
    assert.equal(host.state.rows[1].redSignature, 'alice', 'my scored row keeps its claim');
    assert.equal(host.state.rows[4].redSignature, '', 'my other incomplete row is released');
    assert.equal(host.state.rows[3].blueSignature, 'bob', 'another guru\'s claim is untouched');
});

test('unclaimIncompleteRows writes nothing when there is nothing incomplete', async () => {
    const sheetData = makeSheetData({ guruRows: [
        ['1', 'Deck A', 'Deck B', '1', 'alice', '', '', '', '']
    ] });

    const host = makeHost({ sheetData });
    host.parseSheets(sheetData);
    host.state.setRowIndex(0);

    await new AnalysisActions(host).unclaimIncompleteRows();

    assert.ok(!host.events.includes('unclaimRows'), 'no write is attempted');
    assert.equal(host.events.includes('showCurrentRow'), false, 'no re-render either');
});
