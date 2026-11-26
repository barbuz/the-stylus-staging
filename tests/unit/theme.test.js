import test from 'node:test';
import assert from 'node:assert/strict';

import {
    THEMES,
    THEME_COLOR,
    isTheme,
    resolveTheme,
    nextTheme
} from '../../js/domain/theme.js';

test('an explicit stored choice beats the operating system', () => {
    assert.equal(resolveTheme('light', true), THEMES.LIGHT);
    assert.equal(resolveTheme('dark', false), THEMES.DARK);
});

test('with no choice, the operating system decides', () => {
    assert.equal(resolveTheme(null, true), THEMES.DARK);
    assert.equal(resolveTheme(undefined, false), THEMES.LIGHT);
    assert.equal(resolveTheme('', true), THEMES.DARK);
});

test('an unknown stored value is ignored', () => {
    assert.equal(resolveTheme('sepia', false), THEMES.LIGHT);
    assert.equal(resolveTheme('SEPIA', true), THEMES.DARK);
});

test('toggle flips between exactly the two themes', () => {
    assert.equal(nextTheme(THEMES.LIGHT), THEMES.DARK);
    assert.equal(nextTheme(THEMES.DARK), THEMES.LIGHT);
});

test('only light and dark are themes', () => {
    assert.equal(isTheme('light'), true);
    assert.equal(isTheme('dark'), true);
    assert.equal(isTheme('auto'), false);
    assert.equal(isTheme(null), false);
});

test('each theme has a browser-chrome colour', () => {
    assert.match(THEME_COLOR[THEMES.LIGHT], /^#[0-9a-f]{6}$/);
    assert.match(THEME_COLOR[THEMES.DARK], /^#[0-9a-f]{6}$/);
    assert.notEqual(THEME_COLOR[THEMES.LIGHT], THEME_COLOR[THEMES.DARK]);
});
