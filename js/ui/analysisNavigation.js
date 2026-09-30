/**
 * Analysis navigation.
 *
 * Owns row-to-row movement for the scoring screen: previous / next, skipping to
 * the next incomplete or discrepant match, jumping to the mirror match and to
 * the next unclaimed deck. Each move updates the host's row index (and colour
 * where a discrepancy belongs to another guru) and asks the host to re-render.
 */
import { findNextDeck, findMirrorMatchIndex } from '../domain/matchRows.js';

export class AnalysisNavigation {
    constructor(host) {
        this.host = host;
    }

    async nextRow() {
        const host = this.host;
        const { state } = host;
        if (state.rowIndex < state.rows.length - 1) {
            state.setRowIndex(state.rowIndex + 1);
            await host.showCurrentRow();
        }
    }

    async previousRow() {
        const host = this.host;
        const { state } = host;
        if (state.rowIndex > 0) {
            state.setRowIndex(state.rowIndex - 1);
            await host.showCurrentRow();
        }
    }

    async skipToNextIncomplete() {
        const host = this.host;
        const { state } = host;
        const nextIncompleteIndex = host.findFirstEmptyAnalysis(state.rowIndex + 1);

        if (nextIncompleteIndex != null && nextIncompleteIndex != state.rowIndex) {
            state.setRowIndex(nextIncompleteIndex);
            await host.showCurrentRow();
        } else {
            host.showCompletionMessage();
        }
    }

    async skipToNextDiscrepancy() {
        const host = this.host;
        const { state } = host;
        const targetIndex = host.findFirstDiscrepancy(state.rowIndex + 1);
        if (targetIndex >= 0) {
            state.setRowIndex(targetIndex);
        }

        // A discrepancy may belong to a different guru's colour; follow it.
        const targetRow = state.rows[state.rowIndex];
        if (host.rowHasDiscrepancy(targetRow)) {
            const color = host.getGuruColorInRow(targetRow);
            if (color) {
                state.setGuruColor(color);
            }
        }
        await host.showCurrentRow();
    }

    async skipToNextDeck() {
        const host = this.host;
        const { state } = host;
        const nextDeckIndex = findNextDeck(state.rows, state.guruColor, state.rowIndex);
        if (nextDeckIndex !== state.rowIndex) {
            state.setRowIndex(nextDeckIndex);
            await host.showCurrentRow();
        } else {
            host.uiController.showStatus('No other unclaimed decks found', 'info');
        }
    }

    async skipToMirrorMatch() {
        const host = this.host;
        const { state } = host;
        const mirrorIndex = findMirrorMatchIndex(state.rows, state.rowIndex);

        if (mirrorIndex !== -1) {
            state.setRowIndex(mirrorIndex);
            await host.showCurrentRow();
        } else {
            host.uiController.showStatus('No mirror match found for this game.', 'info');
        }
    }
}
