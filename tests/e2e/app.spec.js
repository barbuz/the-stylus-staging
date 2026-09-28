import { test, expect } from '@playwright/test';

import { installStubs, sampleSpreadsheet } from './stubs.js';

const POD_ID = 'POD_SHEET_ID';
const POD_URL = `https://docs.google.com/spreadsheets/d/${POD_ID}/edit`;

/**
 * Keep the app fully offline: the Google CDN scripts are neutralised so they
 * cannot overwrite the stub, and the UserInfo endpoint is answered locally.
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

async function bootApp(page, { signature = 'alice', preferences } = {}) {
    await isolateNetwork(page);
    const prefs = preferences || { guruSignature: signature, recentPods: [], recentHubs: [] };
    await installStubs(page, { spreadsheet: sampleSpreadsheet(), preferences: prefs });
    await page.goto('/index.html');
}

/** Sign in and wait for the pod URL input to be available. */
async function signIn(page) {
    await page.getByRole('button', { name: /sign in with google/i }).click();
    await expect(page.locator('#app-content')).toBeVisible();
    await expect(page.locator('#sheet-url')).toBeVisible();
}

async function loadPod(page, url = POD_URL) {
    await page.locator('#sheet-url').fill(url);
    await page.locator('#load-sheet-btn').click();
    await expect(page.locator('#sheet-editor')).toBeVisible();
}

test.describe('The Stylus (no Google, no network)', () => {
    test('shows the login screen when not authenticated', async ({ page }) => {
        await bootApp(page);

        await expect(page.locator('#login-section')).toBeVisible();
        await expect(page.locator('#app-content')).toBeHidden();
    });

    test('signs in and restores the guru signature from appData', async ({ page }) => {
        await bootApp(page);

        await signIn(page);

        // The signature came from the stubbed Drive appData preferences, which
        // means the signature section is skipped in favour of the pod input.
        await expect(page.locator('#guru-signature-section')).toBeHidden();
        await expect(page.locator('#sheet-input-section')).toBeVisible();
        await expect(page.locator('#guru-signature-display')).toHaveText('alice');
    });

    test('loads a pod and renders the first match awaiting the guru', async ({ page }) => {
        await bootApp(page);
        await signIn(page);

        await loadPod(page);

        // Row 1 is alice's and unscored, so it is the first match to analyse.
        await expect(page.locator('#current-row-info')).toHaveText('Match 1 of 4');
        await expect(page.locator('#current-analysis-value')).toContainText('Incomplete');
    });

    test('scoring a match writes to the correct cell on the guru sheet', async ({ page }) => {
        await bootApp(page);
        await signIn(page);
        await loadPod(page);

        // The merged sheet's Red Analysis column must map back to column E of
        // the Red Gurus sheet, on the original (unfiltered) row.
        await page.locator('#win-btn').click();

        await expect(page.locator('#status-message')).toContainText('Analysis saved: Win');
        await expect.poll(() => page.evaluate(() => window.__stylus.getCell('Red Gurus', 2, 5))).toBe('1');
    });

    test('navigation moves between matches and reflects claim state', async ({ page }) => {
        await bootApp(page);
        await signIn(page);
        await loadPod(page);

        // Match 1 is claimed by alice and can be scored directly.
        await expect(page.locator('#win-btn')).toBeVisible();
        await expect(page.locator('#claim-button')).toBeHidden();

        await page.locator('#next-btn').click();
        await expect(page.locator('#current-row-info')).toHaveText('Match 2 of 4');

        // Match 3 is unclaimed: it must be claimed before scoring.
        await page.locator('#next-btn').click();
        await expect(page.locator('#current-row-info')).toHaveText('Match 3 of 4');
        await expect(page.locator('#claim-button')).toBeVisible();
        await expect(page.locator('#win-btn')).toBeHidden();
    });

    test('rejects an invalid pod URL without contacting Google', async ({ page }) => {
        await bootApp(page);
        await signIn(page);

        const requestsBefore = await page.evaluate(() => window.__stylus.getRequests().length);

        await page.locator('#sheet-url').fill('https://example.com/not-a-sheet');
        await page.locator('#load-sheet-btn').click();

        await expect(page.locator('#status-message')).toContainText('valid Google Sheets URL');
        await expect(page.locator('#sheet-editor')).toBeHidden();
        expect(await page.evaluate(() => window.__stylus.getRequests().length)).toBe(requestsBefore);
    });

    test('exiting analysis returns to the pod input', async ({ page }) => {
        await bootApp(page);
        await signIn(page);
        await loadPod(page);

        await page.locator('#exit-analysis-btn').click();

        await expect(page.locator('#sheet-editor')).toBeHidden();
        await expect(page.locator('#sheet-input-section')).toBeVisible();
    });

    test('the app boots without unexpected console errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });

        await bootApp(page);
        await signIn(page);
        await loadPod(page);

        expect(errors).toEqual([]);
    });

    // --- Colour dispatch -----------------------------------------------------
    //
    // The synthetic pod claims a different colour on each row, so signing in as
    // a non-Red guru proves the write path targets that colour's sheet and
    // column rather than defaulting to Red. Phase 2 rewrote every colour
    // branch, and Red-only coverage would not have caught a mis-mapped colour.

    test('a Blue guru scores Blue\'s own sheet, not Red\'s', async ({ page }) => {
        await bootApp(page, { signature: 'bob' });
        await signIn(page);
        await loadPod(page);

        // Row 1 is bob's and unscored, so it is first and already claimed.
        await expect(page.locator('#current-row-info')).toHaveText('Match 1 of 4');
        await expect(page.locator('#claim-button')).toBeHidden();

        await page.locator('#win-btn').click();
        await expect(page.locator('#status-message')).toContainText('Analysis saved: Win');

        await expect.poll(() => page.evaluate(() => window.__stylus.getCell('Blue Gurus', 2, 5))).toBe('1');
        // The Red sheet must be untouched: a colour mix-up would write here.
        expect(await page.evaluate(() => window.__stylus.getCell('Red Gurus', 2, 5))).toBeNull();
    });

    test('a Green guru scores Green\'s own sheet, not Red\'s', async ({ page }) => {
        await bootApp(page, { signature: 'carol' });
        await signIn(page);
        await loadPod(page);

        // carol opens on the first match awaiting her. Match 1 is already
        // scored, so she starts at Match 2; step past Match 3 to Match 4,
        // which green has claimed but not yet scored.
        await expect(page.locator('#current-row-info')).toHaveText('Match 2 of 4');
        await page.locator('#next-btn').click();
        await page.locator('#next-btn').click();
        await expect(page.locator('#current-row-info')).toHaveText('Match 4 of 4');
        await expect(page.locator('#claim-button')).toBeHidden();

        await page.locator('#win-btn').click();
        await expect(page.locator('#status-message')).toContainText('Analysis saved: Win');

        // Match 4 is guru-sheet row 5; analysis lives in column E.
        await expect.poll(() => page.evaluate(() => window.__stylus.getCell('Green Gurus', 5, 5))).toBe('1');
        // Red row 5 already holds its own fixture analysis; it must be untouched
        // rather than picking up carol's Win.
        expect(await page.evaluate(() => window.__stylus.getCell('Red Gurus', 5, 5))).toBe('0.5');
    });

    test('claiming routes a Blue guru to its own sheet\'s signature column', async ({ page }) => {
        await bootApp(page, { signature: 'bob' });
        await signIn(page);
        await loadPod(page);

        // Match 2 is unclaimed by bob; Match 1 was already his.
        await page.locator('#next-btn').click();
        await expect(page.locator('#current-row-info')).toHaveText('Match 2 of 4');
        await expect(page.locator('#claim-button')).toBeVisible();

        await page.locator('#claim-button').click();
        await expect(page.locator('#status-message')).toContainText('claimed');

        // Match 2 is guru-sheet row 3; the signature column is F.
        await expect.poll(() => page.evaluate(() => window.__stylus.getCell('Blue Gurus', 3, 6))).toBe('bob');
        // Red row 3 is claimed by alice, so its signature must not change to bob.
        expect(await page.evaluate(() => window.__stylus.getCell('Red Gurus', 3, 6))).toBe('alice');
    });

    test('claiming routes a Green guru to its own sheet\'s signature column', async ({ page }) => {
        await bootApp(page, { signature: 'carol' });
        await signIn(page);
        await loadPod(page);

        // carol opens on Match 2, which green has left unclaimed.
        await expect(page.locator('#current-row-info')).toHaveText('Match 2 of 4');
        await expect(page.locator('#claim-button')).toBeVisible();

        await page.locator('#claim-button').click();
        await expect(page.locator('#status-message')).toContainText('claimed');

        await expect.poll(() => page.evaluate(() => window.__stylus.getCell('Green Gurus', 3, 6))).toBe('carol');
        // Red row 3 is claimed by alice, so its signature must not change to carol.
        expect(await page.evaluate(() => window.__stylus.getCell('Red Gurus', 3, 6))).toBe('alice');
    });

    // --- Colour selection (signature not found) ------------------------------
    //
    // When a signature appears in no column the app must offer all three colours
    // with per-colour claim counts. Phase 2 generates that markup from
    // GURU_COLORS, so this pins the rendered structure and numbers.

    test('offers all three colours with per-colour counts when the signature is unknown', async ({ page }) => {
        await bootApp(page, { signature: 'nobody' });
        await signIn(page);
        await loadPod(page);

        const selection = page.locator('#color-selection-container');
        await expect(selection).toBeVisible();

        // One option per colour, in Red/Blue/Green order.
        await expect(selection.locator('.color-option h4')).toHaveText(['Red Guru', 'Blue Guru', 'Green Guru']);

        // The fixture has 4 matches; each colour has claimed a different count.
        await expect(selection.locator('#color-red .color-info p')).toHaveText('3 / 4 matches claimed');
        await expect(selection.locator('#color-blue .color-info p')).toHaveText('2 / 4 matches claimed');
        await expect(selection.locator('#color-green .color-info p')).toHaveText('2 / 4 matches claimed');

        // Selecting a colour resumes the normal flow as that guru.
        await selection.locator('#color-green .select-color-btn').click();
        await expect(selection).toBeHidden();
        await expect(page.locator('#current-analysis-value')).toBeVisible();
    });
});
