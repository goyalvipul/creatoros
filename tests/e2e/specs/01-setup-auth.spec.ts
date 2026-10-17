import { expect, test } from '@playwright/test';
import { OWNER, signIn, watchProblems } from './helpers';

test.describe.configure({ mode: 'serial' });

test('fresh install: first visit leads to the setup wizard (no default password exists)', async ({ page, request }) => {
  const s = await request.get('/api/v1/setup/status');
  expect((await s.json()).data.initialized).toBe(false);
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'Create the owner account' })).toBeVisible();
});

test('weak passwords are rejected with a clear message', async ({ page }) => {
  await page.goto('/setup');
  await page.getByLabel('Your name').fill(OWNER.name);
  await page.getByLabel('E-mail').fill(OWNER.email);
  await page.getByLabel('Password').fill('password123');
  await page.getByLabel('Workspace / company name').fill(OWNER.org);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create the owner account' })).toBeVisible();
});

test('setup wizard: owner, brand/channel/account, skip devices, finish', async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto('/setup');
  await page.getByLabel('Your name').fill(OWNER.name);
  await page.getByLabel('E-mail').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByLabel('Workspace / company name').fill(OWNER.org);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Brands & channels' })).toBeVisible();
  await page.getByLabel('Brand name').fill('Mehak');
  await page.getByLabel('First channel (optional)').fill('Mehak Music');
  await page.getByLabel('Handle').fill('@mehakmusic');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByRole('heading', { name: /Connect a PC/ })).toBeVisible();
  await page.getByRole('button', { name: 'Create pairing code' }).click();
  await expect(page.getByLabel('Pairing code')).toHaveText(/[A-Z0-9-]{6,}/);
  await expect(page.getByText('pair --server')).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();

  await expect(page.getByRole('heading', { name: 'Choose folders to index' })).toBeVisible();
  await expect(page.getByText('No device connected yet')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'First scan' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: /Integrations/ })).toBeVisible();
  await expect(page.getByText('Gmail', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Finish setup' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello, Vipul');
  expect(problems).toEqual([]);
});

test('setup cannot be repeated once an owner exists', async ({ request }) => {
  const r = await request.post('/api/v1/setup/bootstrap', {
    headers: { 'x-requested-with': 'e2e' },
    data: { email: 'second@e2e.test', name: 'Mallory', password: 'Another-Long-Passphrase-1', orgName: 'Nope' },
  });
  expect(r.status()).toBeGreaterThanOrEqual(400);
});

test('sign out, wrong password fails, correct password signs in', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('E-mail').fill(OWNER.email);
  await page.getByLabel('Password').fill('wrong password here');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello');
});

test('protected pages redirect to login when signed out and return after sign-in', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/calendar');
  await expect(page).toHaveURL(/\/login\?next=%2Fcalendar/);
  await page.getByLabel('E-mail').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await ctx.close();
});
