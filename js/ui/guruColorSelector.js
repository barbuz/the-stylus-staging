/**
 * Guru colour selector.
 *
 * Owns the header dropdown that lets a guru switch colour. Listens for its own
 * document-level dismiss events and removes them on destroy.
 */
import { getElement } from '../utils/domUtils.js';
import { logger } from '../utils/log.js';

export class GuruColorSelector {
    /**
     * @param {object} options
     * @param {Function} options.onChange called with the new colour
     */
    constructor({ onChange }) {
        this.onChange = onChange;
        this.trigger = getElement('sheet-name-info');
        this.dropdown = getElement('guru-color-dropdown');

        this._onDocumentClick = (event) => {
            if (!this.trigger || !this.dropdown) return;
            if (!this.trigger.contains(event.target) && !this.dropdown.contains(event.target)) {
                this.close();
            }
        };
        this._onKeydown = (event) => {
            if (event.key === 'Escape') {
                this.close();
            }
        };

        this.bind();
    }

    bind() {
        if (!this.trigger || !this.dropdown) {
            logger.warn('Guru color selector elements not found');
            return;
        }

        this.trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            if (this.dropdown.classList.contains('show')) {
                this.close();
            } else {
                this.open();
            }
        });

        this.dropdown.addEventListener('click', (event) => {
            const option = event.target.closest('.guru-color-option');
            if (option) {
                this.onChange?.(option.dataset.color);
                this.close();
            }
        });

        document.addEventListener('click', this._onDocumentClick);
        document.addEventListener('keydown', this._onKeydown);
    }

    open() {
        if (!this.trigger || !this.dropdown) return;
        this.trigger.classList.add('active');
        this.dropdown.classList.add('show');
        this.update();
    }

    close() {
        this.trigger?.classList.remove('active');
        this.dropdown?.classList.remove('show');
    }

    /** Mark the active colour option. */
    update(colour) {
        const dropdown = this.dropdown;
        if (!dropdown) return;

        dropdown.querySelectorAll('.guru-color-option').forEach(option => option.classList.remove('current'));
        if (colour) {
            dropdown.querySelector(`[data-color="${colour}"]`)?.classList.add('current');
        }
    }

    destroy() {
        document.removeEventListener('click', this._onDocumentClick);
        document.removeEventListener('keydown', this._onKeydown);
    }
}
