/**
 * Analysis event binder.
 *
 * Wires the static scoring and navigation buttons to controller commands and
 * installs the delegated listeners for the dynamically created thread modal.
 * Kept apart from the controller so the controller holds state and orchestration
 * rather than DOM event plumbing.
 */
import { GuruColorSelector } from './guruColorSelector.js';

export class AnalysisEventBinder {
    constructor(host) {
        this.host = host;
        this._onDocumentClick = null;
    }

    bind() {
        const host = this.host;

        document.getElementById('win-btn').addEventListener('click', () => host.setAnalysis(1.0));
        document.getElementById('tie-btn').addEventListener('click', () => host.setAnalysis(0.5));
        document.getElementById('loss-btn').addEventListener('click', () => host.setAnalysis(0.0));

        document.getElementById('prev-btn').addEventListener('click', () => host.previousRow());
        document.getElementById('next-btn').addEventListener('click', () => host.nextRow());
        document.getElementById('skip-btn').addEventListener('click', () => host.skipToNextIncomplete());
        document.getElementById('discrepancy-btn').addEventListener('click', () => host.skipToNextDiscrepancy());
        document.getElementById('mirror-match-btn').addEventListener('click', () => host.skipToMirrorMatch());
        document.getElementById('next-deck-btn').addEventListener('click', () => host.skipToNextDeck());

        // Guru color selector (owns its own document-level dismiss listeners)
        host.guruColorSelector = new GuruColorSelector({
            onChange: (colour) => host.changeGuruColor(colour)
        });

        document.getElementById('current-row-info').addEventListener('click', () => host.showMatchTableModal());

        // Use event delegation since the thread button is created dynamically in the view.
        this._onDocumentClick = (e) => {
            if (e.target.closest('.create-thread-btn')) {
                const btn = e.target.closest('.create-thread-btn');
                host.showCreateThreadModal(parseInt(btn.dataset.rowIndex));
            }
            if (e.target.closest('.close-thread-modal')) {
                host.closeCreateThreadModal();
            }
            if (e.target.classList.contains('thread-modal-overlay')) {
                host.closeCreateThreadModal();
            }
        };
        document.addEventListener('click', this._onDocumentClick);
    }

    destroy() {
        if (this._onDocumentClick) {
            document.removeEventListener('click', this._onDocumentClick);
            this._onDocumentClick = null;
        }
    }
}
