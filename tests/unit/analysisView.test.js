import test from 'node:test';
import assert from 'node:assert/strict';

import { AnalysisView } from '../../js/ui/analysisView.js';

/**
 * The scoring buttons are shared DOM, not owned by a view instance. When a pod
 * is torn down (a signature change closes it) and reopened, a second
 * AnalysisController builds a second AnalysisView over the same elements. If
 * the first view left its listeners attached, every tap drives both
 * controllers — each sitting on its own row — so a single "Claim Deck" or score
 * writes an extra deck the guru never touched. destroy() must remove them.
 */

/** A fake element that records its listeners so we can dispatch clicks. */
function makeElement(id) {
    return {
        id,
        style: {},
        dataset: {},
        textContent: '',
        innerHTML: '',
        disabled: false,
        _listeners: new Map(),
        addEventListener(type, handler) {
            if (!this._listeners.has(type)) this._listeners.set(type, new Set());
            this._listeners.get(type).add(handler);
        },
        removeEventListener(type, handler) {
            this._listeners.get(type)?.delete(handler);
        },
        dispatch(type, event = {}) {
            for (const handler of [...(this._listeners.get(type) || [])]) {
                handler(event);
            }
        },
        listenerCount(type) {
            return this._listeners.get(type)?.size || 0;
        }
    };
}

const BUTTON_IDS = [
    'claim-button', 'unclaim-button', 'unclaim-incomplete-button',
    'clear-result-button', 'claim-deck-button'
];

function installDom(ids = BUTTON_IDS) {
    const previous = globalThis.document;
    const elements = new Map(ids.map(id => [id, makeElement(id)]));
    globalThis.document = {
        getElementById: (id) => elements.get(id) || null,
        querySelectorAll: () => []
    };
    return {
        el: (id) => elements.get(id),
        restore() { globalThis.document = previous; }
    };
}

test('destroy removes every scoring-button listener the view bound', () => {
    const env = installDom();
    try {
        let claims = 0;
        const view = new AnalysisView({ onClaim: () => { claims++; } });

        env.el('claim-button').dispatch('click');
        assert.equal(claims, 1, 'the live view handles the click');

        view.destroy();

        env.el('claim-button').dispatch('click');
        assert.equal(claims, 1, 'a destroyed view no longer handles clicks');
        assert.equal(env.el('claim-button').listenerCount('click'), 0);
        assert.equal(env.el('claim-deck-button').listenerCount('click'), 0);
    } finally {
        env.restore();
    }
});

test('a reopened pod does not double-handle a click through the old controller', () => {
    const env = installDom();
    try {
        let oldCalls = 0;
        let newCalls = 0;

        // First session, then it is torn down (e.g. a signature change closes it).
        const first = new AnalysisView({ onClaim: () => { oldCalls++; } });
        first.destroy();

        // Reopening the pod builds a second view over the same buttons.
        new AnalysisView({ onClaim: () => { newCalls++; } });

        env.el('claim-button').dispatch('click');

        assert.equal(oldCalls, 0, 'the torn-down controller must not act');
        assert.equal(newCalls, 1, 'only the open controller acts');
    } finally {
        env.restore();
    }
});
