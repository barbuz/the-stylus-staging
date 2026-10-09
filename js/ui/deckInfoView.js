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
 * Every field is wrapped in a `.deck-field` that is itself the edit target, so
 * the whole value area is clickable. In the 'prominent' variant a visible frame
 * makes that obvious; the small pencil remains as an affordance in both.
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

    // Only the clock shows a signature tooltip; data-attribute is the edit type.
    // The compact variant keeps its original look: only the clock is labelled.
    const field = (type, label, valueHtml, extraClass = '', alwaysLabel = false) => {
        const title = `Edit ${label}`;
        const button = editable
            ? `<span class="edit-deck-info-btn" data-type="${type}" title="${title}" role="button" aria-label="${title}">✎</span>`
            : '';
        const labelHtml = (variant === 'prominent' || alwaysLabel)
            ? `<span class="deck-field-label">${label}:</span> `
            : '';
        return `<span class="deck-field ${extraClass}" data-field-type="${type}">`
            + labelHtml
            + `${valueHtml} ${button}</span>`;
    };

    container.innerHTML = [
        field('clock', 'Clock', clockValueHtml(deckInfo.goldfishClock, clockSignature), 'deck-clock', true),
        field('notes', 'Notes', `<span class="notes-value">${escapeHtml(deckInfo.notes || '')}</span>`, 'deck-notes'),
        '<hr class="deck-separator">',
        field('additionalNotes', 'Additional Notes', `<span class="notes-value">${escapeHtml(deckInfo.additionalNotes || '')}</span>`, 'deck-additional')
    ].join(' ');

    if (!editable) {
        return;
    }

    const handleEditClick = (event) => {
        // The whole .deck-field is the edit target; the pencil is just a hint.
        const span = event.target.closest('.deck-field');
        if (!span) {
            return;
        }
        if (span.querySelector('.deck-info-edit-input')) {
            return;
        }
        const type = span.getAttribute('data-field-type');

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

    container.querySelectorAll('.deck-field').forEach(fieldEl => {
        fieldEl.addEventListener('click', handleEditClick);
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
