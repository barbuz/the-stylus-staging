/**
 * Pure deck-notes and colour-statistics parsing.
 *
 * Takes a sheet-data payload and returns plain maps/counts. No DOM, no gapi,
 * no fetch, no instance state.
 */
import { GURU_COLORS, colourLabel } from './guruColor.js';
import { findColumnIndex } from './matchRows.js';
import { logger } from '../utils/log.js';

/**
 * Parse the "Deck Notes" sheet into a map keyed by decklist, plus the resolved
 * column indices. Rows without a decklist are ignored; blank notes keys are
 * omitted rather than stored as ''.
 *
 * @returns {{deckNotesMap: Map<string, object>, columnMap: object}}
 */
export function processDeckNotes(sheetData) {
    const deckNotesMap = new Map();

    if (!sheetData.sheets) {
        logger.debug('No sheets found in sheetData');
        return { deckNotesMap, columnMap: {} };
    }

    // Find the "Deck Notes" sheet
    const deckNotesSheet = sheetData.sheets.find(sheet =>
        sheet.title && sheet.title.toLowerCase().includes('deck notes')
    );

    if (!deckNotesSheet) {
        logger.debug('No "Deck Notes" sheet found. Available sheets:',
            sheetData.sheets.map(s => s.title));
        return { deckNotesMap, columnMap: {} };
    }

    if (!deckNotesSheet.values || deckNotesSheet.values.length < 2) {
        logger.debug('Deck Notes sheet has no data or insufficient rows');
        return { deckNotesMap, columnMap: {} };
    }

    const headerRow = deckNotesSheet.values[0];

    const decklistsColIndex = findColumnIndex(headerRow, ['Decklists', 'Decklist']);
    const goldfishClockColIndex = findColumnIndex(headerRow, ['Goldfish Clock', 'Clock']);
    const goldfishSignatureColIndex = findColumnIndex(headerRow, ['Goldfish Signature', 'Signature']);
    const notesColIndex = findColumnIndex(headerRow, ['Notes']);
    const additionalNotesColIndex = findColumnIndex(headerRow, ['Additional Notes', 'Add Notes']);

    const columnMap = {
        decklists: decklistsColIndex,
        goldfishClock: goldfishClockColIndex,
        goldfishSignature: goldfishSignatureColIndex,
        notes: notesColIndex,
        additionalNotes: additionalNotesColIndex
    };

    if (decklistsColIndex === -1) {
        logger.debug('Decklists column not found');
        return { deckNotesMap, columnMap };
    }

    // Process each row
    for (let i = 1; i < deckNotesSheet.values.length; i++) {
        const row = deckNotesSheet.values[i];
        const decklist = row[columnMap.decklists];

        if (decklist && decklist.trim()) {
            const deckInfo = { row: i };

            if (columnMap.goldfishClock !== -1 && row[columnMap.goldfishClock]) {
                deckInfo.goldfishClock = row[columnMap.goldfishClock].toString().trim();
            }

            if (columnMap.goldfishSignature !== -1 && row[columnMap.goldfishSignature]) {
                deckInfo.goldfishSignature = row[columnMap.goldfishSignature].toString().trim();
            }

            if (columnMap.notes !== -1 && row[columnMap.notes]) {
                const notes = row[columnMap.notes].toString().trim();
                if (notes) deckInfo.notes = notes;
            }

            if (columnMap.additionalNotes !== -1 && row[columnMap.additionalNotes]) {
                const additionalNotes = row[columnMap.additionalNotes].toString().trim();
                if (additionalNotes) deckInfo.additionalNotes = additionalNotes;
            }

            if (Object.keys(deckInfo).length > 0) {
                deckNotesMap.set(decklist.trim(), deckInfo);
            }
        }
    }

    logger.debug('Total deck notes processed:', deckNotesMap.size);
    return { deckNotesMap, columnMap };
}

/**
 * Per-colour claimed/total match counts from the merged guru sheet, used by the
 * colour-selection screen.
 */
export function calculateColorStatistics(sheetData) {
    const mergedGuruSheet = sheetData.sheets?.find(sheet => sheet.title === 'Merged Gurus');

    const stats = {};
    for (const colour of GURU_COLORS) {
        stats[colour] = { claimed: 0, total: 0 };
    }

    if (!mergedGuruSheet || !mergedGuruSheet.values || mergedGuruSheet.values.length < 2) {
        return stats;
    }

    const headerRow = mergedGuruSheet.values[0];

    const player1ColIndex = findColumnIndex(headerRow, ['Player 1', 'Player1']);
    const player2ColIndex = findColumnIndex(headerRow, ['Player 2', 'Player2']);
    const signatureCols = Object.fromEntries(
        GURU_COLORS.map(colour => [colour, findColumnIndex(headerRow, [`${colourLabel(colour)} Signature`])])
    );

    for (let rowIndex = 1; rowIndex < mergedGuruSheet.values.length; rowIndex++) {
        const row = mergedGuruSheet.values[rowIndex];
        const player1 = row[player1ColIndex] || '';
        const player2 = row[player2ColIndex] || '';

        // Only count rows that have player data (actual matches)
        if (player1.trim() || player2.trim()) {
            for (const colour of GURU_COLORS) {
                stats[colour].total++;

                const colIndex = signatureCols[colour];
                if (colIndex !== -1 && row[colIndex] && row[colIndex].trim() !== '') {
                    stats[colour].claimed++;
                }
            }
        }
    }

    return stats;
}
