import { test, expect } from '@playwright/test';

import { installStubs, realPodSpreadsheet } from './stubs.js';
import { REAL_MATCH_ROWS, REAL_POD_SHEET_IDS, clearAnalysisLikeRealSheet } from '../fixtures/realPod.js';

/**
 * End-to-end coverage against the real pod layout rather than the compact
 * synthetic one in app.spec.js.
 *
 * Two properties of the real export shape these tests:
 *
 *  - Guru sheets are 13 columns wide (A:M), not 6. The app reads A:C and E:F,
 *    so this proves genuine sheets work and makes any range drift visible.
 *  - The pod is *finished*: all 450 rows carry agreeing analyses from all three
 *    gurus. The synthetic fixture is mid-analysis, so the "everything is done"
 *    path was previously untested. Where a test needs a row to score, it
 *    deliberately blanks one cell, which reproduces the real mid-analysis state.
 */

const POD_ID = 'REAL_POD_ID';
const POD_URL = `https://docs.google.com/spreadsheets/d/${POD_ID}/edit`;

/** Signature on every Red row except ID 22, which "fixdoll" claimed. */
const PRIMARY_GURU = 'Oophies';

async function isolateNetwork(page) {
    await page.route('**/apis.google.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/accounts.google.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/openidconnect.googleapis.com/**', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ email: 'guru@example.com' })
    }));
    await page.route('**/api.scryfall.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
}

/**
 * Boot with the real pod.
 *
 * @param {object} options
 * @param {string} options.signature guru signature to sign in with
 * @param {boolean} options.blankFirstAnalysis when true, clears the Red
 *        analysis of the first match so the pod looks mid-analysis, as it would
 *        during a live event. The default (finished pod) mirrors the export.
 */
async function bootRealPod(page, { signature = PRIMARY_GURU, blankFirstAnalysis = false } = {}) {
    await isolateNetwork(page);
    const spreadsheet = realPodSpreadsheet();
    if (blankFirstAnalysis) {
        const red = spreadsheet.sheets.find(s => s.title === 'Red Gurus');
        // Match 1 is spreadsheet row 2 (row 1 is the header). Clearing just
        // column E would leave the formula-derived Outcome and Inverse Check
        // populated beside an empty analysis, a state the real sheet cannot
        // produce; the helper clears those dependents too.
        clearAnalysisLikeRealSheet(red, 2, 5);
    }
    await installStubs(page, {
        spreadsheet,
        preferences: { guruSignature: signature, recentPods: [], recentHubs: [] }
    });
    await page.goto('/index.html');
}

async function signInAndLoad(page) {
    await page.getByRole('button', { name: /sign in with google/i }).click();
    await expect(page.locator('#app-content')).toBeVisible();
    await page.locator('#sheet-url').fill(POD_URL);
    await page.locator('#load-sheet-btn').click();
    await expect(page.locator('#sheet-editor')).toBeVisible();
}

test.describe('The Stylus against a real exported pod', () => {
    test('loads a real 13-column pod without console errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });

        await bootRealPod(page);
        await signInAndLoad(page);

        expect(errors).toEqual([]);
        await expect(page.locator('#current-row-info')).toHaveText(`Match 1 of ${REAL_MATCH_ROWS.length}`);
    });

    test('renders the real deck names as their three cards', async ({ page }) => {
        await bootRealPod(page);
        await signInAndLoad(page);

        // Decklists are stored pipe-separated and rendered as separate lines;
        // the pipes themselves are not shown. All three cards must survive.
        const editor = page.locator('#sheet-editor');
        await expect(editor).toContainText('Abraded Bluffs');
        await expect(editor).toContainText('Erode');
        await expect(editor).toContainText('Wayward Guide-Beast');
    });

    test('surfaces the real goldfish clock and note from Deck Notes', async ({ page }) => {
        await bootRealPod(page);
        await signInAndLoad(page);

        // Match 1's first deck has clock 8.0 and a note in the real sheet; both
        // reach the UI, proving the A:E range and header lookup still line up.
        const editor = page.locator('#sheet-editor');
        await expect(editor).toContainText('Clock: 8.0');
        await expect(editor).toContainText('Can Erode T2 and win T9 if not disrupted');
    });

    test('parses the headerless real metadata sheet', async ({ page }) => {
        await bootRealPod(page);
        await signInAndLoad(page);

        // "Pod Name" is row 1 data with no header above it, unlike the fixture.
        const metadataReads = await page.evaluate(() =>
            window.__stylus.getRequests().filter(r => r.params.range === "'metadata'!A:C").length
        );
        expect(metadataReads).toBe(1);
    });

    test('a finished real pod reports every guru reading instead of prompting', async ({ page }) => {
        await bootRealPod(page);
        await signInAndLoad(page);

        // Every real row has three agreeing analyses, so there is nothing to do.
        // The current guru's own reading is labelled "You"; the other two show
        // the partner signatures from columns G:I.
        const analysis = page.locator('#current-analysis-value');
        await expect(analysis).toContainText('Win');
        await expect(analysis).toContainText('You:');
        await expect(analysis).toContainText('FortyTwo');
        await expect(analysis).toContainText('Imnota');
    });

    test('does not write anything when a pod is already complete', async ({ page }) => {
        await bootRealPod(page);
        await signInAndLoad(page);

        await expect(page.locator('#status-message')).toContainText('All rows analysed');
        expect(await page.evaluate(() => window.__stylus.getBatchUpdates().length)).toBe(0);
    });

    test('scoring a blanked row writes to column E of the Red sheet', async ({ page }) => {
        await bootRealPod(page, { blankFirstAnalysis: true });
        await signInAndLoad(page);

        // With E2 cleared the first match needs analysis again, like a live pod.
        // Assert on the persisted cell, not the status text: scoring the last
        // remaining row immediately completes the pod, and the completion
        // message replaces "Analysis saved".
        await page.locator('#win-btn').click();

        await expect.poll(
            () => page.evaluate(() => window.__stylus.getCell('Red Gurus', 2, 5))
        ).toBe('1');
        await expect(page.locator('#status-message')).toContainText('All rows analysed');
    });

    test('scoring routes only to the three real guru sheet ids', async ({ page }) => {
        await bootRealPod(page, { blankFirstAnalysis: true });
        await signInAndLoad(page);

        await page.locator('#win-btn').click();
        await expect.poll(
            () => page.evaluate(() => window.__stylus.getBatchUpdates().length)
        ).toBeGreaterThan(0);

        const targetSheetIds = await page.evaluate(() =>
            window.__stylus.getBatchUpdates().flatMap(update =>
                (update.resource.requests || []).map(request => request.updateCells?.start?.sheetId)
            )
        );
        expect(targetSheetIds.length).toBeGreaterThan(0);
        for (const id of targetSheetIds) {
            expect([REAL_POD_SHEET_IDS.red, REAL_POD_SHEET_IDS.blue, REAL_POD_SHEET_IDS.green]).toContain(id);
        }
    });

    test('navigating all real matches does not error', async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await bootRealPod(page);
        await signInAndLoad(page);

        // A bad column index on any row would throw while walking the pod.
        for (let i = 1; i < REAL_MATCH_ROWS.length; i++) {
            await page.locator('#next-btn').click();
            await expect(page.locator('#current-row-info')).toContainText(`Match ${i + 1} of`);
        }

        expect(errors).toEqual([]);
    });

    test('saves a deck note that begins with a number without truncating it', async ({ page }) => {
        await bootRealPod(page);
        await signInAndLoad(page);

        // Match 1's player-1 deck (Abraded Bluffs) has a note in the real sheet.
        // Editing it to free text that starts with a number used to be coerced
        // to a number, writing "2" and discarding the rest of the note.
        // The whole field is the edit target; the pencil is only a hint.
        await page.locator('#player1-deck-info .deck-field[data-field-type="notes"]').click();
        const input = page.locator('#player1-deck-info .deck-info-edit-input');
        await input.fill('2 mana, wins on turn 5');
        await input.press('Enter');

        // Deck Notes columns are A:E, so Notes is column 4 and match 1 is row 2.
        await expect.poll(
            () => page.evaluate(() => window.__stylus.getCell('Deck Notes', 2, 4))
        ).toBe('2 mana, wins on turn 5');
    });

    test('a mirrored row shows the same decks with the players swapped', async ({ page }) => {
        await bootRealPod(page);
        await signInAndLoad(page);

        // Match 2 (ID 22) is the mirror of match 1: players swapped, so bluffs
        // moves to the draw. Both decks must still be present.
        await page.locator('#next-btn').click();
        await expect(page.locator('#current-row-info')).toContainText('Match 2 of');

        const editor = page.locator('#sheet-editor');
        await expect(editor).toContainText('Admonition Angel');
        await expect(editor).toContainText('Abraded Bluffs');
    });
});