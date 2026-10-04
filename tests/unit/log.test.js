import test from 'node:test';
import assert from 'node:assert/strict';

import { logger } from '../../js/utils/log.js';

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
