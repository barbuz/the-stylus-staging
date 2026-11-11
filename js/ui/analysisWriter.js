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
import { logger } from '../utils/log.js';

/**
 * Compress a list of `row:col` cells into `row-range:col` runs, so a 20-row
 * deck claim reads as `71-90:5` instead of twenty pairs. The exact row set is
 * the evidence a double-write bug needs, so it is kept, just not spelled out.
 */
function compressRanges(updates) {
    const sorted = [...updates].sort((a, b) => a.row - b.row || a.col - b.col);
    const parts = [];
    let start = null;
    let prev = null;
    let col = null;
    for (const { row, col: c } of sorted) {
        if (start === null) {
            start = prev = row;
            col = c;
            continue;
        }
        if (row === prev + 1 && c === col) {
            prev = row;
            continue;
        }
        parts.push(start === prev ? `${start}:${col}` : `${start}-${prev}:${col}`);
        start = prev = row;
        col = c;
    }
    if (start !== null) {
        parts.push(start === prev ? `${start}:${col}` : `${start}-${prev}:${col}`);
    }
    return parts.join(',');
}

export class AnalysisWriter {
    constructor(sheetsAPI, label = '') {
        this.sheetsAPI = sheetsAPI;
        // The owning controller's short id, threaded into the one captured line
        // each write emits, so a log shows which session object made the write.
        this.label = label;
    }

    /**
     * One compact captured line per write. The full update objects are on trace:
     * the ranges are what a bug report needs, and a per-cell dump of a 20-row
     * deck claim is what crowds the buffer.
     */
    _logWrite(action, spreadsheetId, updates) {
        logger.debug(`✍️ ${this.label} ${action} -> ${compressRanges(updates)}`);
        logger.trace(`✍️ ${this.label} ${action} detail:`, { spreadsheetId, updates });
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
        this._logWrite(`score ${value}`, spreadsheetId, updates.updates);
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
        this._logWrite('claim', spreadsheetId, updates.updates);
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
        this._logWrite(`claim ${rows.length} rows`, spreadsheetId, updates.updates);
        return this.sheetsAPI.checkedUpdateSheetData(spreadsheetId, updates);
    }

    async clearCell({ spreadsheetId, sheetId, row, col, guruSheetIds }) {
        this._logWrite('clear', spreadsheetId, [{ row: row + 1, col: col + 1 }]);
        return this.sheetsAPI.clearCell(spreadsheetId, {
            sheetId,
            row: row + 1,
            col: col + 1,
            isMergedGuruUpdate: true,
            guruSheetIds
        });
    }

    /** Clear the signature cell of every listed row in one request. */
    async unclaimRows({ spreadsheetId, sheetId, rows, col, guruSheetIds }) {
        this._logWrite(`unclaim ${rows.length} rows`, spreadsheetId,
            rows.map(row => ({ row: row + 1, col: col + 1 })));
        return this.sheetsAPI.clearCells(spreadsheetId, rows.map(row => ({
            sheetId,
            row: row + 1,
            col: col + 1,
            isMergedGuruUpdate: true,
            guruSheetIds
        })));
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
        this._logWrite(`deck field ${targets.length} rows`, spreadsheetId, updates.updates);
        return this.sheetsAPI.checkedUpdateSheetData(spreadsheetId, updates);
    }

    /** Sign the goldfish clock with the guru signature across every row. */
    async signGoldfishClock({ spreadsheetId, sheet, row, rows, col, signature }) {
        const targets = rows || [row];
        this._logWrite(`sign clock ${targets.length} rows`, spreadsheetId,
            targets.map(target => ({ row: target + 1, col: col + 1 })));
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
