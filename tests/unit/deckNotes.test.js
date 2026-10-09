/**
 * Tests for the deck-notes grouping and gate helpers.
 *
 * These drive the one-deck-at-a-time gate: a run of consecutive rows that share
 * a decklist and identical editable data must collapse to a single entry that
 * still knows every row to write to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    groupDeckNotes,
    allClocksFilled,
    deckNotesProgress
} from '../../js/domain/deckNotes.js';

// Column indices as resolved from the real header
// (Decklists | Goldfish Clock | Signature | Notes | Additional Notes).
const COLUMN_MAP = {
    decklists: 0,
    goldfishClock: 1,
    goldfishSignature: 2,
    notes: 3,
    additionalNotes: 4
};

const HEADER = ['Decklists', 'Goldfish Clock', 'Signature', 'Notes', 'Additional Notes'];

function group(rows) {
    return groupDeckNotes([HEADER, ...rows], COLUMN_MAP);
}

test('groupDeckNotes collapses an all-empty consecutive run', () => {
    const list = group([
        ['Deck A', '', '', '', ''],
        ['Deck A', '', '', '', ''],
        ['Deck B', '', '', '', '']
    ]);

    assert.equal(list.length, 2);
    assert.equal(list[0].deckString, 'Deck A');
    assert.deepEqual(list[0].rows, [1, 2]);
    assert.equal(list[0].row, 1);
    assert.deepEqual(list[1].rows, [3]);
});

test('groupDeckNotes collapses identical clock+notes runs', () => {
    const list = group([
        ['Deck A', '8.0', 'alice', 'note', 'more'],
        ['Deck A', '8.0', 'bob', 'note', 'more'],
        ['Deck B', '7.0', 'alice', '', '']
    ]);

    assert.equal(list.length, 2);
    assert.deepEqual(list[0].rows, [1, 2]);
    assert.equal(list[0].deckInfo.goldfishClock, '8.0');
    assert.equal(list[0].deckInfo.notes, 'note');
    assert.equal(list[0].deckInfo.additionalNotes, 'more');
    // The goldfish signature is not part of the identity, but both distinct
    // signatures are still surfaced for the hover tooltip.
    assert.deepEqual(list[0].signatures, ['alice', 'bob']);
});

test('groupDeckNotes does not collapse rows whose editable data differs', () => {
    const list = group([
        ['Deck A', '8.0', 'alice', 'one', ''],
        ['Deck A', '9.0', 'alice', 'one', ''],
        ['Deck A', '8.0', 'alice', 'two', '']
    ]);

    assert.equal(list.length, 3);
    assert.deepEqual(list.map(entry => entry.rows), [[1], [2], [3]]);
});

test('groupDeckNotes keeps non-consecutive repeats as separate entries', () => {
    const list = group([
        ['Deck A', '8.0', 'alice', '', ''],
        ['Deck B', '7.0', 'alice', '', ''],
        ['Deck A', '8.0', 'alice', '', '']
    ]);

    assert.equal(list.length, 3);
    assert.deepEqual(list.map(entry => entry.deckString), ['Deck A', 'Deck B', 'Deck A']);
    assert.deepEqual(list[2].rows, [3]);
});

test('groupDeckNotes skips rows with no decklist and omits empty keys', () => {
    const list = group([
        ['Deck A', '8.0', 'alice', '', ''],
        ['', '5.0', '', '', ''],
        ['Deck C', '', '', '', '']
    ]);

    assert.equal(list.length, 2);
    assert.equal(list[0].deckInfo.notes, undefined);
    assert.equal(list[0].deckInfo.additionalNotes, undefined);
    assert.deepEqual(list[1].deckInfo, { row: 3 });
});

test('groupDeckNotes tolerates missing columns', () => {
    const list = groupDeckNotes(
        [HEADER, ['Deck A', '', '', '', '']],
        { decklists: 0, goldfishClock: -1, goldfishSignature: -1, notes: -1, additionalNotes: -1 }
    );

    assert.equal(list.length, 1);
    assert.deepEqual(list[0].deckInfo, { row: 1 });
    assert.deepEqual(list[0].signatures, []);
});

test('allClocksFilled is clocks-only and ignores the signature column', () => {
    const filled = group([['Deck A', '8.0', '', '', '']]);
    const empty = group([['Deck A', '', 'alice', '', '']]);

    assert.equal(allClocksFilled(filled, COLUMN_MAP), true);
    // A signature without a clock does not satisfy the gate.
    assert.equal(allClocksFilled(empty, COLUMN_MAP), false);
    // Missing clock column means there is nothing to gate on.
    assert.equal(allClocksFilled(empty, { ...COLUMN_MAP, goldfishClock: -1 }), true);
});

test('deckNotesProgress counts filled clocks', () => {
    const list = group([
        ['Deck A', '8.0', '', '', ''],
        ['Deck B', '', '', '', ''],
        ['Deck C', '7.0', '', '', '']
    ]);

    assert.deepEqual(deckNotesProgress(list), { filled: 2, total: 3 });
    assert.deepEqual(deckNotesProgress([]), { filled: 0, total: 0 });
});
