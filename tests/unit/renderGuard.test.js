import test from 'node:test';
import assert from 'node:assert/strict';

import { AnalysisRowRenderer } from '../../js/ui/analysisRowRenderer.js';
import { CardPresenter } from '../../js/ui/cardPresenter.js';
import { AppState } from '../../js/app/appState.js';

/**
 * Rendering is asynchronous: the analysis list awaits its Discord thread link
 * and the card slots await Scryfall. Two renders can therefore overlap, and a
 * slower older one must not paint its row over the newer one — that is the
 * "flashing back and forth between two matches" a guru sees after a score.
 */

/** A host double whose analysis list records which row was rendered. */
function makeRendererHost({ threadGate } = {}) {
    const host = {
        state: new AppState(),
        built: [],
        view: {
            renderOutcome() {},
            buildAnalysisList({ row }) { host.built.push(row.player1); },
            renderButtons() {},
            renderNavigation() {},
            renderDiscrepancyButton() {}
        },
        getCurrentColorAnalysis(row) { return row.redAnalysis; },
        getDeckStats() { return { totalMatches: 1, unclaimedMatches: 1 }; },
        isMatchAvailableForAnalysis() { return true; },
        updateInverseResultDisplay() {}
    };

    host.state.setGuruColor('red');
    host.state.setSignature('alice');
    host.state.setRows([
        { player1: 'Deck A', player2: 'Deck B', redAnalysis: '1', redSignature: 'alice' },
        { player1: 'Deck C', player2: 'Deck D', redAnalysis: '0', redSignature: 'alice' }
    ]);

    if (threadGate) {
        host.state.setHub({ getThreadById: () => threadGate.promise });
    }

    return host;
}

test('a stale render does not overwrite a newer row after an await', async () => {
    // The thread fetch for row 1 is slow; row 2's render resolves first. The
    // older render must not land its analysis list afterwards.
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });

    const host = makeRendererHost({ threadGate: { promise: firstGate } });
    const renderer = new AnalysisRowRenderer(host);

    // Render row 1 (slow) then row 2 (fast). A later render call supersedes the
    // earlier one, exactly as a reload landing after a Next would.
    host.state.setRowIndex(0);
    const first = renderer.renderRowOutputs(host.state.rows[0]);
    host.state.setRowIndex(1);
    releaseFirst(); // row 1's await resolves only now, after row 2 started
    const second = renderer.renderRowOutputs(host.state.rows[1]);

    await Promise.all([first, second]);

    assert.deepEqual(host.built, ['Deck C'], 'only the newest row is rendered');
});

test('a stale render still lets the newest row render', async () => {
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });

    const host = makeRendererHost({ threadGate: { promise: firstGate } });
    const renderer = new AnalysisRowRenderer(host);

    host.state.setRowIndex(0);
    const first = renderer.renderRowOutputs(host.state.rows[0]);
    host.state.setRowIndex(1);
    const second = renderer.renderRowOutputs(host.state.rows[1]);
    releaseFirst();

    await Promise.all([first, second]);

    assert.deepEqual(host.built, ['Deck C']);
});

test('a slow card load does not repaint the previous row\'s cards', async () => {
    const calls = [];
    const scryfallAPI = {
        parseDeckString: (deck) => (deck ? deck.split('|').map(s => s.trim()) : []),
        getDeckImages: async (deck) => {
            calls.push(deck);
            if (deck === 'Old') await new Promise(resolve => setTimeout(resolve, 20));
            return [{ cardName: deck, image: null }];
        },
        getCardUrl: () => 'url'
    };
    const view = {
        renderCardLoading: () => [],
        renderCards: (slots, images) => { view.rendered = images.map(i => i.cardName); },
        renderCardError: () => { view.errored = true; }
    };
    const cards = new CardPresenter(scryfallAPI, view);

    const slow = cards.loadPlayerCards('player1', 'Old');
    const fast = cards.loadPlayerCards('player1', 'New');
    await Promise.all([slow, fast]);

    assert.deepEqual(view.rendered, ['New'], 'the newest deck wins the slots');
});
