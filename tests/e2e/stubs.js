import {
    REAL_POD_SHEET_IDS, realPodGuruCells, realDeckNotesRows, realMetadataRows
} from '../fixtures/realPod.js';

/**
 * Browser-side stub for the external services The Stylus depends on.
 *
 * Injected with page.addInitScript, so it exists before any app module runs.
 * It replaces Google (gapi / GIS / userinfo), Google Drive appData and Scryfall
 * card images, letting the real application code run end to end with no network
 * access and no Google account.
 *
 * Rather than re-implementing GoogleSheetsAPI's orchestration, the stub models
 * a spreadsheet as cells. The app therefore exercises its genuine parsing,
 * merging and update paths; tests only choose the starting cells.
 *
 * Tests drive this through window.__stylus.
 */
export async function installStubs(page, { spreadsheet, preferences = null } = {}) {
    await page.addInitScript(({ seededSpreadsheet, seededPreferences }) => {
        const state = {
            spreadsheet: seededSpreadsheet,
            requests: [],
            batchUpdates: [],
            preferences: seededPreferences
        };

        // Disable the service worker entirely: its controllerchange handler
        // reloads the page mid-test, and offline caching is irrelevant here.
        try {
            delete Navigator.prototype.serviceWorker;
        } catch (e) {
            // Non-configurable in some engines; the reload guard below still applies.
        }

        const ok = (result) => Promise.resolve({ result });
        const cellKey = (row, col) => `${row}:${col}`;

        function sheetByTitle(title) {
            return state.spreadsheet.sheets.find(s => s.title === title);
        }
        function sheetById(id) {
            return state.spreadsheet.sheets.find(s => s.sheetId === id);
        }

        // Parsed columns are 0-based (A=0); cell keys are 1-based sheet
        // coordinates, so callers must add 1 when looking a cell up.
        function parseRange(range) {
            // Accepts "A:C", "A1:C1000", "E1:F1000" (the range part after "!").
            const match = /^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/.exec(range);
            if (!match) return null;
            return {
                startCol: match[1].charCodeAt(0) - 65,
                startRow: match[2] ? parseInt(match[2], 10) : 1,
                endCol: (match[3] || match[1]).charCodeAt(0) - 65,
                endRow: match[4] ? parseInt(match[4], 10) : null
            };
        }

        function parseA1(range) {
            const match = /^'([^']+)'!(.+)$/.exec(range);
            if (!match) return null;
            const parsed = parseRange(match[2]);
            return parsed ? { ...parsed, title: match[1] } : null;
        }

        function readGrid(sheet, range) {
            const parsed = parseRange(range);
            if (!parsed) return [];

            const occupied = Object.keys(sheet.cells)
                .map(key => parseInt(key.split(':')[0], 10))
                .filter(row => row > 0);
            const maxRow = occupied.length ? Math.max(...occupied) : 0;
            const endRow = parsed.endRow === null ? maxRow : parsed.endRow;

            const grid = [];
            for (let row = parsed.startRow; row <= Math.min(endRow, maxRow); row++) {
                const cells = [];
                for (let col = parsed.startCol; col <= parsed.endCol; col++) {
                    cells.push(sheet.cells[cellKey(row, col + 1)] ?? '');
                }
                grid.push(cells);
            }
            // The Sheets API trims trailing all-empty rows.
            while (grid.length && grid[grid.length - 1].every(v => v === '')) grid.pop();
            return grid;
        }

        const sheetsApi = {
            spreadsheets: {
                get: (params) => {
                    state.requests.push({ kind: 'spreadsheets.get', params });
                    return ok({
                        properties: { title: state.spreadsheet.title },
                        sheets: state.spreadsheet.sheets.map(s => ({
                            properties: {
                                title: s.title,
                                sheetId: s.sheetId,
                                gridProperties: { rowCount: 1000, columnCount: 26 },
                                hidden: !!s.hidden
                            }
                        }))
                    });
                },
                values: {
                    get: (params) => {
                        state.requests.push({ kind: 'values.get', params });
                        const parsed = parseA1(params.range);
                        const sheet = parsed && sheetByTitle(parsed.title);
                        return ok({
                            values: sheet ? readGrid(sheet, params.range.split('!')[1]) : [],
                            range: params.range,
                            majorDimension: 'ROWS'
                        });
                    },
                    batchGet: (params) => {
                        state.requests.push({ kind: 'values.batchGet', params });
                        return ok({
                            valueRanges: params.ranges.map(range => {
                                const parsed = parseA1(range);
                                const sheet = parsed && sheetByTitle(parsed.title);
                                if (!sheet || parsed.endRow !== null) return { range, values: [] };
                                const cell = sheet.cells[cellKey(parsed.startRow, parsed.startCol + 1)];
                                return { range, values: cell === undefined || cell === '' ? [] : [[cell]] };
                            })
                        });
                    },
                    clear: (params) => {
                        state.requests.push({ kind: 'values.clear', params });
                        const parsed = parseA1(params.range);
                        const sheet = parsed && sheetByTitle(parsed.title);
                        if (sheet) delete sheet.cells[cellKey(parsed.startRow, parsed.startCol + 1)];
                        return ok({ clearedRange: params.range });
                    }
                },
                batchUpdate: (params) => {
                    state.batchUpdates.push(params);
                    for (const request of params.resource.requests || []) {
                        const update = request.updateCells;
                        if (!update) continue;
                        const sheet = sheetById(update.start.sheetId);
                        if (!sheet) continue;
                        const value = update.rows[0].values[0].userEnteredValue;
                        const raw = value.numberValue ?? value.stringValue ?? value.formulaValue ?? value.boolValue ?? '';
                        sheet.cells[cellKey(update.start.rowIndex + 1, update.start.columnIndex + 1)] = String(raw);
                    }
                    return ok({ replies: (params.resource.requests || []).map(() => ({})) });
                }
            }
        };

        window.__stylus = {
            getCell(title, row, col) {
                const sheet = sheetByTitle(title);
                return sheet ? (sheet.cells[cellKey(row, col)] ?? null) : null;
            },
            getRequests: () => state.requests.slice(),
            getBatchUpdates: () => state.batchUpdates.slice(),
            getPreferences: () => state.preferences,
            reset() { state.requests = []; state.batchUpdates = []; }
        };

        window.gapi = {
            load(_name, opts) {
                if (opts && opts.callback) opts.callback();
            },
            client: {
                init: () => ok({}),
                setToken: () => {},
                sheets: sheetsApi,
                drive: {
                    files: {
                        list: () => ok({ files: state.preferences ? [{ id: 'PREF_FILE_ID' }] : [] }),
                        get: () => Promise.resolve({ body: JSON.stringify(state.preferences || {}) })
                    }
                },
                request: (params) => {
                    // The app saves preferences with a PATCH whose body is the
                    // JSON document; record it so tests can assert on the
                    // persisted shape.
                    if (params && params.method === 'PATCH' && typeof params.body === 'string') {
                        try {
                            state.preferences = JSON.parse(params.body);
                        } catch (e) {
                            // Ignore malformed bodies; the app never sends one.
                        }
                    }
                    return ok({ id: 'PREF_FILE_ID' });
                }
            }
        };

        window.google = {
            accounts: {
                oauth2: {
                    // Resolving immediately with a token mirrors a user who has
                    // already consented; no real popup is ever opened.
                    initTokenClient: (opts) => ({
                        requestAccessToken() {
                            if (opts && typeof opts.callback === 'function') {
                                opts.callback({ access_token: 'test-access-token', expires_in: 3600 });
                            }
                        }
                    }),
                    revoke: () => {}
                }
            }
        };

        // Stub card images so Scryfall is never contacted. Overriding Image#src
        // makes every card "load" instantly.
        Object.defineProperty(window.Image.prototype, 'src', {
            configurable: true,
            set(value) {
                this.setAttribute('data-src', value);
                if (typeof this.onload === 'function') setTimeout(() => this.onload(), 0);
            },
            get() {
                return this.getAttribute('data-src');
            }
        });
    }, { seededSpreadsheet: spreadsheet, seededPreferences: preferences });
}

/** Build a spreadsheet payload from a compact sheet description. */
export function makeSpreadsheet({ title = 'Test Pod', sheets }) {
    return {
        title,
        sheets: sheets.map(sheet => ({
            title: sheet.title,
            sheetId: sheet.sheetId,
            hidden: !!sheet.hidden,
            cells: sheet.cells || {}
        }))
    };
}

/**
 * Build a cell map for a sheet from a 2D array of values, using 1-based
 * coordinates. Row 1 is typically the header row.
 */
export function cellsFromRows(rows) {
    const cells = {};
    rows.forEach((row, rowIndex) => {
        row.forEach((value, colIndex) => {
            if (value !== '' && value !== null && value !== undefined) {
                cells[`${rowIndex + 1}:${colIndex + 1}`] = String(value);
            }
        });
    });
    return cells;
}

/** A standard pod: Red/Blue/Green Gurus plus a Deck Notes sheet. */
export function sampleSpreadsheet() {
    const guruHeader = ['ID', 'Player 1', 'Player 2', 'Result', 'Analysis', 'Signature'];

    // Columns: ID, Player 1, Player 2, Result, Analysis, Signature
    // Row 1 is claimed by alice but unscored, so it is the first match to do.
    // Row 3 is unclaimed, exercising the claim flow.
    const redRows = [
        guruHeader,
        ['1', 'Deck A', 'Deck B', '1', '', 'alice'],
        ['2', 'Deck A', 'Deck C', '0', '0', 'alice'],
        ['3', 'Deck D', 'Deck E', '', '', ''],
        ['4', 'Deck D', 'Deck F', '0.5', '0.5', 'alice']
    ];
    const blueRows = [
        guruHeader,
        ['1', 'Deck A', 'Deck B', '1', '', 'bob'],
        ['2', 'Deck A', 'Deck C', '', '', ''],
        ['3', 'Deck D', 'Deck E', '', '', ''],
        ['4', 'Deck D', 'Deck F', '0', '0', 'bob']
    ];
    const greenRows = [
        guruHeader,
        ['1', 'Deck A', 'Deck B', '1', '1', 'carol'],
        ['2', 'Deck A', 'Deck C', '', '', ''],
        ['3', 'Deck D', 'Deck E', '', '', ''],
        ['4', 'Deck D', 'Deck F', '0.5', '0.5', 'carol']
    ];

    return makeSpreadsheet({
        sheets: [
            {
                title: 'Deck Notes',
                sheetId: 44,
                cells: cellsFromRows([
                    ['Decklists', 'Goldfish Clock', 'Goldfish Signature', 'Notes', 'Additional Notes'],
                    ['Deck A | Card | Card', '5', 'goldfish1', 'note', ''],
                    ['Deck D | Card | Card', '7', '', '', '']
                ])
            },
            { title: 'Red Gurus', sheetId: 111, cells: cellsFromRows(redRows) },
            { title: 'Blue Gurus', sheetId: 222, cells: cellsFromRows(blueRows) },
            { title: 'Green Gurus', sheetId: 333, cells: cellsFromRows(greenRows) }
        ]
    });
}

/**
 * The real pod, seeded at its true 13-column width.
 *
 * Unlike sampleSpreadsheet(), every guru sheet here is A:M, matching the live
 * workbook. The app only ever reads A:C and E:F, so the extra columns exist to
 * prove that reading a genuine sheet works and to make any future range drift
 * visible. The Deck Notes header is the real one ("Signature", not "Goldfish
 * Signature"), and the metadata sheet is headerless.
 */
export function realPodSpreadsheet() {
    return makeSpreadsheet({
        title: 'Novice I',
        sheets: [
            {
                title: 'Deck Notes',
                sheetId: REAL_POD_SHEET_IDS.deckNotes,
                cells: cellsFromRows(realDeckNotesRows())
            },
            { title: 'Red Gurus', sheetId: REAL_POD_SHEET_IDS.red, cells: realPodGuruCells('red') },
            { title: 'Blue Gurus', sheetId: REAL_POD_SHEET_IDS.blue, cells: realPodGuruCells('blue') },
            { title: 'Green Gurus', sheetId: REAL_POD_SHEET_IDS.green, cells: realPodGuruCells('green') },
            { title: 'metadata', sheetId: REAL_POD_SHEET_IDS.metadata, hidden: true, cells: cellsFromRows(realMetadataRows()) }
        ]
    });
}
