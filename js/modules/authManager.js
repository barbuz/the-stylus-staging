import { CONFIG } from '../config.js';
import { UserPreferences } from './userPreferences.js';
import { APP_EVENTS } from '../app/events.js';
import { logger } from '../utils/log.js';
import { getElement } from '../utils/domUtils.js';
import { getItem, setItem, removeItem } from '../services/storage.js';

// Refresh this long before the token actually expires, matching the margin the
// expiry timer uses.
const REFRESH_LEAD_MS = 2 * 60 * 1000;

// How long a refresh may take before the guru is told it is happening. A warm
// refresh beats this easily; anything slower is worth explaining.
const REFRESH_NOTICE_DELAY_MS = 500;

// Backstop for a sign-in popup that never reports back. A popup the user closes
// or that fails to open is reported immediately by `error_callback`; this only
// covers the silent case (e.g. a standalone app, where the popup has no opener
// to return the token through, so the user can sit on a blank page). Without
// it the button would stay on "Signing in..." forever.
const LOGIN_TIMEOUT_MS = 60000;

export class AuthManager {
    constructor(events, guruSignature = null) {
        // Optional event bus. When present the login / signature flow is routed
        // through it.
        this.events = events || null;
        // The single owner of the current signature. AuthManager deliberately
        // keeps no copy: it delegates reads/writes here.
        this.guruSignature = guruSignature;
        // Injected by main.js after both are constructed; used only to surface a
        // "renewing your sign-in" notice during a slow refresh.
        this.uiController = null;
        this.user = null;
        this.isAuthenticated = false;
        this.tokenClient = null;
        this.initialized = false;
        this.userPreferences = new UserPreferences();
        this.reauthTimer = null;
        // A refresh already in flight, so the expiry timer and a write-triggered
        // check share one token request instead of racing two popups.
        this.refreshPromise = null;
        // The one-shot gesture listener that lets a deferred refresh run once
        // the browser has a user activation to attach it to, plus the
        // visibility listener that arms it only while the page is on screen.
        this._refreshGestureHandler = null;
        this._visibilityHandler = null;
        // The backstop timer for a sign-in popup that never reports back, and
        // whether the sign-in button is currently showing its loading state.
        this.loginTimer = null;
        this._loginPending = false;
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
                        this._handleLoginFailure(response.error);
                        return;
                    }
                    const idToken = response.id_token;
                    // Do not log the response object: it carries the access and
                    // ID tokens. The diagnostic buffer must stay secret-free.
                    logger.debug('✅ OAuth token received');
                    this.handleAuthSuccess(response.access_token, response.expires_in);
                },
                // Some non-OAuth failures never reach `callback`: the popup was
                // blocked or closed, or (in an installed / standalone app) it
                // opened but could not hand the token back. Without this the
                // button would sit on "Signing in..." with nothing in the log.
                error_callback: (err) => {
                    logger.warn('OAuth popup error:', err?.type || err);
                    this._handleLoginFailure(err?.type);
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
        // The popup reported back, so the backstop is no longer needed and a
        // late error callback must not override this success.
        this._loginPending = false;
        this._clearLoginTimer();
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

        // Watch visibility for the whole session, not just once the expiry timer
        // fires: a tab frozen before that point would otherwise come back with
        // no watcher and never refresh.
        this._watchVisibility();
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

        this._clearReauthTimer();
        this._disarmRefreshOnGesture();
    }

    /**
     * Set up a timer to trigger silent re-auth before token expiry.
     *
     * The callback does not fire the token request itself: the token client
     * needs a user gesture, and a request made from a bare timer (or while the
     * phone is locked) opens Google's account screen with no gesture to attach
     * it to, stranding the user there. Instead the timer arms a one-shot
     * gesture listener, so the refresh runs on the guru's next tap or keypress
     * — still before the token actually expires.
     *
     * @param {number} expiresIn - seconds until token expiry
     */
    setupReauthTimer(expiresIn) {
        this._clearReauthTimer();
        // Arm 2 minutes before expiry, but not less than 10 seconds from now.
        const reauthMs = Math.max((expiresIn - 120) * 1000, 10000);
        this.reauthTimer = setTimeout(() => {
            logger.debug('⏰ Token expiring soon, waiting for a user gesture to refresh');
            this._armRefreshOnGesture();
        }, reauthMs);
    }

    _clearReauthTimer() {
        if (this.reauthTimer) {
            clearTimeout(this.reauthTimer);
            this.reauthTimer = null;
        }
    }

    /**
     * Arm the next-gesture refresh, but only while the page is on screen.
     *
     * The listener must not be live while the page is hidden: a phone that is
     * locked, or a guru who switches apps, should not fire a token request
     * behind their back (which is the "stuck on the Google screen" failure).
     * So the gesture listener is added on `visible` and removed on `hidden`.
     * The visibility watcher is installed for the whole session (see
     * `saveTokens`) and re-decides from the stored expiry on each resume, which
     * is what lets a guru who returns after a long absence — even one that
     * froze the tab before the expiry timer ran — still get a refresh on their
     * first tap.
     */
    _armRefreshOnGesture() {
        this._watchVisibility();
        this._addRefreshGestureListener();
    }

    _watchVisibility() {
        if (this._visibilityHandler) {
            return;
        }
        this._visibilityHandler = () => {
            if (document.visibilityState === 'hidden') {
                this._removeRefreshGestureListener();
                logger.debug('⏰ Page hidden; refresh gesture listener removed');
            } else {
                // A frozen background page may not have run the expiry timer, so
                // decide from the token itself: only arm if it is due or past.
                if (this._tokenNeedsRefresh()) {
                    this._addRefreshGestureListener();
                    logger.debug('⏰ Page visible; refresh gesture listener armed');
                } else {
                    logger.debug('⏰ Page visible; token still fresh, nothing armed');
                }
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
    }

    /** True when the stored token is within the refresh lead of its expiry. */
    _tokenNeedsRefresh() {
        const expiryTime = this.getStoredTokens()?.expiryTime;
        return !expiryTime || Date.now() >= expiryTime - REFRESH_LEAD_MS;
    }

    _addRefreshGestureListener() {
        if (this._refreshGestureHandler || this.refreshPromise) {
            return;
        }
        if (document.visibilityState === 'hidden' || !this._tokenNeedsRefresh()) {
            return;
        }

        const handler = () => {
            this._removeRefreshGestureListener();
            this._refreshWithGesture();
        };

        this._refreshGestureHandler = handler;
        document.addEventListener('pointerdown', handler, { capture: true, once: true });
        document.addEventListener('keydown', handler, { capture: true, once: true });
        logger.debug('⏰ Token refresh armed for the next user gesture');
    }

    _removeRefreshGestureListener() {
        if (this._refreshGestureHandler) {
            document.removeEventListener('pointerdown', this._refreshGestureHandler, { capture: true });
            document.removeEventListener('keydown', this._refreshGestureHandler, { capture: true });
            this._refreshGestureHandler = null;
        }
    }

    _disarmRefreshOnGesture() {
        this._removeRefreshGestureListener();
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
    }

    /** Run a token refresh from inside a user gesture (button press, keydown). */
    _refreshWithGesture() {
        this._clearReauthTimer();
        this.attemptAutoReauth({ userGesture: true }).then(success => {
            if (success) {
                // The token is fresh: drop the gesture listener but keep the
                // visibility watcher, so a later freeze/resume can still refresh
                // once this token nears its own expiry.
                this._removeRefreshGestureListener();
            } else if (this.isAuthenticated && this.shouldRememberUser()) {
                // Transient failure on a session that still wants refreshing:
                // keep watching so the next interaction retries. A deliberate
                // "do not remember me" must not keep a listener alive.
                this._armRefreshOnGesture();
            } else {
                this._disarmRefreshOnGesture();
            }
        });
    }

    /**
     * Await a token refresh if one is already in flight, so a write triggered
     * by the same gesture cannot run against the token the refresh is about to
     * replace. Resolves immediately when nothing is in flight.
     */
    async ensureValidToken() {
        if (!this.refreshPromise) {
            return;
        }
        // Tell the guru why the action they just tapped has not happened yet.
        // Delayed, so a warm refresh (well under this) does not flash a notice;
        // the action's own message replaces it when the write proceeds.
        const notice = setTimeout(() => {
            this.uiController?.showStatus('Renewing your sign-in...', 'loading');
        }, REFRESH_NOTICE_DELAY_MS);
        try {
            await this.refreshPromise;
        } finally {
            clearTimeout(notice);
        }
    }

    /**
     * True while a token refresh is in flight. Callers use this to explain a
     * pause that is really the sign-in renewing, rather than reporting the
     * action they were asked to perform as if it were already underway.
     */
    isRefreshing() {
        return !!this.refreshPromise;
    }

    /**
     * Obtain a fresh access token without re-running the login flow.
     *
     * A token refresh is not a login: it must not re-render the shell, reset
     * the open pod or re-emit USER_LOGGED_IN. Doing so is what kicked a guru
     * back to the home screen mid-session when their token refreshed.
     *
     * @param {object} [options]
     * @param {boolean} [options.userGesture] - true when called from a gesture
     * @returns {Promise<boolean>} whether a new token was obtained
     */
    async attemptAutoReauth({ userGesture = false } = {}) {
        // One refresh at a time: a second caller joins the in-flight request.
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        // A token request needs a user gesture. Without one, defer rather than
        // opening a Google screen the user cannot act on (the mobile "stuck at
        // the Google screen"). The expiry timer is what arms the gesture
        // listener; a bare call must not, or it would also arm one behind the
        // login screen and fire a second popup on the sign-in click.
        if (!userGesture) {
            logger.debug('🔐 Auto re-auth deferred - a token request needs a user gesture');
            return false;
        }

        // Only attempt auto re-auth if the user opted to be remembered.
        if (!this.shouldRememberUser()) {
            logger.debug('🔐 Auto re-auth skipped - user chose not to be remembered');
            return false;
        }

        const userId = getItem(CONFIG.STORAGE_KEYS.USER_ID);
        if (!userId) {
            logger.debug('🔐 Auto re-auth skipped - user ID not found');
            return false;
        }

        this.refreshPromise = this._requestRefreshToken(userId)
            .finally(() => { this.refreshPromise = null; });
        return this.refreshPromise;
    }

    _requestRefreshToken(userId) {
        logger.debug('🔄 Attempting automatic re-authentication...');

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                logger.debug('⏰ Auto re-auth timeout after 5 seconds');
                resolve(false);
            }, 5000);

            try {
                const silentTokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: CONFIG.GOOGLE_CLIENT_ID,
                    scope: CONFIG.SCOPES,
                    login_hint: userId,
                    prompt: 'none',
                    callback: (response) => {
                        clearTimeout(timeout);

                        if (response.error) {
                            logger.debug('❌ Silent auto re-auth failed:', response.error);
                            resolve(false);
                            return;
                        }

                        logger.debug('✅ Silent auto re-auth successful');
                        this.applyRefreshedToken(response.access_token, response.expires_in);
                        resolve(true);
                    },
                    // Without this, a popup that fails to open (a blocked popup
                    // on mobile) never calls back and the 5s timeout is the only
                    // thing that resolves the promise.
                    error_callback: (err) => {
                        clearTimeout(timeout);
                        logger.debug('❌ Silent auto re-auth error:', err?.type || err);
                        resolve(false);
                    }
                });

                silentTokenClient.requestAccessToken();
            } catch (error) {
                clearTimeout(timeout);
                logger.debug('❌ Error during silent auth:', error);
                resolve(false);
            }
        });
    }

    /**
     * Attempt a silent sign-in at load for a remembered guru.
     *
     * This is the auto-login an installed app depends on. `prompt: 'none'`
     * reuses the guru's existing Google session with no interaction, so the
     * installed app does not have to open the interactive sign-in popup — which
     * is the flow that is unreliable in a standalone window.
     *
     * The page load itself supplies the user gesture (opening the app is a
     * navigation), so this is safe to run unattended; the mid-session refresh is
     * a different matter and stays gesture-gated.
     *
     * @returns {Promise<boolean>} whether a silent sign-in completed
     */
    async _attemptSilentLogin() {
        if (!this.shouldRememberUser()) {
            logger.debug('🔐 Silent sign-in skipped - user chose not to be remembered');
            return false;
        }

        const userId = getItem(CONFIG.STORAGE_KEYS.USER_ID);
        if (!userId) {
            logger.debug('🔐 Silent sign-in skipped - user ID not found');
            return false;
        }

        logger.debug('🔄 Attempting silent sign-in for a remembered user...');

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                logger.debug('⏰ Silent sign-in timed out');
                resolve(false);
            }, 5000);

            try {
                const silentClient = google.accounts.oauth2.initTokenClient({
                    client_id: CONFIG.GOOGLE_CLIENT_ID,
                    scope: CONFIG.SCOPES,
                    login_hint: userId,
                    prompt: 'none',
                    callback: async (response) => {
                        clearTimeout(timeout);
                        if (response.error) {
                            logger.debug('❌ Silent sign-in failed:', response.error);
                            resolve(false);
                            return;
                        }
                        logger.debug('✅ Silent sign-in successful');
                        try {
                            await this.handleAuthSuccess(response.access_token, response.expires_in);
                            resolve(true);
                        } catch (error) {
                            // A silent sign-in that cannot finish the session must
                            // not hang the load; fall back to the login screen.
                            logger.warn('Silent sign-in could not complete the session:', error);
                            resolve(false);
                        }
                    },
                    error_callback: (err) => {
                        clearTimeout(timeout);
                        logger.debug('❌ Silent sign-in error:', err?.type || err);
                        resolve(false);
                    }
                });

                silentClient.requestAccessToken();
            } catch (error) {
                clearTimeout(timeout);
                logger.debug('❌ Error during silent sign-in:', error);
                resolve(false);
            }
        });
    }

    /**
     * Adopt a refreshed token in place. Deliberately does NOT render, reset the
     * session or emit USER_LOGGED_IN: a refresh keeps the guru exactly where
     * they are.
     */
    applyRefreshedToken(accessToken, expiresIn = 3600) {
        gapi.client.setToken({ access_token: accessToken });
        this.user = { ...(this.user || {}), accessToken };
        this.isAuthenticated = true;
        this.saveTokens(accessToken, expiresIn);
        this.setupReauthTimer(expiresIn);
        logger.debug('🔁 Token refreshed in place (session preserved)');
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
                    // The stored token is stale. Drop it and try a silent
                    // sign-in: a remembered guru (and especially an installed
                    // app) should come back signed in without the interactive
                    // popup, which a standalone window cannot complete.
                    logger.debug('🕒 Access token expired; attempting silent sign-in...');
                    this.clearStoredAuth();
                    const silentSuccess = await this._attemptSilentLogin();
                    if (silentSuccess) {
                        logger.debug('✅ Silent sign-in successful after expiry');
                        return true;
                    }
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
                    // A broken stored token cannot be validated. Drop it and try
                    // a silent sign-in before giving up on the session.
                    logger.debug('❌ Error validating stored token; attempting silent sign-in...', error);
                    this.clearStoredAuth();
                    const silentSuccess = await this._attemptSilentLogin();
                    if (silentSuccess) {
                        logger.debug('✅ Silent sign-in successful after validation error');
                        return true;
                    }
                    return false;
                }
            }

            if (!this.isAuthenticated) {
                // No stored token: try a silent sign-in for a remembered guru.
                // This is what lets the installed app come back to a signed-in
                // session instead of the interactive popup it cannot complete.
                logger.debug('🔄 No valid tokens found; attempting silent sign-in...');
                const silentSuccess = await this._attemptSilentLogin();
                if (silentSuccess) {
                    logger.debug('✅ Silent sign-in successful as fallback');
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

            // Mark the attempt pending and arm the backstop *before* the
            // request: a blocked popup reports through `error_callback`
            // synchronously, and must not be dropped as "not pending".
            this._armLoginTimer();

            // Request access token using Google Identity Services
            this.tokenClient.requestAccessToken();

        } catch (error) {
            logger.error('Error during login:', error);
            this._loginPending = false;
            this._clearLoginTimer();
            this.setLoginButtonLoading(false);
            return false;
        }
    }

    /**
     * Release the sign-in button and explain why sign-in did not complete.
     *
     * Called from the token client's `error_callback` (popup blocked or closed)
     * and from the backstop timer. Deliberately does not surface a raw OAuth
     * code: the guru only needs to know the sign-in did not go through and how
     * to retry.
     */
    _handleLoginFailure(reason) {
        this._clearLoginTimer();
        // A popup that already reported back should not be double-handled.
        if (!this._loginPending) {
            return;
        }
        this._loginPending = false;
        this.setLoginButtonLoading(false);

        const message = this._signInFailureMessage(reason);
        logger.warn(`Login did not complete (${reason || 'unknown'}): ${message}`);
        this.uiController?.showStatus(message, 'error');
    }

    /** Human-readable reason for a sign-in that did not complete. */
    _signInFailureMessage(reason) {
        if (reason === 'popup_failed_to_open') {
            return 'Your browser blocked the Google sign-in popup. Allow popups for this app and try again.';
        }
        if (reason === 'popup_closed') {
            return 'Sign-in was cancelled. Tap "Sign in with Google" to try again.';
        }
        // In an installed app the interactive popup is unreliable, so point the
        // guru at the route that works: the browser session the app reuses.
        if (this._isStandaloneApp()) {
            return 'Sign-in did not complete. Open The Stylus in your browser and sign in there; the installed app will then use that session.';
        }
        return 'Sign-in did not complete. Please tap "Sign in with Google" to try again.';
    }

    /** True when the app is running as an installed / standalone window. */
    _isStandaloneApp() {
        try {
            return window.matchMedia?.('(display-mode: standalone)')?.matches === true
                || window.navigator?.standalone === true;
        } catch {
            return false;
        }
    }

    _armLoginTimer() {
        this._loginPending = true;
        this._clearLoginTimer();
        this.loginTimer = setTimeout(() => {
            this.loginTimer = null;
            this._handleLoginFailure('timeout');
        }, LOGIN_TIMEOUT_MS);
    }

    _clearLoginTimer() {
        if (this.loginTimer) {
            clearTimeout(this.loginTimer);
            this.loginTimer = null;
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
