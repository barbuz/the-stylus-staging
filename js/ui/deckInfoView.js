/**
 * Shared deck-info presenter.
 *
 * Renders the clock / notes / additional-notes panel used by both the analysis
 * screen and the deck-notes gate, so the two screens cannot drift apart. It is
 * pure DOM work: the caller supplies the container, the resolved deck info and
 * the save callback.
 *
 * `variant`:
 *  - 'compact'   analysed match panel (today's appearance)
 *  - 'prominent' deck-notes page: larger affordances and full-width inputs
 *
 * `clockSignature` is the goldfish signature(s) to show as a hover tooltip on
 * the clock value, reusing the analysis screen's `.guru-signature-tooltip`.
 */
import { escapeHtml } from '../utils/domUtils.js';

/**
 * Build the signature tooltip markup for the clock value, or the plain value.
 * Accepts a string or an array of distinct signatures (a grouped entry).
 */
function clockValueHtml(clockValue, clockSignature) {
    const value = `<span class="notes-value">${escapeHtml(clockValue || '')}</span>`;

    const signatures = Array.isArray(clockSignature)
        ? clockSignature.filter(Boolean)
        : (clockSignature ? [clockSignature] : []);

    if (signatures.length === 0) {
        return value;
    }

    const tooltip = signatures.map(escapeHtml).join(', ');
    return `<span class="deck-clock-signed" tabindex="0">${value}<span class="guru-signature-tooltip">${tooltip}</span></span>`;
}

/**
 * Render the deck info panel into `container`.
 *
 * @param {HTMLElement|null} container
 * @param {object} options
 * @param {string} options.deckString
 * @param {object} options.deckInfo
 * @param {Function} options.onSaveField (deckString, type, currentValue, newValue, span)
 * @param {'compact'|'prominent'} [options.variant]
 * @param {string|string[]} [options.clockSignature]
 * @param {boolean} [options.editable]
 */
export function renderDeckInfo(container, {
    deckString,
    deckInfo,
    onSaveField,
    variant = 'compact',
    clockSignature = null,
    editable = true
} = {}) {
    if (!container) {
        return;
    }

    if (!deckInfo) {
        container.innerHTML = '';
        return;
    }

    container.classList.toggle('prominent', variant === 'prominent');

    const editButton = (type, title) => editable
        ? `<button class="edit-deck-info-btn" data-type="${type}" title="${title}">✎</button>`
        : '';

    container.innerHTML = [
        `<span class="deck-clock">Clock: ${clockValueHtml(deckInfo.goldfishClock, clockSignature)} ${editButton('clock', 'Edit Clock')}</span>`,
        `<span class="deck-notes"><span class="notes-value">${escapeHtml(deckInfo.notes || '')}</span> ${editButton('notes', 'Edit Notes')}</span>`,
        '<hr class="deck-separator">',
        `<span class="deck-additional"><span class="notes-value">${escapeHtml(deckInfo.additionalNotes || '')}</span> ${editButton('additionalNotes', 'Edit Additional Notes')}</span>`
    ].join(' ');

    if (!editable) {
        return;
    }

    const handleEditClick = (event) => {
        const btn = event.target.closest('.edit-deck-info-btn');
        if (!btn) {
            return;
        }
        const type = btn.getAttribute('data-type');
        const span = btn.closest('span');
        if (!span) {
            return;
        }

        const currentValue = span.querySelector('.notes-value').textContent || '';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentValue;
        input.className = 'deck-info-edit-input';
        input.setAttribute('aria-label', 'Edit deck info');

        const originalHTML = span.innerHTML;
        span.innerHTML = '';
        span.appendChild(input);
        input.focus();

        const commit = async () => {
            const newValue = input.value;
            span.innerHTML = originalHTML;
            span.querySelector('.edit-deck-info-btn').addEventListener('click', handleEditClick);
            if (newValue !== currentValue) {
                await onSaveField(deckString, type, currentValue, newValue, span);
            }
        };

        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                input.blur();
            } else if (ev.key === 'Escape') {
                input.value = currentValue;
                input.blur();
            }
        });
        input.addEventListener('blur', commit);
    };

    container.querySelectorAll('.edit-deck-info-btn').forEach(btn => {
        btn.addEventListener('click', handleEditClick);
    });
}

/** Update a single deck-info note value in place after a successful save. */
export function updateDeckInfoValue(span, newValue) {
    const value = span?.querySelector('.notes-value');
    if (value) {
        value.textContent = newValue;
    }
}

/** True while an inline deck-info edit is in progress inside `container`. */
export function isDeckInfoEditing(container) {
    return Boolean(container?.querySelector('.deck-info-edit-input'));
}
