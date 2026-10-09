import { test, expect } from '@playwright/test';

import { installStubs, makeSpreadsheet, cellsFromRows, realPodSpreadsheet } from './stubs.js';
import { REAL_POD_SHEET_IDS } from '../fixtures/realPod.js';

/**
 * The clocks & notes gate: a hidden pod opens on the Deck Notes screen one deck
 * at a time, before guruing can start.
 *
 * The real pod fixture has four distinct decks with every clock filled, so it
 * exercises the gate's finished state and the hand-off to analysis. Grouping
 * and the "next without clock" skip need repeated/blank rows, so those tests
 * seed a small purpose-built Deck Notes sheet instead.
 */

const POD_ID = 'REAL_POD_ID';
const POD_URL = `https://docs.google.com/spreadsheets/d/${POD_ID}/edit`;
const SIGNATURE = 'Oophies';

const DECK_NOTES_HEADER = ['Decklists', 'Goldfish Clock', 'Signature', 'Notes', 'Additional Notes'];

async function isolateNetwork(page) {
    await page.route('**/apis.google.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/accounts.google.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/openidconnect.googleapis.com/**', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ email: 'guru@example.com' })
    }));
    await page.route('**/api.scryfall.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
}

/** A hidden pod whose Deck Notes sheet is the given rows (header excluded). */
function gateSpreadsheet(deckNotesRows) {
    return makeSpreadsheet({
        title: 'Gate Pod',
        sheets: [
            {
                title: 'Deck Notes',
                sheetId: REAL_POD_SHEET_IDS.deckNotes,
                cells: cellsFromRows([DECK_NOTES_HEADER, ...deckNotesRows])
            },
            { title: 'Red Gurus', sheetId: REAL_POD_SHEET_IDS.red, hidden: true, cells: cellsFromRows([['ID', 'Player 1', 'Player 2']]) },
            { title: 'Blue Gurus', sheetId: REAL_POD_SHEET_IDS.blue, hidden: true, cells: cellsFromRows([['ID', 'Player 1', 'Player 2']]) },
            { title: 'Green Gurus', sheetId: REAL_POD_SHEET_IDS.green, hidden: true, cells: cellsFromRows([['ID', 'Player 1', 'Player 2']]) },
            { title: 'metadata', sheetId: REAL_POD_SHEET_IDS.metadata, hidden: true, cells: cellsFromRows([['Pod Name', '\u2714', 'Gate Pod']]) }
        ]
    });
}

async function installBoot(page, spreadsheet) {
    await isolateNetwork(page);
    await installStubs(page, {
        spreadsheet,
        preferences: { guruSignature: SIGNATURE, recentPods: [], recentHubs: [] }
    });
}

async function signInAndLoad(page) {
    await page.getByRole('button', { name: /sign in with google/i }).click();
    await expect(page.locator('#app-content')).toBeVisible();
    await page.locator('#sheet-url').fill(POD_URL);
    await page.locator('#load-sheet-btn').click();
}

/** Open the clock editor for the current deck and save a new value. */
async function editClock(page, value) {
    // The whole field is the edit target; the pencil is only a hint.
    await page.locator('#deck-notes-deck-info .deck-field[data-field-type="clock"]').click();
    const input = page.locator('#deck-notes-deck-info .deck-info-edit-input');
    await input.fill(value);
    await input.press('Enter');
}

test.describe('Deck notes gate', () => {
    test('a hidden pod opens on one deck at a time, not the analysis screen', async ({ page }) => {
        await installBoot(page, realPodSpreadsheet({ guruHidden: true }));
        await page.goto('/index.html');
        await signInAndLoad(page);

        await expect(page.locator('#deck-notes-screen')).toBeVisible();
        await expect(page.locator('#guru-analysis-interface')).toBeHidden();
        await expect(page.locator('#deck-notes-progress')).toHaveText('Deck 1 of 4');

        // The first deck's cards render; the fixture's image stub does not
        // load them, so assert on the (card-name) fallback content.
        await expect(page.locator('#deck-notes-cards')).toContainText('Abraded Bluffs');
        await expect(page.locator('#deck-notes-cards .card-slot')).toHaveCount(3);
    });

    test('next moves between decks', async ({ page }) => {
        await installBoot(page, realPodSpreadsheet({ guruHidden: true }));
        await page.goto('/index.html');
        await signInAndLoad(page);

        await page.locator('#deck-notes-next-btn').click();
        await expect(page.locator('#deck-notes-progress')).toHaveText('Deck 2 of 4');
        await page.locator('#deck-notes-prev-btn').click();
        await expect(page.locator('#deck-notes-progress')).toHaveText('Deck 1 of 4');
    });

    test('the goldfish signature shows on hovering the clock', async ({ page }) => {
        await installBoot(page, realPodSpreadsheet({ guruHidden: true }));
        await page.goto('/index.html');
        await signInAndLoad(page);

        // Deck 1's clock is signed "Kamatana" in the real fixture.
        const clock = page.locator('#deck-notes-deck-info .deck-clock-signed');
        await clock.hover();
        await expect(clock.locator('.guru-signature-tooltip')).toHaveText('Kamatana');
    });

    test('grouped consecutive decks collapse to one entry and fill every row', async ({ page }) => {
        await installBoot(page, gateSpreadsheet([
            ['B | Card | Card', '5.0', 'sig', '', ''],
            ['A | Card | Card', '', '', '', ''],
            ['A | Card | Card', '', '', '', ''],
            ['C | Card | Card', '', '', '', '']
        ]));
        await page.goto('/index.html');
        await signInAndLoad(page);

        // Two consecutive identical A rows collapse into a single entry.
        await expect(page.locator('#deck-notes-progress')).toHaveText('Deck 1 of 3');
        await expect(page.locator('#deck-notes-clocks')).toHaveText('1 of 3 clocks filled');

        await page.locator('#deck-notes-next-btn').click();
        await expect(page.locator('#deck-notes-deck-heading')).toHaveText('Deck 2 of 3');
        await expect(page.locator('#deck-notes-cards')).toContainText('A');

        await editClock(page, '6');

        // Both rows of the collapsed run get the clock (column B) and the
        // guru signature (column C).
        await expect.poll(() => page.evaluate(() => window.__stylus.getCell('Deck Notes', 3, 2))).toBe('6');
        await expect.poll(() => page.evaluate(() => window.__stylus.getCell('Deck Notes', 4, 2))).toBe('6');
        await expect.poll(() => page.evaluate(() => window.__stylus.getCell('Deck Notes', 3, 3))).toBe(SIGNATURE);
        await expect.poll(() => page.evaluate(() => window.__stylus.getCell('Deck Notes', 4, 3))).toBe(SIGNATURE);
    });

    test('next without clock jumps to the next empty clock', async ({ page }) => {
        await installBoot(page, gateSpreadsheet([
            ['B | Card | Card', '5.0', 'sig', '', ''],
            ['A | Card | Card', '', '', '', ''],
            ['C | Card | Card', '', '', '', '']
        ]));
        await page.goto('/index.html');
        await signInAndLoad(page);

        await expect(page.locator('#deck-notes-progress')).toHaveText('Deck 1 of 3');
        await expect(page.locator('#deck-notes-next-empty-btn')).toBeVisible();
        await page.locator('#deck-notes-next-empty-btn').click();
        await expect(page.locator('#deck-notes-progress')).toHaveText('Deck 2 of 3');
    });

    test('next without clock disappears once every clock is filled', async ({ page }) => {
        // The real fixture has every clock filled, so the empty-clock jump is moot.
        await installBoot(page, realPodSpreadsheet({ guruHidden: true }));
        await page.goto('/index.html');
        await signInAndLoad(page);

        await expect(page.locator('#deck-notes-start-btn')).toBeEnabled();
        await expect(page.locator('#deck-notes-next-empty-btn')).toBeHidden();
    });

    test('start guruing is gated until every clock is filled, then enters analysis', async ({ page }) => {
        await installBoot(page, gateSpreadsheet([
            ['B | Card | Card', '5.0', 'sig', '', ''],
            ['A | Card | Card', '', '', '', '']
        ]));
        await page.goto('/index.html');
        await signInAndLoad(page);

        const start = page.locator('#deck-notes-start-btn');
        await expect(start).toBeDisabled();

        await page.locator('#deck-notes-next-btn').click();
        await editClock(page, '9');
        await expect(start).toBeEnabled();

        await start.click();

        // The guru sheets were unhidden and the analysis screen took over.
        await expect(page.locator('#deck-notes-screen')).toHaveCount(0);
        await expect(page.locator('#guru-analysis-interface')).toBeVisible();
    });

    test('opening from analysis lands on the open match\'s player 1 deck', async ({ page }) => {
        await installBoot(page, realPodSpreadsheet());
        await page.goto('/index.html');
        await signInAndLoad(page);

        // Match 2's player 1 is Admonition Angel, which is Deck 2 in the notes.
        await page.locator('#next-btn').click();
        await expect(page.locator('#current-row-info')).toContainText('Match 2 of');

        await page.locator('#deck-notes-btn').click();
        await expect(page.locator('#deck-notes-screen')).toBeVisible();
        await expect(page.locator('#deck-notes-progress')).toHaveText('Deck 2 of 4');
    });

    test('the Deck N of M button opens a jump-to-deck table', async ({ page }) => {
        await installBoot(page, realPodSpreadsheet({ guruHidden: true }));
        await page.goto('/index.html');
        await signInAndLoad(page);

        await expect(page.locator('#deck-notes-progress')).toHaveText('Deck 1 of 4');
        await page.locator('#deck-notes-progress').click();

        const modal = page.locator('.overview-table-modal');
        await expect(modal).toBeVisible();
        // One row per deck, no group headers (each entry is a single deck).
        await expect(modal.locator('tr[data-row]')).toHaveCount(4);
        await expect(modal.locator('.deck-group-header')).toHaveCount(0);

        // The clock column shows the value, not a checkmark.
        await expect(modal.locator('tr[data-row="0"] .deck-overview-clock')).toHaveText('8.0');

        // With room, the signature and both notes columns are shown too.
        const headerText = await modal.locator('thead').innerText();
        expect(headerText).toContain('Signature');
        expect(headerText).toContain('Notes');
        expect(headerText).toContain('Additional Notes');
        await expect(modal.locator('tr[data-row="0"]')).toContainText('Kamatana');
        await expect(modal.locator('tr[data-row="0"]')).toContainText('Can Erode');

        // Jump to the third deck via its table row.
        await modal.locator('tr[data-row="2"]').click();
        await expect(page.locator('.overview-table-modal')).toHaveCount(0);
        await expect(page.locator('#deck-notes-progress')).toHaveText('Deck 3 of 4');
    });

    test('a deck filled by the current guru is highlighted in the deck table', async ({ page }) => {
        await installBoot(page, gateSpreadsheet([
            ['A | Card | Card', '5.0', SIGNATURE, 'note A', ''],
            ['B | Card | Card', '7.0', 'someone else', '', '']
        ]));
        await page.goto('/index.html');
        await signInAndLoad(page);

        await page.locator('#deck-notes-progress').click();
        const modal = page.locator('.overview-table-modal');

        await expect(modal.locator('tr.current-guru-row')).toHaveCount(1);
        await expect(modal.locator('tr.current-guru-row')).toHaveAttribute('data-row', '0');
        await expect(modal.locator('tr.current-row')).toHaveAttribute('data-row', '0');
    });

    test('the deck notes screen can be opened from analysis and returned from', async ({ page }) => {
        await installBoot(page, realPodSpreadsheet());
        await page.goto('/index.html');
        await signInAndLoad(page);

        await expect(page.locator('#guru-analysis-interface')).toBeVisible();

        await page.locator('#deck-notes-btn').click();
        await expect(page.locator('#deck-notes-screen')).toBeVisible();
        // Opened from a live session: back to analysis, no Start guruing.
        await expect(page.locator('#deck-notes-back-btn')).toBeVisible();
        await expect(page.locator('#deck-notes-start-btn')).toBeHidden();

        await page.locator('#deck-notes-back-btn').click();
        await expect(page.locator('#deck-notes-screen')).toHaveCount(0);
        await expect(page.locator('#guru-analysis-interface')).toBeVisible();
    });
});
