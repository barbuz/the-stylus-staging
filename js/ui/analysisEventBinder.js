/**
 * Analysis event binder.
 *
 * Wires the static scoring and navigation buttons to controller commands and
 * installs the delegated listeners for the dynamically created thread modal.
 * Kept apart from the controller so the controller holds state and orchestration
 * rather than DOM event plumbing.
 */
import { GuruColorSelector } from './guruColorSelector.js';
import { addEventListenerSafe } from '../utils/domUtils.js';

export class AnalysisEventBinder {
    constructor(host) {
        this.host = host;
        this._onDocumentClick = null;
    }

    bind() {
        const host = this.host;

        addEventListenerSafe('win-btn', 'click', () => host.setAnalysis(1.0));
        addEventListenerSafe('tie-btn', 'click', () => host.setAnalysis(0.5));
        addEventListenerSafe('loss-btn', 'click', () => host.setAnalysis(0.0));

        addEventListenerSafe('prev-btn', 'click', () => host.previousRow());
        addEventListenerSafe('next-btn', 'click', () => host.nextRow());
        addEventListenerSafe('skip-btn', 'click', () => host.skipToNextIncomplete());
        addEventListenerSafe('discrepancy-btn', 'click', () => host.skipToNextDiscrepancy());
        addEventListenerSafe('mirror-match-btn', 'click', () => host.skipToMirrorMatch());
        addEventListenerSafe('next-deck-btn', 'click', () => host.skipToNextDeck());

        // Guru color selector (owns its own document-level dismiss listeners)
        host.guruColorSelector = new GuruColorSelector({
            onChange: (colour) => host.changeGuruColor(colour)
        });

        addEventListenerSafe('current-row-info', 'click', () => host.showMatchTableModal());

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
