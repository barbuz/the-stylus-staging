/**
 * Analysis view.
 *
 * Owns all DOM work for the single-row analysis screen: the sheet header, the
 * scoring value and guru analysis list, button visibility/anchoring, card
 * slots, deck info, progress and the mirror-match button. The controller only
 * passes state in and never touches the DOM itself.
 *
 * All user-derived strings are escaped before being placed in innerHTML.
 */
import {
    GURU_COLORS,
    colourLabel,
    getCurrentColorAnalysis,
    getCurrentColorSignature
} from '../domain/guruColor.js';
import {
    getAnalysisClass,
    formatAnalysisValue,
    getOutcomeDisplayName,
    describeOutcome
} from '../domain/analyses.js';
import { escapeHtml, getElement } from '../utils/domUtils.js';
import { renderDeckInfo, updateDeckInfoValue } from './deckInfoView.js';

function setDisplay(element, value) {
    if (element) {
        element.style.display = value;
    }
}

export class AnalysisView {
    /**
     * @param {object} handlers
     * @param {Function} handlers.onClaim
     * @param {Function} handlers.onClaimDeck
     * @param {Function} handlers.onUnclaim
     * @param {Function} handlers.onClear
     */
    constructor(handlers = {}) {
        this.handlers = handlers;
        this.bindButtons();
    }

    bindButtons() {
        getElement('claim-button')?.addEventListener('click', () => this.handlers.onClaim?.());
        getElement('unclaim-button')?.addEventListener('click', () => this.handlers.onUnclaim?.());
        getElement('clear-result-button')?.addEventListener('click', () => this.handlers.onClear?.());

        const claimDeck = getElement('claim-deck-button');
        claimDeck?.addEventListener('click', async () => {
            claimDeck.disabled = true;
            claimDeck.innerHTML = '<span class="spinner"></span> Claiming...';
            try {
                await this.handlers.onClaimDeck?.();
            } finally {
                claimDeck.disabled = false;
            }
        });
    }

    /** Put a button into its disabled spinner state; returns the button. */
    beginSpinner(id, text) {
        const button = getElement(id);
        if (!button) {
            return null;
        }
        button.dataset.originalText = button.textContent;
        button.disabled = true;
        button.innerHTML = `<span class="spinner"></span> ${escapeHtml(text)}`;
        return button;
    }

    /** Restore a button from its spinner state. */
    endSpinner(button) {
        if (!button) {
            return;
        }
        button.disabled = false;
        button.textContent = button.dataset.originalText || '';
    }

    /**
     * Render the sheet header (title, pod name, sheet link).
     *
     * @param {object} info
     * @param {string} info.spreadsheetId
     * @param {string} info.title
     * @param {string} [info.podName]
     * @param {number} info.matchNumber 1-based match number for the pod title
     */
    renderSheetInfo({ spreadsheetId, title, podName, matchNumber }) {
        const sheetInfoSection = getElement('sheet-info');
        if (!sheetInfoSection) {
            return;
        }

        const sheetLink = document.createElement('a');
        sheetLink.setAttribute('id', 'google-sheet-link');
        sheetLink.target = '_blank';
        sheetLink.href = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
        sheetLink.title = 'Open pod in Google Sheets';

        const heading = document.createElement('h2');
        heading.setAttribute('id', 'sheet-title');

        if (podName) {
            heading.textContent = `${podName} ${matchNumber}`;
            sheetInfoSection.replaceChildren(heading, sheetLink);

            const subTitle = document.createElement('small');
            subTitle.setAttribute('id', 'full-sheet-title');
            subTitle.setAttribute('class', 'small-text');
            subTitle.textContent = title;
            sheetLink.appendChild(subTitle);
        } else {
            heading.textContent = title;
            sheetInfoSection.replaceChildren(sheetLink);
            sheetLink.appendChild(heading);
        }
    }

    /** Progress text, e.g. "Match 3 of 12". */
    renderProgress(rowIndex, total) {
        const info = getElement('current-row-info');
        if (info) {
            info.textContent = `Match ${rowIndex + 1} of ${total}`;
        }
    }

    renderGuruColor(colour) {
        const trigger = getElement('sheet-name-info');
        if (trigger && colour) {
            trigger.textContent = `${colourLabel(colour)} Guru`;
        }
    }

    /** The current outcome cell: text plus CSS class. */
    renderOutcome(outcomeValue) {
        const element = getElement('current-analysis-value');
        const { text, className } = describeOutcome(outcomeValue);
        if (element) {
            element.textContent = text;
            element.className = className;
        }
    }

    /**
     * Render the guru analysis list. `showOtherGurus` mirrors the original:
     * other gurus' readings are revealed once the row is not available to score.
     *
     * @param {object} options
     * @param {object} options.row
     * @param {string} options.outcomeValue
     * @param {string} options.colour
     * @param {boolean} options.showOtherGurus
     * @param {string|null} options.threadUrl
     * @param {number} options.rowIndex
     */
    buildAnalysisList({ row, outcomeValue, colour, showOtherGurus, threadUrl, rowIndex }) {
        const allAnalyses = [{
            name: colourLabel(colour),
            value: getCurrentColorAnalysis(row, colour),
            isCurrent: true
        }];

        for (const other of GURU_COLORS) {
            if (other === colour) {
                continue;
            }
            const rawSignature = getCurrentColorSignature(row, other);
            allAnalyses.push({
                name: colourLabel(other),
                signature: rawSignature && rawSignature.trim() !== '' ? rawSignature : null,
                value: getCurrentColorAnalysis(row, other),
                isCurrent: false
            });
        }

        let html = '<div class="analysis-list">';
        html += `<div class="outcome-header">${escapeHtml(getOutcomeDisplayName(outcomeValue))}</div>`;
        html += '<ul class="guru-analyses-list">';

        allAnalyses.forEach(analysis => {
            const displayValue = showOtherGurus || !analysis.value
                ? formatAnalysisValue(analysis.value)
                : '███';
            const cssClass = showOtherGurus ? getAnalysisClass(analysis.value) : 'other';
            const prefix = analysis.isCurrent ? 'You' : analysis.name;

            const labelHtml = analysis.signature
                ? `<span class="guru-analysis-label guru-signature">
                    ${escapeHtml(prefix)}:
                    <span class="guru-signature-tooltip">${escapeHtml(analysis.signature)}</span>
                </span>`
                : `<span class="guru-analysis-label">${escapeHtml(prefix)}:</span>`;

            html += `<li class="guru-analysis-item">
                ${labelHtml}
                <span class="analysis-result ${cssClass}">${escapeHtml(displayValue)}</span>
            </li>`;
        });

        html += '</ul></div>';

        if (threadUrl) {
            html += `<a href="${escapeHtml(threadUrl)}" target="_blank" rel="noopener noreferrer" class="discord-icon-link" title="Open Guru Match Help post">
                <img src="images/Discord-Symbol-Blurple.svg" alt="Discord" />
            </a>`;
        } else {
            html += `<button class="discord-icon-button create-thread-btn" data-row-index="${rowIndex}" title="Create Guru Match Help post">
                <img src="images/Discord-Symbol-Black.svg" alt="Discord" />
            </button>`;
        }

        const element = getElement('current-analysis-value');
        if (element) {
            element.innerHTML = html;
        }
    }

    /**
     * Show/hide the claim/unclaim/clear/scoring buttons for the row's ownership.
     *
     * @param {object} options
     * @param {object} options.row
     * @param {string} options.colour
     * @param {string} options.signature
     * @param {number|null} options.analysisValue parsed analysis to highlight
     * @param {object} options.deckStats { totalMatches, unclaimedMatches }
     */
    renderButtons({ row, colour, signature, analysisValue, deckStats }) {
        const signatureValue = getCurrentColorSignature(row, colour);
        const claimedByAnother = signatureValue && signatureValue.trim() !== '' && signatureValue !== signature;
        const unclaimed = !signatureValue || signatureValue.trim() === '';
        const owned = signatureValue === signature;

        const scoringButtons = document.querySelectorAll('.scoring-btn');
        const claimButton = getElement('claim-button');
        const claimDeckButton = getElement('claim-deck-button');
        const unclaimButton = getElement('unclaim-button');
        const clearButton = getElement('clear-result-button');
        const claimedMessage = getElement('claimed-message');
        const nextDeckBtn = getElement('next-deck-btn');

        if (claimedByAnother) {
            scoringButtons.forEach(btn => { btn.style.display = 'none'; });
            setDisplay(claimButton, 'none');
            setDisplay(claimDeckButton, 'none');
            setDisplay(unclaimButton, 'none');
            setDisplay(clearButton, 'none');
            setDisplay(nextDeckBtn, 'none');

            const currentAnalysis = getCurrentColorAnalysis(row, colour);
            const analysisText = currentAnalysis && currentAnalysis.trim() !== ''
                ? ` - Analysis: ${formatAnalysisValue(currentAnalysis)}`
                : '';
            if (claimedMessage) {
                claimedMessage.style.display = 'block';
                claimedMessage.textContent = `Claimed by ${signatureValue}${analysisText}`;
            }
        } else if (unclaimed) {
            scoringButtons.forEach(btn => { btn.style.display = 'none'; });
            setDisplay(claimedMessage, 'none');
            setDisplay(unclaimButton, 'none');
            setDisplay(clearButton, 'none');
            setDisplay(nextDeckBtn, 'inline-block');

            if (claimButton) {
                claimButton.style.display = 'block';
                claimButton.disabled = false;
                claimButton.textContent = 'Claim Match';
            }
            if (claimDeckButton) {
                claimDeckButton.style.display = 'inline-block';
                claimDeckButton.textContent = `Claim Deck (${deckStats.unclaimedMatches}/${deckStats.totalMatches})`;
            }
        } else if (owned) {
            scoringButtons.forEach(btn => { btn.style.display = ''; });
            setDisplay(claimedMessage, 'none');
            setDisplay(claimButton, 'none');
            setDisplay(claimDeckButton, 'none');
            setDisplay(nextDeckBtn, 'none');

            const currentAnalysis = getCurrentColorAnalysis(row, colour);
            const hasUserScored = currentAnalysis && currentAnalysis.trim() !== '';
            if (!hasUserScored) {
                if (unclaimButton) {
                    unclaimButton.style.display = 'block';
                    unclaimButton.disabled = false;
                    unclaimButton.textContent = 'Unclaim Match';
                }
                setDisplay(clearButton, 'none');
            } else {
                setDisplay(unclaimButton, 'none');
                if (clearButton) {
                    clearButton.style.display = 'block';
                    clearButton.disabled = false;
                    clearButton.textContent = 'Clear My Result';
                }
            }

            this.highlightAnalysisButton(analysisValue);
        }
    }

    /** Highlight the matching scoring button for a numeric analysis value. */
    highlightAnalysisButton(outcomeValue) {
        document.querySelectorAll('.scoring-btn').forEach(btn => btn.classList.remove('current-analysis'));
        if (typeof outcomeValue !== 'number') {
            return;
        }
        const id = outcomeValue === 1.0 ? 'win-btn'
            : outcomeValue === 0.5 ? 'tie-btn'
                : outcomeValue === 0.0 ? 'loss-btn'
                    : null;
        if (id) {
            getElement(id)?.classList.add('current-analysis');
        }
    }

    renderNavigation(rowIndex, total) {
        const prev = getElement('prev-btn');
        const next = getElement('next-btn');
        if (prev) prev.disabled = rowIndex === 0;
        if (next) next.disabled = rowIndex >= total - 1;
    }

    renderDiscrepancyButton(numDiscrepancies) {
        const button = getElement('discrepancy-btn');
        if (!button) {
            return;
        }
        if (numDiscrepancies > 0) {
            button.style.display = 'inline-block';
            button.textContent = `Next Discrepancy (${numDiscrepancies})`;
        } else {
            button.style.display = 'none';
        }
    }

    /**
     * Mirror-match button state.
     *
     * @param {object} options
     * @param {boolean} options.showOutcome
     * @param {string} options.inverseLetter
     * @param {boolean} options.isSuspectedError
     */
    renderMirrorButton({ showOutcome, inverseLetter, isSuspectedError }) {
        const button = getElement('mirror-match-btn');
        if (!button) {
            return;
        }

        button.textContent = '↕';
        button.title = 'Jump to mirror match';

        if (!showOutcome) {
            button.removeAttribute('data-outcome');
            button.className = 'mirror-match-btn';
            return;
        }

        button.setAttribute('data-outcome', inverseLetter);
        button.className = 'mirror-match-btn has-outcome';
        if (isSuspectedError) {
            button.classList.add('inverse-error');
        }
    }

    /** Render the deck info panel for a player, wiring the inline editors. */
    renderDeckInfo(playerId, deckString, deckInfo, { onSaveField }) {
        renderDeckInfo(getElement(`${playerId}-deck-info`), {
            deckString,
            deckInfo,
            onSaveField,
            variant: 'compact'
        });
    }

    /** Update a single deck-info note value in place after a successful save. */
    updateDeckInfoValue(span, newValue) {
        updateDeckInfoValue(span, newValue);
    }

    /**
     * Reset a card player's slots to their loading state with card names.
     * Returns the slots so the caller can display the loaded images.
     */
    renderCardLoading(playerId, cardNames) {
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

    /** Replace the whole interface with the empty-state message. */
    showNoDataMessage() {
        const analysisInterface = getElement('guru-analysis-interface');
        if (analysisInterface) {
            analysisInterface.innerHTML = `
                <div class="empty-state">
                    <h3>No Analysis Data Found</h3>
                    <p>No rows found with the required columns:</p>
                    <ul>
                        <li>Player 1</li>
                        <li>Player 2</li>
                        <li>Guru Analysis columns (Red, Blue, Green)</li>
                    </ul>
                    <p>Please check that your sheets have the correct column headers and data.</p>
                </div>
            `;
        }
    }

    /**
     * Hide the analysis interface and show the full-screen colour picker with a
     * claimed/total count per colour.
     *
     * @param {object} options
     * @param {object} options.stats per-colour { claimed, total }
     * @param {string} options.sheetTitle
     * @param {Function} options.onSelect called with the chosen colour
     */
    showColorSelection({ stats, sheetTitle, onSelect }) {
        const analysisInterface = getElement('guru-analysis-interface');
        if (!analysisInterface) {
            return;
        }
        analysisInterface.style.display = 'none';

        const container = document.createElement('div');
        container.id = 'color-selection-container';
        container.className = 'color-selection-container full-screen';

        const colorOptions = GURU_COLORS.map(colour => {
            const label = colourLabel(colour);
            const colourStats = stats[colour] || { claimed: 0, total: 0 };
            return `
                    <div class="color-option" id="color-${colour}">
                        <div class="color-circle ${colour}"></div>
                        <div class="color-info">
                            <h4>${label} Guru</h4>
                            <p>${colourStats.claimed} / ${colourStats.total} matches claimed</p>
                        </div>
                        <button class="select-color-btn" data-color="${colour}">Select ${label}</button>
                    </div>`;
        }).join('\n');

        container.innerHTML = `
            <div class="color-selection-screen">
                <h3>Choose Your Guru Color</h3>
                <h4 class="sheet-title">Pod: ${escapeHtml(sheetTitle)}</h4>
                <p>Your signature was not found in any existing analysis. Please select which guru color you want to use for analysis:</p>

                <div class="color-options">${colorOptions}
                </div>

                <p class="color-selection-note">You can start analysing matches by claiming unclaimed matches or work on matches already assigned to your chosen color.</p>
            </div>
        `;

        analysisInterface.parentNode.insertBefore(container, analysisInterface.nextSibling);

        container.querySelectorAll('.select-color-btn').forEach(button => {
            button.addEventListener('click', (event) => {
                onSelect?.(event.target.getAttribute('data-color'));
            });
        });
    }

    /** Remove the colour picker and show the analysis interface again. */
    hideColorSelection() {
        getElement('color-selection-container')?.remove();
        const analysisInterface = getElement('guru-analysis-interface');
        if (analysisInterface) {
            analysisInterface.style.display = '';
        }
    }
}
