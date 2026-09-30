import test from 'node:test';
import assert from 'node:assert/strict';

import { GoogleSheetsAPI } from '../../js/modules/googleSheetsAPI.js';
import { FakeGapi, fakeAuthManager } from '../fixtures/fakeGapi.js';

const SHEET_ID = 'TEST_SHEET_ID';

function withFakeGapi(options = {}) {
    const fake = new FakeGapi(options);
    const restore = fake.install();
    return { fake, restore };
}

// --- Column mappings ---------------------------------------------------------

test('getColumnMapping knows the real five-column deck notes layout', () => {
    const api = new GoogleSheetsAPI(fakeAuthManager());
    // Real sheets carry a Signature column between the clock and the notes;
    // "Signature" here is the goldfish signature.
    assert.deepEqual(api.getColumnMapping('Deck Notes'), {
        decklists: 0, clock: 1, signature: 2, notes: 3, additionalNotes: 4
    });
});

test('getColumnMapping knows guru sheet layout', () => {
    const api = new GoogleSheetsAPI(fakeAuthManager());
    assert.deepEqual(api.getColumnMapping('Red Gurus'), {
        id: 0, player1: 1, player2: 2, guruAnalysis: 4, guruSignature: 5
    });
});

test('getMergedGuruColumnMapping is the 9-column merged layout', () => {
    const api = new GoogleSheetsAPI(fakeAuthManager());
    assert.deepEqual(api.getMergedGuruColumnMapping(), {
        id: 0, player1: 1, player2: 2,
        redAnalysis: 3, redSignature: 4,
        blueAnalysis: 5, blueSignature: 6,
        greenAnalysis: 7, greenSignature: 8
    });
});

// --- Merged update routing ---------------------------------------------------

test('resolveTargetForMergedUpdate routes guru columns to their own sheets', () => {
    const api = new GoogleSheetsAPI(fakeAuthManager());
    const base = { isMergedGuruUpdate: true, guruSheetIds: { red: 11, blue: 22, green: 33 } };

    // Merged columns are 1-indexed: D/E red, F/G blue, H/I green.
    assert.deepEqual(api.resolveTargetForMergedUpdate({ ...base, sheetId: 1, col: 4 }), { targetSheetId: 11, targetCol: 5 });
    assert.deepEqual(api.resolveTargetForMergedUpdate({ ...base, sheetId: 1, col: 5 }), { targetSheetId: 11, targetCol: 6 });
    assert.deepEqual(api.resolveTargetForMergedUpdate({ ...base, sheetId: 1, col: 6 }), { targetSheetId: 22, targetCol: 5 });
    assert.deepEqual(api.resolveTargetForMergedUpdate({ ...base, sheetId: 1, col: 7 }), { targetSheetId: 22, targetCol: 6 });
    assert.deepEqual(api.resolveTargetForMergedUpdate({ ...base, sheetId: 1, col: 8 }), { targetSheetId: 33, targetCol: 5 });
    assert.deepEqual(api.resolveTargetForMergedUpdate({ ...base, sheetId: 1, col: 9 }), { targetSheetId: 33, targetCol: 6 });
});

test('resolveTargetForMergedUpdate routes base columns to the red sheet', () => {
    const api = new GoogleSheetsAPI(fakeAuthManager());
    const update = { isMergedGuruUpdate: true, sheetId: 1, col: 2, guruSheetIds: { red: 11, blue: 22, green: 33 } };
    assert.deepEqual(api.resolveTargetForMergedUpdate(update), { targetSheetId: 11, targetCol: 2 });
});

test('resolveTargetForMergedUpdate leaves non-merged updates untouched', () => {
    const api = new GoogleSheetsAPI(fakeAuthManager());
    const update = { sheetId: 99, col: 6, row: 3 };
    assert.deepEqual(api.resolveTargetForMergedUpdate(update), { targetSheetId: 99, targetCol: 6 });
});

test('updateSheetData sends the spreadsheet id, not the target tab id', async () => {
    const { fake, restore } = withFakeGapi({ sheets: [{ title: 'Red Gurus', sheetId: 111 }] });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        await api.updateSheetData(SHEET_ID, {
            updates: [{
                sheetId: 111, row: 2, col: 5, value: '1', valueType: 'number',
                isMergedGuruUpdate: true, guruSheetIds: { red: 111 }
            }]
        });

        const [call] = fake.callsTo('spreadsheets.batchUpdate');
        assert.equal(call.params.spreadsheetId, SHEET_ID);
        // Merged col 5 is Red Signature, which lands in column F (index 5).
        assert.deepEqual(call.params.resource.requests[0].updateCells.start, { sheetId: 111, rowIndex: 1, columnIndex: 5 });
    } finally {
        restore();
    }
});

test('checkedUpdateSheetData sends the spreadsheet id, not the target tab id', async () => {
    const { fake, restore } = withFakeGapi({
        sheets: [{ title: 'Red Gurus', sheetId: 111 }],
        valueRanges: [[['']]]
    });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        await api.checkedUpdateSheetData(SHEET_ID, {
            updates: [{
                sheetId: 111, row: 2, col: 5, value: 'alice', expectedValue: '',
                valueType: 'string', isMergedGuruUpdate: true, guruSheetIds: { red: 111 }
            }]
        });

        const [call] = fake.callsTo('spreadsheets.batchUpdate');
        assert.equal(call.params.spreadsheetId, SHEET_ID);
        assert.deepEqual(call.params.resource.requests[0].updateCells.start, { sheetId: 111, rowIndex: 1, columnIndex: 5 });
    } finally {
        restore();
    }
});

test('clearCell sends the spreadsheet id, not the target tab id', async () => {
    const { fake, restore } = withFakeGapi({ sheets: [{ title: 'Red Gurus', sheetId: 111 }] });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        await api.clearCell(SHEET_ID, {
            sheetId: 111, row: 4, col: 5, isMergedGuruUpdate: true, guruSheetIds: { red: 111 }
        });

        const [call] = fake.callsTo('values.clear');
        assert.equal(call.params.spreadsheetId, SHEET_ID);
        // Merged col 5 is Red Signature, which clears column F.
        assert.equal(call.params.range, "'Red Gurus'!F4");
    } finally {
        restore();
    }
});

// --- Authentication guard ----------------------------------------------------

test('API methods refuse to run when not logged in', async () => {
    const api = new GoogleSheetsAPI(fakeAuthManager({ loggedIn: false }));
    await assert.rejects(() => api.getSheetData(SHEET_ID), /not authenticated/);
    await assert.rejects(() => api.getSheetMetadata(SHEET_ID), /not authenticated/);
    await assert.rejects(() => api.updateSheetData(SHEET_ID, { updates: [] }), /not authenticated/);
    await assert.rejects(() => api.checkedUpdateSheetData(SHEET_ID, { updates: [] }), /not authenticated/);
    await assert.rejects(() => api.batchUpdate(SHEET_ID, []), /not authenticated/);
    await assert.rejects(() => api.clearCell(SHEET_ID, { row: 1, sheetId: 1, col: 1 }), /not authenticated/);
});

// --- Metadata ----------------------------------------------------------------

test('getSheetMetadata reshapes the API response', async () => {
    const { restore } = withFakeGapi({ sheets: [{ title: 'Red Gurus', sheetId: 11 }, { title: 'Blue Gurus', sheetId: 22, hidden: true }] });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const metadata = await api.getSheetMetadata(SHEET_ID);

        assert.equal(metadata.title, 'Test Pod');
        assert.equal(metadata.sheetId, SHEET_ID);
        assert.deepEqual(metadata.sheets.map(s => s.sheetId), [11, 22]);
        assert.equal(metadata.sheets[1].hidden, true);
    } finally {
        restore();
    }
});

// --- Merging guru sheets -----------------------------------------------------

function guruSheets() {
    return [
        { title: 'Red Gurus', sheetId: 11 },
        { title: 'Blue Gurus', sheetId: 22 },
        { title: 'Green Gurus', sheetId: 33 }
    ];
}

test('mergeGuruSheets merges base, analysis and signature columns', async () => {
    const { fake, restore } = withFakeGapi({
        sheets: guruSheets(),
        values: {
            "'Red Gurus'!A1:C1000": [
                ['ID', 'Player 1', 'Player 2'],
                ['1', 'Deck A', 'Deck B'],
                ['2', 'Deck C', 'Deck D']
            ],
            // Index 0 is the header row, mirroring the real E1:F1000 range.
            "'Red Gurus'!E1:F1000": [['Analysis', 'Signature'], ['1', 'alice'], ['', '']],
            "'Blue Gurus'!E1:F1000": [['Analysis', 'Signature'], ['1', 'bob'], ['0', '']],
            "'Green Gurus'!E1:F1000": [['Analysis', 'Signature'], ['1', 'carol'], ['', '']]
        }
    });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const merged = await api.mergeGuruSheets(SHEET_ID, guruSheets());

        assert.equal(fake.callsTo('values.get').length, 4, 'one base query plus one per guru sheet');
        assert.equal(merged.title, 'Merged Gurus');
        assert.deepEqual(merged.guruSheetIds, { red: 11, blue: 22, green: 33 });
        assert.deepEqual(merged.values[0], [
            'ID', 'Player 1', 'Player 2',
            'Red Analysis', 'Red Signature',
            'Blue Analysis', 'Blue Signature',
            'Green Analysis', 'Green Signature'
        ]);
        assert.deepEqual(merged.values[1], ['1', 'Deck A', 'Deck B', '1', 'alice', '1', 'bob', '1', 'carol']);
        assert.deepEqual(merged.values[2], ['2', 'Deck C', 'Deck D', '', '', '0', '', '', '']);
    } finally {
        restore();
    }
});

test('mergeGuruSheets pads short base rows to three columns', async () => {
    const { restore } = withFakeGapi({
        sheets: guruSheets(),
        values: {
            "'Red Gurus'!A1:C1000": [
                ['ID', 'Player 1', 'Player 2'],
                ['1', 'Deck A'] // missing player 2
            ],
            "'Red Gurus'!E1:F1000": [['Analysis', 'Signature'], ['1', 'alice']],
            "'Blue Gurus'!E1:F1000": [['Analysis', 'Signature'], ['1', 'bob']],
            "'Green Gurus'!E1:F1000": [['Analysis', 'Signature'], ['1', 'carol']]
        }
    });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const merged = await api.mergeGuruSheets(SHEET_ID, guruSheets());
        assert.deepEqual(merged.values[1], ['1', 'Deck A', '', '1', 'alice', '1', 'bob', '1', 'carol']);
    } finally {
        restore();
    }
});

test('mergeGuruSheets marks the merge hidden when any guru sheet is hidden', async () => {
    const sheets = guruSheets();
    sheets[2].hidden = true;
    const { restore } = withFakeGapi({
        sheets,
        values: {
            "'Red Gurus'!A1:C1000": [['ID', 'Player 1', 'Player 2']],
            "'Red Gurus'!E1:F1000": [], "'Blue Gurus'!E1:F1000": [], "'Green Gurus'!E1:F1000": []
        }
    });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const merged = await api.mergeGuruSheets(SHEET_ID, sheets);
        assert.equal(merged.hidden, true);
    } finally {
        restore();
    }
});

test('mergeGuruSheets requires a Red Gurus sheet', async () => {
    const { restore } = withFakeGapi({ sheets: [{ title: 'Blue Gurus', sheetId: 22 }] });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        await assert.rejects(() => api.mergeGuruSheets(SHEET_ID, [{ title: 'Blue Gurus', sheetId: 22 }]), /Red Gurus sheet not found/);
    } finally {
        restore();
    }
});

// --- getSheetData orchestration ----------------------------------------------

const FULL_SHEETS = [
    { title: 'Deck Notes', sheetId: 44 },
    ...guruSheets(),
    { title: 'metadata', sheetId: 55 }
];

test('getSheetData assembles deck notes, merged gurus and custom metadata', async () => {
    const { fake, restore } = withFakeGapi({
        sheets: FULL_SHEETS,
        values: {
            "'Deck Notes'!A:E": [
                ['Decklists', 'Goldfish Clock', 'Goldfish Signature', 'Notes', 'Additional Notes'],
                ['Deck A | Deck B', '5', 'alice', 'note', 'more']
            ],
            "'Red Gurus'!A1:C1000": [['ID', 'Player 1', 'Player 2'], ['1', 'Deck A', 'Deck B']],
            "'Red Gurus'!E1:F1000": [['Analysis', 'Signature'], ['1', 'alice']],
            "'Blue Gurus'!E1:F1000": [['Analysis', 'Signature'], ['1', 'bob']],
            "'Green Gurus'!E1:F1000": [['Analysis', 'Signature'], ['1', 'carol']],
            "'metadata'!A:C": [
                ['Variable Name', 'Checkmark', 'Value'],
                ['Pod Name', 'x', 'Aspirant II'],
                ['Guru Hub Link', 'x', 'https://docs.google.com/spreadsheets/d/HUB_ID']
            ]
        }
    });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const data = await api.getSheetData(SHEET_ID);

        assert.equal(data.sheetId, SHEET_ID);
        assert.equal(data.title, 'Test Pod');
        assert.deepEqual(data.sheets.map(s => s.title).sort(), ['Deck Notes', 'Merged Gurus']);
        // Characterization: the metadata sheet's header row is NOT skipped, so
        // "Variable Name" / "Value" leak in as a spurious `variableName` key.
        // Harmless today (metadata is read by explicit key) but worth knowing.
        assert.deepEqual(data.metadata, {
            variableName: 'Value',
            podName: 'Aspirant II',
            guruHubLink: 'https://docs.google.com/spreadsheets/d/HUB_ID'
        });
    } finally {
        restore();
    }
});

test('getSheetData tolerates a missing metadata sheet', async () => {
    const { restore } = withFakeGapi({
        sheets: guruSheets(),
        values: {
            "'Red Gurus'!A1:C1000": [['ID', 'Player 1', 'Player 2']],
            "'Red Gurus'!E1:F1000": [], "'Blue Gurus'!E1:F1000": [], "'Green Gurus'!E1:F1000": []
        }
    });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const data = await api.getSheetData(SHEET_ID);
        assert.deepEqual(data.metadata, {});
    } finally {
        restore();
    }
});

test('getCustomMetadata camelCases variable names and skips incomplete rows', async () => {
    const { restore } = withFakeGapi({
        values: {
            "'metadata'!A:C": [
                ['Pod Name', 'x', 'Aspirant II'],
                ['Guru Hub Link', 'x', 'HUB'],
                ['No Value Here', 'x', ''],
                ['too', 'short']
            ]
        }
    });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const metadata = await api.getCustomMetadata(SHEET_ID, { title: 'metadata' });
        assert.deepEqual(metadata, { podName: 'Aspirant II', guruHubLink: 'HUB' });
    } finally {
        restore();
    }
});

// --- updateSheetData ---------------------------------------------------------

test('updateSheetData builds updateCells requests with 0-indexed positions', async () => {
    const { fake, restore } = withFakeGapi();
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const result = await api.updateSheetData(SHEET_ID, {
            updates: [{ sheetId: 11, row: 3, col: 5, value: '1', valueType: 'number' }]
        });

        const request = fake.callsTo('spreadsheets.batchUpdate')[0].params.resource.requests[0];
        assert.deepEqual(request, {
            updateCells: {
                start: { sheetId: 11, rowIndex: 2, columnIndex: 4 },
                rows: [{ values: [{ userEnteredValue: { numberValue: 1 } }] }],
                fields: 'userEnteredValue'
            }
        });
        assert.equal(result.updatedCells, 1);
    } finally {
        restore();
    }
});

test('updateSheetData honours explicit value types', async () => {
    const cases = [
        ['number', '42', { numberValue: 42 }],
        ['string', '42', { stringValue: '42' }],
        ['formula', '=SUM(A1:A2)', { formulaValue: '=SUM(A1:A2)' }],
        ['boolean', true, { boolValue: true }]
    ];

    for (const [valueType, value, expected] of cases) {
        const { fake, restore } = withFakeGapi();
        try {
            const api = new GoogleSheetsAPI(fakeAuthManager());
            await api.updateSheetData(SHEET_ID, { updates: [{ sheetId: 1, row: 1, col: 1, value, valueType }] });
            const request = fake.callsTo('spreadsheets.batchUpdate')[0].params.resource.requests[0];
            assert.deepEqual(request.updateCells.rows[0].values[0].userEnteredValue, expected, `valueType=${valueType}`);
        } finally {
            restore();
        }
    }
});

test('updateSheetData auto-detects numeric vs string values', async () => {
    const { fake, restore } = withFakeGapi();
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        await api.updateSheetData(SHEET_ID, {
            updates: [
                { sheetId: 1, row: 1, col: 1, value: '0.5' },
                { sheetId: 1, row: 2, col: 1, value: 'alice' }
            ]
        });
        const requests = fake.callsTo('spreadsheets.batchUpdate')[0].params.resource.requests;
        assert.deepEqual(requests[0].updateCells.rows[0].values[0].userEnteredValue, { numberValue: 0.5 });
        assert.deepEqual(requests[1].updateCells.rows[0].values[0].userEnteredValue, { stringValue: 'alice' });
    } finally {
        restore();
    }
});

test('updateSheetData routes merged-sheet columns to the right guru sheet', async () => {
    const { fake, restore } = withFakeGapi();
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        await api.updateSheetData(SHEET_ID, {
            updates: [{
                sheetId: 11, row: 2, col: 6, value: '1', valueType: 'number',
                isMergedGuruUpdate: true,
                guruSheetIds: { red: 11, blue: 22, green: 33 }
            }]
        });
        const request = fake.callsTo('spreadsheets.batchUpdate')[0].params.resource.requests[0];
        // Merged column F (Blue Analysis) becomes column E on the Blue sheet.
        assert.deepEqual(request.updateCells.start, { sheetId: 22, rowIndex: 1, columnIndex: 4 });
    } finally {
        restore();
    }
});

test('updateSheetData wraps API failures with a readable message', async () => {
    const api = new GoogleSheetsAPI(fakeAuthManager());
    globalThis.gapi = {
        client: { sheets: { spreadsheets: { batchUpdate: () => Promise.reject(new Error('quota exceeded')) } } }
    };
    try {
        await assert.rejects(() => api.updateSheetData(SHEET_ID, { updates: [] }), /quota exceeded/);
    } finally {
        delete globalThis.gapi;
    }
});

// --- checkedUpdateSheetData (optimistic concurrency) -------------------------

test('checkedUpdateSheetData writes only cells whose value still matches', async () => {
    const { fake, restore } = withFakeGapi({
        sheets: [{ title: 'Red Gurus', sheetId: 11 }],
        // batchGet responses: first cell matches, second has drifted.
        valueRanges: [
            [['1']],
            [['0.5']]
        ]
    });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const result = await api.checkedUpdateSheetData(SHEET_ID, {
            updates: [
                { sheetId: 11, row: 2, col: 5, value: '0', valueType: 'number', expectedValue: '1' },
                { sheetId: 11, row: 3, col: 5, value: '1', valueType: 'number', expectedValue: '1' }
            ]
        });

        assert.equal(result.updatedCells, 1);
        assert.equal(result.skippedCells, 1);
        assert.equal(result.skipped[0].currentValue, '0.5');
        assert.equal(result.skipped[0].expectedValue, '1');

        const written = fake.callsTo('spreadsheets.batchUpdate')[0].params.resource.requests;
        assert.equal(written.length, 1);
        assert.deepEqual(written[0].updateCells.start, { sheetId: 11, rowIndex: 1, columnIndex: 4 });
    } finally {
        restore();
    }
});

test('checkedUpdateSheetData skips the write entirely when nothing matches', async () => {
    const { fake, restore } = withFakeGapi({
        sheets: [{ title: 'Red Gurus', sheetId: 11 }],
        valueRanges: [[['9']]]
    });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const result = await api.checkedUpdateSheetData(SHEET_ID, {
            updates: [{ sheetId: 11, row: 2, col: 5, value: '0', valueType: 'number', expectedValue: '1' }]
        });

        assert.equal(result.updatedCells, 0);
        assert.equal(result.skippedCells, 1);
        assert.equal(fake.callsTo('spreadsheets.batchUpdate').length, 0, 'no batchUpdate should be sent');
    } finally {
        restore();
    }
});

test('checkedUpdateSheetData treats an empty expected value as comparing to empty', async () => {
    const { fake, restore } = withFakeGapi({
        sheets: [{ title: 'Red Gurus', sheetId: 11 }],
        valueRanges: [[[]]]
    });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const result = await api.checkedUpdateSheetData(SHEET_ID, {
            updates: [{ sheetId: 11, row: 2, col: 5, value: '1', valueType: 'number', expectedValue: '' }]
        });

        assert.equal(result.updatedCells, 1);
        assert.equal(fake.callsTo('spreadsheets.batchUpdate')[0].params.resource.requests.length, 1);
    } finally {
        restore();
    }
});

test('checkedUpdateSheetData errors when the target sheet does not exist', async () => {
    const { restore } = withFakeGapi({ sheets: [{ title: 'Red Gurus', sheetId: 11 }] });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        await assert.rejects(
            () => api.checkedUpdateSheetData(SHEET_ID, {
                updates: [{ sheetId: 999, row: 2, col: 5, value: '0', expectedValue: '1' }]
            }),
            /Target sheet with ID 999 not found/
        );
    } finally {
        restore();
    }
});

test('checkedUpdateSheetData builds A1 ranges with the right column letters', async () => {
    const { fake, restore } = withFakeGapi({
        sheets: [{ title: 'Red Gurus', sheetId: 11 }],
        valueRanges: [[['1']]]
    });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        await api.checkedUpdateSheetData(SHEET_ID, {
            updates: [{ sheetId: 11, row: 7, col: 5, value: '0', valueType: 'number', expectedValue: '1' }]
        });
        assert.deepEqual(fake.callsTo('values.batchGet')[0].params.ranges, ["'Red Gurus'!E7"]);
    } finally {
        restore();
    }
});

// --- unhideGuruSheets --------------------------------------------------------

test('unhideGuruSheets unhides only exact guru sheet names', async () => {
    const { fake, restore } = withFakeGapi({
        sheets: [
            { title: 'Red Gurus', sheetId: 11, hidden: true },
            { title: 'Blue Gurus', sheetId: 22, hidden: true },
            { title: 'Green Gurus', sheetId: 33, hidden: false },
            { title: 'Red Gurus Archive', sheetId: 44, hidden: true }
        ]
    });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        await api.unhideGuruSheets(SHEET_ID);

        const requests = fake.callsTo('spreadsheets.batchUpdate')[0].params.resource.requests;
        assert.deepEqual(requests.map(r => r.updateSheetProperties.properties.sheetId), [11, 22, 33]);
        assert.ok(requests.every(r => r.updateSheetProperties.properties.hidden === false));
    } finally {
        restore();
    }
});

test('unhideGuruSheets errors when no guru sheets exist', async () => {
    const { restore } = withFakeGapi({ sheets: [{ title: 'Other', sheetId: 1 }] });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        await assert.rejects(() => api.unhideGuruSheets(SHEET_ID), /No Guru sheets found/);
    } finally {
        restore();
    }
});

// --- clearCell ---------------------------------------------------------------

test('clearCell clears the resolved cell range', async () => {
    const { fake, restore } = withFakeGapi({ sheets: [{ title: 'Red Gurus', sheetId: 11 }] });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const result = await api.clearCell(SHEET_ID, { sheetId: 11, row: 4, col: 5 });

        assert.equal(result.success, true);
        assert.equal(result.range, "'Red Gurus'!E4");
        assert.equal(fake.callsTo('values.clear')[0].params.range, "'Red Gurus'!E4");
    } finally {
        restore();
    }
});

test('clearCell resolves merged update coordinates before clearing', async () => {
    const { fake, restore } = withFakeGapi({
        sheets: [{ title: 'Red Gurus', sheetId: 11 }, { title: 'Blue Gurus', sheetId: 22 }]
    });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        await api.clearCell(SHEET_ID, {
            row: 4, col: 6, isMergedGuruUpdate: true,
            guruSheetIds: { red: 11, blue: 22, green: 33 }
        });
        assert.equal(fake.callsTo('values.clear')[0].params.range, "'Blue Gurus'!E4");
    } finally {
        restore();
    }
});

test('clearCell rejects malformed updates', async () => {
    const api = new GoogleSheetsAPI(fakeAuthManager());
    await assert.rejects(() => api.clearCell(SHEET_ID, null), /requires an update object/);
    await assert.rejects(() => api.clearCell(SHEET_ID, { col: 1, sheetId: 1 }), /must include row/);
});

test('clearCell errors when the resolved target sheet is unknown', async () => {
    const { restore } = withFakeGapi({ sheets: [{ title: 'Red Gurus', sheetId: 11 }] });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        await assert.rejects(() => api.clearCell(SHEET_ID, { sheetId: 999, row: 1, col: 1 }), /Target sheet with ID 999 not found/);
    } finally {
        restore();
    }
});

// --- getDeckNotes ------------------------------------------------------------

test('getDeckNotes attaches the deck notes column mapping', async () => {
    const { restore } = withFakeGapi({
        values: {
            "'Deck Notes'!A:E": [
                ['Decklists', 'Goldfish Clock', 'Goldfish Signature', 'Notes', 'Additional Notes'],
                ['Deck A', '5', 'alice', 'n', 'm']
            ]
        }
    });
    try {
        const api = new GoogleSheetsAPI(fakeAuthManager());
        const notes = await api.getDeckNotes(SHEET_ID, { title: 'Deck Notes', sheetId: 44 });

        assert.equal(notes.title, 'Deck Notes');
        assert.deepEqual(notes.columnMapping, {
            decklists: 0, clock: 1, signature: 2, notes: 3, additionalNotes: 4
        });
        assert.equal(notes.values.length, 2);
    } finally {
        restore();
    }
});
