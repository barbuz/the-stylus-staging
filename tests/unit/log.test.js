import test from 'node:test';
import assert from 'node:assert/strict';

import { logger, getLogEntries, clearLogBuffer, LOG_STORAGE_KEY } from '../../js/utils/log.js';
import { LOG_BUFFER_LIMIT } from '../../js/domain/diagnosticLog.js';

/**
 * `logger.debug` is gated so normal use is quiet; `warn` / `error` always pass
 * through. Capture the console methods and the debug flag/location the gate
 * reads.
 */
function withCapturedConsole(fn) {
    const original = { log: console.log, warn: console.warn, error: console.error };
    const calls = { log: 0, warn: 0, error: 0 };
    console.log = () => { calls.log += 1; };
    console.warn = () => { calls.warn += 1; };
    console.error = () => { calls.error += 1; };
    try {
        fn(calls);
    } finally {
        Object.assign(console, original);
    }
}

function withGlobals({ debugFlag, search }, fn) {
    const previous = {
        flag: globalThis.__stylusDebug,
        location: globalThis.location
    };
    if (debugFlag === undefined) {
        delete globalThis.__stylusDebug;
    } else {
        globalThis.__stylusDebug = debugFlag;
    }
    if (search === undefined) {
        delete globalThis.location;
    } else {
        globalThis.location = { search };
    }
    try {
        fn();
    } finally {
        if (previous.flag === undefined) delete globalThis.__stylusDebug;
        else globalThis.__stylusDebug = previous.flag;
        if (previous.location === undefined) delete globalThis.location;
        else globalThis.location = previous.location;
    }
}

test('log: debug is suppressed by default', () => {
    withGlobals({ debugFlag: undefined, search: undefined }, () => {
        withCapturedConsole((calls) => {
            logger.debug('quiet');
            assert.equal(calls.log, 0);
        });
    });
});

test('log: debug is emitted with ?debug in the URL', () => {
    withGlobals({ debugFlag: undefined, search: '?pod=ABC&debug' }, () => {
        withCapturedConsole((calls) => {
            logger.debug('noisy');
            assert.equal(calls.log, 1);
        });
    });
});

test('log: debug is emitted with window.__stylusDebug = true', () => {
    withGlobals({ debugFlag: true, search: undefined }, () => {
        withCapturedConsole((calls) => {
            logger.debug('noisy');
            assert.equal(calls.log, 1);
        });
    });
});

test('log: warn and error always pass through', () => {
    withGlobals({ debugFlag: undefined, search: undefined }, () => {
        withCapturedConsole((calls) => {
            logger.warn('careful');
            logger.error('broken');
            assert.equal(calls.warn, 1);
            assert.equal(calls.error, 1);
        });
    });
});

test('log: every call is captured regardless of the debug flag', () => {
    clearLogBuffer();
    withGlobals({ debugFlag: undefined, search: undefined }, () => {
        withCapturedConsole(() => {
            logger.debug('quiet debug');
            logger.warn('a warning');
            logger.error('an error');
        });
    });

    const entries = getLogEntries();
    assert.deepEqual(entries.map(e => e.level), ['DEBUG', 'WARN', 'ERROR']);
    assert.deepEqual(entries.map(e => e.message), ['quiet debug', 'a warning', 'an error']);
    assert.match(entries[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
    clearLogBuffer();
});

test('log: the buffer is bounded at 500 entries, dropping the oldest', () => {
    clearLogBuffer();
    withGlobals({ debugFlag: undefined, search: undefined }, () => {
        withCapturedConsole(() => {
            for (let i = 0; i < LOG_BUFFER_LIMIT + 20; i += 1) {
                logger.debug(`entry ${i}`);
            }
        });
    });

    const entries = getLogEntries();
    assert.equal(entries.length, LOG_BUFFER_LIMIT);
    // The first 20 were dropped; the 21st is now oldest.
    assert.equal(entries[0].message, 'entry 20');
    assert.equal(entries[entries.length - 1].message, `entry ${LOG_BUFFER_LIMIT + 19}`);
    clearLogBuffer();
});

test('log: captured entries are redacted before they reach the buffer', () => {
    clearLogBuffer();
    withGlobals({ debugFlag: undefined, search: undefined }, () => {
        withCapturedConsole(() => {
            logger.error('auth failed', { access_token: 'secret-token', email: 'alice@example.com' });
        });
    });

    const [entry] = getLogEntries();
    assert.doesNotMatch(entry.message, /secret-token/);
    assert.doesNotMatch(entry.message, /alice@example\.com/);
    assert.match(entry.message, /\[redacted\]/);
    clearLogBuffer();
});

test('log: clearLogBuffer empties the buffer', () => {
    withGlobals({ debugFlag: undefined, search: undefined }, () => {
        withCapturedConsole(() => {
            logger.warn('gone');
        });
    });
    assert.ok(getLogEntries().length > 0);
    clearLogBuffer();
    assert.equal(getLogEntries().length, 0);
});

test('log: sessionStorage mirrors the buffer when available', () => {
    const previous = globalThis.sessionStorage;
    const map = new Map();
    globalThis.sessionStorage = {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: (key) => map.delete(key)
    };
    try {
        clearLogBuffer();
        withGlobals({ debugFlag: undefined, search: undefined }, () => {
            withCapturedConsole(() => {
                logger.warn('persisted');
            });
        });
        const stored = JSON.parse(map.get(LOG_STORAGE_KEY));
        assert.equal(stored.at(-1).message, 'persisted');
    } finally {
        clearLogBuffer();
        if (previous === undefined) delete globalThis.sessionStorage;
        else globalThis.sessionStorage = previous;
    }
});
