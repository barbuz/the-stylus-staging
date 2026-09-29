import test from 'node:test';
import assert from 'node:assert/strict';

import { EventBus, APP_EVENTS } from '../../js/app/events.js';

test('emit delivers the payload to a subscriber', () => {
    const bus = new EventBus();
    const seen = [];
    bus.on('ping', (payload) => seen.push(payload));

    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });

    assert.deepEqual(seen, [{ n: 1 }, { n: 2 }]);
});

test('unsubscribing stops delivery', () => {
    const bus = new EventBus();
    let count = 0;
    const off = bus.on('ping', () => count++);

    bus.emit('ping');
    off();
    bus.emit('ping');

    assert.equal(count, 1);
});

test('off removes a specific handler', () => {
    const bus = new EventBus();
    let a = 0;
    let b = 0;
    const handlerA = () => a++;
    const handlerB = () => b++;

    bus.on('ping', handlerA);
    bus.on('ping', handlerB);
    bus.off('ping', handlerA);
    bus.emit('ping');

    assert.equal(a, 0);
    assert.equal(b, 1);
});

test('emit with no subscribers is a no-op', () => {
    const bus = new EventBus();
    assert.doesNotThrow(() => bus.emit('nobody-listening'));
});

test('a throwing listener does not stop the others', () => {
    const bus = new EventBus();
    const seen = [];
    bus.on('ping', () => { throw new Error('boom'); });
    bus.on('ping', () => seen.push('after'));

    // Swallow the expected console.error from the bus.
    const originalError = console.error;
    console.error = () => {};
    try {
        assert.doesNotThrow(() => bus.emit('ping'));
    } finally {
        console.error = originalError;
    }

    assert.deepEqual(seen, ['after']);
});

test('clear removes one event or everything', () => {
    const bus = new EventBus();
    let a = 0;
    let b = 0;
    bus.on('a', () => a++);
    bus.on('b', () => b++);

    bus.clear('a');
    bus.emit('a');
    bus.emit('b');
    assert.equal(a, 0);
    assert.equal(b, 1);

    bus.clear();
    bus.emit('b');
    assert.equal(b, 1);
});

test('on rejects a non-function handler', () => {
    const bus = new EventBus();
    assert.throws(() => bus.on('ping', 'not a function'), TypeError);
});

test('APP_EVENTS carries the login and signature flow names', () => {
    assert.equal(APP_EVENTS.USER_LOGGED_IN, 'userLoggedIn');
    assert.equal(APP_EVENTS.USER_LOGGED_OUT, 'userLoggedOut');
    assert.equal(APP_EVENTS.GURU_SIGNATURE_LOADED, 'guruSignatureLoaded');
    assert.equal(APP_EVENTS.REQUEST_GURU_SIGNATURE_CHANGE, 'requestGuruSignatureChange');
});
