/**
 * Deck table presenter.
 *
 * Turns the grouped deck-notes entries into the table body for the shared
 * overview table modal, so the deck-notes screen gets a jump-to-deck table that
 * looks like the analysis screen's match table.
 *
 * One deck per row (a grouped entry never spans more than one row, so there is
 * nothing to group). The clock is shown as its value, and a row whose goldfish
 * signature matches the current guru is highlighted like the match table's
 * `current-guru-row`. The signature and notes columns are marked optional: CSS
 * hides them on narrow screens and the modal re-shows them when space allows.
 */
import { escapeHtml } from '../utils/domUtils.js';

const OPTIONAL_CELL = 'overview-table-optional';

/** The clock as its value, or an em dash when it is still empty. */
function clockCell(clock) {
    if (clock) {
        return `<td class="deck-overview-clock">${escapeHtml(clock)}</td>`;
    }
    return '<td class="deck-overview-clock deck-overview-clock-empty" aria-label="No clock yet" title="No clock yet">—</td>';
}

export class DeckTablePresenter {
    constructor(overviewTableModal) {
        this.overviewTableModal = overviewTableModal;
    }

    /**
     * @param {object} options
     * @param {Array} options.entries grouped deck-notes entries
     * @param {number} options.currentRow index of the open deck
     * @param {string} options.signature current guru signature
     * @param {Function} options.onSelect chosen deck index
     */
    async open({ entries, currentRow, signature = '', onSelect }) {
        const bodyHtml = (entries || []).map((entry, idx) => {
            const info = entry.deckInfo || {};
            const clock = (info.goldfishClock || '').trim();
            const entrySignature = (entry.signatures || []).filter(Boolean).join(', ');
            const isCurrent = idx === currentRow ? 'current-row' : '';
            const isGurus = signature && (entry.signatures || []).includes(signature)
                ? 'current-guru-row'
                : '';

            return `
                <tr data-row="${idx}" class="${isCurrent} ${isGurus}">
                    <td class="deck-overview-index">${idx + 1}</td>
                    <td class="deck-overview-deck">${escapeHtml(entry.deckString || 'Unknown deck')}</td>
                    ${clockCell(clock)}
                    <td class="${OPTIONAL_CELL}">${escapeHtml(entrySignature)}</td>
                    <td class="${OPTIONAL_CELL}">${escapeHtml(info.notes || '')}</td>
                    <td class="${OPTIONAL_CELL}">${escapeHtml(info.additionalNotes || '')}</td>
                </tr>
            `;
        }).join('');

        await this.overviewTableModal.open({
            headers: ['#', 'Deck', 'Clock', 'Signature', 'Notes', 'Additional Notes'],
            optionalFromIndex: 3,
            bodyHtml,
            currentRowIndex: currentRow,
            onSelect
        });
    }

    close() {
        this.overviewTableModal.close();
    }
}
