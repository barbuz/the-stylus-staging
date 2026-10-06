import test from 'node:test';
import assert from 'node:assert/strict';

import {
    LOG_BUFFER_LIMIT,
    redactEmails,
    formatLogArguments,
    formatEntry,
    formatDiagnosticLog,
    logFilename
} from '../../js/domain/diagnosticLog.js';

test('diagnosticLog: the buffer cap is 500 entries', () => {
    assert.equal(LOG_BUFFER_LIMIT, 500);
});

test('diagnosticLog: redactEmails replaces email-shaped substrings', () => {
    assert.equal(redactEmails('contact alice@example.com now'), 'contact [redacted] now');
    assert.equal(redactEmails('no address here'), 'no address here');
});

test('diagnosticLog: sensitive keys are redacted, nested values survive', () => {
    const message = formatLogArguments([{
        access_token: 'secret-token',
        refresh_token: 'secret-refresh',
        id_token: 'secret-id',
        email: 'alice@example.com',
        nested: { password: 'hunter2', name: 'alice' }
    }]);

    assert.doesNotMatch(message, /secret-token/);
    assert.doesNotMatch(message, /secret-refresh/);
    assert.doesNotMatch(message, /secret-id/);
    assert.doesNotMatch(message, /hunter2/);
    assert.doesNotMatch(message, /alice@example\.com/);
    assert.match(message, /\[redacted\]/);
    assert.match(message, /"name":"alice"/);
});

test('diagnosticLog: errors keep their stack and are redacted', () => {
    const error = new Error('failed for bob@example.com');
    const message = formatLogArguments(['boom:', error]);
    assert.match(message, /failed for \[redacted\]/);
    assert.match(message, /Error/);
});

test('diagnosticLog: circular objects do not throw', () => {
    const circular = {};
    circular.self = circular;
    const message = formatLogArguments([circular]);
    assert.match(message, /\[circular\]/);
});

test('diagnosticLog: formatEntry uses a fixed-width level column', () => {
    assert.equal(
        formatEntry({ timestamp: '2026-10-04T09:19:01.234Z', level: 'WARN', message: 'careful' }),
        '[2026-10-04T09:19:01.234Z] WARN   careful'
    );
    assert.equal(
        formatEntry({ timestamp: '2026-10-04T09:19:05.001Z', level: 'error', message: 'broken' }),
        '[2026-10-04T09:19:05.001Z] ERROR  broken'
    );
});

test('diagnosticLog: formatDiagnosticLog writes a header and every entry', () => {
    const text = formatDiagnosticLog(
        [{ timestamp: '2026-10-04T09:19:01.234Z', level: 'DEBUG', message: 'hello' }],
        {
            generatedAt: new Date('2026-10-04T09:22:13Z'),
            version: 'v20261004b',
            deploymentLabel: 'Preview',
            url: 'https://barbuz.github.io/the-stylus-staging/?pod=ABC',
            userAgent: 'Mozilla/5.0',
            debug: false
        }
    );

    assert.match(text, /^The Stylus — diagnostic log/);
    assert.match(text, /Generated: 2026-10-04T09:22:13\.000Z/);
    assert.match(text, /Version: v20261004b \(Preview\)/);
    assert.match(text, /Debug: off/);
    assert.match(text, /may contain match data/);
    assert.match(text, /\[2026-10-04T09:19:01\.234Z\] DEBUG {2}hello/);
});

test('diagnosticLog: an empty buffer still produces a valid file', () => {
    const text = formatDiagnosticLog([], { version: 'v1' });
    assert.match(text, /\(no log entries\)/);
});

test('diagnosticLog: filename is stamped from the local date', () => {
    const name = logFilename(new Date(2026, 9, 4, 9, 5, 7));
    assert.equal(name, 'the-stylus-log-20261004-090507.txt');
});
