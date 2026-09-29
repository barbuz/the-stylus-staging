/**
 * Pure guru-colour helpers.
 *
 * A row carries one analysis and one signature per colour (Red/Blue/Green).
 * These helpers resolve a colour to the right field, column or label without
 * knowing anything about the DOM, gapi, or the interface instance.
 */

export const GURU_COLORS = ['red', 'blue', 'green'];

/**
 * The base colour. Shared base columns (ID, players) live on its sheet, and it
 * is the fallback when a guru's colour cannot be determined from the signature.
 */
export const DEFAULT_GURU_COLOUR = GURU_COLORS[0];

const KIND_FIELD_SUFFIX = { analysis: 'Analysis', signature: 'Signature' };

/** Merged-sheet column where the first colour's analysis block begins. */
const MERGED_BLOCK_START = 3;

/** 1-indexed columns on a per-guru sheet holding analysis and signature. */
export const GURU_SHEET_ANALYSIS_COLUMN = 5;  // Column E
export const GURU_SHEET_SIGNATURE_COLUMN = 6; // Column F

/**
 * The row/column field name for a colour and kind ('analysis' | 'signature'),
 * e.g. ('red', 'analysis') -> 'redAnalysis'. Returns null for unknown inputs.
 */
export function colourField(colour, kind) {
    if (!GURU_COLORS.includes(colour) || !Object.prototype.hasOwnProperty.call(KIND_FIELD_SUFFIX, kind)) {
        return null;
    }
    return colour + KIND_FIELD_SUFFIX[kind];
}

/** The colour with an initial capital, e.g. 'red' -> 'Red'. */
export function colourLabel(colour) {
    if (!colour) {
        return '';
    }
    return colour.charAt(0).toUpperCase() + colour.slice(1);
}

/** The current colour's analysis value on a row ('' when unset or unknown colour). */
export function getCurrentColorAnalysis(row, colour) {
    const field = colourField(colour, 'analysis');
    return field ? (row[field] || '') : '';
}

/** The current colour's signature on a row ('' when unset or unknown colour). */
export function getCurrentColorSignature(row, colour) {
    const field = colourField(colour, 'signature');
    return field ? (row[field] || '') : '';
}

/** Write the current colour's analysis on a row. No-op for an unknown colour. */
export function setColourAnalysis(row, colour, value) {
    const field = colourField(colour, 'analysis');
    if (field) {
        row[field] = value;
    }
}

/** Write the current colour's signature on a row. No-op for an unknown colour. */
export function setColourSignature(row, colour, value) {
    const field = colourField(colour, 'signature');
    if (field) {
        row[field] = value;
    }
}

/** A fresh per-colour column index, every entry -1 (not resolved). */
export function emptyColumnIndex() {
    const index = {};
    for (const colour of GURU_COLORS) {
        index[colour] = { analysis: -1, signature: -1 };
    }
    return index;
}

/**
 * Convert the flat `columnIndices` returned by `buildMatchRows` (keys such as
 * `redAnalysis`) into the nested `{ colour: { analysis, signature } }` shape.
 */
export function buildColumnIndex(flatIndices) {
    const index = emptyColumnIndex();
    for (const colour of GURU_COLORS) {
        index[colour].analysis = flatIndices[colourField(colour, 'analysis')] ?? -1;
        index[colour].signature = flatIndices[colourField(colour, 'signature')] ?? -1;
    }
    return index;
}

/**
 * Column index for a colour and kind ('analysis' or 'signature'), or -1 for an
 * unknown colour, kind, or unresolved index. `columnIndex` uses the nested
 * shape produced by `buildColumnIndex`.
 */
export function getCurrentGuruColIndex(colour, columnIndex, kind = 'analysis') {
    return columnIndex?.[colour]?.[kind] ?? -1;
}

/**
 * The colour the signature claimed in a row, or null when the signature is not
 * present in that row.
 */
export function getGuruColorInRow(row, signature) {
    for (const colour of GURU_COLORS) {
        if (getCurrentColorSignature(row, colour) === signature) {
            return colour;
        }
    }

    return null;
}

// --- Sheet naming and merged-sheet layout ------------------------------------
//
// The sheet schema (tab names, fetch ranges, merged-column positions) is derived
// from GURU_COLORS here, so a fourth colour is a data change in this module plus
// the sheet itself. The values match the real workbook and must not change
// without a real-sheet schema change.

/** The tab name a colour's data lives on, e.g. 'red' -> 'Red Gurus'. */
export function guruSheetName(colour) {
    return `${colourLabel(colour)} Gurus`;
}

/**
 * The colour a guru sheet title belongs to, or null when it is not a guru sheet.
 * Matches on the lower-cased colour substring, as the real titles are prose.
 */
export function colourFromSheetTitle(title) {
    if (!title) {
        return null;
    }
    const lower = title.toLowerCase();
    return GURU_COLORS.find(colour => lower.includes(colour)) || null;
}

/** True when a sheet title names any guru colour. */
export function isGuruSheetTitle(title) {
    return colourFromSheetTitle(title) !== null;
}

/**
 * Determine which colour column the current signature is claimed under in the
 * merged guru sheet. Searches from `startRowIndex` (0-based row position, or a
 * negative value to start at the top), wrapping around. Returns the base colour
 * when no signature is set or no merged sheet is present. Throws when the
 * signature appears in no column, so the caller can offer colour selection.
 */
export function determineGuruColorFromSheet(sheetData, signature, startRowIndex = -1) {
    const currentSignature = signature || '';

    if (!currentSignature.trim()) {
        return DEFAULT_GURU_COLOUR;
    }

    const mergedGuruSheet = sheetData.sheets?.find(sheet => sheet.title === 'Merged Gurus');
    if (!mergedGuruSheet || !mergedGuruSheet.values || mergedGuruSheet.values.length < 2) {
        return DEFAULT_GURU_COLOUR;
    }

    const headerRow = mergedGuruSheet.values[0];
    const signatureCols = Object.fromEntries(
        GURU_COLORS.map(colour => [colour, headerRow.findIndex(header =>
            header && header.toLowerCase().includes(`${colourLabel(colour)} Signature`.toLowerCase())
        )])
    );

    const start = startRowIndex >= 0 ? startRowIndex + 1 : 1;
    const totalRows = mergedGuruSheet.values.length;

    for (let i = 0; i < totalRows - 1; i++) {
        const rowIndex = ((start - 1 + i) % (totalRows - 1)) + 1;
        const row = mergedGuruSheet.values[rowIndex];

        for (const colour of GURU_COLORS) {
            const colIndex = signatureCols[colour];
            if (colIndex !== -1 && row[colIndex] === currentSignature) {
                return colour;
            }
        }
    }

    throw new Error(`Guru signature "${currentSignature}" not found in any analysis column. Please check that you have matches assigned to analyse.`);
}

/** The merged guru sheet in a sheet-data payload, or undefined. */
export function getMergedGuruSheet(sheetData) {
    return sheetData?.sheets?.find(sheet => sheet.title === 'Merged Gurus');
}

/** The Google Sheets edit URL for a spreadsheet id. */
export function guruSheetLink(sheetId) {
    return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}

/**
 * The URL a shared match link should point at: the production deployment with
 * the match's pod id (and no guru colour). When the sheet declares a
 * `mainSheetLink`, its spreadsheet id replaces the current pod. Returns '' for
 * a non-absolute or unparseable input, matching the original modal's fallback.
 */
export function deploymentSheetLink(currentHref, basePath, podId, mainSheetLink) {
    const url = new URL(currentHref);
    url.searchParams.delete('guru');
    url.pathname = basePath;
    const mainId = mainSheetLink ? String(mainSheetLink).match(/[-\w]{25,}/) : null;
    url.searchParams.set('pod', mainId ? mainId[0] : podId);
    return url.toString();
}

/** The analysis/signature header pair for one colour, e.g. ['Red Analysis', 'Red Signature']. */
export function mergedColourHeaders(colour) {
    return [`${colourLabel(colour)} Analysis`, `${colourLabel(colour)} Signature`];
}

/** The per-colour header block, in colour order: Red Analysis, Red Signature, Blue … */
export function mergedGuruHeader() {
    return GURU_COLORS.flatMap(colour => mergedColourHeaders(colour));
}

/** The 0-based merged-sheet column index for a colour and kind. */
export function mergedColourColumn(colour, kind) {
    const position = GURU_COLORS.indexOf(colour);
    if (position === -1) {
        return -1;
    }
    return MERGED_BLOCK_START + position * 2 + (kind === 'signature' ? 1 : 0);
}

/**
 * The merged-sheet column mapping (0-based). Base columns A:C are shared; each
 * colour then contributes an analysis/signature pair in colour order.
 */
export function mergedColumnMapping() {
    const mapping = { id: 0, player1: 1, player2: 2 };
    for (const colour of GURU_COLORS) {
        mapping[`${colour}Analysis`] = mergedColourColumn(colour, 'analysis');
        mapping[`${colour}Signature`] = mergedColourColumn(colour, 'signature');
    }
    return mapping;
}

/** The last merged column's letter, used to size fetch ranges. */
export function mergedLastColumn() {
    const last = mergedColourColumn(GURU_COLORS[GURU_COLORS.length - 1], 'signature');
    return String.fromCharCode(65 + last);
}
