import test from 'node:test';
import assert from 'node:assert/strict';

import { GuruSignature } from '../../js/modules/guruSignature.js';

/**
 * GuruSignature touches the DOM and localStorage for its UI feedback. The tests
 * only care about ownership and persistence, so a tiny fake DOM records the
 * elements it asks for and a fake localStorage records writes.
 */
function makeElement(id = '') {
    return {
        id,
        value: '',
        textContent: '',
        style: {},
        children: [],
        addEventListener() {},
        appendChild(child) { this.children.push(child); },
        focus() {},
        select() {}
    };
}

function installGlobals() {
    const previous = {
        document: globalThis.document,
        localStorage: globalThis.localStorage,
        setTimeout: globalThis.setTimeout
    };

    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
    };

    globalThis.document = {
        getElementById: (id) => (id === 'guru-signature-section' || id === 'guru-signature' ||
            id === 'guru-display-name' || id === 'guru-info' || id === 'sheet-input-section' ||
            id === 'set-signature-btn' || id === 'change-signature-btn') ? element(id) : null,
        createElement: () => makeElement()
    };

    const storage = new Map();
    globalThis.localStorage = {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key)
    };

    // showError schedules a hide; keep the timer out of the test loop.
    globalThis.setTimeout = () => 0;

    return {
        element,
        storage,
        restore() {
            globalThis.document = previous.document;
            globalThis.localStorage = previous.localStorage;
            globalThis.setTimeout = previous.setTimeout;
        }
    };
}

function makeUserPreferences({ signature = '' } = {}) {
    return {
        stored: signature,
        writes: [],
        async getGuruSignature() { return this.stored; },
        async setGuruSignature(value) {
            this.stored = value;
            this.writes.push(value);
        }
    };
}

test('initSignature adopts the persisted value from the single owner', async () => {
    const env = installGlobals();
    try {
        const prefs = makeUserPreferences({ signature: 'alice' });
        const owner = new GuruSignature({ userPreferences: prefs, renderAuthSection() {} });
        const seen = [];
        owner.onSignatureSet((value) => seen.push(value));

        await owner.initSignature();

        assert.equal(owner.getSignature(), 'alice');
        assert.equal(owner.hasSignature(), true);
        assert.deepEqual(seen, ['alice']);
        assert.equal(env.element('guru-display-name').textContent, 'alice');
    } finally {
        env.restore();
    }
});

test('initSignature with nothing persisted shows the signature section', async () => {
    const env = installGlobals();
    try {
        const owner = new GuruSignature({ userPreferences: makeUserPreferences(), renderAuthSection() {} });

        await owner.initSignature();

        assert.equal(owner.hasSignature(), false);
        assert.equal(owner.getSignature(), null);
        assert.equal(env.element('guru-signature-section').style.display, 'block');
    } finally {
        env.restore();
    }
});

test('setSignature persists through UserPreferences exactly once', async () => {
    const env = installGlobals();
    try {
        const prefs = makeUserPreferences();
        const owner = new GuruSignature({ userPreferences: prefs, renderAuthSection() {} });
        const seen = [];
        owner.onSignatureSet((value) => seen.push(value));

        await owner.setSignature('bob');

        assert.equal(owner.getSignature(), 'bob');
        assert.deepEqual(prefs.writes, ['bob']);
        assert.deepEqual(seen, ['bob']);
        assert.equal(env.element('guru-display-name').textContent, 'bob');
    } finally {
        env.restore();
    }
});

test('setSignature rejects empty and over-long input without persisting', async () => {
    const env = installGlobals();
    try {
        const prefs = makeUserPreferences();
        const owner = new GuruSignature({ userPreferences: prefs, renderAuthSection() {} });

        await owner.setSignature('');
        await owner.setSignature('x'.repeat(51));

        assert.deepEqual(prefs.writes, []);
        assert.equal(owner.getSignature(), null);
    } finally {
        env.restore();
    }
});

test('saveSignature falls back to localStorage without a UserPreferences', async () => {
    const env = installGlobals();
    try {
        const owner = new GuruSignature({ userPreferences: null, renderAuthSection() {} });

        await owner.saveSignature('carol');

        assert.equal(owner.getSignature(), 'carol');
        assert.equal(env.storage.get(owner.storageKey), 'carol');
    } finally {
        env.restore();
    }
});

test('changeSignature seeds the input with the current value', async () => {
    const env = installGlobals();
    try {
        const owner = new GuruSignature({ userPreferences: makeUserPreferences({ signature: 'alice' }), renderAuthSection() {} });
        await owner.initSignature();

        owner.changeSignature();

        assert.equal(env.element('guru-signature').value, 'alice');
        assert.equal(env.element('guru-signature-section').style.display, 'block');
    } finally {
        env.restore();
    }
});
