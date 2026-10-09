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
 *
 * `spreadsheetId` is the spreadsheet file id (the batchUpdate target);
 * `sheetId` is the numeric tab id inside it. They are distinct and both
 * required: passing the tab id where the file id belongs makes the real API
 * reject the write.
 */
export class AnalysisWriter {
    constructor(sheetsAPI) {
        this.sheetsAPI = sheetsAPI;
    }

    /** Write one guru's Win/Tie/Loss to a merged-guru row. */
    async writeAnalysis({ spreadsheetId, sheetId, row, col, value, guruSheetIds }) {
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
        await this.sheetsAPI.updateSheetData(spreadsheetId, updates);
    }

    /** Atomically claim a row only if its signature cell is still empty. */
    async claimRow({ spreadsheetId, sheetId, row, col, signature, guruSheetIds }) {
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
        return this.sheetsAPI.checkedUpdateSheetData(spreadsheetId, updates);
    }

    /** Claim every listed row, reporting which were already taken. */
    async claimRows({ spreadsheetId, sheetId, rows, col, signature, guruSheetIds }) {
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
        return this.sheetsAPI.checkedUpdateSheetData(spreadsheetId, updates);
    }

    async clearCell({ spreadsheetId, sheetId, row, col, guruSheetIds }) {
        return this.sheetsAPI.clearCell(spreadsheetId, {
            sheetId,
            row: row + 1,
            col: col + 1,
            isMergedGuruUpdate: true,
            guruSheetIds
        });
    }

    /**
     * Checked update of a Deck Notes field (notes / additional notes / clock).
     * `rows` is every spreadsheet row the edit applies to: a grouped entry
     * writes the same value to all of its rows in one call. A single `row` is
     * still accepted for convenience.
     */
    async saveDeckField({ spreadsheetId, sheet, row, rows, col, value, expectedValue }) {
        const targets = rows || [row];
        const updates = {
            updates: targets.map(target => ({
                sheetId: sheet.sheetId,
                row: target + 1,
                col: col + 1,
                value,
                expectedValue,
                valueType: 'auto-detect'
            }))
        };
        return this.sheetsAPI.checkedUpdateSheetData(spreadsheetId, updates);
    }

    /** Sign the goldfish clock with the guru signature across every row. */
    async signGoldfishClock({ spreadsheetId, sheet, row, rows, col, signature }) {
        const targets = rows || [row];
        await this.sheetsAPI.updateSheetData(spreadsheetId, {
            updates: targets.map(target => ({
                sheetId: sheet.sheetId,
                row: target + 1,
                col: col + 1,
                value: signature,
                valueType: 'string'
            }))
        });
    }
}
