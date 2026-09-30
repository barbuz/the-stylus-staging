/**
 * Shared test fixtures.
 *
 * These mirror the shape returned by GoogleSheetsAPI.getSheetData() so that
 * downstream logic can be exercised without touching Google or the network.
 * Keep them structurally faithful to the real API payloads.
 */

export const MERGED_GURU_HEADERS = [
    'ID', 'Player 1', 'Player 2',
    'Red Analysis', 'Red Signature',
    'Blue Analysis', 'Blue Signature',
    'Green Analysis', 'Green Signature'
];

export const DECK_NOTES_HEADERS = [
    'Decklists', 'Goldfish Clock', 'Goldfish Signature', 'Notes', 'Additional Notes'
];

export const MERGED_GURU_COLUMN_MAPPING = {
    id: 0,
    player1: 1,
    player2: 2,
    redAnalysis: 3,
    redSignature: 4,
    blueAnalysis: 5,
    blueSignature: 6,
    greenAnalysis: 7,
    greenSignature: 8
};

export const GURU_SHEET_IDS = { red: 111, blue: 222, green: 333 };

export function makeMergedGuruSheet(rows, overrides = {}) {
    return {
        title: 'Merged Gurus',
        sheetId: GURU_SHEET_IDS.red,
        values: [MERGED_GURU_HEADERS, ...rows],
        range: `'Red Gurus'!A1:I${rows.length + 1}`,
        majorDimension: 'ROWS',
        columnMapping: MERGED_GURU_COLUMN_MAPPING,
        hidden: false,
        guruSheetIds: GURU_SHEET_IDS,
        ...overrides
    };
}

export function makeDeckNotesSheet(rows, overrides = {}) {
    return {
        title: 'Deck Notes',
        sheetId: 444,
        values: [DECK_NOTES_HEADERS, ...rows],
        range: `'Deck Notes'!A1:E${rows.length + 1}`,
        majorDimension: 'ROWS',
        ...overrides
    };
}

export function makeSheetData({ guruRows = [], deckNotesRows = [], metadata = {}, title = 'Aspirant II' } = {}) {
    const sheets = [makeMergedGuruSheet(guruRows)];
    if (deckNotesRows.length) {
        sheets.unshift(makeDeckNotesSheet(deckNotesRows));
    }
    return { spreadsheetId: 'TEST_SHEET_ID', title, sheets, metadata };
}

/**
 * A small, fixed pod used across tests.
 *
 * Row semantics are as they appear in the sheet; `values` excludes the header row.
 * Numeric analysis values are strings, matching the real API.
 */
export function sampleSheetData() {
    return makeMergedGuruSheet([
        // ID, P1, P2, Red, Red Sig, Blue, Blue Sig, Green, Green Sig
        ['1', 'Deck A', 'Deck B', '1', 'alice', '1', 'bob', '1', 'carol'],
        ['2', 'Deck A', 'Deck C', '0', 'alice', '', '', '', ''],
        ['3', 'Deck C', 'Deck A', '0', 'alice', '1', 'bob', '', ''],
        ['4', 'Deck D', 'Deck E', '', '', '', '', '', ''],
        ['5', 'Deck D', 'Deck F', '1', 'alice', '0.5', 'bob', '0', 'carol']
    ]);
}
