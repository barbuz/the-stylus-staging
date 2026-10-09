/**
 * Analysis session loader.
 *
 * Turns a fetched spreadsheet into the controller's session state: it detects
 * the deck-notes-only view, loads the hub threads, determines the guru colour
 * (or offers a choice when the signature is absent), builds the row model and
 * picks the first row to score. Returns false when the caller should stop.
 */
import { HubManager } from '../modules/hubManager.js';
import { processDeckNotes, calculateColorStatistics, groupDeckNotes } from '../domain/deckNotes.js';
import { determineGuruColorFromSheet } from '../domain/guruColor.js';
import { parsePodSheets } from '../domain/matchRows.js';
import { logger } from '../utils/log.js';

export class AnalysisSessionLoader {
    constructor(host) {
        this.host = host;
    }

    async loadData(sheetData, guruColor = null, rowNumber = 0) {
        const host = this.host;
        const state = host.state;
        state.setSheetData(sheetData);

        if (sheetData.sheets.some(sheet => sheet.title === 'Merged Gurus' && sheet.hidden)) {
            const notesData = sheetData.sheets.find(sheet => sheet.title === 'Deck Notes');
            if (notesData) {
                host.showDeckNotesEditor(notesData);
                return false;
            }
            host.uiController.showError('No Deck Notes sheet found. Please ensure it exists to continue.');
            return false;
        }

        if (sheetData.metadata?.guruHubLink && sheetData.metadata?.podName) {
            if (!state.hub) {
                state.setHub(new HubManager(sheetData.metadata.guruHubLink, sheetData.metadata.podName));
            }
            state.hub.loadThreads();
        }

        if (rowNumber !== null && rowNumber > 0) {
            state.setRowIndex(rowNumber - 1);
        }

        if (guruColor === null) {
            try {
                state.setGuruColor(determineGuruColorFromSheet(sheetData, state.signature, state.rowIndex));
            } catch (error) {
                if (error.message.includes('not found in any analysis column')) {
                    host.showGuruColorSelection(sheetData);
                    return false;
                }
                logger.error('Error determining guru color:', error);
                host.uiController.showError('An error occurred while determining guru color');
                return false;
            }
        } else {
            state.setGuruColor(guruColor.toLowerCase());
        }

        const deckNotesResult = processDeckNotes(sheetData);
        state.setDeckNotes(deckNotesResult.deckNotesMap, deckNotesResult.columnMap);
        const deckNotesValues = sheetData.sheets.find(sheet =>
            sheet.title && sheet.title.toLowerCase().includes('deck notes')
        )?.values || null;
        state.setDeckNotesEntries(
            groupDeckNotes(deckNotesValues, deckNotesResult.columnMap),
            deckNotesValues
        );

        const { rows, columnIndex, numDiscrepancies } = parsePodSheets(
            sheetData, state.guruColor, state.signature
        );
        state.setRows(rows);
        state.setNumDiscrepancies(numDiscrepancies);
        state.setColumnIndex(columnIndex);

        if (state.rows.length === 0) {
            host.view.showNoDataMessage();
        } else if (state.rowIndex == null || state.rowIndex < 0 || state.rowIndex >= state.rows.length) {
            const firstEmpty = host.findFirstEmptyAnalysis();
            if (firstEmpty == null) {
                state.setRowIndex(0);
                host.showCompletionMessage();
            } else {
                state.setRowIndex(firstEmpty);
            }
        }
        return true;
    }

    /** Statistics for the guru colour selection screen. */
    colorStatistics(sheetData) {
        return calculateColorStatistics(sheetData);
    }
}
