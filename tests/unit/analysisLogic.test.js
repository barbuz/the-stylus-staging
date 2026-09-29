import test from 'node:test';
import assert from 'node:assert/strict';

import {
    calculateOutcomeFromAnalyses,
    normalizeAnalysisForComparison,
    getGuruAnalysisValues,
    getAnalysisClass,
    formatAnalysisValue,
    getAnalysisLabel,
    getOutcomeDisplayName,
    buildCorrectionString
} from '../../js/domain/analyses.js';
import {
    getCurrentColorAnalysis,
    getCurrentColorSignature,
    setColourAnalysis,
    setColourSignature,
    colourField,
    colourLabel,
    emptyColumnIndex,
    buildColumnIndex,
    getCurrentGuruColIndex,
    getGuruColorInRow,
    GURU_COLORS,
    DEFAULT_GURU_COLOUR,
    guruSheetName,
    colourFromSheetTitle,
    isGuruSheetTitle,
    mergedGuruHeader,
    mergedColumnMapping,
    mergedLastColumn
} from '../../js/domain/guruColor.js';
import {
    findColumnIndex,
    buildMatchRows,
    rowHasCurrentGuruSignature,
    rowHasCurrentGuruSignatureInColor,
    rowHasEmptySignature,
    hasCurrentColorResult,
    rowHasDiscrepancy,
    rowHasMyDiscrepancy,
    allGurusHaveMatchingResults,
    isMatchAvailableForAnalysis,
    isCurrentMatchAvailableForAnalysis,
    isAnalysisComplete,
    findFirstEmptyAnalysis,
    findFirstDiscrepancy,
    findNextDeck,
    findMirrorMatchIndex,
    getDeckStats
} from '../../js/domain/matchRows.js';
import { isInverseErrorSuspected, isOutcomeValueValidForInverse } from '../../js/domain/inverseCheck.js';

import { AnalysisController } from '../../js/ui/analysisController.js';
import { AppState } from '../../js/app/appState.js';
import { makeMergedGuruSheet, makeSheetData } from '../fixtures/sheetData.js';

/**
 * These tests exercise the pure domain layer directly. Only processDeckNotes is
 * still reached through AnalysisController, because it was not part of the
 * Phase 1 extraction; that scaffolding borrows the prototype rather than
 * constructing an instance, since the constructor calls bindEvents() and needs
 * a DOM.
 */
function logic() {
    return Object.create(AnalysisController.prototype);
}

// --- Scoring: calculateOutcomeFromAnalyses -----------------------------------

test('outcome is the agreed value when all three gurus match', () => {
    assert.equal(calculateOutcomeFromAnalyses('1', '1', '1'), '1');
    assert.equal(calculateOutcomeFromAnalyses('0.5', '0.5', '0.5'), '0.5');
    assert.equal(calculateOutcomeFromAnalyses('0', '0', '0'), '0');
});

test('outcome is Incomplete when any guru has not scored', () => {
    assert.equal(calculateOutcomeFromAnalyses('1', '', '1'), 'Incomplete');
    assert.equal(calculateOutcomeFromAnalyses('', '', ''), 'Incomplete');
    assert.equal(calculateOutcomeFromAnalyses('1', '1', undefined), 'Incomplete');
});

test('outcome is Discrepancy when gurus disagree', () => {
    assert.equal(calculateOutcomeFromAnalyses('1', '0.5', '0'), 'Discrepancy');
    assert.equal(calculateOutcomeFromAnalyses('1', '0', '0'), 'Discrepancy');
});

test('outcome ignores surrounding whitespace', () => {
    assert.equal(calculateOutcomeFromAnalyses(' 1 ', '1', ' 1'), '1');
    assert.equal(calculateOutcomeFromAnalyses(' ', '', ''), 'Incomplete');
});

test('outcome compares raw strings, so formatted variants are a discrepancy', () => {
    // Characterization: '1.0' and '1' are both Win but are treated as different
    // analyses because comparison happens before normalisation.
    assert.equal(calculateOutcomeFromAnalyses('1.0', '1', '1'), 'Discrepancy');
});

// --- Normalisation -----------------------------------------------------------

test('normalizeAnalysisForComparison collapses equivalent numeric formats', () => {
    assert.equal(normalizeAnalysisForComparison('1.0'), '1');
    assert.equal(normalizeAnalysisForComparison(1), '1');
    assert.equal(normalizeAnalysisForComparison('0.50'), '0.5');
    assert.equal(normalizeAnalysisForComparison(' Discrepancy '), 'discrepancy');
    assert.equal(normalizeAnalysisForComparison(''), '');
    assert.equal(normalizeAnalysisForComparison(null), '');
    assert.equal(normalizeAnalysisForComparison(undefined), '');
});

test('getGuruAnalysisValues always returns three slots', () => {
    assert.deepEqual(getGuruAnalysisValues({ redAnalysis: '1', blueAnalysis: '', greenAnalysis: '0' }), ['1', '', '0']);
    assert.deepEqual(getGuruAnalysisValues({}), ['', '', '']);
    assert.deepEqual(getGuruAnalysisValues(null), []);
});

test('allGurusHaveMatchingResults requires three present, equal analyses', () => {
    assert.equal(allGurusHaveMatchingResults({ redAnalysis: '1', blueAnalysis: '1.0', greenAnalysis: '1' }), true);
    assert.equal(allGurusHaveMatchingResults({ redAnalysis: '1', blueAnalysis: '1', greenAnalysis: '' }), false);
    assert.equal(allGurusHaveMatchingResults({ redAnalysis: '1', blueAnalysis: '0', greenAnalysis: '1' }), false);
});

// --- Column detection --------------------------------------------------------

test('findColumnIndex matches case-insensitively on substrings', () => {
    const header = ['ID', 'Player 1', 'Player 2', 'Red Analysis', 'Red Signature'];
    assert.equal(findColumnIndex(header, ['Player 1', 'Player1']), 1);
    assert.equal(findColumnIndex(header, ['red analysis']), 3);
    assert.equal(findColumnIndex(header, ['Missing']), -1);
});

test('findColumnIndex falls back to later aliases and skips blank headers', () => {
    const header = ['ID', 'Player1', ''];
    assert.equal(findColumnIndex(header, ['Player 1', 'Player1']), 1);
    assert.equal(findColumnIndex([null, undefined, ''], ['Player 1']), -1);
});

// --- Row parsing -------------------------------------------------------------

test('buildMatchRows maps columns and computes outcomes', () => {
    const sheet = makeMergedGuruSheet([
        ['1', 'Deck A', 'Deck B', '1', 'alice', '1', 'bob', '1', 'carol'],
        ['2', 'Deck A', 'Deck C', '0', 'alice', '', '', '', '']
    ]);

    const { rows, columnIndices } = buildMatchRows(sheet, 0, 'red', '');

    assert.equal(rows.length, 2);
    assert.equal(columnIndices.redAnalysis, 3);
    assert.equal(columnIndices.greenSignature, 8);
    assert.deepEqual(rows[0], {
        sheetIndex: 0,
        sheetTitle: 'Merged Gurus',
        sheetId: sheet.sheetId,
        rowIndex: 1,
        player1: 'Deck A',
        player2: 'Deck B',
        outcomeValue: '1',
        redAnalysis: '1',
        blueAnalysis: '1',
        greenAnalysis: '1',
        redSignature: 'alice',
        blueSignature: 'bob',
        greenSignature: 'carol',
        originalRowIndex: 1
    });
    assert.equal(rows[1].outcomeValue, 'Incomplete');
});

test('buildMatchRows skips rows with no player data', () => {
    const sheet = makeMergedGuruSheet([
        ['1', '', '', '', '', '', '', '', ''],
        ['2', 'Deck A', 'Deck B', '1', '', '1', '', '1', '']
    ]);

    const { rows } = buildMatchRows(sheet, 0, 'red', '');

    assert.equal(rows.length, 1);
    assert.equal(rows[0].player1, 'Deck A');
});

test('buildMatchRows throws a helpful error when columns are missing', () => {
    const sheet = { title: 'Merged Gurus', sheetId: 1, values: [['ID', 'Player 1']] };

    assert.throws(() => buildMatchRows(sheet, 0, 'red', ''), /required columns are missing/);
});

test('buildMatchRows counts my discrepancies only for claimed rows', () => {
    const sheet = makeMergedGuruSheet([
        // Discrepancy on a row alice has claimed and scored.
        ['1', 'Deck A', 'Deck B', '1', 'alice', '0', 'bob', '0', 'carol'],
        // Discrepancy on a row alice has NOT claimed.
        ['2', 'Deck C', 'Deck D', '1', '', '0', 'bob', '0', 'carol'],
        // No discrepancy.
        ['3', 'Deck E', 'Deck F', '1', 'alice', '1', 'bob', '1', 'carol']
    ]);

    const { numDiscrepancies } = buildMatchRows(sheet, 0, 'red', 'alice');

    assert.equal(numDiscrepancies, 1);
});

// --- Deck notes parsing ------------------------------------------------------

test('processDeckNotes builds a map keyed by decklist', () => {
    const sheetData = makeSheetData({
        deckNotesRows: [
            ['Deck A | Deck B', '5', 'alice', 'some notes', 'more notes'],
            ['Deck C', '', '', '', ''],
            ['', '1', '', '', '']
        ]
    });
    const instance = logic();

    const result = instance.processDeckNotes(sheetData);

    assert.equal(result.columnMap.decklists, 0);
    assert.equal(result.deckNotesMap.size, 2);
    assert.deepEqual(result.deckNotesMap.get('Deck A | Deck B'), {
        row: 1,
        goldfishClock: '5',
        goldfishSignature: 'alice',
        notes: 'some notes',
        additionalNotes: 'more notes'
    });
    assert.deepEqual(result.deckNotesMap.get('Deck C'), { row: 2 });
});

// --- Row predicates ----------------------------------------------------------

test('rowHasCurrentGuruSignature / InColor / rowHasEmptySignature', () => {
    const row = { redSignature: 'alice', blueSignature: 'bob', greenSignature: '' };
    const anonymous = 'anon';

    assert.equal(rowHasCurrentGuruSignature(row, anonymous), false);
    assert.equal(rowHasCurrentGuruSignatureInColor(row, 'red', anonymous), false);
    assert.equal(rowHasCurrentGuruSignature(row, 'alice'), true);
    assert.equal(rowHasCurrentGuruSignatureInColor(row, 'red', 'alice'), true);
    assert.equal(rowHasEmptySignature(row, 'red'), false);
    assert.equal(rowHasCurrentGuruSignature(row, 'bob'), true);
    assert.equal(rowHasEmptySignature(row, 'blue'), false);
    assert.equal(rowHasEmptySignature(row, 'green'), true);
});

test('getGuruColorInRow reports which colour the guru claimed', () => {
    assert.equal(getGuruColorInRow({ redSignature: '', blueSignature: 'alice', greenSignature: '' }, 'alice'), 'blue');
    assert.equal(getGuruColorInRow({ redSignature: 'alice' }, 'alice'), 'red');
    assert.equal(getGuruColorInRow({ redSignature: 'bob' }, 'alice'), null);
});

test('isMatchAvailableForAnalysis covers claimed, unclaimed and done rows', () => {
    const signature = 'alice';
    assert.equal(isMatchAvailableForAnalysis({ redSignature: '', redAnalysis: '' }, 'red', signature), true);
    assert.equal(isMatchAvailableForAnalysis({ redSignature: 'alice', redAnalysis: '' }, 'red', signature), true);
    assert.equal(isMatchAvailableForAnalysis({ redSignature: 'alice', redAnalysis: '1' }, 'red', signature), false);
    assert.equal(isMatchAvailableForAnalysis({ redSignature: 'bob', redAnalysis: '' }, 'red', signature), false);
});

test('isCurrentMatchAvailableForAnalysis guards the selection', () => {
    const rows = [{ redSignature: '', redAnalysis: '' }];
    assert.equal(isCurrentMatchAvailableForAnalysis(rows, 'red', 'alice', 0), true);
    assert.equal(isCurrentMatchAvailableForAnalysis(rows, 'red', 'alice', -1), false);
    assert.equal(isCurrentMatchAvailableForAnalysis(rows, 'red', 'alice', 5), false);
});

test('rowHasDiscrepancy detects disagreement and the Discrepancy outcome', () => {
    assert.equal(rowHasDiscrepancy({ outcomeValue: 'Discrepancy' }), true);
    assert.equal(rowHasDiscrepancy({ redAnalysis: '1', blueAnalysis: '0', greenAnalysis: '0' }), true);
    assert.equal(rowHasDiscrepancy({ redAnalysis: '1', blueAnalysis: '1', greenAnalysis: '1' }), false);
    // Characterization: two present-but-differing analyses already count as a
    // discrepancy, even though calculateOutcomeFromAnalyses still calls the row
    // Incomplete because the third guru has not scored.
    assert.equal(rowHasDiscrepancy({ redAnalysis: '1', blueAnalysis: '0', greenAnalysis: '' }), true);
    // A single (or no) analysis cannot disagree with itself.
    assert.equal(rowHasDiscrepancy({ redAnalysis: '1' }), false);
    assert.equal(rowHasDiscrepancy({}), false);
});

test('rowHasMyDiscrepancy requires claim, result and disagreement', () => {
    assert.equal(rowHasMyDiscrepancy({
        redAnalysis: '1', blueAnalysis: '0', greenAnalysis: '0', redSignature: 'alice'
    }, 'red', 'alice'), true);
    assert.equal(rowHasMyDiscrepancy({
        redAnalysis: '1', blueAnalysis: '0', greenAnalysis: '0', redSignature: 'bob'
    }, 'red', 'alice'), false);
});

test('hasCurrentColorResult only counts the selected colour', () => {
    const row = { redAnalysis: '1', blueAnalysis: '' };
    assert.equal(Boolean(hasCurrentColorResult(row, 'red')), true);
    assert.equal(Boolean(hasCurrentColorResult(row, 'blue')), false);
});

test('isAnalysisComplete needs every row scored and at least one row', () => {
    assert.equal(isAnalysisComplete([{ redAnalysis: '1' }, { redAnalysis: '0' }], 'red'), true);
    assert.equal(isAnalysisComplete([{ redAnalysis: '1' }, { redAnalysis: '' }], 'red'), false);
    assert.equal(isAnalysisComplete([], 'red'), false);
});

test('findFirstEmptyAnalysis prefers my claimed rows, then unclaimed ones', () => {
    const signature = 'alice';
    const rows = [
        { redSignature: 'bob', redAnalysis: '' },
        { redSignature: 'alice', redAnalysis: '' },
        { redSignature: '', redAnalysis: '' }
    ];
    assert.equal(findFirstEmptyAnalysis(rows, 'red', signature), 1);
    // With no claimed row left, the unclaimed row is the target.
    assert.equal(findFirstEmptyAnalysis([rows[0], rows[2]], 'red', signature), 1);
    assert.equal(findFirstEmptyAnalysis([{ redSignature: 'bob', redAnalysis: '' }], 'red', signature), null);
});

test('findFirstDiscrepancy wraps and returns -1 when clean', () => {
    const signature = 'alice';
    const rows = [
        { redSignature: 'alice', redAnalysis: '1', blueAnalysis: '0', greenAnalysis: '0' },
        { redSignature: 'alice', redAnalysis: '1', blueAnalysis: '1', greenAnalysis: '1' }
    ];
    assert.equal(findFirstDiscrepancy(rows, 'red', signature, 1), 0);
    assert.equal(findFirstDiscrepancy(rows, 'red', signature, 0), 0);
    assert.equal(findFirstDiscrepancy([rows[1]], 'red', signature), -1);
});

test('findNextDeck finds a different unclaimed P1 deck and falls back', () => {
    const rows = [
        { player1: 'Deck A', redSignature: 'alice' },
        { player1: 'Deck A', redSignature: '' },
        { player1: 'Deck B', redSignature: 'bob' },
        { player1: 'Deck C', redSignature: '' }
    ];
    assert.equal(findNextDeck(rows, 'red', 0), 3);
    // No different unclaimed deck: stay put.
    assert.equal(findNextDeck([rows[0], rows[1]], 'red', 0), 0);
});

// --- Navigation --------------------------------------------------------------

test('findMirrorMatchIndex finds the swapped-fixture row', () => {
    const rows = [
        { player1: 'A', player2: 'B' },
        { player1: 'C', player2: 'D' },
        { player1: 'B', player2: 'A' }
    ];
    assert.equal(findMirrorMatchIndex(rows, 0), 2);
    assert.equal(findMirrorMatchIndex(rows, 1), -1);
    assert.equal(findMirrorMatchIndex(rows, 99), -1);
    assert.equal(findMirrorMatchIndex(rows, -1), -1);
});

test('inverse error is suspected when one side is Loss and neither is Win', () => {
    const rows = [
        { outcomeValue: '0' }, { outcomeValue: '0' },   // both Loss -> suspected
        { outcomeValue: '1' }, { outcomeValue: '0' },   // 1/0 -> fine
        { outcomeValue: '0.5' }, { outcomeValue: '0' }  // tie/loss -> suspected
    ];
    const findMirror = index => (index % 2 === 0 ? index + 1 : index - 1);

    assert.equal(isInverseErrorSuspected(rows, 0, findMirror), true);
    assert.equal(isInverseErrorSuspected(rows, 2, findMirror), false);
    assert.equal(isInverseErrorSuspected(rows, 4, findMirror), true);
});

test('inverse checks are skipped for non-numeric outcomes', () => {
    assert.equal(isOutcomeValueValidForInverse('Discrepancy'), false);
    assert.equal(isOutcomeValueValidForInverse('Incomplete'), false);
    assert.equal(isOutcomeValueValidForInverse(''), false);
    assert.equal(isOutcomeValueValidForInverse('1'), true);

    const rows = [
        { player1: 'A', player2: 'B', outcomeValue: 'Discrepancy' },
        { player1: 'B', player2: 'A', outcomeValue: '0' }
    ];
    const findMirror = index => (index === 0 ? 1 : 0);
    assert.equal(isInverseErrorSuspected(rows, 0, findMirror), false);
});

// --- Display formatting ------------------------------------------------------

test('getOutcomeDisplayName maps values to labels', () => {
    assert.equal(getOutcomeDisplayName('1'), 'Win');
    assert.equal(getOutcomeDisplayName('0.5'), 'Tie');
    assert.equal(getOutcomeDisplayName('0'), 'Loss');
    assert.equal(getOutcomeDisplayName('Discrepancy'), 'Discrepancy');
    assert.equal(getOutcomeDisplayName(''), '');
    assert.equal(getOutcomeDisplayName('0.25'), 'Custom (0.25)');
});

test('getAnalysisClass exposes css class names', () => {
    assert.equal(getAnalysisClass('1'), 'win');
    assert.equal(getAnalysisClass('0.5'), 'tie');
    assert.equal(getAnalysisClass('0'), 'loss');
    assert.equal(getAnalysisClass(''), 'other');
    assert.equal(getAnalysisClass('Discrepancy'), 'other');
});

test('formatAnalysisValue is human readable', () => {
    assert.equal(formatAnalysisValue('1'), 'Win (1.0)');
    assert.equal(formatAnalysisValue('0.5'), 'Tie (0.5)');
    assert.equal(formatAnalysisValue('0'), 'Loss (0.0)');
    assert.equal(formatAnalysisValue(''), 'Not set');
});

test('getAnalysisLabel maps values to short labels', () => {
    assert.equal(getAnalysisLabel(1.0), 'Win');
    assert.equal(getAnalysisLabel(0.5), 'Tie');
    assert.equal(getAnalysisLabel(0.0), 'Loss');
    assert.equal(getAnalysisLabel('Discrepancy'), 'Discrepancy');
});

test('buildCorrectionString reports the disagreement as W/T/L', () => {
    const row = { redAnalysis: '1', blueAnalysis: '0.5', greenAnalysis: '0' };
    assert.equal(buildCorrectionString(row, '0'), '\n\nW/T -> L');
    // Agreeing analyses need no correction.
    assert.equal(buildCorrectionString({ redAnalysis: '1', blueAnalysis: '1', greenAnalysis: '1' }, '1'), '');
    // Nothing to correct when this guru has not scored.
    assert.equal(buildCorrectionString(row, ''), '');
});

test('getCurrentGuruColIndex maps colour and type to column indices', () => {
    const columnIndex = {
        red: { analysis: 3, signature: 4 },
        blue: { analysis: 5, signature: 6 },
        green: { analysis: 7, signature: 8 }
    };
    assert.equal(getCurrentGuruColIndex('green', columnIndex, 'analysis'), 7);
    assert.equal(getCurrentGuruColIndex('green', columnIndex, 'signature'), 8);
    assert.equal(getCurrentGuruColIndex('green', columnIndex), 7);
});

test('getCurrentGuruColIndex returns -1 for unknown inputs', () => {
    const columnIndex = { red: { analysis: 3 } };
    assert.equal(getCurrentGuruColIndex('purple', columnIndex, 'analysis'), -1);
    assert.equal(getCurrentGuruColIndex('red', columnIndex, 'nonsense'), -1);
});

test('buildColumnIndex / emptyColumnIndex keep the per-colour shape', () => {
    assert.deepEqual(emptyColumnIndex(), {
        red: { analysis: -1, signature: -1 },
        blue: { analysis: -1, signature: -1 },
        green: { analysis: -1, signature: -1 }
    });

    const built = buildColumnIndex({
        redAnalysis: 3, blueAnalysis: 5, greenAnalysis: 7,
        redSignature: 4, blueSignature: 6, greenSignature: 8
    });
    assert.deepEqual(built, {
        red: { analysis: 3, signature: 4 },
        blue: { analysis: 5, signature: 6 },
        green: { analysis: 7, signature: 8 }
    });
});

test('colourField / colourLabel derive names from the colour', () => {
    assert.equal(colourField('red', 'analysis'), 'redAnalysis');
    assert.equal(colourField('green', 'signature'), 'greenSignature');
    assert.equal(colourField('purple', 'analysis'), null);
    assert.equal(colourField('red', 'nonsense'), null);
    assert.equal(colourLabel('blue'), 'Blue');
    assert.equal(colourLabel(null), '');
});

// --- Colour access -----------------------------------------------------------

test('getCurrentColorAnalysis / Signature select the colour column', () => {
    const row = {
        redAnalysis: '1', blueAnalysis: '0.5', greenAnalysis: '0',
        redSignature: 'alice', blueSignature: 'bob', greenSignature: 'carol'
    };
    assert.equal(getCurrentColorAnalysis(row, 'blue'), '0.5');
    assert.equal(getCurrentColorSignature(row, 'blue'), 'bob');
    assert.equal(getCurrentColorAnalysis(row, 'purple'), '');
    assert.equal(getCurrentColorSignature(row, 'purple'), '');
});

test('setColourAnalysis / setColourSignature write the right field', () => {
    const row = {};
    setColourAnalysis(row, 'blue', '1');
    setColourSignature(row, 'green', 'bob');
    assert.equal(row.blueAnalysis, '1');
    assert.equal(row.greenSignature, 'bob');
    // Unknown colour is a no-op and does not add stray fields.
    setColourAnalysis(row, 'purple', '1');
    assert.equal(row.purpleAnalysis, undefined);
});

// --- Thread id helpers -------------------------------------------------------

test('getRowThreadId prefers rowIndex, then originalRowIndex, then position', () => {
    const instance = logic();
    assert.equal(instance.getRowThreadId({ rowIndex: 7, originalRowIndex: 2 }, 0), 7);
    assert.equal(instance.getRowThreadId({ originalRowIndex: 4 }, 0), 4);
    assert.equal(instance.getRowThreadId({}, 0), 1);
    assert.equal(instance.getRowThreadId(null, 9), 10);
});

test('hasDiscordThreadForRow copes with a missing thread map', () => {
    const instance = logic();
    assert.equal(instance.hasDiscordThreadForRow(null, { rowIndex: 1 }, 0), false);
    assert.equal(instance.hasDiscordThreadForRow({ has: () => true }, { rowIndex: 1 }, 0), true);
    assert.equal(instance.hasDiscordThreadForRow(new Map([[1, 'thread']]), { rowIndex: 1 }, 0), true);
});

// --- Colour detection from sheet ---------------------------------------------

/** A fake controller carrying just the session state the method reads. */
function controllerWithSignature(signature) {
    const instance = logic();
    instance.state = new AppState();
    instance.state.setSignature(signature);
    instance.state.setRowIndex(-1);
    return instance;
}

test('determineGuruColorFromSheet finds the colour a signature is claimed under', () => {
    const sheetData = makeSheetData({ guruRows: [
        ['1', 'Deck A', 'Deck B', '1', 'bob', '1', 'alice', '1', 'carol']
    ]});
    assert.equal(controllerWithSignature('alice').determineGuruColorFromSheet(sheetData), 'blue');
});

test('determineGuruColorFromSheet defaults to red without a signature', () => {
    assert.equal(controllerWithSignature('').determineGuruColorFromSheet(makeSheetData({ guruRows: [] })), 'red');
});

test('determineGuruColorFromSheet throws when the signature is nowhere', () => {
    const sheetData = makeSheetData({ guruRows: [
        ['1', 'Deck A', 'Deck B', '1', 'bob', '1', 'bob', '1', 'bob']
    ]});
    assert.throws(
        () => controllerWithSignature('nobody').determineGuruColorFromSheet(sheetData),
        /not found in any analysis column/
    );
});

// --- Statistics --------------------------------------------------------------

test('getDeckStats counts matches sharing the current player deck', () => {
    const rows = [
        { player1: 'Deck A', redSignature: 'alice' },
        { player1: 'Deck A', redSignature: '' },
        { player1: 'Deck A', redSignature: 'bob' },
        { player1: 'Deck B', redSignature: '' }
    ];
    assert.deepEqual(getDeckStats(rows, 'red', 0), { totalMatches: 3, unclaimedMatches: 1 });
});

test('getDeckStats is safe with no selection', () => {
    assert.deepEqual(getDeckStats([{ player1: 'Deck A' }], 'red', -1), { totalMatches: 0, unclaimedMatches: 0 });
});

// --- Discrepancy display -----------------------------------------------------
//
// buildDiscrepancyDisplay was confirmed unused (no callers) and removed in
// phase 3. The discrepancy *data* is still exercised by rowHasDiscrepancy /
// rowHasMyDiscrepancy above.

// --- Colour registry: sheet naming and merged layout -------------------------
//
// These pin the derivation, not just the current values: the point of the
// registry is that the sheet schema follows GURU_COLORS.

test('registry: guru sheet names and title matching follow GURU_COLORS', () => {
    assert.deepEqual(GURU_COLORS.map(guruSheetName), ['Red Gurus', 'Blue Gurus', 'Green Gurus']);
    assert.equal(DEFAULT_GURU_COLOUR, 'red');
    assert.equal(colourFromSheetTitle('Red Gurus'), 'red');
    assert.equal(colourFromSheetTitle('blue gurus'), 'blue');
    assert.equal(colourFromSheetTitle('Deck Notes'), null);
    assert.equal(colourFromSheetTitle(''), null);
    assert.equal(isGuruSheetTitle('Green Gurus'), true);
    assert.equal(isGuruSheetTitle('Metadata'), false);
});

test('registry: merged header is one analysis/signature pair per colour, in order', () => {
    assert.deepEqual(mergedGuruHeader(), [
        'Red Analysis', 'Red Signature',
        'Blue Analysis', 'Blue Signature',
        'Green Analysis', 'Green Signature'
    ]);
});

test('registry: merged column mapping matches the real 9-column layout', () => {
    assert.deepEqual(mergedColumnMapping(), {
        id: 0, player1: 1, player2: 2,
        redAnalysis: 3, redSignature: 4,
        blueAnalysis: 5, blueSignature: 6,
        greenAnalysis: 7, greenSignature: 8
    });
    assert.equal(mergedLastColumn(), 'I');
});
