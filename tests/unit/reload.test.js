import test from 'node:test';
import assert from 'node:assert/strict';

import { AnalysisActions } from '../../js/ui/analysisActions.js';
import { AppState } from '../../js/app/appState.js';
import { parsePodSheets } from '../../js/domain/matchRows.js';
import { makeSheetData } from '../fixtures/sheetData.js';

/**
 * Minimal controller double for the reload path. It only needs the state it
 * mutates, a sheetsAPI to re-fetch from, and the row-parse + render hooks the
 * real controller exposes.
 */
function makeHost({ sheetData, refetched, guruColor = 'red', signature = 'alice' }) {
    const host = {
        state: new AppState(),
        rendered: 0,
        sheetsAPI: {
            getSheetData: async (sheetId) => {
                assert.equal(sheetId, sheetData.sheetId);
                return refetched;
            }
        },
        uiController: { showStatus() {} },
        parseSheets(fresh) {
            const { rows, numDiscrepancies } = parsePodSheets(fresh, this.state.guruColor, this.state.signature);
            this.state.setRows(rows);
            this.state.setNumDiscrepancies(numDiscrepancies);
        },
        async showCurrentRow() {
            this.rendered++;
        }
    };
    host.state.setSheetData(sheetData);
    host.state.setGuruColor(guruColor);
    host.state.setSignature(signature);
    return host;
}

test('reload keeps the current match across a re-fetch that changes player names', async () => {
    const initial = makeSheetData({ guruRows: [
        ['1', 'Deck A', 'Deck B', '1', 'alice', '1', 'bob', '1', 'carol'],
        ['2', 'Deck D', 'Deck E', '', '', '', '', '', '']
    ] });
    // The refresh rewrites the player names (e.g. a correction elsewhere in the
    // sheet) but the underlying row identity is unchanged.
    const refetched = makeSheetData({ guruRows: [
        ['1', 'Deck A renamed', 'Deck B', '1', 'alice', '1', 'bob', '1', 'carol'],
        ['2', 'Deck D', 'Deck E', '', '', '', '', '', '']
    ] });

    const host = makeHost({ sheetData: initial, refetched });
    host.parseSheets(initial);
    host.state.setRowIndex(0);

    await new AnalysisActions(host).reload();

    // Old four-field fuzzy match would have failed here; the stable key does not.
    assert.equal(host.state.rowIndex, 0);
    assert.equal(host.state.currentRow.player1, 'Deck A renamed');
    assert.equal(host.rendered, 1);
});

test('reload follows the same row even when only the signature changed', async () => {
    const initial = makeSheetData({ guruRows: [
        ['1', 'Deck A', 'Deck B', '1', 'alice', '1', 'bob', '1', 'carol'],
        ['2', 'Deck D', 'Deck E', '', '', '', '', '', '']
    ] });
    // Another guru claimed the row while we were looking at it. The row we are
    // on is the second one; the claim does not move us.
    const refetched = makeSheetData({ guruRows: [
        ['1', 'Deck A', 'Deck B', '1', 'alice', '1', 'bob', '1', 'carol'],
        ['2', 'Deck D', 'Deck E', '', 'dave', '', '', '', '']
    ] });

    const host = makeHost({ sheetData: initial, refetched });
    host.parseSheets(initial);
    host.state.setRowIndex(1);

    await new AnalysisActions(host).reload();

    assert.equal(host.state.rowIndex, 1);
    assert.equal(host.state.currentRow.player1, 'Deck D');
});

test('reload falls back to the first row when the current row is gone', async () => {
    const initial = makeSheetData({ guruRows: [
        ['1', 'Deck A', 'Deck B', '1', 'alice', '1', 'bob', '1', 'carol'],
        ['2', 'Deck D', 'Deck E', '', '', '', '', '', '']
    ] });
    const refetched = makeSheetData({ guruRows: [
        ['1', 'Deck A', 'Deck B', '1', 'alice', '1', 'bob', '1', 'carol']
    ] });

    const host = makeHost({ sheetData: initial, refetched });
    host.parseSheets(initial);
    host.state.setRowIndex(1);

    await new AnalysisActions(host).reload();

    assert.equal(host.state.rowIndex, 0);
    assert.equal(host.state.rowIndex, 0);
});

test('reload with preservePosition false returns to the first row', async () => {
    const sheetData = makeSheetData({ guruRows: [
        ['1', 'Deck A', 'Deck B', '1', 'alice', '1', 'bob', '1', 'carol'],
        ['2', 'Deck D', 'Deck E', '', '', '', '', '', '']
    ] });

    const host = makeHost({ sheetData, refetched: sheetData });
    host.parseSheets(sheetData);
    host.state.setRowIndex(1);

    await new AnalysisActions(host).reload({ preservePosition: false });

    assert.equal(host.state.rowIndex, 0);
});

test('a failed re-fetch is non-fatal and keeps the current data', async () => {
    const sheetData = makeSheetData({ guruRows: [
        ['1', 'Deck A', 'Deck B', '1', 'alice', '1', 'bob', '1', 'carol']
    ] });

    const host = makeHost({ sheetData, refetched: sheetData });
    host.sheetsAPI.getSheetData = async () => { throw new Error('network down'); };
    host.parseSheets(sheetData);
    host.state.setRowIndex(0);

    await assert.doesNotReject(() => new AnalysisActions(host).reload());

    assert.equal(host.state.rowIndex, 0);
    assert.equal(host.rendered, 0, 'no re-render when the fetch fails');
});
