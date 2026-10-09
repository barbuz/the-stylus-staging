/**
 * Deck table presenter.
 *
 * Turns the grouped deck-notes entries into the table body for the shared
 * match-table modal, so the deck-notes screen gets a jump-to-deck table that
 * looks like the analysis screen's match table. Each deck is a group: the
 * header names the Player 1 deck and the single row shows its clock status.
 */
import { escapeHtml } from '../utils/domUtils.js';
import { renderMatchStatus } from './matchStatus.js';

const COLUMN_COUNT = 2;

/** Status descriptor for a deck's goldfish clock. */
function describeDeckStatus(entry) {
    const clock = (entry.deckInfo?.goldfishClock || '').trim();
    const signature = (entry.signatures || []).filter(Boolean).join(', ');

    if (clock) {
        return {
            key: 'clock-set',
            label: signature ? `Clock ${clock} (${signature})` : `Clock ${clock}`,
            type: 'emoji',
            value: '✅'
        };
    }

    return { key: 'clock-empty', label: 'No clock yet', type: 'emoji', value: '❗' };
}

export class DeckTablePresenter {
    constructor(matchTableModal) {
        this.matchTableModal = matchTableModal;
    }

    async open({ entries, currentRow, onSelect }) {
        const bodyHtml = (entries || []).map((entry, idx) => {
            const status = renderMatchStatus(describeDeckStatus(entry));
            const currentClass = idx === currentRow ? 'current-row' : '';

            return `
                <tr class="deck-group-header">
                    <th colspan="${COLUMN_COUNT}" class="deck-group-header-name">
                        <span class="deck-group-header-p1">Deck ${idx + 1}</span>
                        ${escapeHtml(entry.deckString || 'Unknown deck')}
                    </th>
                </tr>
                <tr data-row="${idx}" class="${currentClass}">
                    <td>${idx + 1}</td>
                    <td class="match-status-cell">${status}</td>
                </tr>
            `;
        }).join('');

        await this.matchTableModal.open({
            headers: ['#', 'Clock'],
            bodyHtml,
            currentRowIndex: currentRow,
            onSelect
        });
    }

    close() {
        this.matchTableModal.close();
    }
}
