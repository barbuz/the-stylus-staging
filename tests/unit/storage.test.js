import test from 'node:test';
import assert from 'node:assert/strict';

import { getItem, setItem, removeItem, getJSON, setJSON } from '../../js/services/storage.js';

function installStorage() {
    const previous = globalThis.localStorage;
    const map = new Map();
    globalThis.localStorage = {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: (key) => map.delete(key)
    };
    return {
        map,
        restore() {
            globalThis.localStorage = previous;
        }
    };
}

test('storage: set/get/remove round-trip a string', () => {
    const { restore } = installStorage();
    try {
        setItem('k', 'value');
        assert.equal(getItem('k'), 'value');
        removeItem('k');
        assert.equal(getItem('k'), null);
    } finally {
        restore();
    }
});

test('storage: getItem returns null for a missing key', () => {
    const { restore } = installStorage();
    try {
        assert.equal(getItem('absent'), null);
    } finally {
        restore();
    }
});

test('storage: setItem coerces non-strings', () => {
    const { map, restore } = installStorage();
    try {
        setItem('n', 42);
        assert.equal(map.get('n'), '42');
    } finally {
        restore();
    }
});

test('storage: JSON helpers round-trip values and fall back safely', () => {
    const { restore } = installStorage();
    try {
        setJSON('obj', { a: [1, 2] });
        assert.deepEqual(getJSON('obj'), { a: [1, 2] });

        // Missing key uses the fallback.
        assert.deepEqual(getJSON('missing', []), []);

        // Invalid JSON uses the fallback instead of throwing.
        setItem('bad', '{not json');
        assert.equal(getJSON('bad', 'fallback'), 'fallback');
    } finally {
        restore();
    }
});

test('storage: degrades to a no-op when localStorage is unavailable', () => {
    const previous = globalThis.localStorage;
    delete globalThis.localStorage;
    try {
        assert.equal(getItem('k'), null);
        setItem('k', 'v'); // must not throw
        removeItem('k'); // must not throw
        assert.equal(getJSON('k', 'fallback'), 'fallback');
    } finally {
        globalThis.localStorage = previous;
    }
});

test('storage: a throwing localStorage is swallowed', () => {
    const previous = globalThis.localStorage;
    globalThis.localStorage = {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('blocked'); },
        removeItem() { throw new Error('blocked'); }
    };
    try {
        assert.equal(getItem('k'), null);
        setItem('k', 'v');
        removeItem('k');
    } finally {
        globalThis.localStorage = previous;
    }
});
