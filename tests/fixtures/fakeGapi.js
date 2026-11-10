/**
 * A minimal in-memory stand-in for the `gapi.client.sheets` surface used by
 * GoogleSheetsAPI. It is a fake at the network boundary, not a mock of our own
 * code: the module under test runs unchanged and we assert on the requests it
 * would have sent and the transformations it performs.
 *
 * Only the endpoints the app actually calls are implemented. Each call is
 * recorded so tests can assert on ranges, resources and ordering.
 */

function spreadsheet(sheets) {
    return {
        properties: { title: 'Test Pod' },
        sheets: sheets.map((sheet, index) => ({
            properties: {
                title: sheet.title,
                sheetId: sheet.sheetId ?? index + 1,
                gridProperties: sheet.gridProperties ?? { rowCount: 1000, columnCount: 26 },
                hidden: sheet.hidden ?? false
            }
        }))
    };
}

export class FakeGapi {
    constructor({ sheets = [], values = {}, valueRanges = {} } = {}) {
        this.calls = [];
        this.sheetsConfig = sheets;
        this.values = values;               // keyed by `${title}!${range}`
        this.valueRanges = valueRanges;     // ordered responses for batchGet

        const valuesApi = {
            get: (params) => this.#record('values.get', params, () => ({
                result: {
                    values: this.#lookupValues(params.spreadsheetId, params.range),
                    range: params.range,
                    majorDimension: 'ROWS'
                }
            })),
            batchGet: (params) => this.#record('values.batchGet', params, () => ({
                result: {
                    valueRanges: this.#lookupRanges(params.ranges)
                }
            })),
            clear: (params) => this.#record('values.clear', params, () => ({
                result: { clearedRange: params.range }
            })),
            batchClear: (params) => this.#record('values.batchClear', params, () => ({
                result: { clearedRanges: (params.resource && params.resource.ranges) || [] }
            }))
        };

        this.gapi = {
            client: {
                sheets: {
                    spreadsheets: {
                        get: (params) => this.#record('spreadsheets.get', params, () => ({
                            result: spreadsheet(this.sheetsConfig)
                        })),
                        values: valuesApi,
                        batchUpdate: (params) => this.#record('spreadsheets.batchUpdate', params, () => ({
                            result: { replies: (params.resource.requests || []).map(() => ({})) }
                        }))
                    }
                }
            }
        };
    }

    /**
     * Install this fake as the global `gapi`, as the browser would provide it.
     * Returns a restore function so tests can clean up.
     */
    install() {
        const previous = globalThis.gapi;
        globalThis.gapi = this.gapi;
        return () => {
            if (previous === undefined) {
                delete globalThis.gapi;
            } else {
                globalThis.gapi = previous;
            }
        };
    }

    /** Requests recorded for a given method name, in order. */
    callsTo(method) {
        return this.calls.filter(call => call.method === method);
    }

    #record(method, params, produce) {
        this.calls.push({ method, params });
        return Promise.resolve().then(produce);
    }

    #lookupValues(spreadsheetId, range) {
        if (range in this.values) return this.values[range];
        const byTitle = Object.keys(this.values).find(key => key === range);
        if (byTitle) return this.values[byTitle];
        return [];
    }

    #lookupRanges(ranges) {
        if (Array.isArray(this.valueRanges) && this.valueRanges.length) {
            return ranges.map((range, index) => ({
                range,
                values: this.valueRanges[index] ?? []
            }));
        }
        return ranges.map(range => ({ range, values: this.#lookupValues(null, range) }));
    }
}

/** A permissive auth manager whose login state the test controls. */
export function fakeAuthManager({ loggedIn = true } = {}) {
    return {
        loggedIn,
        isLoggedIn() {
            return this.loggedIn;
        }
    };
}
