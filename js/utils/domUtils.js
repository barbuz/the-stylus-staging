/**
 * DOM utility functions for safer element access
 */
import { logger } from './log.js';

/**
 * Safely get DOM element with error handling
 * @param {string} id - Element ID
 * @param {boolean} required - Whether element is required (throws if not found)
 * @returns {HTMLElement|null} Element or null
 */
export function getElement(id, required = false) {
    const element = document.getElementById(id);
    if (!element && required) {
        throw new Error(`Required DOM element not found: ${id}`);
    }
    if (!element) {
        // Optional lookups miss during normal operation (a modal not yet built,
        // an error banner that only appears on failure); keep it at debug level.
        logger.debug(`DOM element not found: ${id}`);
    }
    return element;
}

/**
 * Wait for DOM element to be available
 * @param {string} id - Element ID
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<HTMLElement>} Promise that resolves when element is found
 */
export function waitForElement(id, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const element = document.getElementById(id);
        if (element) {
            resolve(element);
            return;
        }

        const observer = new MutationObserver(() => {
            const element = document.getElementById(id);
            if (element) {
                observer.disconnect();
                resolve(element);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Element ${id} not found within ${timeout}ms`));
        }, timeout);
    });
}

/**
 * Safely add event listener with error handling
 * @param {string} elementId - Element ID
 * @param {string} event - Event type
 * @param {Function} handler - Event handler
 * @param {boolean} required - Whether element is required
 */
export function addEventListenerSafe(elementId, event, handler, required = false) {
    const element = getElement(elementId, required);
    if (element) {
        element.addEventListener(event, handler);
    }
}

/**
 * Escape a value for safe interpolation into HTML markup.
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}
