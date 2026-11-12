import { test, expect } from '@playwright/test';

import { installStubs, sampleSpreadsheet } from './stubs.js';

/**
 * The sign-in screen must never stay stuck on "Signing in...".
 *
 * Google sign-in can fail without ever calling the token client's `callback`:
 * the popup may be blocked or closed, or — in an installed / standalone app —
 * it may open and then never hand the token back. Each case must release the
 * button and tell the guru what happened.
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

test.describe('Sign-in failures do not strand the guru', () => {
    test('an installed app is warned before sign-in that it will not complete', async ({ page }) => {
        // Report the installed/standalone display mode the way an installed PWA
        // does, so the login screen can show the hint.
        await page.addInitScript(() => {
            const real = window.matchMedia.bind(window);
            window.matchMedia = (query) => (query.includes('display-mode: standalone')
                ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} }
                : real(query));
        });
        await bootLogin(page);

        await expect(page.locator('#installed-app-hint')).toBeVisible();
        await expect(page.locator('#installed-app-hint')).toHaveText(/installed app/i);
    });

    test('a normal browser tab does not show the installed-app hint', async ({ page }) => {
        await bootLogin(page);

        await expect(page.locator('#installed-app-hint')).toBeHidden();
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
