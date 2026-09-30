/**
 * Recent-pod / recent-hub record shape.
 *
 * These records are persisted to both localStorage and Drive appData, and the
 * production and preview deployments share an origin, so the same stored file
 * is read by builds of different vintages. New writes therefore use
 * `spreadsheetId`, while reads still accept the legacy `sheetId` key.
 *
 * LEGACY: the `sheetId` fallback exists only to read records written before the
 * id-naming change. Once no such records remain in the wild, delete
 * `LEGACY_ID_KEY` and the fallback and read `record.spreadsheetId` directly.
 */

const LEGACY_ID_KEY = 'sheetId';

/** The record's spreadsheet id, accepting the legacy key on read. */
export function getRecordSpreadsheetId(record) {
    if (!record) return undefined;
    return record.spreadsheetId ?? record[LEGACY_ID_KEY];
}

/** Rewrite a persisted record to the current `spreadsheetId` key. */
export function normaliseRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
    if (!(LEGACY_ID_KEY in record)) return record;

    // LEGACY: promote the old key, or drop it when the new one already wins.
    // Delete this whole branch once legacy data is gone.
    const { [LEGACY_ID_KEY]: legacyId, ...rest } = record;
    return record.spreadsheetId === undefined
        ? { spreadsheetId: legacyId, ...rest }
        : rest;
}

/** Rewrite a persisted list of records to the current `spreadsheetId` key. */
export function normaliseRecords(records) {
    return Array.isArray(records) ? records.map(normaliseRecord) : [];
}
