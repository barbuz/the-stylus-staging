import { GoogleSheetsAPI } from './modules/googleSheetsAPI.js';
import { UIController } from './modules/uiController.js';
import { AuthManager } from './modules/authManager.js';
import { GuruSignature } from './modules/guruSignature.js';
import { GuruAnalysisInterface } from './modules/guruAnalysisInterface.js';
import { RecentPodsManager } from './modules/recentPods.js';
import { CONFIG, DEPLOYMENTS } from './config.js';
import {
    isValidGoogleSheetsUrl,
    extractSheetId,
    sanitizeUrlParam,
    deploymentForPath,
    alternateDeploymentUrl,
    resolveDeploymentRedirect
} from './utils/urlUtils.js';

class ThreeCardBlindGuruTool {
    constructor() {
        this.authManager = new AuthManager();
        this.guruSignature = new GuruSignature(this.authManager);
        this.sheetsAPI = new GoogleSheetsAPI(this.authManager);
        this.uiController = new UIController();
        this.analysisInterface = null; // Initialized after auth
        this.recentPodsManager = new RecentPodsManager();

        this.currentSheetData = null;
        this.currentSheetId = null;
        this.handlersSetup = false; // Track if handlers have been set up
        this.authSectionRendered = false; // Track if auth section has been rendered
        
        this.init();
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
            
            // Set up event listeners first, before any authentication
            this.setupPreferencesHandlers();
            
            // Check authentication status
            const isAuthenticated = await this.authManager.checkAuthStatus();
            
            // Hide loading after checking authentication
            this.hideLoading();
            
            if (isAuthenticated) {
                this.authManager.renderAuthSection();
                this.authManager.showAppContent();
                this.authSectionRendered = true; // Mark as rendered
                
                // Only set up handlers once
                if (!this.handlersSetup) {
                    this.setupGuruSignatureHandlers();
                    this.bindEvents();
                    this.handlersSetup = true;
                }

                // Try to initialize the guru signature from persisted preferences so it's
                // available immediately after login (avoids race where loadSheet blocks)
                try {
                    if (this.authManager.userPreferences) {
                        const persistedSig = await this.authManager.userPreferences.getGuruSignature();
                        if (persistedSig && persistedSig.trim() !== '') {
                            await this.guruSignature.initSignature(persistedSig);
                        }
                    }
                } catch (err) {
                    console.warn('Could not initialize guru signature from preferences:', err);
                }

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
                console.log('User not authenticated, showing login screen');
                this.authManager.showLoginScreen();
            }
        } catch (error) {
            console.error('Error initializing application:', error);
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
        const preferred = localStorage.getItem(CONFIG.STORAGE_KEYS.PREFERRED_DEPLOYMENT);
        const target = resolveDeploymentRedirect(
            window.location.pathname, window.location.search, preferred, DEPLOYMENTS
        );
        if (!target) {
            return false;
        }
        console.log(`🔀 Redirecting to preferred deployment: ${target}`);
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
        localStorage.setItem(CONFIG.STORAGE_KEYS.PREFERRED_DEPLOYMENT, key);
    }

    setupDeploymentSwitch() {
        const container = document.getElementById('deployment-switch');
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

    setupPreferencesHandlers() {
        // Listen for user login
        window.addEventListener('userLoggedIn', async () => {
            console.log('User logged in');
            
            // Only render auth section if it hasn't been rendered yet during initialization
            // This prevents duplicate rendering when user is already authenticated
            if (!this.authSectionRendered) {
                this.authManager.renderAuthSection();
                this.authManager.showAppContent();
                this.authSectionRendered = true;
            }
            
            // Only set up handlers once
            if (!this.handlersSetup) {
                this.setupGuruSignatureHandlers();
                this.bindEvents();
                this.handlersSetup = true;
            }
            
            // Initialize user preferences and connect to recent pods manager
            if (this.authManager.userPreferences && this.authManager.userPreferences.isInitialized) {
                this.guruSignature.initSignature(await this.authManager.userPreferences.getGuruSignature());
                // setUserPreferences already loads and renders recent pods/hubs
                this.recentPodsManager.setUserPreferences(this.authManager.userPreferences);
            }
        });
        // Clear preferences on logout
        window.addEventListener('userLoggedOut', () => {
            this.clearLocalPreferences();
            this.handlersSetup = false; // Reset handlers flag so they can be set up again on next login
            this.authSectionRendered = false; // Reset auth section flag
        });
    }

    /**
     * Show simple loading indicator under header
     */
    showLoading(message = 'Loading...') {
        const loadingElement = document.getElementById('app-loading');
        const loadingText = document.getElementById('loading-text');
        if (loadingElement && loadingText) {
            loadingText.textContent = message;
            loadingElement.style.display = 'flex';
        }
    }

    /**
     * Hide loading indicator
     */
    hideLoading() {
        const loadingElement = document.getElementById('app-loading');
        if (loadingElement) {
            loadingElement.style.display = 'none';
        }
    }

    clearLocalPreferences() {
        // Clear local storage
        localStorage.removeItem(CONFIG.STORAGE_KEYS.GURU_SIGNATURE);
        localStorage.removeItem(CONFIG.STORAGE_KEYS.RECENT_PODS);
        localStorage.removeItem(CONFIG.STORAGE_KEYS.RECENT_HUBS);
        console.log('🗑️ Cleared local preferences from localStorage');
    }

    setupGuruSignatureHandlers() {
        // Listen for signature events
        this.guruSignature.onSignatureSet((signature) => {
            console.log('Guru signature set:', signature);
            this.uiController.showStatus(`Welcome, ${signature}! Ready to edit pod sheets.`, 'success');
        });
        this.guruSignature.onSignatureChanged((signature) => {
            console.log('Guru signature changed:', signature);
            if (!signature) {
                this.uiController.showStatus('Please set your Guru Signature to continue.', 'info');
            }
        });
    }

    bindEvents() {
        const loadBtn = document.getElementById('load-sheet-btn');
        const refreshBtn = document.getElementById('refresh-btn');
        const exitAnalysisBtn = document.getElementById('exit-analysis-btn');
        const sheetUrlInput = document.getElementById('sheet-url');

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

        // Listen for user logout to optionally handle recent pods
        window.addEventListener('userLoggedOut', () => {
            // Note: We keep recent pods even after logout so they're available when user logs back in
            // If you want to clear them on logout, uncomment the next line:
            // this.recentPodsManager.clearRecentPods();
            console.log('📋 User logged out - keeping recent pods for next session');
        });
    }

    async checkForDirectAnalysisMode() {
        const urlParams = new URLSearchParams(window.location.search);
        const podId = sanitizeUrlParam(urlParams.get('pod'));
        const hubId = sanitizeUrlParam(urlParams.get('hub'));
        
        if (podId) {
            console.log('🔗 URL parameters detected, going directly to analysis mode');
            
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
                console.log(`🔗 Adding hub from URL parameter: ${hubId}`);
                await this.recentPodsManager.addRecentHub(hubId);
            } catch (error) {
                console.warn('Failed to add hub from URL parameter:', error);
            }
        }
        
        if (podId) {
            try {
                console.log(`🔗 Auto-loading pod from URL: ${podId}, color: ${guruColor}, row: ${rowNumber}`);
                
                this.showLoading('Loading pod data...');
                // Load the pod by ID
                await this.loadSheet(podId, guruColor, rowNumber ? parseInt(rowNumber, 10) : null);
                
                this.hideLoading();
                
            } catch (error) {
                console.warn('Failed to auto-load pod from URL:', error);
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

    async loadSheet(sheetId = null, guruColor = null, rowNumber = null) {
        // Check if guru signature is set before loading sheet
        if (!this.guruSignature.hasSignature()) {
            console.warn('Guru signature not set, cannot load sheet');
            this.uiController.showStatus('Please set your Guru Signature before loading a sheet', 'error');
            this.guruSignature.showSignatureSection();
            return;
        }

        let targetSheetId = sheetId;
        let sheetUrl = '';
        
        // If no sheetId provided, get it from the URL input
        if (!targetSheetId) {
            const url = document.getElementById('sheet-url').value.trim();
            
            if (!url) {
                this.uiController.showStatus('Please enter a pod Google Sheets URL', 'error');
                return;
            }

            if (!isValidGoogleSheetsUrl(url)) {
                this.uiController.showStatus('Please enter a valid Google Sheets URL', 'error');
                return;
            }
            
            targetSheetId = extractSheetId(url);
            sheetUrl = url;
        } else {
            // Construct URL from sheet ID for recent pods functionality
            sheetUrl = `https://docs.google.com/spreadsheets/d/${targetSheetId}`;
        }

        try {
            this.uiController.showStatus('Loading pod...', 'loading');
            this.uiController.setLoadingState(true);

            const sheetData = await this.sheetsAPI.getSheetData(targetSheetId);
            
            this.currentSheetData = sheetData;
            this.currentSheetId = targetSheetId;
            
            // Load data into the analysis interface
            if (!this.analysisInterface) {
                this.analysisInterface = new GuruAnalysisInterface(this.sheetsAPI, this.uiController, this.authManager.guruSignature);
            } else {
                this.analysisInterface.reset();
                this.analysisInterface.setGuruSignature(this.authManager.guruSignature);
            }
            const isLoaded = await this.analysisInterface.loadData(sheetData, guruColor, rowNumber);
            this.uiController.showSheetEditor(sheetData.title || 'Untitled Pod', targetSheetId);
            if (isLoaded) {
                await this.analysisInterface.showCurrentRow();
            }
            
            // Add to recent pods
            if (sheetData.metadata && sheetData.metadata.guruHubLink) {
                console.log('Adding recent hub link:', sheetData.metadata.guruHubLink);
                this.recentPodsManager.addRecentHub(sheetData.metadata.guruHubLink);
            }

            console.log('Adding recent pod:', sheetData.title || 'Untitled Pod');
            this.recentPodsManager.addRecentPod(targetSheetId, sheetData.title || 'Untitled Pod', sheetUrl);

            this.uiController.showStatus(`Loaded pod - ${sheetData.title || 'Untitled Pod'}`, 'success');

        } catch (error) {
            console.error('Error loading pod:', error);
            this.uiController.showStatus(`Error loading pod: ${error.message}`, 'error');
        } finally {
            this.uiController.setLoadingState(false);
        }
    }

    async refreshSheet() {
        if (!this.currentSheetId) {
            this.uiController.showStatus('No pod loaded', 'error');
            return;
        }

        try {
            this.uiController.showStatus('Refreshing pod...', 'loading');
            
            const sheetData = await this.sheetsAPI.getSheetData(this.currentSheetId);
            this.currentSheetData = sheetData;
            
            // Reload data into the analysis interface
            this.analysisInterface.reset();
            await this.analysisInterface.loadData(sheetData);
            await this.analysisInterface.showCurrentRow();
            
            const totalRows = this.analysisInterface.getTotalRows();
            this.uiController.showStatus(`Refreshed - ${totalRows} rows available`, 'success');
            
        } catch (error) {
            console.error('Error refreshing pod:', error);
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
            console.log('🔄 Service worker controller changed, reloading...');
            window.location.reload();
        });
        
        window.addEventListener('load', () => {
            // Use relative path for GitHub Pages subdirectory deployment
            const swPath = new URL('sw.js', window.location.href).pathname;
            console.log('Registering service worker at:', swPath);
            navigator.serviceWorker.register(swPath)
                .then((registration) => {
                    console.log('✅ Service Worker registered successfully:', registration.scope);
                    
                    // Listen for service worker updates
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        console.log('🔄 New service worker found, installing...');
                        
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                // New service worker is installed and waiting
                                console.log('✨ New version available! Reload page to update.');
                            }
                        });
                    });
                })
                .catch((error) => {
                    console.error('❌ Service Worker registration failed:', error);
                });
        });
        console.log('Service Worker is supported in this browser.');
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
    const versionElement = document.getElementById('app-version');
    
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
            console.log('📦 App version:', version);
        } else {
            versionElement.textContent = 'Version: unknown';
        }
    } catch (error) {
        console.error('Error getting app version:', error);
        versionElement.textContent = 'Version: error';
    }
}
