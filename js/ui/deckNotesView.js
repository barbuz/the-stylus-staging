/**
 * Deck-notes gate view.
 *
 * DOM-only view for the one-deck-at-a-time clock & notes screen. It mirrors
 * AnalysisView's patterns: it builds the shell once inside `#sheet-editor`,
 * hides the analysis interface while open, and exposes render methods the
 * controller calls. All user-derived strings are escaped before entering
 * innerHTML.
 *
 * The deck-info panel itself is shared with the analysis screen via
 * deckInfoView.js; this view only supplies the container and the 'prominent'
 * variant.
 */
import { escapeHtml, getElement } from '../utils/domUtils.js';
import { renderDeckInfo } from './deckInfoView.js';

export class DeckNotesView {
    /**
     * @param {object} handlers
     * @param {Function} handlers.onPrev
     * @param {Function} handlers.onNext
     * @param {Function} handlers.onNextEmptyClock
     * @param {Function} handlers.onStart
     * @param {Function} handlers.onBack
     * @param {Function} handlers.onExit
     */
    constructor(handlers = {}) {
        this.handlers = handlers;
        this.screen = null;
    }

    /** Create the screen shell inside #sheet-editor if it is not there yet. */
    ensureScreen() {
        const existing = getElement('deck-notes-screen');
        if (existing) {
            this.screen = existing;
            return existing;
        }

        const sheetEditor = getElement('sheet-editor');
        if (!sheetEditor) {
            return null;
        }

        const screen = document.createElement('div');
        screen.id = 'deck-notes-screen';
        screen.className = 'deck-notes-screen full-screen';
        screen.innerHTML = `
            <div class="deck-notes-interface">
                <div class="match-details">
                    <div class="player-deck deck-notes-deck">
                        <h3 id="deck-notes-deck-heading">Deck</h3>
                        <div class="deck-container">
                            <div class="deck-info prominent" id="deck-notes-deck-info"></div>
                            <div class="card-images" id="deck-notes-cards">
                                <div class="card-slot"><div class="card-loading">Loading...</div></div>
                                <div class="card-slot"><div class="card-loading">Loading...</div></div>
                                <div class="card-slot"><div class="card-loading">Loading...</div></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="content-sidebar">
                    <div class="deck-notes-controls">
                        <div class="navigation-controls">
                            <button id="deck-notes-prev-btn" class="nav-arrow-btn" title="Previous deck">‹</button>
                            <button id="deck-notes-next-btn" class="nav-arrow-btn" title="Next deck">›</button>
                        </div>
                        <p id="deck-notes-progress" class="deck-notes-progress"></p>
                        <p id="deck-notes-clocks" class="deck-notes-clocks"></p>
                        <button id="deck-notes-next-empty-btn" class="secondary-btn">Next without clock</button>
                        <button id="deck-notes-start-btn" class="primary-btn">Start guruing</button>
                        <button id="deck-notes-back-btn" class="secondary-btn" style="display: none;">Back to analysis</button>
                    </div>

                    <div class="editor-header">
                        <div class="header-left">
                            <div id="deck-notes-sheet-info">
                                <h2 id="deck-notes-sheet-title">Deck Notes</h2>
                            </div>
                        </div>
                        <div class="editor-controls">
                            <button id="deck-notes-exit-btn" class="secondary-btn">Exit</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        sheetEditor.insertBefore(screen, sheetEditor.firstChild);
        this.screen = screen;
        this.bindButtons();

        const analysisInterface = getElement('guru-analysis-interface');
        if (analysisInterface) {
            analysisInterface.style.display = 'none';
        }

        return screen;
    }

    bindButtons() {
        getElement('deck-notes-prev-btn')?.addEventListener('click', () => this.handlers.onPrev?.());
        getElement('deck-notes-next-btn')?.addEventListener('click', () => this.handlers.onNext?.());
        getElement('deck-notes-next-empty-btn')?.addEventListener('click', () => this.handlers.onNextEmptyClock?.());
        getElement('deck-notes-start-btn')?.addEventListener('click', () => this.handlers.onStart?.());
        getElement('deck-notes-back-btn')?.addEventListener('click', () => this.handlers.onBack?.());
        getElement('deck-notes-exit-btn')?.addEventListener('click', () => this.handlers.onExit?.());
    }

    /** Render the sheet header: pod name plus a link to the spreadsheet. */
    renderHeader({ spreadsheetId, sheetTitle, podName }) {
        const section = getElement('deck-notes-sheet-info');
        if (!section) {
            return;
        }

        const link = document.createElement('a');
        link.setAttribute('id', 'deck-notes-sheet-link');
        link.target = '_blank';
        link.href = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
        link.title = 'Open pod in Google Sheets';

        const heading = document.createElement('h2');
        heading.setAttribute('id', 'deck-notes-sheet-title');
        heading.textContent = podName || sheetTitle || 'Deck Notes';

        const subTitle = document.createElement('small');
        subTitle.className = 'small-text';
        subTitle.textContent = 'Deck Notes';

        link.appendChild(heading);
        link.appendChild(subTitle);
        section.replaceChildren(link);
    }

    /**
     * Render one deck: its cards (via the card presenter) and the shared
     * deck-info panel in its prominent variant.
     */
    renderDeck({ deckString, deckInfo, index, total, onSaveField, clockSignature }) {
        const heading = getElement('deck-notes-deck-heading');
        if (heading) {
            heading.textContent = `Deck ${index + 1} of ${total}`;
        }

        renderDeckInfo(getElement('deck-notes-deck-info'), {
            deckString,
            deckInfo,
            onSaveField,
            variant: 'prominent',
            clockSignature
        });
    }

    renderProgress(index, total) {
        const progress = getElement('deck-notes-progress');
        if (progress) {
            progress.textContent = total === 0 ? '' : `Deck ${index + 1} of ${total}`;
        }
    }

    /** Show how many of the grouped decks have their goldfish clock filled. */
    renderClockProgress({ filled, total }) {
        const clocks = getElement('deck-notes-clocks');
        if (clocks) {
            clocks.textContent = `${filled} of ${total} clocks filled`;
        }
    }

    /**
     * Navigation state: arrow bounds, the Start guruing gate and whether the
     * Back-to-analysis affordance applies (only when a session is open).
     */
    renderNavigation({ index, total, canStart, showBack }) {
        const prev = getElement('deck-notes-prev-btn');
        const next = getElement('deck-notes-next-btn');
        if (prev) prev.disabled = index <= 0;
        if (next) next.disabled = index >= total - 1;

        const start = getElement('deck-notes-start-btn');
        if (start) {
            // "Start guruing" belongs to the pre-guruing gate; when opened from
            // analysis there is nothing to start.
            start.style.display = showBack ? 'none' : '';
            start.disabled = !canStart;
            start.title = canStart ? '' : 'Fill every goldfish clock before guruing';
        }

        const back = getElement('deck-notes-back-btn');
        if (back) {
            back.style.display = showBack ? 'inline-block' : 'none';
        }
    }

    /** Replace one deck's card slots with their loading state. */
    renderCardLoading(containerId, cardNames) {
        const container = getElement(containerId);
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
    renderCards(slots, deckImages, { getCardUrl }) {
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

    renderCardError(slots) {
        slots.forEach(slot => {
            slot.innerHTML = '<div class="card-error">Failed to load</div>';
        });
    }

    /** Remove the screen and restore the analysis interface. */
    destroy() {
        getElement('deck-notes-screen')?.remove();
        this.screen = null;

        const analysisInterface = getElement('guru-analysis-interface');
        if (analysisInterface) {
            analysisInterface.style.display = '';
        }
    }
}
