import { logger } from '../utils/log.js';
import { getElement } from '../utils/domUtils.js';

export class UIController {
    constructor(guruSignature = null) {
        this.statusMessage = getElement('status-message');
        this.sheetEditor = getElement('sheet-editor');
        this.loadBtn = getElement('load-sheet-btn');
        this.refreshBtn = getElement('refresh-btn');
        // The single owner of the signature, injected by main.js. Used only to
        // decide whether the signature section should stay hidden.
        this.guruSignature = guruSignature;

        // --- Pointer type detection ---
        this._pointerType = null;
        this._pointerDetectionDone = false;
        this._pointerHandler = (e) => {
            if (!this._pointerDetectionDone) {
                this._pointerType = e.pointerType;
                this._pointerDetectionDone = true;
                logger.debug(`Pointer type detected: ${this._pointerType}`);
                window.removeEventListener('pointerdown', this._pointerHandler, true);
                window.removeEventListener('pointermove', this._pointerHandler, true);
            }
        };
        window.addEventListener('pointerdown', this._pointerHandler, true);
        window.addEventListener('pointermove', this._pointerHandler, true);
    }
    /**
     * Returns the detected pointer type: 'mouse', 'touch', 'pen', or null if not yet detected.
     */
    getPointerType() {
        return this._pointerType;
    }

    showStatus(message, type = 'info') {
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status-message ${type}`;
        this.statusMessage.style.display = 'block';

        // Auto-hide success messages after 3 seconds, info messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                this.hideStatus();
            }, 3000);
        } else if (type === 'info') {
            setTimeout(() => {
                this.hideStatus();
            }, 5000);
        }
    }

    hideStatus() {
        this.statusMessage.style.display = 'none';
        this.statusMessage.className = 'status-message';
    }

    showSheetEditor(title = 'Sheet Editor') {
        // Hide the other sections for fullscreen experience
        const guruSignatureSection = getElement('guru-signature-section');
        const sheetInputSection = getElement('sheet-input-section');
        const header = document.querySelector('header');

        if (guruSignatureSection) guruSignatureSection.style.display = 'none';
        if (sheetInputSection) sheetInputSection.style.display = 'none';
        if (header) header.style.display = 'none';

        // Add fullscreen class and show the editor
        this.sheetEditor.classList.add('fullscreen-analysis');
        this.sheetEditor.style.display = 'block';

        // Add body class for mobile scrolling support
        document.body.classList.add('fullscreen-mode');
    }

    hideSheetEditor() {
        this.sheetEditor.style.display = 'none';
    }

    clearURLParameters() {
        // Clear every deep-link parameter the app reads (pod / guru / hub /
        // match) when returning to home. `match` is the row parameter; there is
        // no `row` parameter (phase 4 of #18).
        const newUrl = new URL(window.location);
        newUrl.searchParams.delete('pod');
        newUrl.searchParams.delete('guru');
        newUrl.searchParams.delete('hub');
        newUrl.searchParams.delete('match');
        window.history.replaceState({}, '', newUrl);

        // Reset document title
        document.title = 'The Stylus';
    }

    hideHomeScreen() {
        // Hide the home screen sections to go directly to analysis mode
        const sheetInputSection = getElement('sheet-input-section');
        const guruSignatureSection = getElement('guru-signature-section');

        if (sheetInputSection) {
            sheetInputSection.style.display = 'none';
        }
        if (guruSignatureSection) {
            guruSignatureSection.style.display = 'none';
        }

        logger.debug('🏠 Home screen hidden for direct analysis mode');
    }

    showSheetInputSection() {
        // Clear URL parameters when returning to home
        this.clearURLParameters();

        // Show the input sections again when exiting fullscreen analysis
        const sheetInputSection = getElement('sheet-input-section');
        const header = document.querySelector('header');

        // Hide the sheet editor
        this.sheetEditor.style.display = 'none';

        // Always show these sections
        if (sheetInputSection) sheetInputSection.style.display = 'block';
        if (header) header.style.display = 'block';

        // Remove body class for mobile scrolling support
        document.body.classList.remove('fullscreen-mode');

        // Only show the guru signature section when no signature is set. Ask the
        // single owner rather than reading localStorage behind its back.
        const hasSignature = this.guruSignature?.hasSignature() ?? false;
        const guruSignatureSection = getElement('guru-signature-section');

        if (guruSignatureSection) {
            if (hasSignature) {
                // User has a signature, keep the section hidden
                guruSignatureSection.style.display = 'none';
                logger.debug('🔒 Guru signature exists, keeping section hidden');
            } else {
                // No signature set, show the section
                guruSignatureSection.style.display = 'block';
                logger.debug('⚠️ No guru signature found, showing section');
            }
        }
    }

    setLoadingState(isLoading) {
        // `#save-btn` does not exist in the markup: the analysis screen has no
        // Save button, so there is nothing to toggle for it here.
        const buttons = [
            { element: this.loadBtn, idle: 'Load Results', busy: 'Loading...' },
            { element: this.refreshBtn, idle: 'Refresh', busy: 'Refreshing...' }
        ];

        buttons.forEach(({ element, idle, busy }) => {
            if (!element) {
                return;
            }
            element.disabled = isLoading;
            element.innerHTML = isLoading
                ? `<span class="loading-spinner"></span>${busy}`
                : idle;
        });
    }

    showError(message) {
        this.showStatus(message, 'error');
    }

    showSuccess(message) {
        this.showStatus(message, 'success');
    }

    showLoading(message) {
        this.showStatus(message, 'loading');
    }

    enableEditorControls() {
        if (this.refreshBtn) this.refreshBtn.disabled = false;
    }

    disableEditorControls() {
        if (this.refreshBtn) this.refreshBtn.disabled = true;
    }

    showConfirmDialog(message) {
        return new Promise((resolve) => {
            const result = confirm(message);
            resolve(result);
        });
    }
}
