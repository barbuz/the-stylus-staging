/**
 * Guru Signature Manager
 * Handles guru username storage and validation
 */
import { CONFIG } from '../config.js';
import { APP_EVENTS } from '../app/events.js';
import { logger } from '../utils/log.js';
import { getElement } from '../utils/domUtils.js';
import { getItem, setItem } from '../services/storage.js';


export class GuruSignature {
    constructor(authManager, events = null) {
        this.storageKey = CONFIG.STORAGE_KEYS.GURU_SIGNATURE;
        this.authManager = authManager;
        this.events = events;
        // The one place the current value lives. Persistence is delegated to
        // UserPreferences; nothing else keeps a copy (phase 5 of #18).
        this.userPreferences = authManager?.userPreferences || null;
        this.callbacks = {
            onSignatureSet: []
        };
        this.signature = null; // In-memory signature for this session
        this.initialized = false;
        this.bindEvents();
    }

    /** Load the persisted signature into memory and update the UI. */
    async initSignature() {
        const signature = this.userPreferences
            ? await this.userPreferences.getGuruSignature()
            : getItem(this.storageKey) || '';

        if (signature) {
            this.signature = signature;
            this.displaySignature(signature);
            this.hideSignatureSection();
            this.showSheetInputSection();
            this.authManager?.renderAuthSection();
            this.notifyCallbacks('onSignatureSet', signature);
        } else {
            this.showSignatureSection();
        }
        this.initialized = true;
    }

    bindEvents() {
        const setSignatureBtn = getElement('set-signature-btn');
        const changeSignatureBtn = getElement('change-signature-btn');
        const signatureInput = getElement('guru-signature');

        if (setSignatureBtn) {
            setSignatureBtn.addEventListener('click', () => this.setSignature());
        }

        if (changeSignatureBtn) {
            changeSignatureBtn.addEventListener('click', () => this.changeSignature());
        }

        if (signatureInput) {
            signatureInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.setSignature();
                }
            });
        }

        // Listen for requests to change guru signature
        this.events?.on(APP_EVENTS.REQUEST_GURU_SIGNATURE_CHANGE, () => {
            this.changeSignature();
        });
    }


    async setSignature(signature = null) {
        const signatureInput = getElement('guru-signature');
        const finalSignature = signature || signatureInput.value.trim();

        if (!finalSignature) {
            this.showError('Please enter your Guru Signature (username)');
            return;
        }

        if (finalSignature.length > 50) {
            this.showError('Guru Signature must be less than 50 characters');
            return;
        }

        await this.saveSignature(finalSignature);
        this.signature = finalSignature;

        this.displaySignature(finalSignature);
        this.hideSignatureSection();
        this.showSheetInputSection();
        this.authManager?.renderAuthSection();
        this.notifyCallbacks('onSignatureSet', finalSignature);
    }

    changeSignature() {
        const signatureInput = getElement('guru-signature');
        const currentSignature = this.getSignature();

        signatureInput.value = currentSignature;
        this.showSignatureSection();
        signatureInput.focus();
        signatureInput.select();
    }

    /** Persist through the single owner (UserPreferences), with a localStorage fallback. */
    async saveSignature(signature) {
        if (this.userPreferences) {
            await this.userPreferences.setGuruSignature(signature);
        } else {
            setItem(this.storageKey, signature);
        }
        this.signature = signature;
    }

    getSignature() {
        return this.signature;
    }

    displaySignature(signature) {
        const guruDisplayName = getElement('guru-display-name');
        const guruInfo = getElement('guru-info');

        if (guruDisplayName && guruInfo) {
            guruDisplayName.textContent = signature;
            guruInfo.style.display = 'block';
        }
    }

    showSignatureSection() {
        const signatureSection = getElement('guru-signature-section');
        const guruSignatureInput = getElement('guru-signature');
        const sheetInputSection = getElement('sheet-input-section');
        const guruInfo = getElement('guru-info');

        if (signatureSection) {
            signatureSection.style.display = 'block';
        }
        if (guruSignatureInput) {
            guruSignatureInput.value = this.getSignature() || '';
            guruSignatureInput.focus();
            guruSignatureInput.select();
        }
        if (sheetInputSection) {
            sheetInputSection.style.display = 'none';
        }
        if (guruInfo) {
            guruInfo.style.display = 'none';
        }
    }

    hideSignatureSection() {
        const signatureSection = getElement('guru-signature-section');

        if (signatureSection) {
            signatureSection.style.display = 'none';
        }
    }

    showSheetInputSection() {
        const sheetInputSection = getElement('sheet-input-section');

        if (sheetInputSection) {
            sheetInputSection.style.display = 'block';
        }
    }

    showError(message) {
        // Create or update error message
        let errorDiv = getElement('guru-signature-error');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.id = 'guru-signature-error';
            errorDiv.className = 'status-message error';

            const signatureSection = getElement('guru-signature-section');
            if (signatureSection) {
                signatureSection.appendChild(errorDiv);
            }
        }

        errorDiv.textContent = message;
        errorDiv.style.display = 'block';

        // Hide error after 5 seconds
        setTimeout(() => {
            if (errorDiv) {
                errorDiv.style.display = 'none';
            }
        }, 5000);
    }

    hasSignature() {
        return !!this.signature;
    }

    /** Notify listeners that a signature is now set (main.js wires the status line). */
    onSignatureSet(callback) {
        this.callbacks.onSignatureSet.push(callback);
    }

    notifyCallbacks(event, signature) {
        this.callbacks[event].forEach(callback => {
            try {
                callback(signature);
            } catch (error) {
                logger.error('Error in guru signature callback:', error);
            }
        });
    }
}
