import { test, expect } from '@playwright/test';

import { installStubs, sampleSpreadsheet } from './stubs.js';

const POD_ID = 'POD_SHEET_ID';
const POD_URL = `https://docs.google.com/spreadsheets/d/${POD_ID}/edit`;

/**
 * Keep the app fully offline, as the other specs do.
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

async function setVisibility(page, state) {
    await page.evaluate((s) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
        document.dispatchEvent(new Event('visibilitychange'));
    }, state);
}

async function bootAndOpenPod(page) {
    await isolateNetwork(page);
    await installStubs(page, {
        spreadsheet: sampleSpreadsheet(),
        preferences: { guruSignature: 'alice', recentPods: [], recentHubs: [] }
    });
    await page.goto('/index.html');

    await page.getByRole('button', { name: /sign in with google/i }).click();
    await expect(page.locator('#sheet-url')).toBeVisible();
    await page.locator('#sheet-url').fill(POD_URL);
    await page.locator('#load-sheet-btn').click();
    await expect(page.locator('#sheet-editor')).toBeVisible();
    await expect(page.locator('#current-row-info')).toHaveText('Match 1 of 4');
}

test.describe('Token refresh keeps the session', () => {
    test('a mid-session expiry keeps the open pod; the next gesture refreshes in place', async ({ page }) => {
        // Freeze the clock so the ~58-minute re-auth timer can be reached
        // without a real wait.
        await page.clock.install();
        await bootAndOpenPod(page);

        // The user opted to be remembered, so an expiry should refresh silently.
        await page.evaluate(() => {
            localStorage.setItem('remember_user', 'true');
            localStorage.setItem('user_id', 'alice@example.com');
        });

        const before = await page.evaluate(() => window.__stylus.getTokenRequests());

        // Cross the expiry threshold: the app arms a refresh for the next tap.
        await page.clock.fastForward('59:00');
        await page.waitForTimeout(200);

        // The guru taps the screen (e.g. moving to the next match). That gesture
        // is what drives the refresh.
        await page.mouse.click(5, 5);
        await page.waitForTimeout(200);

        const after = await page.evaluate(() => window.__stylus.getTokenRequests());
        expect(after).toBe(before + 1);

        // The whole point: the pod is still open, on the same match, not back on
        // the home screen.
        await expect(page.locator('#sheet-editor')).toBeVisible();
        await expect(page.locator('#current-row-info')).toHaveText('Match 1 of 4');
        await expect(page.locator('#sheet-input-section')).toBeHidden();
    });

    test('a guru who returns after a long background refreshes on the first tap', async ({ page }) => {
        await page.clock.install();
        await bootAndOpenPod(page);
        await page.evaluate(() => {
            localStorage.setItem('remember_user', 'true');
            localStorage.setItem('user_id', 'alice@example.com');
        });

        const before = await page.evaluate(() => window.__stylus.getTokenRequests());

        // Switch apps for two hours: well past the token's expiry and long past
        // any timer the page might hold.
        await setVisibility(page, 'hidden');
        await page.clock.fastForward('02:00:00');
        await page.waitForTimeout(200);

        // No refresh happened in the background.
        expect(await page.evaluate(() => window.__stylus.getTokenRequests())).toBe(before);

        // Return and tap. The refresh was still armed, so it runs now.
        await setVisibility(page, 'visible');
        await page.mouse.click(5, 5);
        await page.waitForTimeout(300);

        expect(await page.evaluate(() => window.__stylus.getTokenRequests())).toBe(before + 1);
        await expect(page.locator('#sheet-editor')).toBeVisible();
        await expect(page.locator('#current-row-info')).toHaveText('Match 1 of 4');
    });

    test('the tap that scores a match also refreshes, and the write waits for it', async ({ page }) => {
        await page.clock.install();
        await bootAndOpenPod(page);
        await page.evaluate(() => {
            localStorage.setItem('remember_user', 'true');
            localStorage.setItem('user_id', 'alice@example.com');
        });

        // Cross the expiry threshold so the next tap must refresh first.
        await page.clock.fastForward('59:00');
        await page.waitForTimeout(200);

        const before = await page.evaluate(() => window.__stylus.getTokenRequests());

        // Hold the token response open: if the write raced the refresh it would
        // land on the stale token while this is still pending.
        await page.evaluate(() => window.__stylus.deferTokenResponse());

        // The guru scores the match. That one tap is both the gesture that
        // drives the refresh and the action that needs a valid token.
        await page.locator('#win-btn').click();
        await page.waitForTimeout(200);

        // The refresh was requested, and the write is still waiting on it: the
        // score has not been written yet.
        expect(await page.evaluate(() => window.__stylus.getTokenRequests())).toBe(before + 1);
        expect(await page.evaluate(() => window.__stylus.getCell('Red Gurus', 2, 5))).toBeNull();

        // The guru is told why their score has not landed yet, rather than
        // staring at a frozen button.
        await expect(page.locator('#status-message')).toHaveText('Renewing your sign-in...');

        // Let the token arrive; the queued write completes against it.
        await page.evaluate(() => window.__stylus.resolveToken());
        await expect.poll(() => page.evaluate(() => window.__stylus.getCell('Red Gurus', 2, 5))).toBe('1');

        // And the pod is still open on the same match.
        await expect(page.locator('#sheet-editor')).toBeVisible();
        await expect(page.locator('#sheet-input-section')).toBeHidden();
    });

    test('the expiry timer alone never opens a token request', async ({ page }) => {
        await page.clock.install();
        await bootAndOpenPod(page);
        await page.evaluate(() => {
            localStorage.setItem('remember_user', 'true');
            localStorage.setItem('user_id', 'alice@example.com');
        });

        const before = await page.evaluate(() => window.__stylus.getTokenRequests());

        // Cross the expiry threshold with no interaction at all.
        await page.clock.fastForward('59:00');
        await page.waitForTimeout(300);

        const after = await page.evaluate(() => window.__stylus.getTokenRequests());
        expect(after).toBe(before);

        // And the session is untouched.
        await expect(page.locator('#sheet-editor')).toBeVisible();
        await expect(page.locator('#current-row-info')).toHaveText('Match 1 of 4');
    });
});
