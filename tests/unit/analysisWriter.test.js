import test from 'node:test';
import assert from 'node:assert/strict';

import { AnalysisWriter } from '../../js/ui/analysisWriter.js';
import { getLogEntries, clearLogBuffer } from '../../js/utils/log.js';

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
        },
        async clearCells(spreadsheetId, updates) {
            calls.push({ method: 'clearCells', spreadsheetId, updates });
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

test('unclaimRows clears every row in one request, targeting the file id', async () => {
    const api = recordingAPI();
    await new AnalysisWriter(api).unclaimRows({
        spreadsheetId: SPREADSHEET_ID,
        sheetId: TAB_ID,
        rows: [1, 2, 5],
        col: 5,
        guruSheetIds: { red: TAB_ID }
    });

    const [call] = api.calls;
    assert.equal(call.method, 'clearCells');
    assert.equal(call.spreadsheetId, SPREADSHEET_ID);
    // Each spreadsheet row is 1-indexed, still targeting the tab id.
    assert.deepEqual(call.updates.map(u => u.row), [2, 3, 6]);
    assert.ok(call.updates.every(u => u.sheetId === TAB_ID && u.isMergedGuruUpdate));
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

test('each write emits one captured line tagged with the controller label', async () => {
    const api = recordingAPI();
    const writer = new AnalysisWriter(api, '#7');
    clearLogBuffer();

    await writer.claimRow({
        spreadsheetId: SPREADSHEET_ID, sheetId: TAB_ID, row: 70, col: 4,
        signature: 'alice', guruSheetIds: { red: TAB_ID }
    });

    const messages = getLogEntries().map(e => e.message);
    const writeLine = messages.find(m => m.includes('claim'));
    assert.ok(writeLine, `expected a claim line, got: ${JSON.stringify(messages)}`);
    assert.match(writeLine, /#7/);
    assert.match(writeLine, /71:5/);
    clearLogBuffer();
});

test('a deck claim logs its rows as compressed ranges, not one pair per row', async () => {
    const api = recordingAPI();
    const writer = new AnalysisWriter(api, '#3');
    clearLogBuffer();

    await writer.claimRows({
        spreadsheetId: SPREADSHEET_ID, sheetId: TAB_ID,
        rows: [70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89],
        col: 4, signature: 'alice', guruSheetIds: { red: TAB_ID }
    });

    const line = getLogEntries().map(e => e.message).find(m => m.includes('claim'));
    assert.match(line, /claim 20 rows/);
    assert.match(line, /71-90:5/);
    clearLogBuffer();
});

test('the captured write line carries the value, not just the ranges', async () => {
    const api = recordingAPI();
    const writer = new AnalysisWriter(api, '#1');
    clearLogBuffer();

    await writer.claimRow({
        spreadsheetId: SPREADSHEET_ID, sheetId: TAB_ID, row: 70, col: 4,
        signature: 'alice', guruSheetIds: { red: TAB_ID }
    });

    const line = getLogEntries().map(e => e.message).find(m => m.includes('claim'));
    // Where AND what: a "wrong value written" report needs both.
    assert.match(line, /71:5/);
    assert.match(line, /"alice"/);
    clearLogBuffer();
});

test('a mixed-value write reports a distinct count instead of one value', async () => {
    const api = recordingAPI();
    const writer = new AnalysisWriter(api, '#1');
    clearLogBuffer();

    await writer.saveDeckField({
        spreadsheetId: SPREADSHEET_ID, sheet: { sheetId: TAB_ID }, rows: [1, 2],
        col: 3, value: 'note', expectedValue: ''
    });
    // saveDeckField writes the same value to every row -> a single quoted value.
    const line = getLogEntries().map(e => e.message).find(m => m.includes('deck field'));
    assert.match(line, /"note"/);
    clearLogBuffer();
});
