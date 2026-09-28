/**
 * URL utility functions for Google Sheets
 */

/**
 * Validate if a URL is a valid Google Sheets URL
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid Google Sheets URL
 */
export function isValidGoogleSheetsUrl(url) {
    const pattern = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+/;
    return pattern.test(url);
}

/**
 * Extract spreadsheet ID from a Google Sheets URL or return as-is if already an ID
 * @param {string} urlOrId - Google Sheets URL or spreadsheet ID
 * @returns {string|null} Extracted sheet ID or null if invalid
 */
export function extractSheetId(urlOrId) {
    if (!urlOrId) {
        return null;
    }

    // If it's already just an ID (no slashes), return it
    if (!urlOrId.includes('/')) {
        return urlOrId;
    }

    // Extract from URL patterns:
    // https://docs.google.com/spreadsheets/d/SHEET_ID/edit...
    const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

/**
 * Sanitize a URL parameter value that may have been mangled by external apps.
 * Trims whitespace and removes trailing characters like ")," or extra commas/parentheses.
 * @param {string|null|undefined} value
 * @returns {string|null} sanitized value or null if input was falsy
 */
export function sanitizeUrlParam(value) {
    if (value === null || value === undefined) return null;
    let v = String(value).trim();
    // Remove any trailing commas and parentheses that may have been appended,
    // e.g. "SHEET_ID)," or "SHEET_ID),"
    v = v.replace(/[\),]+$/g, '');
    return v;
}

/**
 * Normalise a pathname to a single trailing slash so that "/the-stylus",
 * "/the-stylus/" and "/the-stylus/index.html" all compare equal against a
 * deployment root.
 * @param {string} pathname
 * @returns {string}
 */
function normalizePath(pathname) {
    if (!pathname) return '/';
    let p = String(pathname).split(/[?#]/)[0].replace(/index\.html$/, '');
    return p.endsWith('/') ? p : `${p}/`;
}

/**
 * Which configured deployment a pathname belongs to. Returns null when the
 * path is not under a known deployment (e.g. localhost during development).
 * @param {string} pathname - window.location.pathname
 * @param {Object} deployments - key -> { path, label, appName }
 * @returns {string|null} deployment key
 */
export function deploymentForPath(pathname, deployments) {
    const normalized = normalizePath(pathname);
    for (const [key, deployment] of Object.entries(deployments)) {
        if (normalized === normalizePath(deployment.path)) return key;
    }
    return null;
}

/**
 * The other deployment's URL for a pathname, preserving the query string.
 * Used by the deploy switch to move between production and preview without
 * losing the current pod/match context.
 * @param {string} pathname - window.location.pathname
 * @param {string} search - window.location.search (with or without leading "?")
 * @param {Object} deployments
 * @returns {string|null} URL path with query, or null if path is unrecognised
 */
export function alternateDeploymentUrl(pathname, search, deployments) {
    const current = deploymentForPath(pathname, deployments);
    if (!current) return null;
    const otherKey = Object.keys(deployments).find(key => key !== current);
    if (!otherKey) return null;
    return `${deployments[otherKey].path}${search || ''}`;
}

/**
 * Where a deep link should actually open, given this browser's preferred
 * deployment.
 *
 * Deliberately conservative: an absent or unknown preference means "leave me
 * on whichever deployment the link points at", so shared production links
 * never bounce an ordinary visitor. A known preference always wins, but a
 * preference must not rewrite a bare entry link (no pod/hub context).
 *
 * @param {string} pathname - window.location.pathname
 * @param {string} search - window.location.search (with or without leading "?")
 * @param {string|null} preferred - stored preference ('production'/'preview'), or null
 * @param {Object} deployments
 * @returns {string|null} redirect target (path + query), or null for no redirect
 */
export function resolveDeploymentRedirect(pathname, search, preferred, deployments) {
    const params = new URLSearchParams(search || '');
    // Only deep links auto-redirect; the home screen stays where it was opened.
    if (!params.has('pod') && !params.has('hub')) return null;

    const current = deploymentForPath(pathname, deployments);
    if (!current) return null;

    if (!preferred || !Object.prototype.hasOwnProperty.call(deployments, preferred)) {
        return null;
    }
    if (preferred === current) return null;
    return `${deployments[preferred].path}${search || ''}`;
}
