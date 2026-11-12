import test from 'node:test';
import assert from 'node:assert/strict';

import { AuthManager } from '../../js/modules/authManager.js';

/**
 * AuthManager's token-refresh path touches the DOM (gesture listeners), GIS
 * (`google.accounts.oauth2`) and `gapi`. These tests install small fakes for
 * each and drive the refresh explicitly, so the assertions are about behaviour
 * rather than timing.
 */
function installEnv() {
    const previous = {
        document: globalThis.document,
        localStorage: globalThis.localStorage,
        google: globalThis.google,
        gapi: globalThis.gapi,
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout
    };

    const storage = new Map();
    globalThis.localStorage = {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key)
    };

    // Timer capture: the tests decide when a scheduled callback runs.
    const timers = new Map();
    let timerId = 0;
    globalThis.setTimeout = (fn, ms) => {
        const id = ++timerId;
        timers.set(id, { fn, ms });
        return id;
    };
    globalThis.clearTimeout = (id) => timers.delete(id);

    // Fake document that records listeners so a test can dispatch a gesture or
    // a visibility change.
    const listeners = new Map();
    let visibility = 'visible';
    globalThis.document = {
        get visibilityState() { return visibility; },
        addEventListener: (type, handler) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(handler);
        },
        removeEventListener: (type, handler) => {
            listeners.get(type)?.delete(handler);
        }
    };
    const dispatch = (type) => {
        for (const handler of [...(listeners.get(type) || [])]) handler();
    };
    const setVisibility = (state) => {
        visibility = state;
        dispatch('visibilitychange');
    };

    const gapiToken = { value: null };
    globalThis.gapi = { client: { setToken: ({ access_token }) => { gapiToken.value = access_token; } } };

    // GIS stub whose response is chosen per test.
    const gis = { requests: 0, opts: null, respond: () => {} };
    globalThis.google = {
        accounts: {
            oauth2: {
                initTokenClient: (opts) => {
                    gis.opts = opts;
                    return {
                        requestAccessToken: () => {
                            gis.requests++;
                            gis.respond(opts);
                        }
                    };
                }
            }
        }
    };

    return {
        storage,
        timers,
        dispatch,
        setVisibility,
        // Let the async refresh chain (async fn -> promise -> finally -> then)
        // settle before asserting on its effects.
        flush: () => new Promise((resolve) => setImmediate(resolve)),
        gis,
        gapiToken,
        runTimers: (ms) => {
            for (const [id, t] of [...timers]) {
                if (ms === undefined || t.ms === ms) {
                    timers.delete(id);
                    t.fn();
                }
            }
        },
        restore() {
            globalThis.document = previous.document;
            globalThis.localStorage = previous.localStorage;
            globalThis.google = previous.google;
            globalThis.gapi = previous.gapi;
            globalThis.setTimeout = previous.setTimeout;
            globalThis.clearTimeout = previous.clearTimeout;
        }
    };
}

function makeManager({ remembered = true } = {}) {
    const emitted = [];
    const events = { emit: (event) => emitted.push(event) };
    const manager = new AuthManager(events, null);
    manager.isAuthenticated = true;
    manager.user = { accessToken: 'old-token', email: 'alice@example.com' };
    // Mirror the post-login state: a token near its expiry, and the session
    // visibility watcher that `saveTokens` installs.
    manager.saveTokens('old-token', 60);
    // Record status notices so a test can assert what the guru is told.
    const statusCalls = [];
    manager.uiController = { showStatus: (...args) => statusCalls.push(args) };
    if (remembered) {
        localStorage.setItem('remember_user', 'true');
        localStorage.setItem('user_id', 'alice@example.com');
    }
    return { manager, emitted, statusCalls };
}

test('a refresh adopts the new token without emitting USER_LOGGED_IN', async () => {
    const env = installEnv();
    try {
        const { manager, emitted } = makeManager();
        env.gis.respond = (opts) => opts.callback({ access_token: 'fresh-token', expires_in: 3600 });

        const ok = await manager.attemptAutoReauth({ userGesture: true });

        assert.equal(ok, true);
        assert.equal(env.gapiToken.value, 'fresh-token');
        assert.equal(manager.user.accessToken, 'fresh-token');
        assert.equal(manager.isAuthenticated, true);
        // The crux of the "kicked back to home" bug: a refresh is not a login.
        assert.deepEqual(emitted, [], 'a token refresh must not re-run the login flow');
    } finally {
        env.restore();
    }
});

test('a refresh re-arms the expiry timer for the new token', async () => {
    const env = installEnv();
    try {
        const { manager } = makeManager();
        env.gis.respond = (opts) => opts.callback({ access_token: 'fresh-token', expires_in: 3600 });

        await manager.attemptAutoReauth({ userGesture: true });

        // A new re-auth timer (2 minutes before the new expiry) must be pending.
        const scheduled = [...env.timers.values()].map(t => t.ms);
        assert.ok(scheduled.includes((3600 - 120) * 1000), `expected a re-armed timer, got ${scheduled}`);
    } finally {
        env.restore();
    }
});

test('without a user gesture no token request is made', async () => {
    const env = installEnv();
    try {
        const { manager, emitted } = makeManager();

        const ok = await manager.attemptAutoReauth();

        assert.equal(ok, false);
        assert.equal(env.gis.requests, 0, 'a bare call must not open the Google screen');
        assert.deepEqual(emitted, []);
    } finally {
        env.restore();
    }
});

test('no gesture listener is live while the page is hidden', async () => {
    const env = installEnv();
    try {
        const { manager } = makeManager();
        manager.setupReauthTimer(3600);
        env.runTimers(); // fire the expiry timer -> arm the refresh
        env.setVisibility('hidden');

        env.dispatch('pointerdown');

        assert.equal(env.gis.requests, 0, 'no popup while the tab is hidden');
    } finally {
        env.restore();
    }
});

test('the expiry timer refreshes on the next gesture, not on the timer itself', async () => {
    const env = installEnv();
    try {
        const { manager } = makeManager();
        env.gis.respond = (opts) => opts.callback({ access_token: 'fresh-token', expires_in: 3600 });

        manager.setupReauthTimer(3600);
        env.runTimers(); // expiry timer fires: arms the refresh
        assert.equal(env.gis.requests, 0, 'the timer must not itself request a token');

        env.dispatch('pointerdown'); // the guru taps the screen
        await env.flush();

        assert.equal(env.gis.requests, 1, 'the gesture drives the refresh');
        assert.equal(manager.user.accessToken, 'fresh-token');
    } finally {
        env.restore();
    }
});

test('a guru who returns after a long background still refreshes on the first tap', async () => {
    const env = installEnv();
    try {
        const { manager } = makeManager();
        env.gis.respond = (opts) => opts.callback({ access_token: 'fresh-token', expires_in: 3600 });

        manager.setupReauthTimer(3600);
        env.runTimers(); // the expiry passes while the page is open

        // The guru switches apps for a long time: the page is hidden the whole
        // while, so no refresh can (or should) happen.
        env.setVisibility('hidden');
        env.dispatch('pointerdown');
        assert.equal(env.gis.requests, 0, 'nothing happens while backgrounded');

        // They come back and tap. There was no expiry-based time limit, so the
        // refresh is still armed and runs now.
        env.setVisibility('visible');
        env.dispatch('pointerdown');
        await env.flush();

        assert.equal(env.gis.requests, 1, 'the return tap refreshes the token');
        assert.equal(manager.user.accessToken, 'fresh-token');
    } finally {
        env.restore();
    }
});

test('a frozen background page that missed its expiry timer still refreshes on return', async () => {
    const env = installEnv();
    try {
        const { manager } = makeManager();
        env.gis.respond = (opts) => opts.callback({ access_token: 'fresh-token', expires_in: 3600 });

        // The page is backgrounded *before* the expiry timer fires, so the timer
        // never runs (a frozen/suspended tab). The refresh is armed only once
        // the page becomes visible again, from the stored expiry.
        env.setVisibility('hidden');
        assert.equal(env.gis.requests, 0, 'nothing happens while backgrounded');

        env.setVisibility('visible');
        env.dispatch('pointerdown');
        await env.flush();

        assert.equal(env.gis.requests, 1, 'the return tap refreshes even without the timer firing');
        assert.equal(manager.user.accessToken, 'fresh-token');
    } finally {
        env.restore();
    }
});

test('a resume right after a refresh does not request a second token', async () => {
    const env = installEnv();
    try {
        const { manager } = makeManager();
        env.gis.respond = (opts) => opts.callback({ access_token: 'fresh-token', expires_in: 3600 });

        manager.setupReauthTimer(3600);
        env.runTimers();
        env.dispatch('pointerdown');
        await env.flush();
        assert.equal(env.gis.requests, 1);

        // A later resume must not refresh again: nothing is armed until the next
        // expiry arms it.
        env.setVisibility('hidden');
        env.setVisibility('visible');
        env.dispatch('pointerdown');
        await env.flush();

        assert.equal(env.gis.requests, 1, 'a resume after a refresh does not re-request');
    } finally {
        env.restore();
    }
});

test('a failed silent request resolves false via error_callback', async () => {
    const env = installEnv();
    try {
        const { manager, emitted } = makeManager();
        env.gis.respond = (opts) => opts.error_callback({ type: 'popup_failed_to_open' });

        const ok = await manager.attemptAutoReauth({ userGesture: true });

        assert.equal(ok, false);
        assert.equal(manager.user.accessToken, 'old-token', 'the session token is untouched');
        assert.deepEqual(emitted, []);
    } finally {
        env.restore();
    }
});

test('a slow refresh tells the guru it is renewing their sign-in', async () => {
    const env = installEnv();
    try {
        const { manager, statusCalls } = makeManager();
        let resolveResponse;
        env.gis.respond = (opts) => { resolveResponse = () => opts.callback({ access_token: 'fresh-token', expires_in: 3600 }); };

        const refresh = manager.attemptAutoReauth({ userGesture: true });
        const waited = manager.ensureValidToken();

        // A warm refresh must not flash a notice: nothing until the delay.
        await Promise.resolve();
        assert.deepEqual(statusCalls, [], 'no notice before the delay');

        // Cross the notice delay while the token is still pending.
        env.runTimers(500);
        assert.deepEqual(statusCalls, [['Renewing your sign-in...', 'loading']]);

        resolveResponse();
        await refresh;
        await waited;
    } finally {
        env.restore();
    }
});

test('a warm refresh shows no notice at all', async () => {
    const env = installEnv();
    try {
        const { manager, statusCalls } = makeManager();
        env.gis.respond = (opts) => opts.callback({ access_token: 'fresh-token', expires_in: 3600 });

        const refresh = manager.attemptAutoReauth({ userGesture: true });
        await manager.ensureValidToken();
        await refresh;
        // Let the (cleared) timer would-have-fired window pass.
        env.runTimers(500);

        assert.deepEqual(statusCalls, [], 'a fast refresh is silent');
    } finally {
        env.restore();
    }
});

test('ensureValidToken awaits an in-flight refresh', async () => {
    const env = installEnv();
    try {
        const { manager } = makeManager();
        let resolveResponse;
        env.gis.respond = (opts) => { resolveResponse = () => opts.callback({ access_token: 'fresh-token', expires_in: 3600 }); };

        const refresh = manager.attemptAutoReauth({ userGesture: true });
        let settled = false;
        const waited = manager.ensureValidToken().then(() => { settled = true; });

        // Nothing has settled until the GIS callback fires.
        await Promise.resolve();
        assert.equal(settled, false, 'the write must wait for the refresh');

        resolveResponse();
        await refresh;
        await waited;
        assert.equal(settled, true);
    } finally {
        env.restore();
    }
});

test('a refresh requested by the gesture is not duplicated by a second caller', async () => {
    const env = installEnv();
    try {
        const { manager } = makeManager();
        env.gis.respond = (opts) => opts.callback({ access_token: 'fresh-token', expires_in: 3600 });

        const first = manager.attemptAutoReauth({ userGesture: true });
        const second = manager.attemptAutoReauth({ userGesture: true });
        await Promise.all([first, second]);

        assert.equal(env.gis.requests, 1, 'concurrent callers share one token request');
    } finally {
        env.restore();
    }
});

test('an expired stored token at load silently signs the guru back in', async () => {
    const env = installEnv();
    try {
        const emitted = [];
        const events = { emit: (event) => emitted.push(event) };
        const manager = new AuthManager(events, null);
        manager.initialized = true;
        localStorage.setItem('remember_user', 'true');
        localStorage.setItem('user_id', 'alice@example.com');
        localStorage.setItem('access_token', 'expired-token');
        localStorage.setItem('token_expiry', String(Date.now() - 1000));
        // Isolate the silent sign-in decision from the DOM/Drive-bound success path.
        manager.handleAuthSuccess = async (token) => { manager.user = { accessToken: token }; };
        env.gis.respond = (opts) => opts.callback({ access_token: 'fresh-token', expires_in: 3600 });

        const restored = await manager.checkAuthStatus();

        assert.equal(restored, true, 'the session is restored');
        assert.equal(env.gis.requests, 1, 'a silent sign-in is attempted at load');
        assert.equal(env.gis.opts.prompt, 'none', 'it is silent, not interactive');
        assert.equal(manager.user.accessToken, 'fresh-token');
    } finally {
        env.restore();
    }
});

test('with no stored token a remembered guru is signed in silently at load', async () => {
    const env = installEnv();
    try {
        const emitted = [];
        const events = { emit: (event) => emitted.push(event) };
        const manager = new AuthManager(events, null);
        manager.initialized = true;
        // The reported case: a remembered guru whose token storage is empty.
        localStorage.setItem('remember_user', 'true');
        localStorage.setItem('user_id', 'alice@example.com');
        manager.handleAuthSuccess = async (token) => { manager.user = { accessToken: token }; };
        env.gis.respond = (opts) => opts.callback({ access_token: 'fresh-token', expires_in: 3600 });

        const restored = await manager.checkAuthStatus();

        assert.equal(restored, true);
        assert.equal(env.gis.requests, 1, 'silent sign-in is the auto-login path');
        assert.equal(env.gis.opts.prompt, 'none');
    } finally {
        env.restore();
    }
});

test('a guru who did not ask to be remembered gets no silent sign-in', async () => {
    const env = installEnv();
    try {
        const emitted = [];
        const events = { emit: (event) => emitted.push(event) };
        const manager = new AuthManager(events, null);
        manager.initialized = true;
        manager.showLoginScreen = () => {};
        localStorage.setItem('remember_user', 'false');
        localStorage.setItem('user_id', 'alice@example.com');

        const restored = await manager.checkAuthStatus();

        assert.equal(restored, false);
        assert.equal(env.gis.requests, 0, 'no silent sign-in without consent to remember');
    } finally {
        env.restore();
    }
});

test('a silent sign-in that fails leaves the guru on the login screen', async () => {
    const env = installEnv();
    try {
        const emitted = [];
        const events = { emit: (event) => emitted.push(event) };
        const manager = new AuthManager(events, null);
        manager.initialized = true;
        manager.showLoginScreen = () => {};
        localStorage.setItem('remember_user', 'true');
        localStorage.setItem('user_id', 'alice@example.com');
        env.gis.respond = (opts) => opts.error_callback({ type: 'popup_failed_to_open' });

        const restored = await manager.checkAuthStatus();

        assert.equal(restored, false);
        assert.equal(env.gis.requests, 1, 'one silent attempt was made');
    } finally {
        env.restore();
    }
});
