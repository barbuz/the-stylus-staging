/**
 * Thin wrapper around `localStorage`.
 *
 * Every key still comes from `CONFIG.STORAGE_KEYS`; this module only centralises
 * access so callers do not repeat the same read/parse/write boilerplate and a
 * browser with storage disabled (private mode, quota exceeded) degrades to a
 * no-op instead of throwing at the call site.
 */

function backingStore() {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

/** Read a raw string value, or null when absent/unavailable. */
export function getItem(key) {
    const store = backingStore();
    if (!store) {
        return null;
    }
    try {
        return store.getItem(key);
    } catch {
        return null;
    }
}

/** Write a string value. Non-strings are coerced, matching localStorage. */
export function setItem(key, value) {
    const store = backingStore();
    if (!store) {
        return;
    }
    try {
        store.setItem(key, String(value));
    } catch {
        // Storage full or blocked; nothing useful to do here.
    }
}

/** Remove a key. */
export function removeItem(key) {
    const store = backingStore();
    if (!store) {
        return;
    }
    try {
        store.removeItem(key);
    } catch {
        // Blocked storage; nothing to remove.
    }
}

/** Read and JSON-parse a value, returning `fallback` when absent or invalid. */
export function getJSON(key, fallback = null) {
    const raw = getItem(key);
    if (raw === null || raw === '') {
        return fallback;
    }
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

/** JSON-encode and write a value. */
export function setJSON(key, value) {
    setItem(key, JSON.stringify(value));
}
