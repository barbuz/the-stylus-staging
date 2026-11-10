import { test, expect } from '@playwright/test';

import { installStubs, sampleSpreadsheet } from './stubs.js';

const POD_ID = 'POD_SHEET_ID';
const POD_URL = `https://docs.google.com/spreadsheets/d/${POD_ID}/edit`;

/**
 * Row rendering is asynchronous: the analysis list awaits its Discord thread
 * link and the card slots await Scryfall. Two renders can overlap, and a slower
 * older one must not paint its row over the newer one — otherwise the screen
 * flashes between two matches or shows a match's cards over the wrong row.
 *
 * These specs slow one row's async work so the older render lands last, then
 * assert the invariant a guru sees: once the header names a match, its content
 * is never a previous match's.
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

/** The sample pod plus a hub link, so the analysis list has an await gap. */
function podWithHub() {
    const spreadsheet = sampleSpreadsheet();
    spreadsheet.sheets.push({
        title: 'metadata',
        sheetId: 999,
        hidden: true,
        cells: {
            '1:1': 'Guru Hub Link', '1:3': 'https://docs.google.com/spreadsheets/d/HUB_SHEET_ID/edit',
            '2:1': 'Pod Name', '2:3': 'Aspirant II'
        }
    });
    return spreadsheet;
}

/**
 * Boot the app with injected latency.
 *
 * `slowThreadMs` delays the hub thread fetch (the await inside the analysis
 * list). `slowImageMatch` is a RegExp source matched against an image's src;
 * matching images load slowly, everything else instantly.
 */
async function bootApp(page, { spreadsheet, slowThreadMs = 0, slowImageMatch = null } = {}) {
    await isolateNetwork(page);
    await installStubs(page, {
        spreadsheet,
        preferences: { guruSignature: 'alice', recentPods: [], recentHubs: [] }
    });

    await page.addInitScript(({ slowThreadMs, slowImageMatch }) => {
        if (slowThreadMs > 0) {
            const ss = window.gapi.client.sheets.spreadsheets;
            const orig = ss.get;
            ss.get = async (...args) => {
                await new Promise(r => setTimeout(r, slowThreadMs));
                return orig(...args);
            };
        }
        if (slowImageMatch) {
            const re = new RegExp(slowImageMatch);
            Object.defineProperty(window.Image.prototype, 'src', {
                configurable: true,
                set(value) {
                    this.setAttribute('data-src', value);
                    const fire = () => { if (typeof this.onload === 'function') this.onload(); };
                    setTimeout(fire, re.test(value) ? 1200 : 5);
                },
                get() { return this.getAttribute('data-src'); }
            });
        }
    }, { slowThreadMs, slowImageMatch });
    await page.goto('/index.html');
}

async function signIn(page) {
    await page.getByRole('button', { name: /sign in with google/i }).click();
    await expect(page.locator('#app-content')).toBeVisible();
    await expect(page.locator('#sheet-url')).toBeVisible();
}

async function loadPod(page) {
    await page.locator('#sheet-url').fill(POD_URL);
    await page.locator('#load-sheet-btn').click();
    await expect(page.locator('#sheet-editor')).toBeVisible();
    await expect(page.locator('#current-row-info')).toHaveText('Match 1 of 4');
}

/**
 * Sample (header, analysis value, first card slot) on every change until the
 * returned stop() is called. Returns the recorded timeline.
 */
async function startTimeline(page) {
    await page.evaluate(() => {
        window.__timeline = [];
        const snap = () => {
            const progress = document.getElementById('current-row-info')?.textContent || '';
            const analysis = document.getElementById('current-analysis-value')?.textContent?.replace(/\s+/g, ' ').trim() || '';
            const slot = document.querySelector('#player1-cards .card-slot:first-child');
            const slotTitle = slot?.querySelector('.card-link')?.getAttribute('title') || slot?.textContent?.replace(/\s+/g, ' ').trim() || '';
            return { progress, analysis, slotTitle };
        };
        window.__record = () => {
            const s = snap();
            const last = window.__timeline[window.__timeline.length - 1];
            if (!last || last.progress !== s.progress || last.analysis !== s.analysis || last.slotTitle !== s.slotTitle) {
                window.__timeline.push({ t: Math.round(performance.now()), ...s });
            }
        };
        window.__record();
        window.__timer = setInterval(window.__record, 20);
    });
}

async function stopTimeline(page) {
    return page.evaluate(() => { clearInterval(window.__timer); return window.__timeline; });
}

test.describe('render race', () => {
    test('scoring then Next does not flash the previous match', async ({ page }) => {
        await bootApp(page, { spreadsheet: podWithHub(), slowThreadMs: 900 });
        await signIn(page);
        await loadPod(page);

        await startTimeline(page);
        // Score row 1, then move to row 2 while the write-triggered reload and
        // the in-place refresh are both still awaiting the thread link.
        await page.locator('#win-btn').click();
        await page.waitForTimeout(60);
        await page.locator('#next-btn').click();
        await page.waitForTimeout(3000);

        const timeline = await stopTimeline(page);
        // Row 1's analysis list reads "You: Win (1.0) Blue: bob". Once the
        // header says Match 2, that content must never appear.
        const leaked = timeline.filter(s => s.progress === 'Match 2 of 4' && /Win \(1\.0\)/.test(s.analysis));
        expect(leaked, `stale row 1 content on Match 2:\n${JSON.stringify(leaked, null, 2)}`).toHaveLength(0);
    });

    test('moving quickly does not show a previous match\'s cards', async ({ page }) => {
        await bootApp(page, { spreadsheet: sampleSpreadsheet(), slowImageMatch: 'Deck%20A|Deck A' });
        await signIn(page);
        await loadPod(page);

        await page.waitForTimeout(200); // let row 1 (Deck A) begin its slow load
        await startTimeline(page);
        await page.locator('#next-btn').click();
        await page.waitForTimeout(60);
        await page.locator('#next-btn').click();
        await page.waitForTimeout(3500);

        const timeline = await stopTimeline(page);
        // Rows 1 and 2 are both Deck A, but row 3 is Deck D. While the header
        // says Match 3, a lingering "Deck A" image is a stale render.
        const leaked = timeline.filter(s => s.progress === 'Match 3 of 4' && /Deck A/.test(s.slotTitle));
        expect(leaked, `stale row 1 card on Match 3:\n${JSON.stringify(leaked, null, 2)}`).toHaveLength(0);
    });
});
