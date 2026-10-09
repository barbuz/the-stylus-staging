/**
 * Match table presenter.
 *
 * Turns the controller's row list and per-row predicates into the options the
 * overview table modal needs, including each row's status markup and highlight
 * class. Keeps the modal's wiring out of the controller.
 */
import { escapeHtml } from '../utils/domUtils.js';
import { getCurrentColorSignature } from '../domain/guruColor.js';
import { describeMatchStatus, renderMatchStatus } from './matchStatus.js';

const COLUMN_COUNT = 4;

export class MatchTablePresenter {
    constructor(overviewTableModal) {
        this.overviewTableModal = overviewTableModal;
    }

    async open({ rows, currentRowIndex, colour, signature, threadMap, statusFor, onSelect }) {
        const bodyHtml = rows.map((row, idx) => {
            const parts = [];

            // Insert a sticky header row whenever the P1 deck changes.
            if (idx === 0 || row.player1 !== rows[idx - 1].player1) {
                parts.push(`
                    <tr class="deck-group-header">
                        <th colspan="${COLUMN_COUNT}" class="deck-group-header-name">
                            <span class="deck-group-header-p1">P1</span>
                            ${escapeHtml(row.player1 || 'Unknown deck')}
                        </th>
                    </tr>
                `);
            }

            const rowSignature = getCurrentColorSignature(row, colour) || '';
            const highlight = idx === currentRowIndex ? 'current-row' : '';
            const currentGuruRow = rowSignature === signature ? 'current-guru-row' : '';
            const status = renderMatchStatus(describeMatchStatus(statusFor(row, idx)));

            parts.push(`
                <tr data-row="${idx}" class="${highlight} ${currentGuruRow}">
                    <td>${idx + 1}</td>
                    <td>${escapeHtml(row.player2)}</td>
                    <td class="match-status-cell">${status}</td>
                    <td>${escapeHtml(rowSignature)}</td>
                </tr>
            `);
            return parts.join('');
        }).join('');

        await this.overviewTableModal.open({
            headers: ['#', 'Player 2 Deck', 'Status', 'Signature'],
            bodyHtml,
            currentRowIndex,
            onSelect
        });
    }

    close() {
        this.overviewTableModal.close();
    }
}
