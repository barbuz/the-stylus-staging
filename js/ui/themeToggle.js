/**
 * Day/night toggle.
 *
 * The theme itself is resolved before first paint by the inline script in
 * index.html; this class keeps the DOM attribute, the browser chrome colour and
 * the persisted choice in step afterwards. A single delegated click handler
 * serves every toggle, including ones a screen creates later (deck notes), and
 * `mountThemeToggles` fills their slots.
 */
import { CONFIG } from '../config.js';
import { THEMES, THEME_COLOR, nextTheme, resolveTheme } from '../domain/theme.js';
import { getItem, setItem } from '../services/storage.js';
import { logger } from '../utils/log.js';

const SUN_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></svg>';
const MOON_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

/** The theme currently painted on the page. */
export function currentTheme() {
    return document.documentElement.dataset.theme === THEMES.DARK ? THEMES.DARK : THEMES.LIGHT;
}

export function themeToggleMarkup() {
    const theme = currentTheme();
    return `
        <button type="button" class="theme-toggle" data-theme-toggle role="switch"
            aria-checked="${theme === THEMES.DARK}" aria-label="Night mode"
            title="Switch between day and night mode">
            <span class="theme-toggle-thumb" aria-hidden="true"></span>
            <span class="theme-toggle-option" data-theme-option="day" aria-hidden="true">
                ${SUN_ICON}<span class="theme-toggle-label">Day</span>
            </span>
            <span class="theme-toggle-option" data-theme-option="night" aria-hidden="true">
                ${MOON_ICON}<span class="theme-toggle-label">Night</span>
            </span>
        </button>`;
}

/** Fill every empty `[data-theme-toggle-slot]` under `root`. */
export function mountThemeToggles(root = document) {
    root.querySelectorAll('[data-theme-toggle-slot]').forEach((slot) => {
        if (!slot.querySelector('[data-theme-toggle]')) {
            slot.innerHTML = themeToggleMarkup();
        }
    });
}

export class ThemeToggle {
    constructor() {
        this._clickBound = false;
        this._media = null;
    }

    init() {
        this._media = typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-color-scheme: dark)')
            : null;

        const stored = getItem(CONFIG.STORAGE_KEYS.THEME);
        this.apply(resolveTheme(stored, Boolean(this._media?.matches)));
        mountThemeToggles();
        this._bindClickOnce();
        this._watchSystem();

        logger.debug(`🎨 Theme: ${currentTheme()}${stored ? ' (saved)' : ' (system)'}`);
    }

    apply(theme) {
        document.documentElement.dataset.theme = theme;
        document.querySelector('meta[name="theme-color"]')
            ?.setAttribute('content', THEME_COLOR[theme]);
        this.sync();
    }

    set(theme) {
        this.apply(theme);
        setItem(CONFIG.STORAGE_KEYS.THEME, theme);
    }

    toggle() {
        this.set(nextTheme(currentTheme()));
        logger.debug(`🎨 Theme toggled to ${currentTheme()}`);
    }

    sync() {
        const isDark = currentTheme() === THEMES.DARK;
        document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
            button.setAttribute('aria-checked', String(isDark));
        });
    }

    _bindClickOnce() {
        if (this._clickBound) {
            return;
        }
        this._clickBound = true;
        document.addEventListener('click', (event) => {
            if (event.target.closest('[data-theme-toggle]')) {
                this.toggle();
            }
        });
    }

    _watchSystem() {
        if (!this._media || typeof this._media.addEventListener !== 'function') {
            return;
        }
        this._media.addEventListener('change', (event) => {
            // An explicit choice outranks the operating system.
            if (getItem(CONFIG.STORAGE_KEYS.THEME)) {
                return;
            }
            this.apply(event.matches ? THEMES.DARK : THEMES.LIGHT);
        });
    }
}
