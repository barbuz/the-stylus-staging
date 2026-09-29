/**
 * Analysis writer.
 *
 * Owns every write to the spreadsheet for the scoring screen: setting an
 * analysis, claiming / unclaiming, clearing a result, claiming a whole deck and
 * saving a deck-notes field. It only talks to sheetsAPI and returns plain
 * results; the controller applies the local state changes and re-renders.
 *
 * Merged-guru writes are routed to the individual colour sheet by the API
 * module via `guruSheetIds`, so this class never needs the colour column map.
 */
export class AnalysisWriter {
    constructor(sheetsAPI) {
        this.sheetsAPI = sheetsAPI;
    }

    /** Write one guru's Win/Tie/Loss to a merged-guru row. */
    async writeAnalysis({ sheetId, row, col, value, guruSheetIds }) {
        const updates = {
            updates: [{
                sheetId,
                row: row + 1, // sheets are 1-indexed
                col: col + 1,
                value: value.toString(),
                valueType: 'number',
                isMergedGuruUpdate: true,
                guruSheetIds
            }]
        };
        await this.sheetsAPI.updateSheetData(sheetId, updates);
    }

    /** Atomically claim a row only if its signature cell is still empty. */
    async claimRow({ sheetId, row, col, signature, guruSheetIds }) {
        const updates = {
            updates: [{
                sheetId,
                row: row + 1,
                col: col + 1,
                value: signature,
                expectedValue: '',
                valueType: 'string',
                isMergedGuruUpdate: true,
                guruSheetIds
            }]
        };
        return this.sheetsAPI.checkedUpdateSheetData(sheetId, updates);
    }

    /** Claim every listed row, reporting which were already taken. */
    async claimRows({ sheetId, rows, col, signature, guruSheetIds }) {
        const updates = {
            updates: rows.map(row => ({
                sheetId,
                row: row + 1,
                col: col + 1,
                value: signature,
                expectedValue: '',
                valueType: 'string',
                isMergedGuruUpdate: true,
                guruSheetIds
            }))
        };
        return this.sheetsAPI.checkedUpdateSheetData(sheetId, updates);
    }

    async clearCell({ sheetId, row, col, guruSheetIds }) {
        return this.sheetsAPI.clearCell(sheetId, {
            sheetId,
            row: row + 1,
            col: col + 1,
            isMergedGuruUpdate: true,
            guruSheetIds
        });
    }

    /** Checked update of a Deck Notes field (notes / additional notes / clock). */
    async saveDeckField({ sheetId, sheet, row, col, value, expectedValue }) {
        const updates = {
            updates: [{
                sheetId: sheet.sheetId,
                row: row + 1,
                col: col + 1,
                value,
                expectedValue,
                valueType: 'auto-detect'
            }]
        };
        return this.sheetsAPI.checkedUpdateSheetData(sheetId, updates);
    }

    /** Sign the goldfish clock with the guru signature. */
    async signGoldfishClock({ sheetId, sheet, row, col, signature }) {
        await this.sheetsAPI.updateSheetData(sheetId, {
            updates: [{
                sheetId: sheet.sheetId,
                row: row + 1,
                col: col + 1,
                value: signature,
                valueType: 'string'
            }]
        });
    }
}
