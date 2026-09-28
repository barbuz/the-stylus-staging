/**
 * Pure row model and row predicates.
 *
 * Everything here works on plain row objects and takes the guru colour and
 * signature as arguments. No DOM, no gapi, no fetch.
 */
import { calculateOutcomeFromAnalyses, getGuruAnalysisValues, normalizeAnalysisForComparison } from './analyses.js';
import {
    GURU_COLORS,
    getCurrentColorAnalysis,
    getCurrentColorSignature,
    buildColumnIndex,
    colourField,
    colourLabel
} from './guruColor.js';

/** Substring match of the first matching header alias, or -1. */
export function findColumnIndex(headerRow, possibleNames) {
    for (const name of possibleNames) {
        const index = headerRow.findIndex(header =>
            header && header.toLowerCase().includes(name.toLowerCase())
        );
        if (index !== -1) return index;
    }
    return -1;
}

/**
 * Build the row model from a merged guru sheet.
 *
 * Returns the rows that carry player data, the resolved column indices, and the
 * count of the current guru's discrepancies. Rows without player data still
 * count toward `numDiscrepancies` but are not returned, matching the original
 * single-pass behaviour.
 */
export function buildMatchRows(sheet, sheetIndex, colour, signature) {
    const headerRow = sheet.values[0];

    // Expected columns: ID, Player1, Player2, Red Analysis, Red Signature,
    // Blue Analysis, Blue Signature, Green Analysis, Green Signature
    const player1ColIndex = findColumnIndex(headerRow, ['Player 1', 'Player1']);
    const player2ColIndex = findColumnIndex(headerRow, ['Player 2', 'Player2']);

    const columnIndices = {
        player1: player1ColIndex,
        player2: player2ColIndex
    };
    for (const colour of GURU_COLORS) {
        columnIndices[colourField(colour, 'analysis')] = findColumnIndex(headerRow, [`${colourLabel(colour)} Analysis`]);
        columnIndices[colourField(colour, 'signature')] = findColumnIndex(headerRow, [`${colourLabel(colour)} Signature`]);
    }

    // Throw error if any required column is missing
    if (Object.values(columnIndices).some(index => index === -1)) {
        throw new Error('One or more required columns are missing in the pod sheet. Please check the sheet structure.');
    }

    const rows = [];
    let discrepancies = 0;

    // Process data rows (skip header)
    for (let rowIndex = 1; rowIndex < sheet.values.length; rowIndex++) {
        const row = sheet.values[rowIndex];

        // Get the original row index from the backend filtering
        const originalRowIndex = sheet.originalRowIndices ? sheet.originalRowIndices[rowIndex] : rowIndex;

        const player1 = row[columnIndices.player1] || '';
        const player2 = row[columnIndices.player2] || '';
        // Pull each guru's analysis and signature through the colour lookup, so
        // the field names are derived rather than hard-coded per colour.
        const colourValues = {};
        for (const colour of GURU_COLORS) {
            colourValues[colourField(colour, 'analysis')] =
                row[columnIndices[colourField(colour, 'analysis')]].toString().trim() || '';
            colourValues[colourField(colour, 'signature')] =
                row[columnIndices[colourField(colour, 'signature')]].toString().trim() || '';
        }

        // Calculate outcome based on all guru analyses, in colour order
        const outcomeValue = calculateOutcomeFromAnalyses(
            ...GURU_COLORS.map(colour => colourValues[colourField(colour, 'analysis')])
        );

        const newRow = {
            sheetIndex,
            sheetTitle: sheet.title,
            sheetId: sheet.sheetId,
            rowIndex,
            player1: player1.trim(),
            player2: player2.trim(),
            outcomeValue,
            ...colourValues,
            originalRowIndex // Use the original row index from unfiltered data
        };

        // Check for discrepancies for the current guru
        if (rowHasMyDiscrepancy(newRow, colour, signature)) {
            discrepancies++;
        }

        // Only include rows that have player data
        if (player1.trim() || player2.trim()) {
            rows.push(newRow);
        }
    }

    return { rows, columnIndices, numDiscrepancies: discrepancies };
}

// --- Row predicates ----------------------------------------------------------

/** The signature appears anywhere in the row. */
export function rowHasCurrentGuruSignature(row, signature) {
    const currentSignature = signature || '';
    if (!currentSignature.trim()) {
        return false;
    }

    return GURU_COLORS.some(colour => getCurrentColorSignature(row, colour) === currentSignature);
}

/** The signature appears in the current colour's column of the row. */
export function rowHasCurrentGuruSignatureInColor(row, colour, signature) {
    const currentSignature = signature || '';
    if (!currentSignature.trim()) {
        return false;
    }

    return getCurrentColorSignature(row, colour) == currentSignature;
}

/** The current colour's signature column of the row is empty (unclaimed). */
export function rowHasEmptySignature(row, colour) {
    const currentRowSignature = getCurrentColorSignature(row, colour);

    return !currentRowSignature || currentRowSignature.trim() === '';
}

/** The current colour has a non-blank analysis on the row. */
export function hasCurrentColorResult(row, colour) {
    const currentAnalysis = getCurrentColorAnalysis(row, colour);
    return currentAnalysis && (currentAnalysis.toString().trim() !== '');
}

/**
 * The row disagrees with itself. Two present-but-differing analyses already
 * count, even when the third guru has not scored and the outcome is therefore
 * still Incomplete.
 */
export function rowHasDiscrepancy(row) {
    const outcomeValue = (row.outcomeValue || '').toString().toLowerCase().trim();
    if (outcomeValue === 'discrepancy') {
        return true;
    }

    const normalizedAnalyses = getGuruAnalysisValues(row)
        .map(value => normalizeAnalysisForComparison(value))
        .filter(Boolean);

    return normalizedAnalyses.length >= 2 && new Set(normalizedAnalyses).size > 1;
}

/** A discrepancy on a row the current guru has claimed and scored. */
export function rowHasMyDiscrepancy(row, colour, signature) {
    return rowHasDiscrepancy(row) && rowHasCurrentGuruSignature(row, signature) && hasCurrentColorResult(row, colour);
}

/** All three gurus have scored and agree. */
export function allGurusHaveMatchingResults(row) {
    const normalizedAnalyses = getGuruAnalysisValues(row)
        .map(value => normalizeAnalysisForComparison(value))
        .filter(Boolean);
    return normalizedAnalyses.length === 3 && new Set(normalizedAnalyses).size === 1;
}

/**
 * The row can be scored now: either the current guru already claimed it, or it
 * is unclaimed, and the current colour's analysis is still empty.
 */
export function isMatchAvailableForAnalysis(row, colour, signature) {
    const hasMySignature = rowHasCurrentGuruSignatureInColor(row, colour, signature);
    const isUnclaimed = rowHasEmptySignature(row, colour);

    const currentAnalysis = getCurrentColorAnalysis(row, colour);
    const needsSolving = !currentAnalysis || currentAnalysis.trim() === '';

    return (hasMySignature || isUnclaimed) && needsSolving;
}

/** As above, for the selected row. False when there is no valid selection. */
export function isCurrentMatchAvailableForAnalysis(rows, colour, signature, currentRowIndex) {
    if (currentRowIndex < 0 || currentRowIndex >= rows.length) {
        return false;
    }

    return isMatchAvailableForAnalysis(rows[currentRowIndex], colour, signature);
}

/**
 * True when the current row is not awaiting work: no valid selection, or the
 * selected row already has a result (a complete/deleted row or one claimed by
 * another guru). Drives the "nothing to write" completion message.
 */
export function isCurrentRowResolved(rows, colour, signature, currentRowIndex) {
    const currentRow = rows[currentRowIndex];
    if (!currentRow) {
        return true;
    }

    if (isCurrentMatchAvailableForAnalysis(rows, colour, signature, currentRowIndex)) {
        return false;
    }

    return Boolean(hasCurrentColorResult(currentRow, colour));
}

/** Whether the current colour has scored every row (and there is at least one). */
export function isAnalysisComplete(rows, colour) {
    for (let i = 0; i < rows.length; i++) {
        const currentAnalysis = getCurrentColorAnalysis(rows[i], colour);
        if (!currentAnalysis || currentAnalysis.trim() === '') {
            return false;
        }
    }

    return rows.length > 0; // Only complete if we have rows to analyse
}

// --- Navigation --------------------------------------------------------------

/**
 * First row needing work: a claimed row with an empty analysis first, then an
 * unclaimed row. Searches from `startFromIndex` and wraps. Returns null when
 * there is nothing left.
 */
export function findFirstEmptyAnalysis(rows, colour, signature, startFromIndex = 0) {
    const needsAnalysis = row =>
        rowHasCurrentGuruSignatureInColor(row, colour, signature) &&
        (getCurrentColorAnalysis(row, colour).trim() === '');

    // Phase 1: Look for incomplete rows that belong to current guru
    for (let i = startFromIndex; i < rows.length; i++) {
        if (needsAnalysis(rows[i])) {
            return i;
        }
    }

    if (startFromIndex > 0) {
        for (let i = 0; i < startFromIndex - 1; i++) {
            if (needsAnalysis(rows[i])) {
                return i;
            }
        }
    }

    // Phase 2: no claimed rows left, look for rows with empty signatures
    for (let i = startFromIndex; i < rows.length; i++) {
        if (rowHasEmptySignature(rows[i], colour)) {
            return i;
        }
    }

    if (startFromIndex > 0) {
        for (let i = 0; i < startFromIndex - 1; i++) {
            if (rowHasEmptySignature(rows[i], colour)) {
                return i;
            }
        }
    }

    return null;
}

/** First row with one of the current guru's discrepancies, wrapping. -1 if none. */
export function findFirstDiscrepancy(rows, colour, signature, startFromIndex = 0) {
    for (let i = startFromIndex; i < rows.length; i++) {
        if (rowHasMyDiscrepancy(rows[i], colour, signature)) {
            return i;
        }
    }

    if (startFromIndex > 0) {
        for (let i = 0; i < startFromIndex; i++) {
            if (rowHasMyDiscrepancy(rows[i], colour, signature)) {
                return i;
            }
        }
    }

    return -1;
}

/**
 * First unclaimed row with a different Player 1 deck, searching forward then
 * wrapping. Falls back to `currentRowIndex` when there is none.
 */
export function findNextDeck(rows, colour, currentRowIndex) {
    if (currentRowIndex >= rows.length || currentRowIndex < 0) {
        return currentRowIndex;
    }

    const player1Deck = rows[currentRowIndex].player1;
    if (!player1Deck) {
        return currentRowIndex;
    }

    const isOtherUnclaimedDeck = row =>
        row.player1 !== player1Deck && rowHasEmptySignature(row, colour);

    for (let i = currentRowIndex + 1; i < rows.length; i++) {
        if (isOtherUnclaimedDeck(rows[i])) {
            return i;
        }
    }

    for (let i = 0; i < currentRowIndex; i++) {
        if (isOtherUnclaimedDeck(rows[i])) {
            return i;
        }
    }

    return currentRowIndex;
}

/** Index of the row with the players swapped, or -1. */
export function findMirrorMatchIndex(rows, rowIndex) {
    if (rowIndex < 0 || rowIndex >= rows.length) {
        return -1;
    }

    const currentRow = rows[rowIndex];

    return rows.findIndex((row, index) =>
        index !== rowIndex && // Exclude current row
        row.player1 === currentRow.player2 && // Swapped players
        row.player2 === currentRow.player1
    );
}

// --- Statistics --------------------------------------------------------------

/** The id a row is keyed by in the thread map: its sheet row, else 1-based index. */
export function getRowThreadId(row, fallbackIndex) {
    if (row && typeof row.rowIndex === 'number') {
        return row.rowIndex;
    }
    if (row && typeof row.originalRowIndex === 'number') {
        return row.originalRowIndex;
    }
    return fallbackIndex + 1;
}

/** Whether the thread map has an entry for this row. */
export function hasDiscordThreadForRow(threadMap, row, fallbackIndex) {
    if (!threadMap || typeof threadMap.has !== 'function') {
        return false;
    }
    const rowId = getRowThreadId(row, fallbackIndex);
    return rowId != null && threadMap.has(rowId);
}

/**
 * Parse every guru sheet in a pod into one row model.
 *
 * The merged-guru sheet is the only analysis sheet; other sheets are skipped.
 * Returns the combined rows, the resolved column index for the current colour,
 * and the discrepancy count. Extracted from the controller so loading is a pure
 * data transformation.
 */
export function parsePodSheets(sheetData, colour, signature) {
    const rows = [];
    let columnIndex = null;
    let numDiscrepancies = 0;

    if (!sheetData.sheets || !Array.isArray(sheetData.sheets)) {
        return { rows, columnIndex, numDiscrepancies };
    }

    sheetData.sheets.forEach((sheet, sheetIndex) => {
        if (sheet.title !== 'Merged Gurus' || !sheet.values || sheet.values.length <= 1) {
            return;
        }
        const parsed = buildMatchRows(sheet, sheetIndex, colour, signature);
        rows.push(...parsed.rows);
        columnIndex = buildColumnIndex(parsed.columnIndices);
        numDiscrepancies = parsed.numDiscrepancies;
    });

    return { rows, columnIndex, numDiscrepancies };
}

/** Match counts for the current row's Player 1 deck. */
export function getDeckStats(rows, colour, currentRowIndex) {
    if (currentRowIndex >= rows.length || currentRowIndex < 0) {
        return { totalMatches: 0, unclaimedMatches: 0 };
    }

    const player1Deck = rows[currentRowIndex].player1;
    if (!player1Deck) {
        return { totalMatches: 0, unclaimedMatches: 0 };
    }

    const deckRows = rows.filter(row => row.player1 === player1Deck);
    const unclaimedMatches = deckRows.filter(row => rowHasEmptySignature(row, colour)).length;

    return {
        totalMatches: deckRows.length,
        unclaimedMatches
    };
}