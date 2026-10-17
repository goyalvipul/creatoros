import { expect, test } from '@playwright/test';
import { signIn, watchProblems } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('actions: add, see it on Today, complete it', async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto('/today');
  await page.getByRole('button', { name: 'Add action' }).click();
  await page.getByLabel('What needs doing?').fill('Send the lyric sheet to the editor');
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  const item = page.getByRole('listitem').filter({ hasText: 'Send the lyric sheet to the editor' });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: /^Complete/ }).click();
  await expect(item).toBeHidden();
  await page.getByRole('tab', { name: 'Recently done' }).click();
  await expect(page.getByText('Send the lyric sheet to the editor')).toBeVisible();
  expect(problems).toEqual([]);
});

test('ideas become projects; checklist gates "ready"; override is explicit', async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto('/content');
  await page.getByRole('button', { name: 'New idea' }).click();
  await page.getByLabel('Title').fill('Acoustic rooftop session');
  await page.getByLabel('Pitch (optional)').fill('One take, golden hour.');
  await page.getByRole('dialog').getByRole('button', { name: 'Capture' }).click();
  const card = page.getByRole('listitem').filter({ hasText: 'Acoustic rooftop session' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Make a project' }).click();
  await page.getByLabel('Type').selectOption('MUSIC_VIDEO');
  await page.getByRole('dialog').getByRole('button', { name: 'Create project' }).click();

  await expect(page).toHaveURL(/\/production\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Acoustic rooftop session');
  const boxes = page.getByRole('checkbox');
  await expect(boxes.first()).toBeVisible();

  // moving to READY with open required items is blocked until the owner explicitly overrides
  await page.getByLabel('Move to stage').selectOption('READY');
  const dlg = page.getByRole('dialog', { name: 'Checklist is incomplete' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Move to stage')).toHaveValue('DRAFT');

  // tick one item, it persists after reload
  await boxes.first().click(); // the box reflects the server state, so it ticks after the round-trip
  await expect(boxes.first()).toBeChecked();
  await page.reload();
  await expect(page.getByRole('checkbox').first()).toBeChecked();

  await page.getByLabel('Move to stage').selectOption('READY');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Move anyway/ })
    .click();
  await expect(page.getByLabel('Move to stage')).toHaveValue('READY');
  await expect(page.getByText('checklist override')).toBeVisible();
  expect(problems).toEqual([]);
});

test('collaborations: log an inquiry, triage it, create a deal, invoice and record a payment', async ({
  page,
}) => {
  const problems = watchProblems(page);
  await page.goto('/collaborations');
  await page.getByRole('button', { name: 'Log inquiry' }).click();
  await page.getByLabel('Brand / company').fill('Acme Audio');
  await page.getByLabel('Contact e-mail').fill('sam@acme.example');
  await page.getByLabel('Subject').fill('Sponsored reel for Acme headphones');
  await page
    .getByLabel('Message / notes')
    .fill('Hi! We would love a collab. Budget is 1500 CAD for one reel.');
  await page.getByLabel('Offered amount').fill('1500');
  await page.getByRole('dialog').getByRole('button', { name: 'Log inquiry' }).click();

  const row = page.getByRole('link').filter({ hasText: 'Sponsored reel for Acme headphones' });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sponsored reel');
  await expect(page.getByText('never sends e-mail', { exact: false })).toBeVisible();
  const confirm = page.getByRole('button', { name: /Yes, create an opportunity/ });
  if (await confirm.isVisible()) await confirm.click();

  // a deal with an invoice
  await page.goto('/collaborations?tab=pipeline');
  await page.getByRole('button', { name: 'New deal' }).click();
  await page.getByLabel('Title').fill('Acme Audio: 1 reel');
  await page.getByLabel('Agreed amount').fill('1500');
  await page.getByRole('dialog').getByRole('button', { name: 'Create deal' }).click();
  await expect(page).toHaveURL(/\/collaborations\/deals\//);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Acme Audio: 1 reel');

  await page.goto('/collaborations?tab=invoices');
  await page.getByRole('button', { name: 'New invoice' }).click();
  const inv = page.getByRole('dialog');
  await inv.getByRole('combobox', { name: /^Deal/ }).selectOption({ label: 'Acme Audio: 1 reel' });
  await inv.getByLabel('Amount').fill('1500');
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('cell', { name: /INV-/ })).toBeVisible();

  await page.getByRole('link', { name: 'Acme Audio: 1 reel' }).click();
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
  expect(problems).toEqual([]);
});

test('channels: add a brand, channel and account', async ({ page }) => {
  await page.goto('/channels');
  await page.getByRole('button', { name: 'New brand' }).click();
  await page.getByLabel('Brand name').fill('Travel Notes');
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  const brand = page
    .locator('section', { has: page.getByRole('heading', { name: 'Travel Notes', level: 2 }) })
    .first();
  await expect(brand).toBeVisible();
  await brand.getByRole('button', { name: 'Channel' }).click();
  await page.getByLabel('Channel name').fill('Travel Notes Vlogs');
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('region', { name: 'Channel Travel Notes Vlogs' })).toBeVisible();
  await page
    .getByRole('region', { name: 'Channel Travel Notes Vlogs' })
    .getByRole('button', { name: 'Account' })
    .click();
  await page.getByLabel('Handle').fill('@travelnotes');
  await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('@travelnotes')).toBeVisible();

  // edit the account handle
  await page.getByRole('button', { name: 'Edit account @travelnotes' }).click();
  await page.getByLabel('Handle').fill('@travelnotes2');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('@travelnotes2')).toBeVisible();
  await expect(page.getByText('@travelnotes', { exact: true })).toHaveCount(0);

  // rename the channel
  await page.getByRole('button', { name: 'Edit channel Travel Notes Vlogs' }).click();
  await page.getByLabel('Channel name').fill('Travel Notes Films');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('region', { name: 'Channel Travel Notes Films' })).toBeVisible();

  // delete the account, the channel, then the brand (each asks first)
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete account @travelnotes2' }).click();
  await expect(page.getByText('@travelnotes2')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete channel Travel Notes Films' }).click();
  await expect(page.getByRole('region', { name: 'Channel Travel Notes Films' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete brand Travel Notes' }).click();
  await expect(page.getByRole('heading', { name: 'Travel Notes', level: 2 })).toHaveCount(0);
});

test('command palette finds records; quick add captures an idea', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: /search|command/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').or(dialog.getByRole('textbox')).first().fill('Acme');
  await expect(dialog.getByText(/Acme/).first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Quick add' }).click();
  await page.getByRole('dialog').getByLabel('Title').fill('Idea from quick add');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/ideas') && r.request().method() === 'POST',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^(Add|Save|Capture)/ })
    .click();
  expect((await saved).ok()).toBeTruthy();
  await page.goto('/content');
  await expect(page.getByText('Idea from quick add')).toBeVisible();
});

test('settings: security and demo data', async ({ page }) => {
  await page.goto('/settings?tab=demo');
  await page.getByRole('button', { name: 'Load demo data' }).click();
  await expect(page.getByRole('button', { name: 'Remove demo data' })).toBeVisible();
  await page.goto('/production');
  await expect(page.getByText('DEMO Lyric video: Midnight Train')).toBeVisible();
  await page.goto('/settings?tab=demo');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Remove demo data' }).click();
  await expect(page.getByRole('button', { name: 'Load demo data' })).toBeVisible();
  await page.goto('/production');
  await expect(page.getByText('DEMO Lyric video: Midnight Train')).toBeHidden();
});
