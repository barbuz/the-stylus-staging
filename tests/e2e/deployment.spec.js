import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import { installStubs, sampleSpreadsheet } from './stubs.js';

const ROOT = path.resolve('.');
const POD_ID = 'POD_SHEET_ID';

const CONTENT_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
};

/**
 * Serve the real app files under the /the-stylus/ and /the-stylus-staging/
 * path prefixes, which is how the two GitHub Pages deployments are shaped.
 * Without this the static test server only exists at the origin root.
 */
async function serveDeploymentPaths(page) {
    const prefixes = ['/the-stylus-staging/', '/the-stylus/'];
    for (const prefix of prefixes) {
        await page.route(new RegExp(`\\${prefix}.*`), (route) => {
            const url = new URL(route.request().url());
            const relative = url.pathname.slice(prefix.length) || 'index.html';
            const file = path.join(ROOT, relative);
            if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                return route.fulfill({ status: 404, body: 'not found' });
            }
            const type = CONTENT_TYPES[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ body: fs.readFileSync(file), contentType: type });
        });
    }
}

async function isolateNetwork(page) {
    await page.route('**/apis.google.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/accounts.google.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/openidconnect.googleapis.com/**', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ email: 'alice@example.com' })
    }));
    await page.route('**/api.scryfall.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
}

async function bootDeployment(page, pathname, { preference = null } = {}) {
    await isolateNetwork(page);
    await serveDeploymentPaths(page);
    await installStubs(page, { spreadsheet: sampleSpreadsheet(), preferences: { guruSignature: 'alice', recentPods: [], recentHubs: [] } });
    if (preference) {
        await page.addInitScript(value => localStorage.setItem('preferred_deployment', value), preference);
    }
    await page.goto(pathname);
}

test.describe('Deployment preference routing', () => {
    test('preview deep link opens in production for a production-preferring browser', async ({ page }) => {
        await bootDeployment(page, `/the-stylus-staging/index.html?pod=${POD_ID}`, { preference: 'production' });

        await expect(page).toHaveURL(new RegExp(`/the-stylus/\\?pod=${POD_ID}$`));
    });

    test('production deep link opens in preview for a preview-preferring browser', async ({ page }) => {
        await bootDeployment(page, `/the-stylus/index.html?pod=${POD_ID}`, { preference: 'preview' });

        await expect(page).toHaveURL(new RegExp(`/the-stylus-staging/\\?pod=${POD_ID}$`));
    });

    test('a shared production link is left alone for an ordinary visitor', async ({ page }) => {
        await bootDeployment(page, `/the-stylus/index.html?pod=${POD_ID}`);

        // No stored preference: the link must not bounce an uninitiated visitor.
        await expect(page).toHaveURL(new RegExp(`/the-stylus/index\\.html\\?pod=${POD_ID}$`));
        await expect(page.locator('#login-section')).toBeVisible();
    });

    test('home screen is not rewritten even with a preference set', async ({ page }) => {
        await bootDeployment(page, '/the-stylus-staging/index.html', { preference: 'production' });

        await expect(page).toHaveURL(/\/the-stylus-staging\/index\.html$/);
    });

    test('preview shows its own name and offers a switch to production', async ({ page }) => {
        await bootDeployment(page, '/the-stylus-staging/index.html');

        await expect(page).toHaveTitle('The Stylus - Preview');
        await expect(page.locator('.header-title h1')).toHaveText('The Stylus - Preview');

        await page.getByRole('button', { name: /sign in with google/i }).click();
        await expect(page.locator('#app-content')).toBeVisible();

        await expect(page.locator('.deployment-switch-note')).toHaveText('You are using Preview.');
        await expect(page.locator('.deployment-switch-btn')).toHaveText('Switch to Production');
    });

    test('merely opening a deployment does not change the stored preference', async ({ page }) => {
        await bootDeployment(page, '/the-stylus/index.html', { preference: 'preview' });

        await page.getByRole('button', { name: /sign in with google/i }).click();
        await expect(page.locator('#app-content')).toBeVisible();

        // The site the tester is on is not the same thing as their preference;
        // only an explicit switch may change it.
        expect(await page.evaluate(() => localStorage.getItem('preferred_deployment'))).toBe('preview');
    });

    test('switching records the preference and carries the pod across', async ({ page }) => {
        await bootDeployment(page, `/the-stylus-staging/index.html?pod=${POD_ID}`);

        await page.getByRole('button', { name: /sign in with google/i }).click();
        await expect(page.locator('.deployment-switch-btn')).toHaveText('Switch to Production');
        await page.locator('.deployment-switch-btn').click();

        await expect(page).toHaveURL(new RegExp(`/the-stylus/\\?pod=${POD_ID}$`));
        expect(await page.evaluate(() => localStorage.getItem('preferred_deployment'))).toBe('production');
    });
});
