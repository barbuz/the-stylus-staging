/**
 * Logging helper with a bounded diagnostic buffer.
 *
 * The app logs a lot while a guru works through a pod. That is useful while
 * developing, but it is noise in normal use, so console output for `debug` is
 * suppressed unless explicitly opted into: add `?debug` to the URL or set
 * `window.__stylusDebug = true`. `warn` and `error` always pass through.
 *
 * The debug flag controls *console verbosity* only, not *capture*: every call
 * records a redacted entry in a 500-line ring buffer (oldest dropped first) so a
 * guru can download it to attach to a bug report. The buffer is mirrored into
 * `sessionStorage` (never `localStorage`) so a reload-into-failure keeps the
 * prior lines without leaking across sessions.
 *
 * Call sites use the `logger` object (`logger.debug(...)`) rather than
 * destructured names, so a local `catch (error)` binding cannot shadow it.
 */
import { formatLogArguments, LOG_BUFFER_LIMIT } from '../domain/diagnosticLog.js';
import { getSessionJSON, setSessionJSON } from '../services/storage.js';
import { CONFIG } from '../config.js';

export const LOG_STORAGE_KEY = CONFIG.STORAGE_KEYS.DIAGNOSTIC_LOG;

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

/** Whether `logger.debug` is currently writing to the console. */
export function isDebugEnabled() {
    return debugEnabled();
}

const buffer = [];

function isValidEntry(entry) {
    return entry
        && typeof entry.timestamp === 'string'
        && typeof entry.level === 'string'
        && typeof entry.message === 'string';
}

function restore() {
    const stored = getSessionJSON(LOG_STORAGE_KEY, null);
    if (!Array.isArray(stored)) {
        return;
    }
    for (const entry of stored) {
        if (isValidEntry(entry)) {
            buffer.push(entry);
        }
    }
    if (buffer.length > LOG_BUFFER_LIMIT) {
        buffer.splice(0, buffer.length - LOG_BUFFER_LIMIT);
    }
}

function persist() {
    setSessionJSON(LOG_STORAGE_KEY, buffer);
}

function record(level, args) {
    let message;
    try {
        message = formatLogArguments(args);
    } catch {
        message = '[unformattable log arguments]';
    }
    buffer.push({ timestamp: new Date().toISOString(), level, message });
    if (buffer.length > LOG_BUFFER_LIMIT) {
        buffer.splice(0, buffer.length - LOG_BUFFER_LIMIT);
    }
    persist();
}

restore();

export const logger = {
    /** Development-only console message, gated behind `?debug`; always captured. */
    debug(...args) {
        record('DEBUG', args);
        if (debugEnabled()) {
            console.log(...args);
        }
    },

    /** Warning. Always emitted and captured. */
    warn(...args) {
        record('WARN', args);
        console.warn(...args);
    },

    /** Error. Always emitted and captured. */
    error(...args) {
        record('ERROR', args);
        console.error(...args);
    }
};

/** A copy of the buffered entries, oldest first. */
export function getLogEntries() {
    return buffer.slice();
}

/** Empty the buffer (in memory and in sessionStorage). */
export function clearLogBuffer() {
    buffer.length = 0;
    persist();
}
