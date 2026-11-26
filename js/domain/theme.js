/**
 * Day/night theme resolution.
 *
 * Pure: no DOM and no storage. A stored explicit choice wins; with no choice
 * the operating system's preference decides. Only `light` and `dark` exist.
 */

export const THEMES = {
    LIGHT: 'light',
    DARK: 'dark'
};

export const THEME_COLOR = {
    light: '#f5f7fa',
    dark: '#0a0e17'
};

export function isTheme(value) {
    return value === THEMES.LIGHT || value === THEMES.DARK;
}

export function resolveTheme(stored, prefersDark) {
    if (isTheme(stored)) {
        return stored;
    }
    return prefersDark ? THEMES.DARK : THEMES.LIGHT;
}

export function nextTheme(theme) {
    return theme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;
}
