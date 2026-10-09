/**
 * Shared card-slot renderer.
 *
 * The analysis screen and the deck-notes gate both draw three Scryfall card
 * slots inside a `<playerId>-cards` container. Keeping the three renderers here
 * stops the two screens drifting apart (the deck-notes gate used to carry a
 * verbatim copy). Pure DOM work; all user-derived strings are escaped.
 */
import { escapeHtml, getElement } from '../utils/domUtils.js';

/**
 * Reset a card container's slots to their loading state with card names.
 * Returns the slots so the caller can display the loaded images.
 *
 * @param {string} playerId container id prefix (`<playerId>-cards`)
 * @param {string[]} cardNames
 * @returns {NodeList|Array} the slot elements
 */
export function renderCardSlotsLoading(playerId, cardNames) {
    const container = getElement(`${playerId}-cards`);
    if (!container) {
        return [];
    }
    const slots = container.querySelectorAll('.card-slot');
    slots.forEach((slot, index) => {
        slot.innerHTML = index < cardNames.length
            ? `<div class="card-loading">${escapeHtml(cardNames[index])}</div>`
            : '<div class="card-loading">Loading...</div>';
    });
    return slots;
}

/** Display loaded card images (or fall back to names) in the slots. */
export function renderCardSlots(slots, deckImages, { getCardUrl }) {
    for (let i = 0; i < Math.min(deckImages.length, slots.length); i++) {
        const cardData = deckImages[i];
        const slot = slots[i];

        if (cardData.image) {
            const link = document.createElement('a');
            link.href = getCardUrl(cardData.cardName);
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'card-link';
            link.title = `Click to view ${cardData.cardName} on Scryfall`;

            const displayImage = cardData.image.cloneNode();
            displayImage.alt = cardData.cardName;
            link.appendChild(displayImage);
            slot.replaceChildren(link);
        } else {
            const url = getCardUrl(cardData.cardName, false);
            slot.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="card-link">
                <div class="card-error">${escapeHtml(cardData.cardName)}</div>
            </a>`;
        }
    }

    for (let i = deckImages.length; i < slots.length; i++) {
        slots[i].innerHTML = '<div class="card-loading">-</div>';
    }
}

/** Show a failure state in every slot. */
export function renderCardSlotsError(slots) {
    slots.forEach(slot => {
        slot.innerHTML = '<div class="card-error">Failed to load</div>';
    });
}
