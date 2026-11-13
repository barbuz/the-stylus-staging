import { test, expect } from '@playwright/test';

import { installStubs, sampleSpreadsheet } from './stubs.js';

/**
 * The sign-in screen must never stay stuck on "Signing in...".
 *
 * Google sign-in can fail without ever calling the token client's `callback`:
 * the popup may be blocked or closed, or it may open and then never hand the
 * token back. Each case must release the button and tell the guru what happened.
 */
async function isolateNetwork(page) {
    await page.route('**/apis.google.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/accounts.google.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/openidconnect.googleapis.com/**', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ email: 'alice@example.com' })
    }));
    await page.route('**/api.scryfall.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
}

async function bootLogin(page) {
    await isolateNetwork(page);
    await installStubs(page, {
        spreadsheet: sampleSpreadsheet(),
        preferences: { guruSignature: 'alice', recentPods: [], recentHubs: [] }
    });
    await page.goto('/index.html');
    await expect(page.locator('#login-section')).toBeVisible();
}

/** Report the installed/standalone display mode the way an installed PWA does. */
async function reportStandalone(page) {
    await page.addInitScript(() => {
        const real = window.matchMedia.bind(window);
        window.matchMedia = (query) => (query.includes('display-mode: standalone')
            ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} }
            : real(query));
    });
}

test.describe('Sign-in failures do not strand the guru', () => {
    test('a remembered guru signs in from an installed app without the popup', async ({ page }) => {
        await reportStandalone(page);
        await bootLogin(page);

        // The guru is remembered, so reopening the app auto-signs them in.
        await page.evaluate(() => {
            localStorage.setItem('remember_user', 'true');
            localStorage.setItem('user_id', 'alice@example.com');
        });
        await page.reload();

        await expect(page.locator('#sheet-url')).toBeVisible();
        await expect(page.locator('#login-section')).toBeHidden();
    });

    test('a blocked popup releases the button and explains why', async ({ page }) => {
        await bootLogin(page);
        await page.evaluate(() => window.__stylus.failNextToken('popup_failed_to_open'));

        await page.locator('#login-btn').click();

        // The button returns to its idle state rather than spinning forever.
        await expect(page.locator('#login-btn')).toBeEnabled();
        await expect(page.locator('#login-btn')).toHaveText(/sign in with google/i);
        await expect(page.locator('#status-message')).toHaveText(/blocked the Google sign-in popup/i);
    });

    test('a popup that never reports back releases the button via the backstop', async ({ page }) => {
        // Reach the 60s backstop without a real wait.
        await page.clock.install();
        await bootLogin(page);
        await page.evaluate(() => window.__stylus.silenceToken());

        await page.locator('#login-btn').click();
        await expect(page.locator('#login-btn')).toBeDisabled();

        // The popup opens but never calls back — the installed-app hang.
        await page.clock.fastForward('01:01');
        await page.waitForTimeout(200);

        await expect(page.locator('#login-btn')).toBeEnabled();
        await expect(page.locator('#status-message')).toHaveText(/sign-in did not complete/i);
    });
});
