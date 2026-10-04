import { CONFIG } from '../config.js';
import { UserPreferences } from './userPreferences.js';
import { APP_EVENTS } from '../app/events.js';
import { logger } from '../utils/log.js';
import { getElement } from '../utils/domUtils.js';
import { getItem, setItem, removeItem } from '../services/storage.js';

export class AuthManager {
    constructor(events, guruSignature = null) {
        // Optional event bus. When present the login / signature flow is routed
        // through it instead of `window` CustomEvents (phase 4 of #18).
        this.events = events || null;
        // The single owner of the current signature (phase 5 of #18). AuthManager
        // deliberately keeps no copy: it delegates reads/writes here.
        this.guruSignature = guruSignature;
        this.user = null;
        this.isAuthenticated = false;
        this.tokenClient = null;
        this.initialized = false;
        this.userPreferences = new UserPreferences();
        this.reauthTimer = null;
    }

    /** The current guru signature, or '' when none is set. */
    getGuruSignature() {
        return this.guruSignature?.getSignature() || '';
    }

    async initialize() {
        if (this.initialized) return;

        try {
            // Initialize Google API client for Sheets API
            await new Promise((resolve, reject) => {
                gapi.load('client', {
                    callback: resolve,
                    onerror: reject
                });
            });

            await gapi.client.init({
                discoveryDocs: CONFIG.DISCOVERY_DOCS,
            });

            // Load user ID from localStorage if available
            const userId = getItem(CONFIG.STORAGE_KEYS.USER_ID);

            // Initialize Google Identity Services for authentication
            this.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CONFIG.GOOGLE_CLIENT_ID,
                scope: CONFIG.SCOPES,
                login_hint: userId || '', // Use stored user ID if available
                callback: (response) => {
                    if (response.error) {
                        logger.error('OAuth error:', response.error);
                        return;
                    }
                    const idToken = response.id_token;
                    // Do not log the response object: it carries the access and
                    // ID tokens. The diagnostic buffer must stay secret-free.
                    logger.debug('✅ OAuth token received');
                    this.handleAuthSuccess(response.access_token, response.expires_in);
                }
            });

            this.initialized = true;
            logger.debug('✅ Google API client and Identity Services initialized');

        } catch (error) {
            logger.error('Error initializing Google services:', error);
            throw error;
        }
    }


    async handleAuthSuccess(accessToken, expiresIn = 3600) {
        setItem(CONFIG.STORAGE_KEYS.LAST_LOGIN, Date.now().toString());
        try {
            // Set access token for gapi client
            gapi.client.setToken({
                access_token: accessToken
            });

            let userEmail = null;
            if (this.shouldRememberUser()) {
                // get email address from localStorage if available
                userEmail = getItem(CONFIG.STORAGE_KEYS.USER_ID);

                if (!userEmail) {
                    logger.debug('🔐 No user email found in localStorage, fetching from Google UserInfo API');
                }
                // Fetch user email from Google UserInfo endpoint
                try {
                    const userInfoResp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
                        headers: {
                            'Authorization': `Bearer ${accessToken}`
                        }
                    });
                    if (userInfoResp.ok) {
                        const userInfo = await userInfoResp.json();
                        userEmail = userInfo.email || null;
                    }
                    // If we successfully fetched the email, save it to localStorage
                    setItem(CONFIG.STORAGE_KEYS.USER_ID, userEmail);
                } catch (e) {
                    logger.warn('Could not fetch user email:', e);
                }
            } else {
                removeItem(CONFIG.STORAGE_KEYS.USER_ID);
            }

            // Create minimal user object with email if available
            this.user = {
                accessToken: accessToken,
                email: userEmail
            };
            this.isAuthenticated = true;

            // Store tokens for persistence
            this.saveTokens(accessToken, expiresIn);

            // Set up automatic silent re-auth timer
            this.setupReauthTimer(expiresIn);

            // Initialize user preferences in Google Drive
            await this.initializeUserPreferences();

            // Update UI immediately
            this.renderAuthSection();
            this.showAppContent();

            // Notify the app that the user logged in
            this.events?.emit(APP_EVENTS.USER_LOGGED_IN);

            logger.debug('✅ User successfully authenticated');

        } catch (error) {
            logger.error('Error during authentication:', error);

            // Show error to user and reset login button
            this.setLoginButtonLoading(false);

            // If we can't proceed with authentication, reset state
            this.isAuthenticated = false;
            this.user = null;

            // Show a user-friendly error message
            alert('Authentication failed. Please try logging in again.');
        }
    }

    async initializeUserPreferences() {
        try {
            // Initialize user preferences with appData storage
            await this.userPreferences.initialize(this.user);

            logger.debug('✅ User preferences initialized from Google appData');
        } catch (error) {
            logger.error('Error initializing user preferences:', error);
        }
    }

    saveTokens(accessToken, expiresIn = 3600) {
        setItem(CONFIG.STORAGE_KEYS.ACCESS_TOKEN, accessToken);

        // Calculate expiry time
        const expiryTime = Date.now() + (expiresIn * 1000);
        setItem(CONFIG.STORAGE_KEYS.TOKEN_EXPIRY, expiryTime.toString());

        logger.debug('💾 Token saved for persistent session', {
            expires_at: new Date(expiryTime).toLocaleString(),
            expires_in_minutes: Math.round(expiresIn / 60)
        });
    }

    setRememberUser(remember = true) {
        if (remember) {
            setItem(CONFIG.STORAGE_KEYS.REMEMBER_USER, 'true');
        } else {
            removeItem(CONFIG.STORAGE_KEYS.REMEMBER_USER);
        }
    }

    shouldRememberUser() {
        return getItem(CONFIG.STORAGE_KEYS.REMEMBER_USER) === 'true';
    }

    getLastLoginTime() {
        const lastLogin = getItem(CONFIG.STORAGE_KEYS.LAST_LOGIN);
        return lastLogin ? parseInt(lastLogin) : null;
    }

    getStoredTokens() {
        const accessToken = getItem(CONFIG.STORAGE_KEYS.ACCESS_TOKEN);
        const expiryTime = getItem(CONFIG.STORAGE_KEYS.TOKEN_EXPIRY);

        if (!accessToken) {
            return null;
        }

        return {
            accessToken,
            expiryTime: expiryTime ? parseInt(expiryTime) : null
        };
    }

    clearStoredAuth() {
        removeItem(CONFIG.STORAGE_KEYS.ACCESS_TOKEN);
        removeItem(CONFIG.STORAGE_KEYS.TOKEN_EXPIRY);
        logger.debug('🗑️ Cleared stored authentication');

        // Clear any pending re-auth timer
        if (this.reauthTimer) {
            clearTimeout(this.reauthTimer);
            this.reauthTimer = null;
        }
    }

    /**
     * Set up a timer to trigger silent re-auth before token expiry
     * @param {number} expiresIn - seconds until token expiry
     */
    setupReauthTimer(expiresIn) {
        // Clear any existing timer
        if (this.reauthTimer) {
            clearTimeout(this.reauthTimer);
        }
        // Re-auth 2 minutes before expiry, but not less than 10 seconds from now
        const reauthMs = Math.max((expiresIn - 120) * 1000, 10000);
        this.reauthTimer = setTimeout(async () => {
            logger.debug('⏰ Token expiring soon, attempting silent re-auth...');
            await this.attemptAutoReauth();
        }, reauthMs);
    }

    async attemptAutoReauth() {
        try {
            // Only attempt auto re-auth if user opted to be remembered
            if (!this.shouldRememberUser()) {
                logger.debug('🔐 Auto re-auth skipped - user chose not to be remembered');
                return false;
            }

            // Load user ID from localStorage
            const userId = getItem(CONFIG.STORAGE_KEYS.USER_ID);
            if (!userId) {
                logger.debug('🔐 Auto re-auth skipped - user ID not found');
                return false;
            }

            logger.debug('🔄 Attempting automatic re-authentication...');

            // Try silent authentication with Google Identity Services
            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    logger.debug('⏰ Auto re-auth timeout after 5 seconds');
                    resolve(false);
                }, 5000);

                try {
                    // Create a silent token client for automatic login
                    const silentTokenClient = google.accounts.oauth2.initTokenClient({
                        client_id: CONFIG.GOOGLE_CLIENT_ID,
                        scope: CONFIG.SCOPES,
                        login_hint: userId, // Use stored user ID
                        prompt: 'none', // No user interaction
                        callback: (response) => {
                            clearTimeout(timeout);

                            if (response.error) {
                                logger.debug('❌ Silent auto re-auth failed:', response.error);
                                resolve(false);
                            } else {
                                logger.debug('✅ Silent auto re-auth successful');
                                this.handleAuthSuccess(response.access_token, response.expires_in);
                                resolve(true);
                            }
                        }
                    });

                    // Request token silently (no user interaction)
                    silentTokenClient.requestAccessToken();

                } catch (error) {
                    clearTimeout(timeout);
                    logger.debug('❌ Error during silent auth:', error);
                    resolve(false);
                }
            });

        } catch (error) {
            logger.error('Auto re-authentication failed:', error);
            return false;
        }
    }

    async checkAuthStatus() {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            // First, check for stored tokens in localStorage
            const storedTokens = this.getStoredTokens();
            if (storedTokens) {
                logger.debug('🔄 Found stored tokens, checking expiry...');

                // Check if access token is expired
                const isExpired = storedTokens.expiryTime && Date.now() >= storedTokens.expiryTime;

                if (isExpired) {
                    logger.debug('🕒 Access token expired, attempting automatic re-authentication...');

                    // Try automatic re-authentication
                    const reauthSuccess = await this.attemptAutoReauth();
                    if (reauthSuccess) {
                        this.isAuthenticated = true;
                        logger.debug('✅ Automatic re-authentication successful');
                        return true;
                    }

                    logger.debug('❌ Automatic re-authentication failed, clearing stored auth');
                    this.clearStoredAuth();

                    return false;
                } else {
                    // Set up automatic silent re-auth timer
                    this.setupReauthTimer((storedTokens.expiryTime - Date.now()) / 1000);
                }

                // Try to validate the token using stored tokens only
                try {
                    // Set access token for gapi client
                    gapi.client.setToken({
                        access_token: storedTokens.accessToken
                    });

                    this.user = {
                        accessToken: storedTokens.accessToken
                    };
                    this.isAuthenticated = true;

                    // Initialize user preferences for restored session
                    await this.initializeUserPreferences();

                    logger.debug('✅ Session restored successfully');

                    // Render auth section to show guru signature
                    this.renderAuthSection();

                    // Notify the app of the restored session
                    setTimeout(() => {
                        this.events?.emit(APP_EVENTS.USER_LOGGED_IN);
                    }, 100);

                    return true;
                } catch (error) {
                    logger.debug('❌ Error validating stored token, attempting silent re-auth...', error);

                    // Try automatic re-authentication when there's an error
                    const reauthSuccess = await this.attemptAutoReauth();
                    if (reauthSuccess) {
                        logger.debug('✅ Silent re-authentication successful after token validation error');
                        return true;
                    }

                    logger.debug('❌ Silent re-authentication failed, clearing stored auth');
                    this.clearStoredAuth();

                    // Show login screen when silent re-auth fails
                    return false;
                }
            }

            // Final attempt: try silent authentication if no valid tokens found
            if (!this.isAuthenticated) {
                logger.debug('🔄 No valid tokens found, attempting silent authentication...');
                const reauthSuccess = await this.attemptAutoReauth();
                if (reauthSuccess) {
                    logger.debug('✅ Silent authentication successful as fallback');
                    return true;
                }
            }

            this.isAuthenticated = false;
            this.user = null;
            logger.debug('❌ No valid authentication found');

            // Show login screen when no authentication is found
            this.showLoginScreen();
            return false;
        } catch (error) {
            logger.error('Error checking auth status:', error);
            this.isAuthenticated = false;
            this.user = null;

            // Show login screen when there's an error checking auth
            this.showLoginScreen();
            return false;
        }
    }

    async login() {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            // Show loading state on login button
            this.setLoginButtonLoading(true);

            // Request access token using Google Identity Services
            this.tokenClient.requestAccessToken();

        } catch (error) {
            logger.error('Error during login:', error);
            this.setLoginButtonLoading(false);
            return false;
        }
    }

    async logout() {
        try {
            // Notify the app before logging out
            this.events?.emit(APP_EVENTS.USER_LOGGED_OUT);

            // Revoke the token if we have one
            if (this.user && this.user.accessToken) {
                google.accounts.oauth2.revoke(this.user.accessToken);
            }

            this.isAuthenticated = false;
            this.user = null;

            // Clear all stored authentication data
            this.clearStoredAuth();

            // Clear remember preference and login time (user manually logged out)
            removeItem(CONFIG.STORAGE_KEYS.REMEMBER_USER);
            removeItem(CONFIG.STORAGE_KEYS.LAST_LOGIN);

            // Note: We intentionally keep the guru signature in localStorage so it persists across logout/login

            logger.debug('👋 User logged out successfully');
            window.location.reload();
        } catch (error) {
            logger.error('Error logging out:', error);
        }
    }

    getUser() {
        return this.user;
    }

    isLoggedIn() {
        return this.isAuthenticated;
    }

    getAccessToken() {
        if (this.user && this.user.accessToken) {
            return this.user.accessToken;
        }

        // Try to get token from localStorage as fallback
        const storedTokens = this.getStoredTokens();
        return storedTokens ? storedTokens.accessToken : null;
    }

    renderAuthSection() {
        const authSection = getElement('auth-section');
        const signature = this.getGuruSignature();
        logger.debug('AuthManager: Rendering auth section with guruSignature:', signature);

        if (this.isAuthenticated && this.user) {
            authSection.innerHTML = `
                <div class="user-info">
                    ${signature ? `
                        <div class="guru-signature-display">
                            <span class="guru-label">Guru:</span>
                            <span class="guru-signature-name" id="guru-signature-display">${signature}</span>
                        </div>
                    ` : ''}
                </div>
                <button id="logout-btn" class="logout-btn">Logout</button>
            `;

            getElement('logout-btn').addEventListener('click', () => {
                this.logout();
            });

            // Add click handler for guru signature to change it
            if (signature) {
                const guruSignatureDisplay = getElement('guru-signature-display');
                if (guruSignatureDisplay) {
                    guruSignatureDisplay.addEventListener('click', () => {
                        this.promptGuruSignatureChange();
                    });
                    guruSignatureDisplay.style.cursor = 'pointer';
                    guruSignatureDisplay.title = 'Click to change guru signature';
                }
            }
        } else {
            authSection.innerHTML = '';
        }
    }

    /**
     * Prompt user to change guru signature
     */
    promptGuruSignatureChange() {
        // Ask the guru signature module to open its editor
        this.events?.emit(APP_EVENTS.REQUEST_GURU_SIGNATURE_CHANGE);
    }

    showLoginScreen() {
        getElement('login-section').style.display = 'block';
        getElement('app-content').style.display = 'none';

        const loginBtn = getElement('login-btn');
        // Remove existing listeners to prevent duplicates
        const newLoginBtn = loginBtn.cloneNode(true);
        loginBtn.parentNode.replaceChild(newLoginBtn, loginBtn);

        // Set checkbox state based on stored preference
        const rememberCheckbox = getElement('remember-me-checkbox');
        if (rememberCheckbox) {
            rememberCheckbox.checked = this.shouldRememberUser();
        }

        newLoginBtn.addEventListener('click', () => {
            // Save the remember me preference before login
            const rememberMe = getElement('remember-me-checkbox')?.checked ?? true;
            this.setRememberUser(rememberMe);
            this.login();
        });
    }

    /**
     * Set loading state on login button
     */
    setLoginButtonLoading(isLoading) {
        const loginBtn = getElement('login-btn');
        if (loginBtn) {
            if (isLoading) {
                loginBtn.disabled = true;
                loginBtn.innerHTML = `
                    <div class="loading-spinner"></div>
                    Signing in...
                `;
            } else {
                loginBtn.disabled = false;
                loginBtn.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" style="margin-right: 8px;">
                        <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Sign in with Google
                `;
            }
        }
    }

    showAppContent() {
        getElement('login-section').style.display = 'none';
        getElement('app-content').style.display = 'block';
    }
}
