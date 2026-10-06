/**
 * Diagnostic-log formatting and redaction.
 *
 * Pure functions only: the logger keeps raw entries in a ring buffer, and these
 * turn them into the plain-text file a guru attaches to a bug report. Nothing
 * here touches the DOM, storage or the console.
 *
 * The file is user-initiated and stays on the machine, but a pod carries match
 * data, so access tokens and email addresses are stripped before export. The
 * same helpers run at capture time (see `js/utils/log.js`), so secrets never
 * reach the buffer in the first place.
 */

/** Maximum number of buffered entries; oldest are dropped first. */
export const LOG_BUFFER_LIMIT = 500;

const REDACTED = '[redacted]';

// Keys whose value is always a secret, at any nesting depth.
const SENSITIVE_KEY_PATTERN =
    /^(access_token|refresh_token|id_token|token|authorization|email|email_address|client_secret|password)$/i;

// Email-shaped substrings inside free text (messages, URLs, user agents).
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Replace any email-shaped substring with a placeholder. */
export function redactEmails(text) {
    return String(text).replace(EMAIL_PATTERN, REDACTED);
}

function sanitizeValue(value, seen) {
    if (typeof value === 'string') {
        return redactEmails(value);
    }
    if (value instanceof Error) {
        return {
            name: value.name,
            message: redactEmails(value.message || ''),
            stack: redactEmails(value.stack || '')
        };
    }
    if (Array.isArray(value)) {
        return value.map(item => sanitizeValue(item, seen));
    }
    if (value && typeof value === 'object') {
        if (seen.has(value)) {
            return '[circular]';
        }
        seen.add(value);
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitizeValue(item, seen);
        }
        return result;
    }
    return value;
}

function formatArgument(value) {
    if (typeof value === 'string') {
        return redactEmails(value);
    }
    if (value instanceof Error) {
        return redactEmails(value.stack || `${value.name}: ${value.message}`);
    }
    if (value === undefined) {
        return 'undefined';
    }
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(sanitizeValue(value, new WeakSet()));
        } catch {
            return redactEmails(String(value));
        }
    }
    return String(value);
}

/**
 * Format logger arguments the way the console would (objects stringified,
 * `Error` stacks kept) into a single redacted message string.
 */
export function formatLogArguments(args) {
    return args.map(formatArgument).join(' ');
}

/** Format one buffered entry as `[timestamp] LEVEL  message`. */
export function formatEntry(entry) {
    const level = String(entry.level || 'DEBUG').toUpperCase();
    return `[${entry.timestamp}] ${level.padEnd(6)} ${entry.message}`;
}

/**
 * Build the complete downloadable text: a metadata header (version,
 * deployment, URL, user agent, debug state) plus the buffered entries.
 */
export function formatDiagnosticLog(entries = [], meta = {}) {
    const generatedAt = meta.generatedAt instanceof Date
        ? meta.generatedAt.toISOString()
        : (meta.generatedAt || new Date().toISOString());
    const version = meta.deploymentLabel
        ? `${meta.version} (${meta.deploymentLabel})`
        : `${meta.version}`;

    const header = [
        'The Stylus — diagnostic log',
        `Generated: ${generatedAt}`,
        `Version: ${version}`,
        `URL: ${redactEmails(meta.url || '')}`,
        `User agent: ${redactEmails(meta.userAgent || '')}`,
        `Debug: ${meta.debug ? 'on' : 'off'}`,
        '',
        'Note: this file may contain match data. Access tokens and email addresses are',
        'removed automatically.',
        ''
    ];

    const body = entries.length ? entries.map(formatEntry) : ['(no log entries)'];
    return [...header, ...body].join('\n') + '\n';
}

/** Download filename: `the-stylus-log-YYYYMMDD-HHMMSS.txt` (local time). */
export function logFilename(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('') + '-' + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join('');
    return `the-stylus-log-${stamp}.txt`;
}
