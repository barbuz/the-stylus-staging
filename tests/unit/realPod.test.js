/**
 * Tests driven by a real exported pod workbook rather than hand-written rows.
 *
 * The hand-written fixtures in sheetData.js were guesses about the sheet
 * layout. This file instead feeds the app data copied verbatim from a live
 * export, which is what catches schema drift: a wrong column index or a wrong
 * assumption about cell types shows up here and nowhere else.
 *
 * See tests/fixtures/realPod.js for provenance and the conventions it encodes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { GoogleSheetsAPI } from '../../js/modules/googleSheetsAPI.js';
import { AnalysisController } from '../../js/ui/analysisController.js';
import { findColumnIndex, findMirrorMatchIndex } from '../../js/domain/matchRows.js';
import { calculateOutcomeFromAnalyses } from '../../js/domain/analyses.js';
import { fakeAuthManager } from '../fixtures/fakeGapi.js';

import {
    REAL_POD_HEADER, REAL_DECKS, REAL_MATCH_ROWS, REAL_POD_SHEET_IDS,
    REAL_GURU_WINDOWS, realPodGuruCells, realDeckNotesRows, realMetadataRows,
    REAL_DERIVED_COLUMNS, clearAnalysisLikeRealSheet
} from '../fixtures/realPod.js';

const SHEET_ID = 'REAL_POD_ID';

/**
 * Install a gapi fake that answers exactly the ranges the app requests,
 * sourcing its data from the real workbook cells.
 *
 * The app reads guru sheets as two disjoint windows: A1:C1000 (base) and
 * E1:F1000 (analysis + signature). Cutting the 13-column real data down to
 * those windows is the point: it proves the app's column indices line up with
 * a genuine sheet.
 */
function withRealPodGapi() {
    const guruSheets = [
        { title: 'Red Gurus', sheetId: REAL_POD_SHEET_IDS.red },
        { title: 'Blue Gurus', sheetId: REAL_POD_SHEET_IDS.blue },
        { title: 'Green Gurus', sheetId: REAL_POD_SHEET_IDS.green }
    ];
    const colourOf = { 'Red Gurus': 'red', 'Blue Gurus': 'blue', 'Green Gurus': 'green' };

    function window(sheetTitle, kind) {
        const cells = realPodGuruCells(colourOf[sheetTitle]);
        const { startCol, endCol } = kind === 'base'
            ? { startCol: 1, endCol: 3 }
            : { startCol: 5, endCol: 6 };

        const maxRow = REAL_MATCH_ROWS.length + 1;
        const rows = [];
        for (let row = 1; row <= maxRow; row++) {
            const cellsInRow = [];
            for (let col = startCol; col <= endCol; col++) {
                cellsInRow.push(cells[`${row}:${col}`] ?? '');
            }
            // The Sheets API trims trailing all-empty rows.
            if (row > 1 && cellsInRow.every(v => v === '')) continue;
            rows.push(cellsInRow);
        }
        return rows;
    }

    const values = {};
    for (const sheet of guruSheets) {
        values[`'${sheet.title}'!A1:C1000`] = window(sheet.title, 'base');
        values[`'${sheet.title}'!E1:F1000`] = window(sheet.title, 'analysis');
    }
    // Deck Notes is requested as A:E.
    values["'Deck Notes'!A:E"] = realDeckNotesRows();
    values["'metadata'!A:C"] = realMetadataRows();

    const previous = globalThis.gapi;
    const calls = [];
    globalThis.gapi = {
        client: {
            sheets: {
                spreadsheets: {
                    get: (params) => Promise.resolve({
                        result: {
                            properties: { title: 'Novice I' },
                            sheets: [
                                { properties: { title: 'Deck Notes', sheetId: REAL_POD_SHEET_IDS.deckNotes, gridProperties: { rowCount: 100, columnCount: 5 } } },
                                ...guruSheets.map(s => ({
                                    properties: { title: s.title, sheetId: s.sheetId, gridProperties: { rowCount: 1000, columnCount: 13 } }
                                })),
                                { properties: { title: 'metadata', sheetId: REAL_POD_SHEET_IDS.metadata, gridProperties: { rowCount: 2, columnCount: 3 }, hidden: true } }
                            ]
                        }
                    }),
                    values: {
                        get: (params) => {
                            calls.push(params.range);
                            return Promise.resolve({
                                result: {
                                    values: values[params.range] ?? [],
                                    range: params.range,
                                    majorDimension: 'ROWS'
                                }
                            });
                        },
                        batchGet: (params) => Promise.resolve({
                            result: { valueRanges: params.ranges.map(range => ({ range, values: [] })) }
                        })
                    }
                }
            }
        }
    };

    return {
        calls,
        restore() {
            if (previous === undefined) delete globalThis.gapi;
            else globalThis.gapi = previous;
        }
    };
}

function logic() {
    return Object.create(AnalysisController.prototype);
}

test('real pod: base columns come from Red only, analysis from all three', async () => {
    const { calls, restore } = withRealPodGapi();
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        await api.getSheetData(SHEET_ID);

        // ID/Player columns are shared across the colours, so the app reads the
        // base window once (from Red) rather than three times. Real guru sheets
        // are 13 columns wide; the windows below are strict sub-ranges.
        const baseCalls = calls.filter(r => r.endsWith(REAL_GURU_WINDOWS.base));
        assert.deepEqual(baseCalls, [`'Red Gurus'!${REAL_GURU_WINDOWS.base}`]);

        // Analysis/signature is per-colour, so all three are read.
        for (const colour of ['Red', 'Blue', 'Green']) {
            assert.ok(
                calls.includes(`'${colour} Gurus'!${REAL_GURU_WINDOWS.analysis}`),
                `expected analysis window for ${colour}`
            );
        }
    } finally {
        restore();
    }
});

test('real pod: merge maps each colour to its own E/F reading', async () => {
    const { restore } = withRealPodGapi();
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const data = await api.getSheetData(SHEET_ID);
        const merged = data.sheets.find(s => s.title === 'Merged Gurus');

        // Header row is base headers + the six generated labels.
        assert.deepEqual(merged.values[0], [
            'ID#', 'Player 1 (On the Play)', 'Player 2 (On the Draw)',
            'Red Analysis', 'Red Signature',
            'Blue Analysis', 'Blue Signature',
            'Green Analysis', 'Green Signature'
        ]);

        // First match: all three gurus agree on a win.
        const first = merged.values[1];
        assert.equal(first[0], '1');
        assert.equal(first[1], REAL_DECKS.bluffs);
        assert.equal(first[2], REAL_DECKS.admonition);
        assert.deepEqual(first.slice(3), ['1.0', 'Oophies', '1.0', 'FortyTwo', '1.0', 'Imnota']);
    } finally {
        restore();
    }
});

test('real pod: every merged row carries operator-usable analysis and signature', async () => {
    const { restore } = withRealPodGapi();
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const merged = (await api.getSheetData(SHEET_ID)).sheets.find(s => s.title === 'Merged Gurus');

        for (const row of merged.values.slice(1)) {
            for (let col = 3; col <= 8; col++) {
                assert.notEqual(
                    String(row[col]).trim(), '',
                    `row ${row[0]} column ${col} was empty`
                );
            }
        }
    } finally {
        restore();
    }
});

test('real pod: metadata parses even though the sheet has no header row', async () => {
    const { restore } = withRealPodGapi();
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const data = await api.getSheetData(SHEET_ID);

        // Row 1 of the real metadata sheet is data ("Pod Name"), not a header,
        // so nothing is skipped and both entries parse cleanly.
        assert.equal(data.metadata.podName, 'Novice I');
        assert.equal(
            data.metadata.guruHubLink,
            'https://docs.google.com/spreadsheets/d/HUB_ID/edit?gid=134887943#gid=134887943'
        );
        // Characterization: because there is no header row in real data, the
        // spurious `variableName: 'Value'` artefact seen with a headered sheet
        // does NOT occur here. Guards against "fixing" one case and breaking
        // the other.
        assert.equal(data.metadata.variableName, undefined);
    } finally {
        restore();
    }
});

test('real pod: deck notes parse with the real header order', async () => {
    const { restore } = withRealPodGapi();
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const data = await api.getSheetData(SHEET_ID);
        const notes = data.sheets.find(s => s.title === 'Deck Notes');

        assert.deepEqual(notes.values[0], [
            'Decklists', 'Goldfish Clock', 'Signature', 'Notes', 'Additional Notes'
        ]);
        assert.equal(notes.values[1][0], REAL_DECKS.bluffs);
        assert.equal(notes.values[1][1], '8.0');
        assert.equal(notes.values[1][2], 'Kamatana');
    } finally {
        restore();
    }
});

test('real pod: processDeckNotes keys by decklist and keeps sparse notes', () => {
    const sheetData = {
        sheets: [
            {
                title: 'Deck Notes',
                values: realDeckNotesRows()
            }
        ]
    };

    // processDeckNotes returns { deckNotesMap, columnMap }, not a bare Map.
    const { deckNotesMap, columnMap } = logic().processDeckNotes(sheetData);

    assert.equal(deckNotesMap.size, 4);
    // The real header is "Signature" (the goldfish signature), which
    // findColumnIndex resolves via its ['Goldfish Signature', 'Signature'] aliases.
    assert.equal(columnMap.decklists, 0);
    assert.equal(columnMap.goldfishClock, 1);
    assert.equal(columnMap.goldfishSignature, 2);
    assert.equal(columnMap.notes, 3);
    assert.equal(columnMap.additionalNotes, 4);

    const bluffs = deckNotesMap.get(REAL_DECKS.bluffs);
    assert.equal(bluffs.goldfishClock, '8.0');
    assert.equal(bluffs.goldfishSignature, 'Kamatana');
    assert.equal(bluffs.notes, 'Can Erode T2 and win T9 if not disrupted');

    // Rows with blank Notes omit the key entirely rather than storing ''.
    const admonition = deckNotesMap.get(REAL_DECKS.admonition);
    assert.equal(admonition.goldfishClock, '11.0');
    assert.equal(admonition.notes, undefined);
    assert.equal(admonition.additionalNotes, undefined);
});

test('real pod: mirror pairs are found by swapped decklists', () => {
    const rows = REAL_MATCH_ROWS.map(r => ({ player1: r.player1, player2: r.player2 }));

    // Row 1 (bluffs vs admonition) mirrors row 2, and vice versa.
    assert.equal(findMirrorMatchIndex(rows, 0), 1);
    assert.equal(findMirrorMatchIndex(rows, 1), 0);
    assert.equal(findMirrorMatchIndex(rows, 2), 3);
    assert.equal(findMirrorMatchIndex(rows, 3), 2);
});

test('real pod: a real mirror pair inverts W<->L and preserves T', () => {
    // Rows 1/22: bluffs wins on the play, admonition wins on the draw.
    const [w, l] = [REAL_MATCH_ROWS[0], REAL_MATCH_ROWS[1]];
    assert.equal(w.outcome, '1');
    assert.equal(l.outcome, '0');

    // Rows 2/43 are a tie from both sides, so the pairing is symmetric.
    assert.equal(REAL_MATCH_ROWS[2].outcome, '0.5');
    assert.equal(REAL_MATCH_ROWS[3].outcome, '0.5');

    // Agreeing gurus return the analysis string verbatim, so the wire form
    // ("1", "0.5", "0") round-trips rather than being normalised to "1.0".
    assert.equal(calculateOutcomeFromAnalyses('1', '1', '1'), '1');
    assert.equal(calculateOutcomeFromAnalyses('0.5', '0.5', '0.5'), '0.5');
    assert.equal(calculateOutcomeFromAnalyses('0', '0', '0'), '0');
});

test('real pod: IDs stay as the strings the API returns', () => {
    // The app never sets valueRenderOption, so IDs arrive as FORMATTED_VALUE
    // strings: "1" and "22", never 1 or 22.0. The .xlsx shows floats only
    // because that is how the file format stores numbers.
    for (const row of REAL_MATCH_ROWS) {
        assert.equal(typeof row.id, 'string', `id ${row.id} was not a string`);
        assert.ok(!row.id.includes('.'), `id ${row.id} carried a float suffix`);
    }

    // The fixture must not silently coerce them when building cells either.
    const cells = realPodGuruCells('red');
    assert.equal(cells['2:1'], '1');
    assert.equal(cells['3:1'], '22');

    // Inverse ID# is stored as a plain string too, and survived merge intact.
    assert.equal(REAL_MATCH_ROWS[0].inverse, '22');
});

test('real pod: header prose matches by substring, as the app assumes', () => {
    // Real headers are sentences, not labels; findColumnIndex is substring-based.
    assert.equal(findColumnIndex(REAL_POD_HEADER, ['Player 1', 'Player1']), 1);
    assert.equal(findColumnIndex(REAL_POD_HEADER, ['Player 2', 'Player2']), 2);
    assert.equal(findColumnIndex(REAL_POD_HEADER, ['Guru Analysis']), 4);
    assert.equal(findColumnIndex(REAL_POD_HEADER, ['Guru Signature']), 5);
});

test('real pod: blanking an analysis also clears its formula-derived columns', () => {
    // The real sheet computes D (Outcome) and K (Inverse Check) from the
    // analysis cells. A test that deletes only E leaves "Outcome = 1" beside an
    // empty analysis, which the real sheet never does. This pins the helper
    // that keeps the seeded state honest.
    const cells = realPodGuruCells('red');
    const sheet = { cells: { ...cells } };

    assert.equal(sheet.cells['2:5'], '1.0', 'E2 analysis');
    assert.equal(sheet.cells[`2:${REAL_DERIVED_COLUMNS.outcome}`], '1', 'D2 outcome');
    assert.ok(sheet.cells[`2:${REAL_DERIVED_COLUMNS.inverseCheck}`], 'K2 inverse check');

    clearAnalysisLikeRealSheet(sheet, 2, 5);

    assert.equal(sheet.cells['2:5'], undefined, 'E2 cleared');
    assert.equal(sheet.cells[`2:${REAL_DERIVED_COLUMNS.outcome}`], undefined, 'D2 cleared');
    assert.equal(sheet.cells[`2:${REAL_DERIVED_COLUMNS.inverseCheck}`], undefined, 'K2 cleared');

    // L (Inverse ID#) is hand-entered, not derived, so it must survive.
    assert.equal(sheet.cells['2:12'], '22', 'L2 inverse id kept');
    // And neighbouring rows are untouched.
    assert.equal(sheet.cells['3:5'], '0.0', 'E3 untouched');
});

test('real pod: derived Inverse Check equals 1 minus the mirror outcome', () => {
    // K is the outcome the mirror row is expected to carry. Row 1 (Win) mirrors
    // ID 22 (Loss), so K = 1 - 0 = 1, matching the real sheet's K on that row.
    const cells = realPodGuruCells('red');
    for (const [index, match] of REAL_MATCH_ROWS.entries()) {
        const mirror = REAL_MATCH_ROWS.find(m => m.id === match.inverse);
        assert.ok(mirror, `row ${match.id} has a mirror`);
        const expected = String(1 - parseFloat(mirror.outcome));
        assert.equal(
            cells[`${index + 2}:${REAL_DERIVED_COLUMNS.inverseCheck}`],
            expected,
            `K for ID ${match.id}`
        );
    }

    // The app ignores K entirely, so a wrong K must not change the outcome.
    assert.equal(calculateOutcomeFromAnalyses('1', '1', '1'), '1');
});

test('real pod: the app only requests the windows it can actually see', () => {
    // The 13-column layout is real, but the app fetches A:C and E:F only. This
    // asserts the fixture advertises the same windows, so a test cannot
    // accidentally depend on a column the app never reads.
    assert.equal(REAL_GURU_WINDOWS.base, 'A1:C1000');
    assert.equal(REAL_GURU_WINDOWS.analysis, 'E1:F1000');
    assert.equal(REAL_DERIVED_COLUMNS.outcome, 4, 'D is outside both windows');
    assert.equal(REAL_DERIVED_COLUMNS.inverseCheck, 11, 'K is outside both windows');
});