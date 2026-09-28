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
        if (host.currentRowIndex < host.allRows.length - 1) {
            host.currentRowIndex++;
            await host.showCurrentRow();
        }
    }

    async previousRow() {
        const host = this.host;
        if (host.currentRowIndex > 0) {
            host.currentRowIndex--;
            await host.showCurrentRow();
        }
    }

    async skipToNextIncomplete() {
        const host = this.host;
        const nextIncompleteIndex = host.findFirstEmptyAnalysis(host.currentRowIndex + 1);

        if (nextIncompleteIndex != null && nextIncompleteIndex != host.currentRowIndex) {
            host.currentRowIndex = nextIncompleteIndex;
            await host.showCurrentRow();
        } else {
            host.showCompletionMessage();
        }
    }

    async skipToNextDiscrepancy() {
        const host = this.host;
        const targetIndex = host.findFirstDiscrepancy(host.currentRowIndex + 1);
        if (targetIndex >= 0) {
            host.currentRowIndex = targetIndex;
        }

        // A discrepancy may belong to a different guru's colour; follow it.
        const targetRow = host.allRows[host.currentRowIndex];
        if (host.rowHasDiscrepancy(targetRow)) {
            const color = host.getGuruColorInRow(targetRow);
            if (color) {
                host.currentGuruColor = color;
            }
        }
        await host.showCurrentRow();
    }

    async skipToNextDeck() {
        const host = this.host;
        const nextDeckIndex = findNextDeck(host.allRows, host.currentGuruColor, host.currentRowIndex);
        if (nextDeckIndex !== host.currentRowIndex) {
            host.currentRowIndex = nextDeckIndex;
            await host.showCurrentRow();
        } else {
            host.uiController.showStatus('No other unclaimed decks found', 'info');
        }
    }

    async skipToMirrorMatch() {
        const host = this.host;
        const mirrorIndex = findMirrorMatchIndex(host.allRows, host.currentRowIndex);

        if (mirrorIndex !== -1) {
            host.currentRowIndex = mirrorIndex;
            await host.showCurrentRow();
        } else {
            host.uiController.showStatus('No mirror match found for this game.', 'info');
        }
    }
}
