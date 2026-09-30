/**
 * Analysis session state.
 *
 * The single source of truth for everything the scoring screen needs about the
 * pod currently open: the fetched spreadsheet, the parsed row model, the
 * current row and guru colour, the discrepancy count, the deck-notes lookup and
 * the resolved per-colour column index.
 *
 * Extracted from the scattered fields that used to be duplicated between
 * AnalysisController's constructor and reset() (phase 4 of #18). Everything that
 * used to copy those fields now reads them from here, so there is one place for
 * them to drift from instead of two.
 *
 * `signature` is deliberately not cleared by `reset()`: it is the signed-in
 * guru's identity for the whole session, not per-pod state.
 */
import { emptyColumnIndex } from '../domain/guruColor.js';

export class AppState {
    constructor() {
        this.signature = '';
        this.reset();
    }

    /** Clear all per-pod session state, keeping the guru signature. */
    reset() {
        this.sheetData = null;
        this.rows = [];
        this.rowIndex = -1;
        this.guruColor = null;
        this.numDiscrepancies = 0;
        this.deckNotesMap = new Map();
        this.deckNotesColumnMap = {};
        this.columnIndex = emptyColumnIndex();
        this.hub = null;
    }

    /** The open spreadsheet's file id, or null when no pod is loaded. */
    get spreadsheetId() {
        return this.sheetData?.spreadsheetId ?? null;
    }

    get currentRow() {
        return this.rows[this.rowIndex];
    }

    get totalRows() {
        return this.rows.length;
    }

    setSheetData(sheetData) {
        this.sheetData = sheetData;
    }

    setRows(rows) {
        this.rows = rows;
    }

    setRowIndex(index) {
        this.rowIndex = index;
    }

    setGuruColor(colour) {
        this.guruColor = colour;
    }

    setNumDiscrepancies(count) {
        this.numDiscrepancies = count;
    }

    setHub(hub) {
        this.hub = hub;
    }

    setSignature(signature) {
        this.signature = signature;
    }

    setDeckNotes(deckNotesMap, columnMap) {
        this.deckNotesMap = deckNotesMap;
        this.deckNotesColumnMap = columnMap;
    }

    /** Store a resolved column index; a null parse leaves the previous one. */
    setColumnIndex(columnIndex) {
        if (columnIndex) {
            this.columnIndex = columnIndex;
        }
    }

    /**
     * A stable identity for the current row: sheet id plus original row index.
     * Unlike the player names, these survive a re-fetch that reorders or
     * reformats rows.
     */
    currentRowKey() {
        const row = this.currentRow;
        return row ? { sheetId: row.sheetId, originalRowIndex: row.originalRowIndex } : null;
    }

    /** Index of the row matching a `currentRowKey()`, or -1. */
    findRowIndexByKey(key) {
        if (!key) {
            return -1;
        }
        return this.rows.findIndex(
            row => row.sheetId === key.sheetId && row.originalRowIndex === key.originalRowIndex
        );
    }
}
