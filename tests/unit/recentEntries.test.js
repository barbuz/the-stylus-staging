import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getRecordSpreadsheetId,
    normaliseRecord,
    normaliseRecords
} from '../../js/domain/recentEntries.js';
import { RecentPodsManager } from '../../js/modules/recentPods.js';

test('getRecordSpreadsheetId reads the current spreadsheetId key', () => {
    assert.equal(getRecordSpreadsheetId({ spreadsheetId: 'ABC', title: 'Pod' }), 'ABC');
});

test('getRecordSpreadsheetId falls back to the legacy sheetId key', () => {
    assert.equal(getRecordSpreadsheetId({ sheetId: 'OLD', title: 'Pod' }), 'OLD');
});

test('getRecordSpreadsheetId prefers spreadsheetId when both keys are present', () => {
    assert.equal(getRecordSpreadsheetId({ spreadsheetId: 'NEW', sheetId: 'OLD' }), 'NEW');
});

test('getRecordSpreadsheetId tolerates missing records', () => {
    assert.equal(getRecordSpreadsheetId(null), undefined);
    assert.equal(getRecordSpreadsheetId({}), undefined);
});

test('normaliseRecord promotes a legacy sheetId to spreadsheetId', () => {
    assert.deepEqual(
        normaliseRecord({ sheetId: 'OLD', title: 'Pod', url: 'u', lastAccessed: 1, dateAdded: 2 }),
        { spreadsheetId: 'OLD', title: 'Pod', url: 'u', lastAccessed: 1, dateAdded: 2 }
    );
});

test('normaliseRecord leaves a current record untouched', () => {
    const record = { spreadsheetId: 'NEW', title: 'Pod' };
    assert.equal(normaliseRecord(record), record);
});

test('normaliseRecord keeps spreadsheetId and drops a stale legacy key', () => {
    assert.deepEqual(
        normaliseRecord({ spreadsheetId: 'NEW', sheetId: 'OLD', title: 'Pod' }),
        { spreadsheetId: 'NEW', title: 'Pod' }
    );
});

test('normaliseRecord passes through non-objects', () => {
    const arr = ['a'];
    assert.equal(normaliseRecord(null), null);
    assert.equal(normaliseRecord('nope'), 'nope');
    assert.equal(normaliseRecord(arr), arr);
});

test('normaliseRecords maps a mixed list, accepting old and new records', () => {
    assert.deepEqual(
        normaliseRecords([
            { sheetId: 'OLD', title: 'A' },
            { spreadsheetId: 'NEW', title: 'B' }
        ]),
        [
            { spreadsheetId: 'OLD', title: 'A' },
            { spreadsheetId: 'NEW', title: 'B' }
        ]
    );
});

test('normaliseRecords treats a missing list as empty', () => {
    assert.deepEqual(normaliseRecords(null), []);
    assert.deepEqual(normaliseRecords(undefined), []);
    assert.deepEqual(normaliseRecords({ sheetId: 'OLD' }), []);
});

/**
 * The manager's persistence path, exercised without a DOM. Only the members
 * add/remove touch are stubbed; the id matching under test is the real one.
 */
function managerWith(records) {
    const manager = Object.create(RecentPodsManager.prototype);
    manager.recentPods = records;
    manager.recentHubs = [];
    manager.saved = 0;
    manager.rendered = 0;
    manager.saveRecentPods = async () => { manager.saved++; };
    manager.saveRecentHubs = async () => { manager.saved++; };
    manager.renderRecentPods = () => { manager.rendered++; };
    return manager;
}

test('addRecentPod dedupes a legacy record by its spreadsheet id', async () => {
    const manager = managerWith([
        { sheetId: 'ABC', title: 'Old title', url: 'u', lastAccessed: 1, dateAdded: 2 }
    ]);

    await manager.addRecentPod('ABC', 'New title', 'u');

    assert.equal(manager.recentPods.length, 1);
    assert.equal(manager.recentPods[0].spreadsheetId, 'ABC');
    assert.equal(manager.recentPods[0].title, 'New title');
    // The original dateAdded survives the update.
    assert.equal(manager.recentPods[0].dateAdded, 2);
});

test('addRecentPod writes the current spreadsheetId key', async () => {
    const manager = managerWith([]);

    await manager.addRecentPod('ABC', 'Pod', 'u');

    assert.equal(manager.recentPods[0].spreadsheetId, 'ABC');
    assert.equal(manager.recentPods[0].sheetId, undefined);
});

test('removeRecentPod removes a legacy record by its spreadsheet id', async () => {
    const manager = managerWith([{ sheetId: 'ABC', title: 'Pod' }, { spreadsheetId: 'XYZ' }]);

    await manager.removeRecentPod('ABC');

    assert.deepEqual(manager.recentPods, [{ spreadsheetId: 'XYZ' }]);
});

