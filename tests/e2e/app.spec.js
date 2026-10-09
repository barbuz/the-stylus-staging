import { test, expect } from '@playwright/test';
import fs from 'node:fs';

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
async function signIn(page, { waitForPodInput = true } = {}) {
    await page.getByRole('button', { name: /sign in with google/i }).click();
    await expect(page.locator('#app-content')).toBeVisible();
    if (waitForPodInput) {
        await expect(page.locator('#sheet-url')).toBeVisible();
    }
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

        // The batchUpdate must name the spreadsheet file, not the tab, or the
        // real API rejects the write. The stub ignores the id, so assert here.
        const [batch] = await page.evaluate(() => window.__stylus.getBatchUpdates());
        expect(batch.spreadsheetId).toBe(POD_ID);
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

    test('the Match N of M button opens the jump-to-match table', async ({ page }) => {
        await bootApp(page);
        await signIn(page);
        await loadPod(page);

        await page.locator('#current-row-info').click();

        const modal = page.locator('.match-table-modal');
        await expect(modal).toBeVisible();
        // All four match rows are listed; P1 group headers add no data-row.
        await expect(modal.locator('tr[data-row]')).toHaveCount(4);
        await expect(modal.locator('tr.current-row')).toHaveAttribute('data-row', '0');

        // Clicking match 4 jumps the analysis screen to it.
        await modal.locator('tr[data-row="3"]').click();
        await expect(page.locator('.match-table-modal')).toHaveCount(0);
        await expect(page.locator('#current-row-info')).toHaveText('Match 4 of 4');
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

    test('exiting analysis clears the deep-link parameters and reloading stays on the input', async ({ page }) => {
        await bootApp(page);
        await signIn(page);
        await loadPod(page);

        // Scoring a row writes pod / guru / match into the URL.
        await expect
            .poll(() => new URL(page.url()).searchParams.get('pod'))
            .toBeTruthy();

        await page.locator('#exit-analysis-btn').click();

        const params = new URL(page.url()).searchParams;
        expect(params.get('pod')).toBeNull();
        expect(params.get('guru')).toBeNull();
        expect(params.get('match')).toBeNull();

        // On reload the stored session is restored; with no deep-link params the
        // app must land on the pod input rather than reopening analysis mode.
        await page.reload();

        await expect(page.locator('#sheet-input-section')).toBeVisible();
        await expect(page.locator('#sheet-editor')).toBeHidden();
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

// --- Signature ownership (phase 5 of #18) ------------------------------------
//
// The signature is a single immutable session value. There is no live getter
// into an open pod, so a change is an explicit restart: it must persist once,
// update the header, and be the value the *next* pod load resolves against.

test.describe('Signature ownership', () => {
    test('an unset signature shows the identification section instead of the pod input', async ({ page }) => {
        await bootApp(page, { preferences: { guruSignature: '', recentPods: [], recentHubs: [] } });
        await signIn(page, { waitForPodInput: false });

        // With no signature, the app asks for one and hides the pod input.
        await expect(page.locator('#guru-signature-section')).toBeVisible();
        await expect(page.locator('#sheet-input-section')).toBeHidden();

        // Setting one reveals the pod input and hides the section again.
        await page.locator('#guru-signature').fill('alice');
        await page.locator('#set-signature-btn').click();

        await expect(page.locator('#sheet-input-section')).toBeVisible();
        await expect(page.locator('#guru-signature-section')).toBeHidden();
    });

    test('the change affordance is hidden while a pod is open', async ({ page }) => {
        await bootApp(page);
        await signIn(page);
        await loadPod(page);

        // The signature is session identity, not live per-row state: the change
        // affordance lives in the header, which the scoring screen hides. A guru
        // must therefore leave the pod before changing it.
        await expect(page.locator('#guru-signature-display')).toBeHidden();
    });

    test('changing the signature persists once and the next load uses it', async ({ page }) => {
        await bootApp(page);
        await signIn(page);
        await expect(page.locator('#guru-signature-display')).toHaveText('alice');

        // Change it through the header affordance, before any pod is open.
        await page.locator('#guru-signature-display').click();
        await expect(page.locator('#guru-signature-section')).toBeVisible();
        await page.locator('#guru-signature').fill('bob');
        await page.locator('#set-signature-btn').click();

        // Persisted through the single owner; the header and section reflect it.
        await expect.poll(() => page.evaluate(() =>
            window.__stylus.getPreferences().guruSignature
        )).toBe('bob');
        await expect(page.locator('#guru-signature-display')).toHaveText('bob');
        await expect(page.locator('#guru-signature-section')).toBeHidden();

        // The next load resolves against the new signature: bob's first match is
        // his own and unscored.
        await loadPod(page);
        await expect(page.locator('#current-row-info')).toHaveText('Match 1 of 4');
    });
});

test.describe('Recent-pod id naming', () => {
    // A record saved before the rename carries `sheetId`. The app must still
    // list and open it, then persist it back under `spreadsheetId`.
    const legacyPods = [{
        sheetId: POD_ID,
        title: 'Legacy Pod',
        url: POD_URL,
        lastAccessed: Date.now(),
        dateAdded: Date.now()
    }];

    test('lists a pod saved under the legacy sheetId key', async ({ page }) => {
        await bootApp(page, {
            preferences: { guruSignature: 'alice', recentPods: legacyPods, recentHubs: [] }
        });
        await signIn(page);

        await expect(page.locator('#recent-pods-section')).toBeVisible();
        await expect(page.locator('#recent-pods-list .recent-pod-name')).toHaveText('Legacy Pod');
    });

    test('opening a legacy pod rewrites it under spreadsheetId', async ({ page }) => {
        await bootApp(page, {
            preferences: { guruSignature: 'alice', recentPods: legacyPods, recentHubs: [] }
        });
        await signIn(page);

        await page.locator('#recent-pods-list .recent-pod-info').first().click();
        await expect(page.locator('#sheet-editor')).toBeVisible();

        await expect.poll(() => page.evaluate(() =>
            window.__stylus.getPreferences().recentPods[0].spreadsheetId
        )).toBe(POD_ID);

        const saved = await page.evaluate(() => window.__stylus.getPreferences().recentPods[0]);
        expect(saved.sheetId).toBeUndefined();
    });
});

test.describe('Diagnostic log download', () => {
    test('the footer Log button works before sign-in', async ({ page }) => {
        await bootApp(page);

        // The footer is visible on the login screen, and the handler is bound on
        // load, so this must work even when authentication never completes.
        await expect(page.locator('#login-section')).toBeVisible();
        const downloadPromise = page.waitForEvent('download');
        await page.locator('.app-footer [data-log-download]').click();
        const download = await downloadPromise;

        const path = await download.path();
        const text = fs.readFileSync(path, 'utf8');
        expect(text).toContain('The Stylus — diagnostic log');
    });

    test('the footer Log button downloads a file containing a log line', async ({ page }) => {
        await bootApp(page);
        await signIn(page);

        const downloadPromise = page.waitForEvent('download');
        await page.locator('.app-footer [data-log-download]').click();
        const download = await downloadPromise;

        expect(download.suggestedFilename()).toMatch(/^the-stylus-log-\d{8}-\d{6}\.txt$/);

        const path = await download.path();
        const text = fs.readFileSync(path, 'utf8');
        expect(text).toContain('The Stylus — diagnostic log');
        expect(text).toContain('Version: v');
        expect(text).toMatch(/\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] (DEBUG|WARN|ERROR)/);
    });

    test('the analysis screen exposes a Log button inside the pod', async ({ page }) => {
        await bootApp(page);
        await signIn(page);
        await loadPod(page);

        const downloadPromise = page.waitForEvent('download');
        await page.locator('.editor-controls [data-log-download]').click();
        const download = await downloadPromise;

        const path = await download.path();
        const text = fs.readFileSync(path, 'utf8');
        expect(text).toContain('The Stylus — diagnostic log');
    });

    test('an uncaught error is captured in the downloaded log', async ({ page }) => {
        await bootApp(page);
        await signIn(page);

        // Throw from a timer so it is genuinely uncaught and reaches the
        // window error listener wired up on load. Register the pageerror wait
        // first, then trigger, so it cannot resolve before we are listening.
        const errorSeen = page.waitForEvent('pageerror');
        await page.evaluate(() => {
            setTimeout(() => { throw new Error('diagnostic-e2e-boom'); }, 0);
        });
        await errorSeen;

        const downloadPromise = page.waitForEvent('download');
        await page.locator('.app-footer [data-log-download]').click();
        const download = await downloadPromise;

        const path = await download.path();
        const text = fs.readFileSync(path, 'utf8');
        expect(text).toContain('Uncaught error:');
        expect(text).toContain('diagnostic-e2e-boom');
    });
});
