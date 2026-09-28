import test from 'node:test';
import assert from 'node:assert/strict';

import { isValidGoogleSheetsUrl, extractSheetId, sanitizeUrlParam, deploymentForPath, alternateDeploymentUrl, resolveDeploymentRedirect } from '../../js/utils/urlUtils.js';
import { podNameToCode, podCodeToName } from '../../js/utils/podUtils.js';
import { ANALYSIS_VALUES, STATUS_TYPES } from '../../js/utils/constants.js';
import { DEPLOYMENTS } from '../../js/config.js';

test('urlUtils: isValidGoogleSheetsUrl', () => {
    assert.equal(isValidGoogleSheetsUrl('https://docs.google.com/spreadsheets/d/ABC123/edit'), true);
    assert.equal(isValidGoogleSheetsUrl('https://docs.google.com/spreadsheets/d/ABC-1_2'), true);
    assert.equal(isValidGoogleSheetsUrl('https://example.com/spreadsheets/d/ABC'), false);
    assert.equal(isValidGoogleSheetsUrl('http://docs.google.com/spreadsheets/d/ABC'), false);
    assert.equal(isValidGoogleSheetsUrl(''), false);
});

test('urlUtils: extractSheetId', () => {
    assert.equal(extractSheetId('https://docs.google.com/spreadsheets/d/ABC-123_x/edit#gid=0'), 'ABC-123_x');
    assert.equal(extractSheetId('ABC-123_x'), 'ABC-123_x');
    assert.equal(extractSheetId('https://example.com/not-a-sheet'), null);
    assert.equal(extractSheetId(''), null);
    assert.equal(extractSheetId(null), null);
});

test('urlUtils: sanitizeUrlParam strips Discord-style trailing junk', () => {
    assert.equal(sanitizeUrlParam('ABC-123),'), 'ABC-123');
    assert.equal(sanitizeUrlParam('  ABC-123  '), 'ABC-123');
    assert.equal(sanitizeUrlParam('ABC-123),)'), 'ABC-123');
    assert.equal(sanitizeUrlParam(null), null);
    assert.equal(sanitizeUrlParam(undefined), null);
    assert.equal(sanitizeUrlParam(''), '');
});

test('podUtils: podNameToCode', () => {
    assert.equal(podNameToCode('Aspirant II'), 'A II');
    assert.equal(podNameToCode('Exemplar'), 'E');
    assert.equal(podNameToCode('Novice I'), 'N I');
    assert.equal(podNameToCode('  contender   iii  '), 'C iii');
    assert.throws(() => podNameToCode('A B C'), /too many words/);
    assert.throws(() => podNameToCode(''), /non-empty string/);
    assert.throws(() => podNameToCode(null), /non-empty string/);
});

test('podUtils: podCodeToName', () => {
    assert.equal(podCodeToName('A II'), 'Aspirant II');
    assert.equal(podCodeToName('E'), 'Exemplar');
    assert.equal(podCodeToName('n i'), 'Novice i');
    assert.throws(() => podCodeToName('X I'), /Unknown pod code prefix/);
});

test('constants: analysis values are the scoring contract', () => {
    assert.deepEqual(ANALYSIS_VALUES, { WIN: 1.0, TIE: 0.5, LOSS: 0.0 });
    assert.equal(STATUS_TYPES.ERROR, 'error');
});

test('urlUtils: deploymentForPath matches deployments by directory', () => {
    assert.equal(deploymentForPath('/the-stylus/', DEPLOYMENTS), 'production');
    assert.equal(deploymentForPath('/the-stylus', DEPLOYMENTS), 'production');
    assert.equal(deploymentForPath('/the-stylus/index.html', DEPLOYMENTS), 'production');
    assert.equal(deploymentForPath('/the-stylus-staging/', DEPLOYMENTS), 'preview');
    assert.equal(deploymentForPath('/the-stylus-staging/index.html', DEPLOYMENTS), 'preview');
    assert.equal(deploymentForPath('/', DEPLOYMENTS), null);
    assert.equal(deploymentForPath('/somewhere-else/', DEPLOYMENTS), null);
});

test('urlUtils: alternateDeploymentUrl flips deployment and keeps the query', () => {
    assert.equal(
        alternateDeploymentUrl('/the-stylus/', '?pod=ABC&match=3', DEPLOYMENTS),
        '/the-stylus-staging/?pod=ABC&match=3'
    );
    assert.equal(
        alternateDeploymentUrl('/the-stylus-staging/', '', DEPLOYMENTS),
        '/the-stylus/'
    );
    assert.equal(alternateDeploymentUrl('/unknown/', '', DEPLOYMENTS), null);
});

test('urlUtils: resolveDeploymentRedirect redirects deep links to the preference', () => {
    // A preview preference sends a production pod link to preview.
    assert.equal(
        resolveDeploymentRedirect('/the-stylus/', '?pod=ABC', 'preview', DEPLOYMENTS),
        '/the-stylus-staging/?pod=ABC'
    );
    // A production preference sends a preview pod link back to production.
    assert.equal(
        resolveDeploymentRedirect('/the-stylus-staging/', '?hub=H1', 'production', DEPLOYMENTS),
        '/the-stylus/?hub=H1'
    );
    // Already on the preferred deployment: no redirect, so it cannot loop.
    assert.equal(resolveDeploymentRedirect('/the-stylus/', '?pod=ABC', 'production', DEPLOYMENTS), null);
});

test('urlUtils: resolveDeploymentRedirect leaves ordinary visitors alone', () => {
    // No preference: a shared production link must not bounce anywhere.
    assert.equal(resolveDeploymentRedirect('/the-stylus/', '?pod=ABC', null, DEPLOYMENTS), null);
    // Unknown preference values are ignored.
    assert.equal(resolveDeploymentRedirect('/the-stylus/', '?pod=ABC', 'banana', DEPLOYMENTS), null);
    // Bare entry links (home screen) are never rewritten, even with a preference.
    assert.equal(resolveDeploymentRedirect('/the-stylus/', '', 'preview', DEPLOYMENTS), null);
    assert.equal(resolveDeploymentRedirect('/the-stylus/', '?foo=1', 'preview', DEPLOYMENTS), null);
    // Unrecognised paths (local development) never redirect.
    assert.equal(resolveDeploymentRedirect('/', '?pod=ABC', 'preview', DEPLOYMENTS), null);
});
