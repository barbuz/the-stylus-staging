/**
 * Logging helper.
 *
 * The app logs a lot while a guru works through a pod. That is useful while
 * developing, but it is noise in normal use, so `debug` is suppressed unless it
 * is explicitly opted into: add `?debug` to the URL or set
 * `window.__stylusDebug = true`. `warn` and `error` always pass through because
 * they mark something a guru or developer should see.
 *
 * Call sites use the `logger` object (`logger.debug(...)`) rather than
 * destructured names, so a local `catch (error)` binding cannot shadow it.
 */

function debugEnabled() {
    try {
        if (globalThis.__stylusDebug === true) {
            return true;
        }
        return typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
    } catch {
        return false;
    }
}

export const logger = {
    /** Development-only message, gated behind `?debug` / `window.__stylusDebug`. */
    debug(...args) {
        if (debugEnabled()) {
            console.log(...args);
        }
    },

    /** Warning. Always emitted. */
    warn(...args) {
        console.warn(...args);
    },

    /** Error. Always emitted. */
    error(...args) {
        console.error(...args);
    }
};
