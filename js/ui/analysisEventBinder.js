/**
 * Analysis event binder.
 *
 * Wires the static scoring and navigation buttons to controller commands and
 * installs the delegated listeners for the dynamically created thread modal.
 * Kept apart from the controller so the controller holds state and orchestration
 * rather than DOM event plumbing.
 */
import { GuruColorSelector } from './guruColorSelector.js';
import { getElement } from '../utils/domUtils.js';
import { logger } from '../utils/log.js';

export class AnalysisEventBinder {
    constructor(host) {
        this.host = host;
        this._onDocumentClick = null;
        // Bound listeners, kept so destroy() can remove them. The scoring and
        // navigation buttons are shared DOM: a second controller that binds
        // without the first unbinding leaves the old handlers attached, so one
        // tap drives both controllers — each on its own row.
        this._listeners = [];
    }

    bind() {
        const host = this.host;

        this._bindButton('win-btn', () => host.setAnalysis(1.0));
        this._bindButton('tie-btn', () => host.setAnalysis(0.5));
        this._bindButton('loss-btn', () => host.setAnalysis(0.0));

        this._bindButton('prev-btn', () => host.previousRow());
        this._bindButton('next-btn', () => host.nextRow());
        this._bindButton('skip-btn', () => host.skipToNextIncomplete());
        this._bindButton('discrepancy-btn', () => host.skipToNextDiscrepancy());
        this._bindButton('mirror-match-btn', () => host.skipToMirrorMatch());
        this._bindButton('next-deck-btn', () => host.skipToNextDeck());
        this._bindButton('deck-notes-btn', () => host.openDeckNotes());

        // Guru color selector (owns its own document-level dismiss listeners)
        host.guruColorSelector = new GuruColorSelector({
            onChange: (colour) => host.changeGuruColor(colour)
        });

        this._bindButton('current-row-info', () => host.showOverviewTableModal());

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

    /** Bind one button click and remember it for destroy(). */
    _bindButton(id, handler) {
        const element = getElement(id);
        if (!element) {
            return;
        }
        element.addEventListener('click', handler);
        this._listeners.push({ element, handler });
    }

    destroy() {
        for (const { element, handler } of this._listeners) {
            element.removeEventListener('click', handler);
        }
        logger.debug(`AnalysisEventBinder: unbound ${this._listeners.length} listeners`);
        this._listeners = [];

        if (this._onDocumentClick) {
            document.removeEventListener('click', this._onDocumentClick);
            this._onDocumentClick = null;
        }
    }
}
