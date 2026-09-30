import test from 'node:test';
import assert from 'node:assert/strict';

import { AppState } from '../../js/app/appState.js';
import { GURU_COLORS } from '../../js/domain/guruColor.js';

// --- Initial state -----------------------------------------------------------

test('a fresh state has no pod loaded', () => {
    const state = new AppState();

    assert.equal(state.sheetData, null);
    assert.equal(state.spreadsheetId, null);
    assert.deepEqual(state.rows, []);
    assert.equal(state.rowIndex, -1);
    assert.equal(state.guruColor, null);
    assert.equal(state.signature, '');
    assert.equal(state.numDiscrepancies, 0);
    assert.equal(state.deckNotesMap.size, 0);
    assert.deepEqual(state.deckNotesColumnMap, {});
    assert.equal(state.hub, null);
    assert.equal(state.totalRows, 0);
    assert.equal(state.currentRow, undefined);
});

test('the column index starts unresolved for every colour', () => {
    const { columnIndex } = new AppState();

    for (const colour of GURU_COLORS) {
        assert.deepEqual(columnIndex[colour], { analysis: -1, signature: -1 });
    }
});

// --- Mutators ----------------------------------------------------------------

test('setters update the matching fields', () => {
    const state = new AppState();

    state.setSheetData({ spreadsheetId: 'ABC', title: 'Pod' });
    state.setRows([{ sheetId: 'ABC', originalRowIndex: 3 }]);
    state.setRowIndex(0);
    state.setGuruColor('blue');
    state.setSignature('alice');
    state.setNumDiscrepancies(2);
    state.setHub({ marker: true });

    assert.equal(state.spreadsheetId, 'ABC');
    assert.equal(state.totalRows, 1);
    assert.equal(state.guruColor, 'blue');
    assert.equal(state.signature, 'alice');
    assert.equal(state.numDiscrepancies, 2);
    assert.deepEqual(state.currentRow, { sheetId: 'ABC', originalRowIndex: 3 });
    assert.equal(state.hub.marker, true);
});

test('setColumnIndex stores a resolved index but ignores a null parse', () => {
    const state = new AppState();
    const resolved = { red: { analysis: 3, signature: 4 } };

    state.setColumnIndex(null);
    assert.equal(state.columnIndex.red.analysis, -1);

    state.setColumnIndex(resolved);
    assert.deepEqual(state.columnIndex, resolved);
});

// --- reset -------------------------------------------------------------------

test('reset clears per-pod state but keeps the guru signature', () => {
    const state = new AppState();
    state.setSignature('alice');
    state.setSheetData({ spreadsheetId: 'ABC' });
    state.setRows([{ sheetId: 'ABC' }]);
    state.setRowIndex(0);
    state.setGuruColor('red');
    state.setNumDiscrepancies(1);
    state.setDeckNotes(new Map([['deck', {}]]), { decklists: 0 });
    state.setHub({});

    state.reset();

    assert.equal(state.signature, 'alice', 'signature is session-wide, not per-pod');
    assert.equal(state.sheetData, null);
    assert.deepEqual(state.rows, []);
    assert.equal(state.rowIndex, -1);
    assert.equal(state.guruColor, null);
    assert.equal(state.numDiscrepancies, 0);
    assert.equal(state.deckNotesMap.size, 0);
    assert.deepEqual(state.deckNotesColumnMap, {});
    assert.equal(state.hub, null);
});

// --- Stable row key ----------------------------------------------------------

test('currentRowKey identifies the row by sheet id and original row index', () => {
    const state = new AppState();
    state.setRows([
        { sheetId: 'ABC', originalRowIndex: 1, player1: 'Deck A', player2: 'Deck B' },
        { sheetId: 'ABC', originalRowIndex: 7, player1: 'Deck A', player2: 'Deck C' }
    ]);
    state.setRowIndex(1);

    assert.deepEqual(state.currentRowKey(), { sheetId: 'ABC', originalRowIndex: 7 });
});

test('currentRowKey is null when there is no current row', () => {
    const state = new AppState();
    assert.equal(state.currentRowKey(), null);

    state.setRows([{ sheetId: 'ABC', originalRowIndex: 1 }]);
    state.setRowIndex(5);
    assert.equal(state.currentRowKey(), null);
});

test('findRowIndexByKey locates the row even when player names changed', () => {
    const state = new AppState();
    state.setRows([
        { sheetId: 'ABC', originalRowIndex: 1, player1: 'Deck A', player2: 'Deck B' },
        { sheetId: 'ABC', originalRowIndex: 7, player1: 'Deck A', player2: 'Deck C' },
        { sheetId: 'ABC', originalRowIndex: 7, player1: 'Ignored, first match wins' }
    ]);

    // Only the identity fields matter; a re-fetch may rewrite the player names.
    assert.equal(state.findRowIndexByKey({ sheetId: 'ABC', originalRowIndex: 7 }), 1);
});

test('findRowIndexByKey returns -1 for a missing or null key', () => {
    const state = new AppState();
    state.setRows([{ sheetId: 'ABC', originalRowIndex: 1 }]);

    assert.equal(state.findRowIndexByKey(null), -1);
    assert.equal(state.findRowIndexByKey({ sheetId: 'OTHER', originalRowIndex: 1 }), -1);
    assert.equal(state.findRowIndexByKey({ sheetId: 'ABC', originalRowIndex: 99 }), -1);
});
