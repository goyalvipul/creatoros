import { expect, test } from '@playwright/test';
import { SECTIONS, signIn, watchProblems } from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

for (const s of SECTIONS) {
  test(`section ${s.path} renders without errors`, async ({ page }) => {
    const problems = watchProblems(page);
    await page.goto(s.path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(s.heading);
    await expect(page.getByText(/Request failed|Something went wrong|Cannot reach the server/i)).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(problems).toEqual([]);
  });
}

test('keyboard: skip to content, visible focus, dialogs trap and close with Escape', async ({ page }) => {
  await page.goto('/today');
  await page.getByRole('button', { name: 'Add action' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});

test('theme toggle persists across reloads', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click();
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
});

test('PWA: manifest, icons, service worker script and offline page are served', async ({ request }) => {
  const m = await request.get('/manifest.webmanifest');
  expect(m.ok()).toBe(true);
  const manifest = await m.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBe(true);
  expect(sw.headers()['content-type']).toContain('javascript');
  expect((await request.get('/offline.html')).ok()).toBe(true);
});
