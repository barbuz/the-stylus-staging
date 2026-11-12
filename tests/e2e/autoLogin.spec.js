import { test, expect } from '@playwright/test';

import { installStubs, sampleSpreadsheet } from './stubs.js';

/**
 * A remembered guru should come back signed in without touching the sign-in
 * button. This is the path an installed (standalone) app depends on: the
 * interactive sign-in opens a popup, which a standalone window cannot complete,
 * so auto-login must never require that popup.
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

async function seedRememberedGuru(page, { remember = 'true' } = {}) {
    await isolateNetwork(page);
    await installStubs(page, {
        spreadsheet: sampleSpreadsheet(),
        preferences: { guruSignature: 'alice', recentPods: [], recentHubs: [] }
    });
    await page.goto('/index.html');
    await page.evaluate((remembered) => {
        localStorage.setItem('remember_user', remembered);
        localStorage.setItem('user_id', 'alice@example.com');
        localStorage.removeItem('access_token');
        localStorage.removeItem('token_expiry');
    }, remember);
}

test.describe('Auto-login at load', () => {
    test('a remembered guru is signed in silently, without pressing the button', async ({ page }) => {
        await seedRememberedGuru(page);

        await page.reload();

        // The pod input is the signed-in home screen; the login screen is gone.
        await expect(page.locator('#sheet-url')).toBeVisible();
        await expect(page.locator('#login-section')).toBeHidden();

        // The sign-in happened with no click: the silent request is the auto-login.
        const requests = await page.evaluate(() => window.__stylus.getTokenRequests());
        expect(requests).toBeGreaterThan(0);
    });

    test('a guru who did not ask to be remembered still sees the login screen', async ({ page }) => {
        await seedRememberedGuru(page, { remember: 'false' });

        await page.reload();

        await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible();
        const requests = await page.evaluate(() => window.__stylus.getTokenRequests());
        expect(requests).toBe(0);
    });
});
