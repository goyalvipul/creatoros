import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, SECTIONS, signIn } from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('360px: no section scrolls horizontally and primary navigation is reachable', async ({ page }) => {
  for (const s of SECTIONS) {
    await page.goto(s.path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(s.heading);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);
  }
});

test('360px: bottom navigation and the More sheet', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Production' }).click();
  await expect(page).toHaveURL(/\/production$/);
  await page.getByRole('button', { name: 'More sections' }).click();
  const sheet = page.getByRole('dialog', { name: 'All sections' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('link', { name: 'Collaborations' }).click();
  await expect(page).toHaveURL(/\/collaborations/);
});

test('360px: touch targets in primary navigation are at least 44px', async ({ page }) => {
  await page.goto('/');
  const boxes = await page
    .getByRole('navigation', { name: 'Primary' })
    .locator('a,button')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  for (const b of boxes) {
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.width).toBeGreaterThanOrEqual(44);
  }
});

test('360px: dialogs fit the screen and forms are usable', async ({ page }) => {
  await page.goto('/today');
  await page.getByRole('button', { name: 'Add action' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  const box = await dlg.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(360);
  await page.getByLabel('What needs doing?').fill('Mobile test');
  await expectNoHorizontalOverflow(page);
});
