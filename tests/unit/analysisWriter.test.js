import test from 'node:test';
import assert from 'node:assert/strict';

import { AnalysisWriter } from '../../js/ui/analysisWriter.js';

/**
 * The writer must keep the spreadsheet file id (the batchUpdate target) and the
 * tab id (the cell's sheet) distinct. Passing the tab id where the file id
 * belongs makes the real Sheets API reject the write; the browser stub ignores
 * `spreadsheetId`, so only this layer catches the mix-up.
 */
function recordingAPI() {
    const calls = [];
    return {
        calls,
        async updateSheetData(spreadsheetId, updates) {
            calls.push({ method: 'updateSheetData', spreadsheetId, updates });
            return { success: true };
        },
        async checkedUpdateSheetData(spreadsheetId, updates) {
            calls.push({ method: 'checkedUpdateSheetData', spreadsheetId, updates });
            return { success: true, updatedCells: 1, skippedCells: 0 };
        },
        async clearCell(spreadsheetId, update) {
            calls.push({ method: 'clearCell', spreadsheetId, update });
            return { success: true };
        }
    };
}

const SPREADSHEET_ID = 'SPREADSHEET_FILE_ID';
const TAB_ID = 111;

test('writeAnalysis targets the spreadsheet file id, not the tab id', async () => {
    const api = recordingAPI();
    await new AnalysisWriter(api).writeAnalysis({
        spreadsheetId: SPREADSHEET_ID,
        sheetId: TAB_ID,
        row: 1,
        col: 4,
        value: 1.0,
        guruSheetIds: { red: TAB_ID }
    });

    const [call] = api.calls;
    assert.equal(call.spreadsheetId, SPREADSHEET_ID);
    // The cell target still uses the tab id, 1-indexed.
    assert.equal(call.updates.updates[0].sheetId, TAB_ID);
    assert.equal(call.updates.updates[0].row, 2);
    assert.equal(call.updates.updates[0].col, 5);
});

test('claimRow targets the spreadsheet file id, not the tab id', async () => {
    const api = recordingAPI();
    await new AnalysisWriter(api).claimRow({
        spreadsheetId: SPREADSHEET_ID,
        sheetId: TAB_ID,
        row: 1,
        col: 5,
        signature: 'alice',
        guruSheetIds: { red: TAB_ID }
    });

    const [call] = api.calls;
    assert.equal(call.method, 'checkedUpdateSheetData');
    assert.equal(call.spreadsheetId, SPREADSHEET_ID);
    assert.equal(call.updates.updates[0].sheetId, TAB_ID);
});

test('claimRows targets the spreadsheet file id, not the tab id', async () => {
    const api = recordingAPI();
    await new AnalysisWriter(api).claimRows({
        spreadsheetId: SPREADSHEET_ID,
        sheetId: TAB_ID,
        rows: [1, 2],
        col: 5,
        signature: 'alice',
        guruSheetIds: { red: TAB_ID }
    });

    const [call] = api.calls;
    assert.equal(call.spreadsheetId, SPREADSHEET_ID);
    assert.deepEqual(call.updates.updates.map(u => u.row), [2, 3]);
});

test('clearCell targets the spreadsheet file id, not the tab id', async () => {
    const api = recordingAPI();
    await new AnalysisWriter(api).clearCell({
        spreadsheetId: SPREADSHEET_ID,
        sheetId: TAB_ID,
        row: 3,
        col: 4,
        guruSheetIds: { red: TAB_ID }
    });

    const [call] = api.calls;
    assert.equal(call.spreadsheetId, SPREADSHEET_ID);
    assert.equal(call.update.sheetId, TAB_ID);
    assert.equal(call.update.row, 4);
});

test('saveDeckField and signGoldfishClock target the spreadsheet file id', async () => {
    const api = recordingAPI();
    const writer = new AnalysisWriter(api);
    const sheet = { sheetId: 444, title: 'Deck Notes' };

    await writer.saveDeckField({
        spreadsheetId: SPREADSHEET_ID, sheet, row: 1, col: 3, value: 'note', expectedValue: ''
    });
    await writer.signGoldfishClock({
        spreadsheetId: SPREADSHEET_ID, sheet, row: 1, col: 2, signature: 'alice'
    });

    assert.equal(api.calls[0].spreadsheetId, SPREADSHEET_ID);
    assert.equal(api.calls[0].updates.updates[0].sheetId, 444);
    assert.equal(api.calls[1].spreadsheetId, SPREADSHEET_ID);
    assert.equal(api.calls[1].updates.updates[0].sheetId, 444);
});

test('saveDeckField writes every row of a grouped entry in one call', async () => {
    const api = recordingAPI();
    const writer = new AnalysisWriter(api);
    const sheet = { sheetId: 444, title: 'Deck Notes' };

    await writer.saveDeckField({
        spreadsheetId: SPREADSHEET_ID,
        sheet,
        rows: [1, 2, 5],
        col: 3,
        value: 'note',
        expectedValue: ''
    });

    const [call] = api.calls;
    assert.equal(call.method, 'checkedUpdateSheetData');
    assert.equal(call.spreadsheetId, SPREADSHEET_ID);
    // Each spreadsheet row is written 1-indexed, still targeting the tab id.
    assert.deepEqual(call.updates.updates.map(u => u.row), [2, 3, 6]);
    assert.deepEqual(call.updates.updates.map(u => u.sheetId), [444, 444, 444]);
    assert.ok(call.updates.updates.every(u => u.value === 'note' && u.expectedValue === ''));
});

test('signGoldfishClock signs every row of a grouped entry', async () => {
    const api = recordingAPI();
    const writer = new AnalysisWriter(api);
    const sheet = { sheetId: 444, title: 'Deck Notes' };

    await writer.signGoldfishClock({
        spreadsheetId: SPREADSHEET_ID, sheet, rows: [1, 2], col: 2, signature: 'alice'
    });

    const [call] = api.calls;
    assert.equal(call.spreadsheetId, SPREADSHEET_ID);
    assert.deepEqual(call.updates.updates.map(u => u.row), [2, 3]);
    assert.ok(call.updates.updates.every(u => u.value === 'alice' && u.valueType === 'string'));
});
