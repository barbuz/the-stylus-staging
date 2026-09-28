/**
 * Match table modal.
 *
 * Shows the pod as a scrollable table with a status per match and lets a guru
 * jump to any row. Owns its overlay, listeners and teardown. The controller
 * supplies the per-row signature, row class and status markup, so no domain
 * logic lives here.
 */
import { escapeHtml } from '../utils/domUtils.js';

export class MatchTableModal {
    constructor() {
        this.overlay = null;
    }

    /**
     * @param {object} options
     * @param {Array} options.rows
     * @param {number} options.currentRowIndex
     * @param {Function} options.statusMarkupFor (row, index) -> trusted HTML
     * @param {Function} options.signatureFor (row) -> string
     * @param {Function} options.rowClassFor (row, index) -> class string
     * @param {Function} options.onSelect called with the chosen row index
     */
    async open({ rows, statusMarkupFor, signatureFor, rowClassFor, currentRowIndex, onSelect }) {
        this.close();

        const overlay = document.createElement('div');
        overlay.className = 'match-table-overlay';

        const modal = document.createElement('div');
        modal.className = 'match-table-modal';

        const table = document.createElement('table');
        table.className = 'match-table';
        const tableColumnCount = 4;

        let lastDeck = null;
        const bodyHtml = rows.map((row, idx) => {
            const parts = [];
            if (row.player1 !== lastDeck) {
                lastDeck = row.player1;
                parts.push(`
                    <tr class="deck-group-header">
                        <th colspan="${tableColumnCount}" class="deck-group-header-name">
                            <span class="deck-group-header-p1">P1</span>
                            ${escapeHtml(lastDeck || 'Unknown deck')}
                        </th>
                    </tr>
                `);
            }

            const signature = signatureFor(row);
            const classNames = rowClassFor(row, idx);
            parts.push(`
                <tr data-row="${idx}" class="${classNames}">
                    <td>${idx + 1}</td>
                    <td>${escapeHtml(row.player2)}</td>
                    <td class="match-status-cell">${statusMarkupFor(row, idx)}</td>
                    <td>${escapeHtml(signature)}</td>
                </tr>
            `);
            return parts.join('');
        }).join('');

        table.innerHTML = `
            <thead>
                <tr>
                    <th>#</th>
                    <th>Player 2 Deck</th>
                    <th>Status</th>
                    <th>Signature</th>
                </tr>
            </thead>
            <tbody>
                ${bodyHtml}
            </tbody>
        `;
        modal.appendChild(table);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        this.overlay = overlay;
        this._onSelect = onSelect;
        this._currentRowIndex = currentRowIndex;

        this._onTableClick = (event) => {
            const tr = event.target.closest('tr[data-row]');
            if (tr) {
                this._onSelect?.(parseInt(tr.getAttribute('data-row'), 10));
                this.close();
            }
        };
        this._onOverlayMouseDown = (event) => {
            if (event.target === overlay && this._currentRowIndex >= 0) {
                this._onSelect?.(this._currentRowIndex);
                this.close();
            }
        };
        this._onKeydown = (event) => {
            if (event.key === 'Escape') {
                this.close();
            }
        };

        table.addEventListener('click', this._onTableClick);
        overlay.addEventListener('mousedown', this._onOverlayMouseDown);
        document.addEventListener('keydown', this._onKeydown);

        requestAnimationFrame(() => {
            const thead = table.querySelector('thead');
            if (thead) {
                const headHeight = thead.getBoundingClientRect().height;
                if (headHeight) {
                    table.style.setProperty('--match-table-head-offset', `${headHeight}px`);
                }
            }

            table.querySelector('tr.current-row')?.scrollIntoView({ block: 'center', behavior: 'auto' });
        });
    }

    close() {
        if (this._onKeydown) {
            document.removeEventListener('keydown', this._onKeydown);
            this._onKeydown = null;
        }
        this.overlay?.remove();
        this.overlay = null;
    }

    destroy() {
        this.close();
    }
}
