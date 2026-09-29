/**
 * Tiny application event bus.
 *
 * Replaces the `window` CustomEvents that used to carry the login / logout /
 * signature flow (phase 4 of #18). A plain object keeps the events local to the
 * app instead of leaking them onto the global window, and lets subscriptions be
 * set up once and torn down predictably.
 *
 * `emit` never lets one failing listener break the others.
 */
export class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    /**
     * Subscribe to an event. Returns an unsubscribe function.
     * @param {string} event
     * @param {Function} handler
     * @returns {Function} unsubscribe
     */
    on(event, handler) {
        if (typeof handler !== 'function') {
            throw new TypeError('EventBus.on requires a handler function');
        }
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(handler);
        return () => this.off(event, handler);
    }

    /** Remove a previously registered handler. */
    off(event, handler) {
        const handlers = this.listeners.get(event);
        if (!handlers) {
            return;
        }
        handlers.delete(handler);
        if (handlers.size === 0) {
            this.listeners.delete(event);
        }
    }

    /** Notify every subscriber of `event`. */
    emit(event, payload) {
        const handlers = this.listeners.get(event);
        if (!handlers) {
            return;
        }
        for (const handler of handlers) {
            try {
                handler(payload);
            } catch (error) {
                console.error(`Error in "${event}" listener:`, error);
            }
        }
    }

    /** Remove every subscription, or just those for one event. */
    clear(event = null) {
        if (event === null) {
            this.listeners.clear();
        } else {
            this.listeners.delete(event);
        }
    }
}

// Event names, kept together so a typo is a lookup miss rather than silence.
export const APP_EVENTS = {
    USER_LOGGED_IN: 'userLoggedIn',
    USER_LOGGED_OUT: 'userLoggedOut',
    GURU_SIGNATURE_LOADED: 'guruSignatureLoaded',
    GURU_SIGNATURE_CHANGED: 'guruSignatureChanged',
    REQUEST_GURU_SIGNATURE_CHANGE: 'requestGuruSignatureChange'
};
