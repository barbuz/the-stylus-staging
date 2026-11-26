import { test, expect } from '@playwright/test';

/**
 * Keep the app offline. The theme is resolved before the app boots, so these
 * tests do not need the Google or spreadsheet stubs.
 */
async function blockExternal(page) {
    // The app's controllerchange handler reloads the page on a new worker.
    await page.addInitScript(() => {
        try { delete Navigator.prototype.serviceWorker; } catch (e) { /* non-configurable */ }
    });
    await page.route('**/apis.google.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/accounts.google.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/openidconnect.googleapis.com/**', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ email: 'alice@example.com' })
    }));
    await page.route('**/api.scryfall.com/**', route => route.fulfill({
        contentType: 'application/json',
        body: '{}'
    }));
}

test('follows the operating system when no choice is saved', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await blockExternal(page);
    await page.goto('/index.html');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5f7fa');
});

test('opens in the night face when the operating system prefers dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await blockExternal(page);
    await page.goto('/index.html');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0a0e17');
});

test('the switch flips the theme and remembers the choice', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await blockExternal(page);
    await page.goto('/index.html');

    const toggle = page.locator('header [data-theme-toggle]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => localStorage.getItem('stylus_theme'))).toBe('dark');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.locator('header [data-theme-toggle]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('stylus_theme'))).toBe('light');
});

test('a saved choice outranks the operating system', async ({ page }) => {
    await page.addInitScript(() => {
        try { localStorage.setItem('stylus_theme', 'light'); } catch (e) { /* storage blocked */ }
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await blockExternal(page);
    await page.goto('/index.html');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
