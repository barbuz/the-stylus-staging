import { GoogleSheetsAPI } from './modules/googleSheetsAPI.js';
import { UIController } from './modules/uiController.js';
import { AuthManager } from './modules/authManager.js';
import { GuruSignature } from './modules/guruSignature.js';
import { AnalysisController } from './ui/analysisController.js';
import { RecentPodsManager } from './modules/recentPods.js';
import { CONFIG, DEPLOYMENTS } from './config.js';
import { EventBus, APP_EVENTS } from './app/events.js';
import {
    isValidGoogleSheetsUrl,
    extractSheetId,
    sanitizeUrlParam,
    deploymentForPath,
    alternateDeploymentUrl,
    resolveDeploymentRedirect
} from './utils/urlUtils.js';
import { logger } from './utils/log.js';
import { getElement } from './utils/domUtils.js';
import { getItem, setItem, removeItem } from './services/storage.js';

class ThreeCardBlindGuruTool {
    constructor() {
        // One local bus for the login / logout / signature flow, replacing the
        // window CustomEvents and the boolean guard flags (phase 4 of #18).
        this.events = new EventBus();
        this.authManager = new AuthManager(this.events);
        this.guruSignature = new GuruSignature(this.authManager, this.events);
        // Hand the owner to the components that need it, so nothing else keeps
        // a copy of the signature (phase 5 of #18).
        this.authManager.guruSignature = this.guruSignature;
        this.sheetsAPI = new GoogleSheetsAPI(this.authManager);
        this.uiController = new UIController(this.guruSignature);
        this.analysisInterface = null; // Initialized after auth
        this.recentPodsManager = new RecentPodsManager();

        this.currentSheetData = null;
        this.currentSpreadsheetId = null;
        this._domBound = false;
        this._signatureHandlersBound = false;

        this.setupEventSubscriptions();
        this.init();
    }

    /**
     * Subscribe to the app events. Registration happens exactly once per page
     * load; the handlers themselves are written to be safe to re-run.
     */
    setupEventSubscriptions() {
        this.events.on(APP_EVENTS.USER_LOGGED_IN, () => this.onUserLoggedIn());
        this.events.on(APP_EVENTS.USER_LOGGED_OUT, () => this.clearLocalPreferences());
    }

    /**
     * Bring the authenticated session to life: render the signed-in chrome,
     * wire handlers once, and pull the persisted signature / recent pods in.
     */
    async onUserLoggedIn() {
        this.authManager.renderAuthSection();
        this.authManager.showAppContent();

        this.setupGuruSignatureHandlers();
        this.bindEvents();

        if (this.authManager.userPreferences && this.authManager.userPreferences.isInitialized) {
            // The single owner loads the persisted signature and updates the UI.
            await this.guruSignature.initSignature();
            // setUserPreferences already loads and renders recent pods/hubs
            this.recentPodsManager.setUserPreferences(this.authManager.userPreferences);
        }
    }

    async init() {
        try {
            // Honour this browser's deployment preference before doing any
            // authentication work, so a preview tester opening a production
            // deep link lands in preview (and vice versa).
            if (this.applyDeploymentPreference()) {
                return;
            }

            // Show loading while initializing
            this.showLoading('Initializing application...');

            // Check authentication status
            const isAuthenticated = await this.authManager.checkAuthStatus();

            // Hide loading after checking authentication
            this.hideLoading();

            if (isAuthenticated) {
                // Bring the session up directly; on a restored session the login
                // event also fires on a short delay, and onUserLoggedIn is safe
                // to run more than once.
                await this.onUserLoggedIn();

                // Check if we should go directly to analysis mode based on URL parameters
                const hasUrlParameters = await this.checkForDirectAnalysisMode();

                if (!hasUrlParameters) {
                    // No URL parameters, show normal home screen
                    if (this.authManager.isLoggedIn()) {
                        this.uiController.showStatus('Ready to load pod sheet', 'success');
                    } else {
                        this.authManager.showLoginScreen();
                    }
                }
            } else {
                // User is not authenticated, show login screen
                logger.debug('User not authenticated, showing login screen');
                this.authManager.showLoginScreen();
            }
        } catch (error) {
            logger.error('Error initializing application:', error);
            this.hideLoading();
            this.uiController.showStatus('Error initializing Google API. Please refresh the page.', 'error');
        }
    }

    currentDeploymentKey() {
        return deploymentForPath(window.location.pathname, DEPLOYMENTS);
    }

    /**
     * Redirect a deep link to this browser's preferred deployment. Returns true
     * when a redirect was started (the caller must stop initialising).
     */
    applyDeploymentPreference() {
        const preferred = getItem(CONFIG.STORAGE_KEYS.PREFERRED_DEPLOYMENT);
        const target = resolveDeploymentRedirect(
            window.location.pathname, window.location.search, preferred, DEPLOYMENTS
        );
        if (!target) {
            return false;
        }
        logger.debug(`🔀 Redirecting to preferred deployment: ${target}`);
        window.location.replace(target);
        return true;
    }

    /**
     * Persist which deployment this browser should open deep links in, so links
     * shared from either deployment land where the user expects.
     */
    setDeploymentPreference(key) {
        if (!Object.prototype.hasOwnProperty.call(DEPLOYMENTS, key)) {
            return;
        }
        setItem(CONFIG.STORAGE_KEYS.PREFERRED_DEPLOYMENT, key);
    }

    setupDeploymentSwitch() {
        const container = getElement('deployment-switch');
        if (!container) {
            return;
        }

        const current = this.currentDeploymentKey();
        const otherKey = Object.keys(DEPLOYMENTS).find(key => key !== current);
        container.replaceChildren();
        if (!current || !otherKey) {
            return;
        }

        const other = DEPLOYMENTS[otherKey];
        const note = document.createElement('span');
        note.className = 'deployment-switch-note';
        note.textContent = `You are using ${DEPLOYMENTS[current].label}.`;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'deployment-switch-btn';
        button.dataset.deployment = otherKey;
        button.textContent = `Switch to ${other.label}`;
        button.title = `Open this match in the ${other.label} version`;
        button.addEventListener('click', () => {
            this.setDeploymentPreference(otherKey);
            const url = alternateDeploymentUrl(window.location.pathname, window.location.search, DEPLOYMENTS);
            if (url) {
                window.location.href = url;
            }
        });

        container.append(note, button);
    }

    /**
     * Show simple loading indicator under header
     */
    showLoading(message = 'Loading...') {
        const loadingElement = getElement('app-loading');
        const loadingText = getElement('loading-text');
        if (loadingElement && loadingText) {
            loadingText.textContent = message;
            loadingElement.style.display = 'flex';
        }
    }

    /**
     * Hide loading indicator
     */
    hideLoading() {
        const loadingElement = getElement('app-loading');
        if (loadingElement) {
            loadingElement.style.display = 'none';
        }
    }

    clearLocalPreferences() {
        // Clear local storage
        removeItem(CONFIG.STORAGE_KEYS.GURU_SIGNATURE);
        removeItem(CONFIG.STORAGE_KEYS.RECENT_PODS);
        removeItem(CONFIG.STORAGE_KEYS.RECENT_HUBS);
        logger.debug('🗑️ Cleared local preferences from localStorage');
    }

    setupGuruSignatureHandlers() {
        if (this._signatureHandlersBound) {
            return;
        }
        this._signatureHandlersBound = true;

        // Listen for the signature being set (initial load or an explicit change).
        this.guruSignature.onSignatureSet((signature) => {
            logger.debug('Guru signature set:', signature);
            this.uiController.showStatus(`Welcome, ${signature}! Ready to edit pod sheets.`, 'success');
            // A change while a pod is open must not leave a stale snapshot behind.
            this.refreshSignatureForOpenPod();
        });
    }

    /**
     * If a pod is open, adopt the (now changed) signature: close the pod and
     * return home so the next load resolves the colour and rows against the new
     * value. The signature is session identity, not live per-row state.
     */
    refreshSignatureForOpenPod() {
        if (!this.currentSpreadsheetId) {
            return;
        }
        this.analysisInterface?.destroy();
        this.analysisInterface = null;
        this.currentSheetData = null;
        this.currentSpreadsheetId = null;
        this.uiController.showSheetInputSection();
    }

    bindEvents() {
        if (this._domBound) {
            return;
        }
        this._domBound = true;

        const loadBtn = getElement('load-sheet-btn');
        const refreshBtn = getElement('refresh-btn');
        const exitAnalysisBtn = getElement('exit-analysis-btn');
        const sheetUrlInput = getElement('sheet-url');

        loadBtn.addEventListener('click', () => this.loadSheet());
        refreshBtn.addEventListener('click', () => this.refreshSheet());
        exitAnalysisBtn.addEventListener('click', () => this.uiController.showSheetInputSection());
        this.setupDeploymentSwitch();

        // Allow Enter key to trigger load
        sheetUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.loadSheet();
            }
        });
    }

    async checkForDirectAnalysisMode() {
        const urlParams = new URLSearchParams(window.location.search);
        const podId = sanitizeUrlParam(urlParams.get('pod'));
        const hubId = sanitizeUrlParam(urlParams.get('hub'));

        if (podId) {
            logger.debug('🔗 URL parameters detected, going directly to analysis mode');

            // Hide the home screen sections
            this.uiController.hideHomeScreen();

            // Handle URL parameters for auto-loading (includes hub if present)
            await this.handleURLParameters();

            return true; // Indicates we went to analysis mode
        } else if (hubId) {
            await this.handleURLParameters();
        }

        return false; // No URL parameters, use normal flow
    }

    async handleURLParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const podId = sanitizeUrlParam(urlParams.get('pod'));
        const guruColor = sanitizeUrlParam(urlParams.get('guru'));
        const hubId = sanitizeUrlParam(urlParams.get('hub'));
        let rowNumber = sanitizeUrlParam(urlParams.get('match'));

        // If hub parameter is present, add it to recent hubs before rendering
        if (hubId) {
            try {
                logger.debug(`🔗 Adding hub from URL parameter: ${hubId}`);
                await this.recentPodsManager.addRecentHub(hubId);
            } catch (error) {
                logger.warn('Failed to add hub from URL parameter:', error);
            }
        }

        if (podId) {
            try {
                logger.debug(`🔗 Auto-loading pod from URL: ${podId}, color: ${guruColor}, row: ${rowNumber}`);

                this.showLoading('Loading pod data...');
                // Load the pod by ID
                await this.loadSheet(podId, guruColor, rowNumber ? parseInt(rowNumber, 10) : null);

                this.hideLoading();

            } catch (error) {
                logger.warn('Failed to auto-load pod from URL:', error);
                this.hideLoading();
                this.uiController.showStatus(`Could not load pod from URL: ${error.message}`, 'error');

                // Clear invalid pod ID from URL
                this.clearInvalidURLParameters();
            }
        }
    }

    clearInvalidURLParameters() {
        const newUrl = new URL(window.location);
        newUrl.search = ''
        window.history.replaceState({}, '', newUrl);
    }

    async loadSheet(spreadsheetId = null, guruColor = null, rowNumber = null) {
        // Check if guru signature is set before loading sheet
        if (!this.guruSignature.hasSignature()) {
            logger.warn('Guru signature not set, cannot load sheet');
            this.uiController.showStatus('Please set your Guru Signature before loading a sheet', 'error');
            this.guruSignature.showSignatureSection();
            return;
        }

        let targetSpreadsheetId = spreadsheetId;
        let sheetUrl = '';

        // If no spreadsheetId provided, get it from the URL input
        if (!targetSpreadsheetId) {
            const url = getElement('sheet-url').value.trim();

            if (!url) {
                this.uiController.showStatus('Please enter a pod Google Sheets URL', 'error');
                return;
            }

            if (!isValidGoogleSheetsUrl(url)) {
                this.uiController.showStatus('Please enter a valid Google Sheets URL', 'error');
                return;
            }

            targetSpreadsheetId = extractSheetId(url);
            sheetUrl = url;
        } else {
            // Construct URL from the spreadsheet ID for recent pods functionality
            sheetUrl = `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}`;
        }

        try {
            this.uiController.showStatus('Loading pod...', 'loading');
            this.uiController.setLoadingState(true);

            const sheetData = await this.sheetsAPI.getSheetData(targetSpreadsheetId);

            this.currentSheetData = sheetData;
            this.currentSpreadsheetId = targetSpreadsheetId;

            // Load data into the analysis interface
            if (!this.analysisInterface) {
                // The signature is a snapshot taken at load: it cannot change
                // while a pod is open (phase 5 of #18).
                this.analysisInterface = new AnalysisController(
                    this.sheetsAPI, this.uiController, this.guruSignature.getSignature()
                );
            } else {
                this.analysisInterface.reset();
            }
            const isLoaded = await this.analysisInterface.loadData(sheetData, guruColor, rowNumber);
            this.uiController.showSheetEditor(sheetData.title || 'Untitled Pod');
            if (isLoaded) {
                await this.analysisInterface.showCurrentRow();
            }

            // Add to recent pods
            if (sheetData.metadata && sheetData.metadata.guruHubLink) {
                logger.debug('Adding recent hub link:', sheetData.metadata.guruHubLink);
                this.recentPodsManager.addRecentHub(sheetData.metadata.guruHubLink);
            }

            logger.debug('Adding recent pod:', sheetData.title || 'Untitled Pod');
            this.recentPodsManager.addRecentPod(targetSpreadsheetId, sheetData.title || 'Untitled Pod', sheetUrl);

            this.uiController.showStatus(`Loaded pod - ${sheetData.title || 'Untitled Pod'}`, 'success');

        } catch (error) {
            logger.error('Error loading pod:', error);
            this.uiController.showStatus(`Error loading pod: ${error.message}`, 'error');
        } finally {
            this.uiController.setLoadingState(false);
        }
    }

    async refreshSheet() {
        if (!this.currentSpreadsheetId) {
            this.uiController.showStatus('No pod loaded', 'error');
            return;
        }

        try {
            this.uiController.showStatus('Refreshing pod...', 'loading');

            const sheetData = await this.sheetsAPI.getSheetData(this.currentSpreadsheetId);
            this.currentSheetData = sheetData;

            // Reload data into the analysis interface
            this.analysisInterface.reset();
            await this.analysisInterface.loadData(sheetData);
            await this.analysisInterface.showCurrentRow();

            const totalRows = this.analysisInterface.getTotalRows();
            this.uiController.showStatus(`Refreshed - ${totalRows} rows available`, 'success');

        } catch (error) {
            logger.error('Error refreshing pod:', error);
            this.uiController.showStatus(`Error refreshing: ${error.message}`, 'error');
        }
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    applyDeploymentBranding();

    new ThreeCardBlindGuruTool();

    // Display app version
    displayAppVersion();

    // Register service worker for PWA functionality
    if ('serviceWorker' in navigator) {
        // Listen for the controlling service worker changing (global listener)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            logger.debug('🔄 Service worker controller changed, reloading...');
            window.location.reload();
        });

        window.addEventListener('load', () => {
            // Use relative path for GitHub Pages subdirectory deployment
            const swPath = new URL('sw.js', window.location.href).pathname;
            logger.debug('Registering service worker at:', swPath);
            navigator.serviceWorker.register(swPath)
                .then((registration) => {
                    logger.debug('✅ Service Worker registered successfully:', registration.scope);

                    // Listen for service worker updates
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        logger.debug('🔄 New service worker found, installing...');

                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                // New service worker is installed and waiting
                                logger.debug('✨ New version available! Reload page to update.');
                            }
                        });
                    });
                })
                .catch((error) => {
                    logger.error('❌ Service Worker registration failed:', error);
                });
        });
        logger.debug('Service Worker is supported in this browser.');
    }
});

/**
 * Label the running deployment (production vs preview) and give preview its own
 * visible name, so testers can always tell which version they are looking at.
 */
function applyDeploymentBranding() {
    const key = deploymentForPath(window.location.pathname, DEPLOYMENTS);
    if (!key) {
        return;
    }

    const deployment = DEPLOYMENTS[key];

    document.title = deployment.appName;
    const heading = document.querySelector('.header-title h1');
    if (heading) {
        heading.textContent = deployment.appName;
    }
}

/**
 * Display the app version from the service worker
 */
async function displayAppVersion() {
    const versionElement = getElement('app-version');

    if (!versionElement) {
        return;
    }

    try {
        // Fetch the service worker file to extract version
        const swResponse = await fetch('sw.js');
        const swText = await swResponse.text();

        // Extract version from APP_VERSION constant (simple and targeted)
        const match = swText.match(/const APP_VERSION\s*=\s*['"]([^'"]+)['"]/);

        if (match && match[1]) {
            const version = match[1];
            const key = deploymentForPath(window.location.pathname, DEPLOYMENTS);
            const deployment = key ? DEPLOYMENTS[key] : null;
            versionElement.textContent = deployment
                ? `${deployment.appName} — Version: ${version}`
                : `Version: ${version}`;
            logger.debug('📦 App version:', version);
        } else {
            versionElement.textContent = 'Version: unknown';
        }
    } catch (error) {
        logger.error('Error getting app version:', error);
        versionElement.textContent = 'Version: error';
    }
}
