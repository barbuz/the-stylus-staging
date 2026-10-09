/**
 * Overview table modal.
 *
 * A scrollable table that lets a guru jump to a row. It is generic: the caller
 * supplies the column headers and the body markup, so the analysis screen uses
 * it for the match list and the deck-notes screen for its deck list. Owns its
 * overlay, listeners and teardown; no domain logic lives here.
 */
import { escapeHtml } from '../utils/domUtils.js';

export class OverviewTableModal {
    constructor() {
        this.overlay = null;
    }

    /**
     * @param {object} options
     * @param {Array<string>} options.headers column header labels
     * @param {string} options.bodyHtml trusted tbody markup; rows use data-row
     * @param {number} options.currentRowIndex
     * @param {Function} options.onSelect called with the chosen row index
     */
    async open({ headers = [], bodyHtml = '', currentRowIndex, onSelect }) {
        this.close();

        const overlay = document.createElement('div');
        overlay.className = 'overview-table-overlay';

        const modal = document.createElement('div');
        modal.className = 'overview-table-modal';

        const table = document.createElement('table');
        table.className = 'overview-table';

        const headerHtml = headers
            .map(header => `<th>${escapeHtml(header)}</th>`)
            .join('');

        table.innerHTML = `
            <thead>
                <tr>${headerHtml}</tr>
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
                    table.style.setProperty('--overview-table-head-offset', `${headHeight}px`);
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
