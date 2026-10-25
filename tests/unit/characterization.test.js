/**
 * Characterization tests: the intentional current quirks of the app.
 *
 * These do not assert desirable behaviour. They pin the behaviour that exists
 * today so that a change shows up as a test diff instead of slipping through.
 * Each quirk is labelled:
 *
 *   CONTRACT - part of the scoring/format spec. Must not change.
 *   ACCIDENT - an artefact of the implementation. Free to fix in a later phase.
 *
 * See AGENTS.md for the full list and the reasoning behind each.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { GoogleSheetsAPI } from '../../js/modules/googleSheetsAPI.js';
import { fakeAuthManager } from '../fixtures/fakeGapi.js';
import { calculateOutcomeFromAnalyses } from '../../js/domain/analyses.js';
import {
    REAL_MATCH_ROWS, REAL_GURU_WINDOWS, REAL_DERIVED_COLUMNS,
    realMetadataRows, realPodGuruCells, REAL_POD_SHEET_IDS
} from '../fixtures/realPod.js';

// --- CONTRACT: scoring compares raw strings ----------------------------------

test('CONTRACT: outcome compares raw strings, so "1.0" vs "1" is a Discrepancy', () => {
    // Both spellings mean Win, but comparison happens before normalisation.
    // This is the documented contract; keep it until the sheet format changes.
    assert.equal(calculateOutcomeFromAnalyses('1.0', '1', '1'), 'Discrepancy');
    assert.equal(calculateOutcomeFromAnalyses('1', '1', '1'), '1');
});

test('CONTRACT: Incomplete and Discrepancy are exact capitalised strings', () => {
    // The strings are matched elsewhere with .toLowerCase(); they are part of
    // the wire/display contract and must keep this spelling.
    assert.equal(calculateOutcomeFromAnalyses('1', '', ''), 'Incomplete');
    assert.equal(calculateOutcomeFromAnalyses('1', '0', '0'), 'Discrepancy');
});

test('CONTRACT: the app never reads columns D (Outcome) or K (Inverse Check)', () => {
    // The sheet computes both, but the app fetches only A:C and E:F and
    // recomputes the outcome locally. D and K are outside both windows.
    assert.equal(REAL_GURU_WINDOWS.base, 'A1:C1000');
    assert.equal(REAL_GURU_WINDOWS.analysis, 'E1:F1000');
    assert.equal(REAL_DERIVED_COLUMNS.outcome, 4, 'D is not in A:C or E:F');
    assert.equal(REAL_DERIVED_COLUMNS.inverseCheck, 11, 'K is not in A:C or E:F');
});

// --- ACCIDENT: metadata sheet is headerless ----------------------------------

function withMetadataGapi(values) {
    const previous = globalThis.gapi;
    globalThis.gapi = {
        client: {
            sheets: {
                spreadsheets: {
                    get: () => Promise.resolve({
                        result: {
                            properties: { title: 'Pod' },
                            sheets: [{
                                properties: {
                                    title: 'metadata',
                                    sheetId: REAL_POD_SHEET_IDS.metadata,
                                    gridProperties: { rowCount: values.length, columnCount: 3 }
                                }
                            }]
                        }
                    }),
                    values: {
                        get: (params) => Promise.resolve({
                            result: { values, range: params.range, majorDimension: 'ROWS' }
                        })
                    }
                }
            }
        }
    };
    return () => {
        if (previous === undefined) delete globalThis.gapi;
        else globalThis.gapi = previous;
    };
}

test('ACCIDENT: a headerless metadata sheet yields no spurious variableName key', async () => {
    // Real metadata has no header row: row 1 is already data. The parser's
    // "skip header if present" comment therefore never fires, which is why the
    // real payload does not produce a `variableName` key.
    const restore = withMetadataGapi(realMetadataRows());
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const metadata = await api.getCustomMetadata('ID', { title: 'metadata' });

        assert.equal(metadata.variableName, undefined);
        assert.ok(metadata.podName, 'the real row 1 data is parsed as a value');
    } finally {
        restore();
    }
});

test('ACCIDENT: a headered metadata sheet does produce a spurious variableName key', async () => {
    // With a header row, row 1 is treated as data and camelCases to
    // `variableName`. Synthetic fixtures (sheetData.js) hit this; real sheets do
    // not. Documented so "fixing" one case cannot silently break the other.
    const restore = withMetadataGapi([
        ['Variable Name', 'Check', 'Value'],
        ['Pod Name', 'x', 'Aspirant II']
    ]);
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const metadata = await api.getCustomMetadata('ID', { title: 'metadata' });

        assert.equal(metadata.variableName, 'Value');
        assert.equal(metadata.podName, 'Aspirant II');
    } finally {
        restore();
    }
});

// --- ACCIDENT: derived-column modelling in the stub --------------------------

test('ACCIDENT: cells are FORMATTED_VALUE strings, never numbers', () => {
    // The app never sets valueRenderOption, so every cell arrives as a string.
    // The exported .xlsx stores floats; that is a file-format artefact.
    for (const row of REAL_MATCH_ROWS) {
        assert.equal(typeof row.id, 'string');
        assert.equal(typeof row.outcome, 'string');
    }
    const cells = realPodGuruCells('red');
    assert.equal(cells['2:5'], '1.0');
    assert.equal(typeof cells['2:5'], 'string');
});
