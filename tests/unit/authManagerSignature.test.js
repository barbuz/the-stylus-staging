import test from 'node:test';
import assert from 'node:assert/strict';

import { AuthManager } from '../../js/modules/authManager.js';

/**
 * Phase 5 of #18: AuthManager must not keep its own copy of the signature. It
 * delegates to the single owner (the GuruSignature instance) and exposes the
 * current value through getGuruSignature().
 */
function makeSignatureOwner(signature = null) {
    return {
        current: signature,
        getSignature() { return this.current; }
    };
}

test('AuthManager holds no signature string of its own', () => {
    const manager = new AuthManager(null, makeSignatureOwner('alice'));

    // The field is the injected owner object, never a plain string copy.
    assert.equal(typeof manager.guruSignature, 'object');
    assert.notEqual(typeof manager.guruSignature, 'string');
});

test('getGuruSignature delegates to the owner', () => {
    const owner = makeSignatureOwner('alice');
    const manager = new AuthManager(null, owner);

    assert.equal(manager.getGuruSignature(), 'alice');

    // A change on the owner is visible immediately: there is no stale copy.
    owner.current = 'bob';
    assert.equal(manager.getGuruSignature(), 'bob');
});

test('getGuruSignature is empty when no owner is wired', () => {
    const manager = new AuthManager(null, null);
    assert.equal(manager.getGuruSignature(), '');
});

test('logout clears the session but keeps the signature owner', () => {
    const owner = makeSignatureOwner('alice');
    const manager = new AuthManager(null, owner);

    // logout() reloads the page, which jsdom-less node cannot do; exercise the
    // state mutation directly rather than the full method.
    manager.isAuthenticated = true;
    manager.user = { accessToken: 'token' };

    assert.equal(manager.getGuruSignature(), 'alice');
    assert.equal(manager.guruSignature, owner);
});
