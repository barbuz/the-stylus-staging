import test from 'node:test';
import assert from 'node:assert/strict';

import { AuthManager } from '../../js/modules/authManager.js';

/**
 * The sign-in flow's failure handling.
 *
 * A Google sign-in popup can fail without ever calling the token client's
 * `callback`: the popup may be blocked or closed (reported through
 * `error_callback`), or — in an installed / standalone app — it may open and
 * then never hand the token back at all. None of these must leave the button
 * stuck on "Signing in...".
 *
 * These tests install a fake DOM, a fake GIS and a fake `gapi`, then drive the
 * token client's callbacks directly so the assertions are about behaviour.
 */
function installEnv() {
    const previous = {
        document: globalThis.document,
        window: globalThis.window,
        localStorage: globalThis.localStorage,
        google: globalThis.google,
        gapi: globalThis.gapi,
        alert: globalThis.alert,
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

    // A minimal login button the manager can toggle, plus the elements the
    // success path touches (auth section, login / app containers).
    const elements = new Map();
    const makeEl = () => ({ disabled: false, innerHTML: '', style: {}, addEventListener: () => {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {} } });
    const button = makeEl();
    elements.set('login-btn', button);
    for (const id of ['auth-section', 'login-section', 'app-content', 'guru-signature-display', 'status-message']) {
        elements.set(id, makeEl());
    }
    globalThis.document = {
        // Return (and lazily create) an element for any id, so the success
        // path's DOM writes have somewhere to land.
        getElementById: (id) => {
            if (!elements.has(id)) elements.set(id, makeEl());
            return elements.get(id);
        },
        addEventListener: () => {},
        removeEventListener: () => {},
        visibilityState: 'visible',
        createElement: makeEl,
        body: makeEl()
    };

    let standalone = false;
    globalThis.window = {
        matchMedia: () => ({ matches: standalone }),
        navigator: {}
    };

    globalThis.alert = () => {};

    globalThis.gapi = {
        load: (_name, opts) => opts.callback(),
        client: {
            init: () => Promise.resolve({}),
            setToken: () => {},
            // The success path initialises preferences from Drive appData.
            drive: {
                files: {
                    list: () => Promise.resolve({ result: { files: [{ id: 'PREF_FILE_ID' }] } }),
                    get: () => Promise.resolve({ body: '{}' })
                }
            },
            request: () => Promise.resolve({ result: { id: 'PREF_FILE_ID' } })
        }
    };

    // GIS stub: records the config so a test can invoke its callbacks.
    const gis = { opts: null, requests: 0, respond: () => {} };
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
                },
                revoke: () => {}
            }
        }
    };

    return {
        button,
        gis,
        setStandalone: (value) => { standalone = value; },
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
            globalThis.window = previous.window;
            globalThis.localStorage = previous.localStorage;
            globalThis.google = previous.google;
            globalThis.gapi = previous.gapi;
            globalThis.alert = previous.alert;
            globalThis.setTimeout = previous.setTimeout;
            globalThis.clearTimeout = previous.clearTimeout;
        }
    };
}

function makeManager() {
    const emitted = [];
    const events = { emit: (event) => emitted.push(event) };
    const manager = new AuthManager(events, null);
    const statusCalls = [];
    manager.uiController = { showStatus: (...args) => statusCalls.push(args) };
    return { manager, emitted, statusCalls };
}

test('the token client is given an error_callback', async () => {
    const env = installEnv();
    try {
        const { manager } = makeManager();
        await manager.initialize();

        // Without this, a popup the guru closes (or that a browser blocks) never
        // reports back and the button is stuck loading.
        assert.equal(typeof env.gis.opts.error_callback, 'function');
    } finally {
        env.restore();
    }
});

test('a blocked popup releases the button and explains why', async () => {
    const env = installEnv();
    try {
        const { manager, statusCalls } = makeManager();
        await manager.initialize();
        // A blocked popup reports synchronously from inside requestAccessToken.
        env.gis.respond = (opts) => opts.error_callback({ type: 'popup_failed_to_open' });

        await manager.login();

        assert.equal(env.button.disabled, false, 'the button must not stay disabled');
        assert.equal(statusCalls.length, 1);
        assert.match(statusCalls[0][0], /blocked the Google sign-in popup/i);
        assert.equal(statusCalls[0][1], 'error');
    } finally {
        env.restore();
    }
});

test('closing the popup releases the button', async () => {
    const env = installEnv();
    try {
        const { manager, statusCalls } = makeManager();
        await manager.initialize();
        env.gis.respond = (opts) => opts.error_callback({ type: 'popup_closed' });

        await manager.login();

        assert.equal(env.button.disabled, false);
        assert.match(statusCalls[0][0], /cancelled/i);
    } finally {
        env.restore();
    }
});

test('an installed app points the guru at the browser when sign-in does not complete', async () => {
    const env = installEnv();
    try {
        const { manager, statusCalls } = makeManager();
        env.setStandalone(true);
        await manager.initialize();
        env.gis.respond = (opts) => opts.error_callback({ type: 'popup_closed' });

        await manager.login();

        // popup_closed maps to the cancelled message, but the timeout path is
        // the one the installed app actually hits. Exercise that directly.
        statusCalls.length = 0;
        manager._handleLoginFailure('timeout');
        assert.equal(statusCalls.length, 0, 'a non-pending attempt is ignored');

        env.gis.respond = (opts) => opts.error_callback({ type: 'unknown' });
        await manager.login();
        assert.match(statusCalls[0][0], /browser \(not the installed app\)/i);
    } finally {
        env.restore();
    }
});

test('the backstop releases the button when nothing reports back', async () => {
    const env = installEnv();
    try {
        const { manager, statusCalls } = makeManager();
        await manager.initialize();
        // The popup opens but never calls back — the installed-app hang.
        env.gis.respond = () => {};

        await manager.login();
        assert.equal(env.button.disabled, true, 'loading while the popup is open');

        // The backstop timer fires.
        env.runTimers();

        assert.equal(env.button.disabled, false);
        assert.equal(statusCalls.length, 1);
    } finally {
        env.restore();
    }
});

test('a successful sign-in is not overridden by a later popup error', async () => {
    const env = installEnv();
    try {
        const { manager, statusCalls } = makeManager();
        await manager.initialize();
        env.gis.respond = () => {}; // hold the popup open

        await manager.login();

        // The token arrives.
        await manager.handleAuthSuccess('token', 3600);
        assert.equal(statusCalls.length, 0);

        // A late error_callback (e.g. the popup finally closes) must be ignored.
        env.gis.opts.error_callback({ type: 'popup_closed' });
        env.runTimers();

        assert.equal(statusCalls.length, 0, 'a completed sign-in is not undone');
        assert.equal(manager.isLoggedIn(), true);
    } finally {
        env.restore();
    }
});
