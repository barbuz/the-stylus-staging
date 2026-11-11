import test from 'node:test';
import assert from 'node:assert/strict';

import { AnalysisEventBinder } from '../../js/ui/analysisEventBinder.js';

/**
 * The scoring and navigation buttons are shared DOM, not owned by a binder
 * instance. When a pod is closed (a signature change) and reopened, a second
 * AnalysisController builds a second AnalysisEventBinder over the same
 * elements. If the first binder left its listeners attached, one tap drives
 * both controllers — each on its own row — so a single Win or Claim Deck writes
 * an extra match the guru never touched. That is the "it claimed matches I
 * didn't claim" report. destroy() must remove every listener it bound.
 *
 * GuruColorSelector is not exercised here (it owns document-level dismiss
 * listeners and is covered by its own concerns); the host supplies a minimal
 * double so bind() can run.
 */

function makeElement(id) {
    return {
        id,
        style: {},
        classList: { add() {}, remove() {}, contains: () => false },
        dataset: {},
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

// Every button the binder binds, plus the dropdown/trigger the colour selector
// looks for (left null so the selector no-ops).
const BUTTON_IDS = [
    'win-btn', 'tie-btn', 'loss-btn',
    'prev-btn', 'next-btn', 'skip-btn', 'discrepancy-btn',
    'mirror-match-btn', 'next-deck-btn', 'deck-notes-btn',
    'current-row-info'
];

function installDom() {
    const previousDocument = globalThis.document;
    const elements = new Map(BUTTON_IDS.map(id => [id, makeElement(id)]));
    globalThis.document = {
        getElementById: (id) => elements.get(id) || null,
        addEventListener() {},
        removeEventListener() {}
    };
    return {
        el: (id) => elements.get(id),
        restore() { globalThis.document = previousDocument; }
    };
}

/** A host double: bind() only reads these methods and the state object. */
function makeHost() {
    const calls = [];
    const host = {
        calls,
        state: { signature: 'alice', guruColor: 'red' },
        setAnalysis: (v) => calls.push(`setAnalysis:${v}`),
        previousRow: () => calls.push('previousRow'),
        nextRow: () => calls.push('nextRow'),
        skipToNextIncomplete: () => calls.push('skipToNextIncomplete'),
        skipToNextDiscrepancy: () => calls.push('skipToNextDiscrepancy'),
        skipToMirrorMatch: () => calls.push('skipToMirrorMatch'),
        skipToNextDeck: () => calls.push('skipToNextDeck'),
        openDeckNotes: () => calls.push('openDeckNotes'),
        changeGuruColor: () => calls.push('changeGuruColor'),
        showOverviewTableModal: () => calls.push('showOverviewTableModal'),
        showCreateThreadModal: () => calls.push('showCreateThreadModal'),
        closeCreateThreadModal: () => calls.push('closeCreateThreadModal')
    };
    return host;
}

test('destroy removes every scoring-button listener the binder bound', () => {
    const env = installDom();
    try {
        const host = makeHost();
        const binder = new AnalysisEventBinder(host);
        binder.bind();

        env.el('win-btn').dispatch('click');
        assert.deepEqual(host.calls, ['setAnalysis:1'], 'the live binder handles the click');

        binder.destroy();

        env.el('win-btn').dispatch('click');
        assert.deepEqual(host.calls, ['setAnalysis:1'], 'a destroyed binder no longer handles clicks');
        assert.equal(env.el('win-btn').listenerCount('click'), 0);
        assert.equal(env.el('next-btn').listenerCount('click'), 0);
    } finally {
        env.restore();
    }
});

test('a reopened pod does not drive the closed controller through the shared buttons', () => {
    const env = installDom();
    try {
        // First session is torn down (e.g. a signature change closes the pod).
        const firstHost = makeHost();
        const first = new AnalysisEventBinder(firstHost);
        first.bind();
        first.destroy();

        // Reopening the pod binds a second binder over the same buttons.
        const secondHost = makeHost();
        new AnalysisEventBinder(secondHost).bind();

        env.el('win-btn').dispatch('click');

        assert.deepEqual(firstHost.calls, [], 'the torn-down controller must not act');
        assert.deepEqual(secondHost.calls, ['setAnalysis:1'], 'only the open controller acts');
    } finally {
        env.restore();
    }
});
