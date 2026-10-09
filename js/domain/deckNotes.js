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
 * Group the Deck Notes rows into one entry per run of consecutive identical
 * decks, for the one-deck-at-a-time gate.
 *
 * A run collapses only when the decklist and the editable data (clock, notes,
 * additional notes) are identical; the goldfish signature is deliberately not
 * part of the identity, because it records who filled the clock rather than
 * what the deck is. Differing rows stay as several single-row entries, and
 * repeated decklists that are not consecutive are always separate entries.
 *
 * `rows` holds every spreadsheet row index (values-relative, matching
 * `processDeckNotes`) that the entry's edits must be written to.
 *
 * @param {Array<Array<string>>} values the Deck Notes sheet values incl. header
 * @param {object} columnMap resolved column indices from `processDeckNotes`
 * @returns {Array<{deckString: string, row: number, rows: number[], deckInfo: object, signatures: string[]}>}
 */
export function groupDeckNotes(values, columnMap) {
    const list = [];
    if (!values || values.length < 2 || !columnMap || columnMap.decklists === -1) {
        return list;
    }

    const cell = (row, index) =>
        index !== undefined && index !== -1 ? (row[index] || '').toString().trim() : '';

    for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        const decklist = cell(row, columnMap.decklists);
        if (!decklist) {
            continue;
        }

        const clock = cell(row, columnMap.goldfishClock);
        const notes = cell(row, columnMap.notes);
        const additionalNotes = cell(row, columnMap.additionalNotes);
        const signature = cell(row, columnMap.goldfishSignature);

        const previous = list[list.length - 1];
        if (previous &&
            previous.deckString === decklist &&
            previous._clock === clock &&
            previous._notes === notes &&
            previous._additionalNotes === additionalNotes) {
            previous.rows.push(i);
            if (signature && !previous._signatures.includes(signature)) {
                previous._signatures.push(signature);
            }
            continue;
        }

        list.push({
            deckString: decklist,
            row: i,
            rows: [i],
            _clock: clock,
            _notes: notes,
            _additionalNotes: additionalNotes,
            _signatures: signature ? [signature] : []
        });
    }

    return list.map(entry => {
        const deckInfo = { row: entry.row };
        if (entry._clock) deckInfo.goldfishClock = entry._clock;
        if (entry._signatures.length) deckInfo.goldfishSignature = entry._signatures[0];
        if (entry._notes) deckInfo.notes = entry._notes;
        if (entry._additionalNotes) deckInfo.additionalNotes = entry._additionalNotes;

        return {
            deckString: entry.deckString,
            row: entry.row,
            rows: entry.rows,
            deckInfo,
            signatures: entry._signatures
        };
    });
}

/** Whether every grouped deck has a goldfish clock. Missing clock column = pass. */
export function allClocksFilled(list, columnMap) {
    if (!columnMap || columnMap.goldfishClock === -1) {
        return true;
    }
    return (list || []).every(entry => !!(entry.deckInfo && entry.deckInfo.goldfishClock));
}

/** How many of the grouped decks have a goldfish clock, for the gate progress. */
export function deckNotesProgress(list) {
    const entries = list || [];
    return {
        filled: entries.filter(entry => entry.deckInfo && entry.deckInfo.goldfishClock).length,
        total: entries.length
    };
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
