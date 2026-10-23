import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizeVersion,
    isValidVersion,
    tagName,
    parseLatestRelease
} from '../../scripts/release.js';

test('release: normalizeVersion strips a leading v and whitespace', () => {
    assert.equal(normalizeVersion(' v2026.10 '), '2026.10');
    assert.equal(normalizeVersion('v2026.10.1'), '2026.10.1');
    assert.equal(normalizeVersion('2026.10'), '2026.10');
    assert.equal(normalizeVersion(undefined), '');
});

test('release: only CalVer YYYY.MM and YYYY.MM.PATCH are valid', () => {
    assert.equal(isValidVersion('2026.10'), true);
    assert.equal(isValidVersion('v2026.10.1'), true);
    assert.equal(isValidVersion('2026.1'), false);
    assert.equal(isValidVersion('1.0.0'), false);
    // The old service-worker token shape must not be mistaken for a release.
    assert.equal(isValidVersion('v20261010d'), false);
    assert.equal(isValidVersion(''), false);
});

test('release: tagName prefixes exactly one v', () => {
    assert.equal(tagName('2026.10'), 'v2026.10');
    assert.equal(tagName('v2026.10'), 'v2026.10');
});

test('release: parseLatestRelease reads the top release heading', () => {
    const changelog = [
        '# Changelog',
        '',
        '## [Unreleased]',
        '',
        '- Work in progress',
        '',
        '## [2026.10] - 2026-10-23',
        '',
        '- Something shipped',
        '',
        '## [2026.09] - 2026-09-28',
        '',
        '- Older'
    ].join('\n');

    assert.deepEqual(parseLatestRelease(changelog), { version: '2026.10', tag: 'v2026.10' });
});

test('release: parseLatestRelease returns null when there is no release heading', () => {
    assert.equal(parseLatestRelease('# Changelog\n\n## [Unreleased]\n'), null);
    assert.equal(parseLatestRelease(''), null);
    assert.equal(parseLatestRelease(undefined), null);
});
