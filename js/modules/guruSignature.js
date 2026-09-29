/**
 * Guru Signature Manager
 * Handles guru username storage and validation
 */
import { CONFIG } from '../config.js';
import { APP_EVENTS } from '../app/events.js';


export class GuruSignature {
    constructor(authManager, events = null) {
        this.storageKey = CONFIG.STORAGE_KEYS.GURU_SIGNATURE;
        this.authManager = authManager;
        this.events = events;
        this.callbacks = {
            onSignatureSet: [],
            onSignatureChanged: []
        };
        this.signature = null; // In-memory signature for this session
        this.initialized = false;
        this.bindEvents();
    }

    async initSignature(signature) {
        if (signature) {
            this.signature = signature;
            this.displaySignature(this.signature);
            this.hideSignatureSection();
            this.showSheetInputSection();
            this.notifyCallbacks('onSignatureSet', this.signature);
        } else {
            this.showSignatureSection();
        }
        this.initialized = true;
    }

    bindEvents() {
        const setSignatureBtn = document.getElementById('set-signature-btn');
        const changeSignatureBtn = document.getElementById('change-signature-btn');
        const signatureInput = document.getElementById('guru-signature');

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
        const signatureInput = document.getElementById('guru-signature');
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

        // Update auth manager header display
        if (this.authManager) {
            this.authManager.updateGuruSignature(finalSignature);
        }

        this.displaySignature(finalSignature);
        this.hideSignatureSection();
        this.showSheetInputSection();
        this.notifyCallbacks('onSignatureSet', finalSignature);
    }

    changeSignature() {
        const signatureInput = document.getElementById('guru-signature');
        const currentSignature = this.getSignature();
        
        signatureInput.value = currentSignature;
        this.showSignatureSection();
        signatureInput.focus();
        signatureInput.select();
    }

    async saveSignature(signature) {
        // Use authManager to save signature (which will handle Drive vs localStorage)
        if (this.authManager) {
            await this.authManager.saveGuruSignature(signature);
        } else {
            // Fall back to localStorage if authManager not available
            localStorage.setItem(this.storageKey, signature);
        }
        // Always update in-memory value
        this.signature = signature;
    }

    getSignature() {
        return this.signature;
    }

    displaySignature(signature) {
        const guruDisplayName = document.getElementById('guru-display-name');
        const guruInfo = document.getElementById('guru-info');
        
        if (guruDisplayName && guruInfo) {
            guruDisplayName.textContent = signature;
            guruInfo.style.display = 'block';
        }
    }

    showSignatureSection() {
        const signatureSection = document.getElementById('guru-signature-section');
        const guruSignatureInput = document.getElementById('guru-signature');
        const sheetInputSection = document.getElementById('sheet-input-section');
        const guruInfo = document.getElementById('guru-info');
        
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
        const signatureSection = document.getElementById('guru-signature-section');
        
        if (signatureSection) {
            signatureSection.style.display = 'none';
        }
    }

    showSheetInputSection() {
        const sheetInputSection = document.getElementById('sheet-input-section');
        
        if (sheetInputSection) {
            sheetInputSection.style.display = 'block';
        }
    }

    showError(message) {
        // Create or update error message
        let errorDiv = document.getElementById('guru-signature-error');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.id = 'guru-signature-error';
            errorDiv.className = 'status-message error';
            
            const signatureSection = document.getElementById('guru-signature-section');
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

    clearSignature() {
        localStorage.removeItem(this.storageKey);
        this.signature = null;
        this.showSignatureSection();
        document.getElementById('guru-signature').value = '';
        this.notifyCallbacks('onSignatureChanged', null);
    }

    hasSignature() {
        return !!this.signature;
    }

    // Event system for other modules to listen to signature changes
    onSignatureSet(callback) {
        this.callbacks.onSignatureSet.push(callback);
    }

    onSignatureChanged(callback) {
        this.callbacks.onSignatureChanged.push(callback);
    }

    notifyCallbacks(event, signature) {
        this.callbacks[event].forEach(callback => {
            try {
                callback(signature);
            } catch (error) {
                console.error('Error in guru signature callback:', error);
            }
        });
    }

    // Get signature with metadata for audit trail
    getSignatureWithMetadata() {
        const signature = this.getSignature();
        if (!signature) return null;

        return {
            signature,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            sessionId: this.getSessionId()
        };
    }

    getSessionId() {
        let sessionId = sessionStorage.getItem('3cb-session-id');
        if (!sessionId) {
            sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('3cb-session-id', sessionId);
        }
        return sessionId;
    }
}
