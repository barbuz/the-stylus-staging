/**
 * Analysis session loader.
 *
 * Turns a fetched spreadsheet into the controller's session state: it detects
 * the deck-notes-only view, loads the hub threads, determines the guru colour
 * (or offers a choice when the signature is absent), builds the row model and
 * picks the first row to score. Returns false when the caller should stop.
 */
import { HubManager } from '../modules/hubManager.js';
import { processDeckNotes, calculateColorStatistics } from '../domain/deckNotes.js';
import { determineGuruColorFromSheet } from '../domain/guruColor.js';
import { parsePodSheets } from '../domain/matchRows.js';

export class AnalysisSessionLoader {
    constructor(host) {
        this.host = host;
    }

    async loadData(sheetData, guruColor = null, rowNumber = 0) {
        const host = this.host;
        host.currentData = sheetData;

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
            if (!host.hub) {
                host.hub = new HubManager(sheetData.metadata.guruHubLink, sheetData.metadata.podName);
            }
            host.hub.loadThreads();
        }

        if (rowNumber !== null && rowNumber > 0) {
            host.currentRowIndex = rowNumber - 1;
        }

        if (guruColor === null) {
            try {
                host.currentGuruColor = determineGuruColorFromSheet(sheetData, host.guruSignature, host.currentRowIndex);
            } catch (error) {
                if (error.message.includes('not found in any analysis column')) {
                    host.showGuruColorSelection(sheetData);
                    return false;
                }
                console.error('Error determining guru color:', error);
                host.uiController.showError('An error occurred while determining guru color');
                return false;
            }
        } else {
            host.currentGuruColor = guruColor.toLowerCase();
        }

        const deckNotesResult = processDeckNotes(sheetData);
        host.deckNotesMap = deckNotesResult.deckNotesMap;
        host.deckNotesColumnMap = deckNotesResult.columnMap;

        const { rows, columnIndex, numDiscrepancies } = parsePodSheets(
            sheetData, host.currentGuruColor, host.guruSignature
        );
        host.allRows = rows;
        host.numDiscrepancies = numDiscrepancies;
        if (columnIndex) {
            host.columnIndex = columnIndex;
        }

        if (host.allRows.length === 0) {
            host.view.showNoDataMessage();
        } else if (host.currentRowIndex == null || host.currentRowIndex < 0 || host.currentRowIndex >= host.allRows.length) {
            const firstEmpty = host.findFirstEmptyAnalysis();
            if (firstEmpty == null) {
                host.currentRowIndex = 0;
                host.showCompletionMessage();
            } else {
                host.currentRowIndex = firstEmpty;
            }
        }
        return true;
    }

    /** Statistics for the guru colour selection screen. */
    colorStatistics(sheetData) {
        return calculateColorStatistics(sheetData);
    }
}
