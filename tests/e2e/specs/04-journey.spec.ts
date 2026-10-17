/**
 * T33: one creator's whole journey in the browser.
 *   files indexed by a (simulated, signed) scanner agent -> associate with a song and a clip -> approve the clip
 *   -> publish manually to two platforms -> link the deal deliverables to those posts -> invoice and payment
 *   -> follow-up action (Todo honestly "not configured") -> dashboard reflects it all.
 * Everything a person does is done through the UI; only the PC-side scanner is played by signed API calls.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { signIn, watchProblems } from './helpers';

test.describe.configure({ mode: 'serial' });

const V1 = '/api/v1';
const XRW = { 'x-requested-with': 'e2e' };
const SONG = 'Midnight Train (song)';
const CLIP = 'Midnight Train clip';
const REEL = 'Midnight Train reel';
const DEAL = 'Journey Brand: 2 posts';
const IG = '@journey_ig';
const TT = '@journey_tt';

/** Calls the API as the signed-in owner (same session cookie as the browser). */
async function ownerApi<T = any>(
  page: Page,
  method: 'GET' | 'POST',
  url: string,
  data?: unknown,
): Promise<T> {
  const r = await page.request.fetch(`${V1}${url}`, { method, data, headers: XRW });
  expect(r.ok(), `${method} ${url} -> ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()).data as T;
}

test('a creator goes from files on disk to a paid collaboration', async ({ page, request }) => {
  test.setTimeout(180_000);
  const problems = watchProblems(page);
  await signIn(page);

  // ---------- accounts to publish to (Channels is covered by its own spec) ----------
  const brand = await ownerApi(page, 'POST', '/brands', { name: 'Journey Brand Channel' });
  const channel = await ownerApi(page, 'POST', '/channels', { brandId: brand.id, name: 'Journey Channel' });
  await ownerApi(page, 'POST', '/social-accounts', {
    channelId: channel.id,
    platform: 'instagram',
    handle: IG,
  });
  await ownerApi(page, 'POST', '/social-accounts', { channelId: channel.id, platform: 'tiktok', handle: TT });

  // ---------- 1. a paired PC reports two files (the real agent is covered by the Go e2e test) ----------
  const code = (await ownerApi(page, 'POST', '/pairing-codes', { label: 'Journey PC' })).code as string;
  const pairRes = await request.post(`${V1}/agents/pair`, {
    headers: XRW,
    data: {
      code,
      deviceUuid: randomUUID(),
      hostname: 'JOURNEY-PC',
      os: 'windows',
      agentVersion: '1.0.0',
    },
  });
  expect(pairRes.status(), await pairRes.text()).toBe(201);
  const dev = (await pairRes.json()).data as { token: string; signingKey: string; deviceId: string };
  const root = await ownerApi(page, 'POST', '/roots', {
    deviceId: dev.deviceId,
    label: 'Journey Media',
    displayPath: 'D:\\Journey',
  });

  const signed = async (method: 'GET' | 'POST', url: string, body = '') => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', dev.signingKey)
      .update(`${ts}.${createHash('sha256').update(body).digest('hex')}`)
      .digest('hex');
    const res = await request.fetch(`${V1}${url}`, {
      method,
      data: body || undefined,
      headers: {
        ...XRW,
        authorization: `Bearer ${dev.token}`,
        'x-agent-timestamp': ts,
        'x-agent-signature': sig,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
    });
    expect(res.ok(), `${method} ${url} -> ${res.status()} ${await res.text()}`).toBeTruthy();
    return (await res.json()).data;
  };
  await signed(
    'POST',
    '/agents/heartbeat',
    JSON.stringify({ agentVersion: '1.0.0', roots: [{ rootId: root.id, reachable: true }] }),
  );
  const runId = randomUUID();
  const file = (seq: number, name: string, size: number) => ({
    eventId: `${runId}:${seq}`,
    seq,
    kind: 'file',
    path: `D:\\Journey\\${name}`,
    size,
    mtimeMs: Date.now() - 3_600_000,
    fileId: `journey-${seq}`,
    state: 'STABLE',
    stableObservations: 2,
    quickSignature: `journey-qs-${seq}`,
  });
  const ingested = await signed(
    'POST',
    '/agents/ingest',
    JSON.stringify({
      rootId: root.id,
      runId,
      phase: 'START',
      observations: [
        file(0, 'midnight_train_master.wav', 48_000_000),
        file(1, 'midnight_train_clip_v2.mp4', 120_000_000),
      ],
    }),
  );
  expect(ingested.accepted).toBe(2);

  // ---------- 2. Library: two assets, each linked to its file by the owner ----------
  await page.goto('/library');
  await page.getByRole('tab', { name: 'Assets' }).click();
  for (const [title, kind] of [
    [SONG, 'AUDIO'],
    [CLIP, 'VIDEO'],
  ]) {
    await page.getByRole('button', { name: 'New asset' }).click();
    const dlg = page.getByRole('dialog', { name: 'New asset' });
    await dlg.getByLabel('Title').fill(title!);
    await dlg.getByLabel('Kind').selectOption(kind!);
    await dlg.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('button', { name: title!, exact: true })).toBeVisible();
  }

  await page.getByRole('tab', { name: 'Files' }).click();
  await page.getByLabel('Search files').fill('midnight_train');
  for (const [fileName, assetTitle] of [
    ['midnight_train_master.wav', SONG],
    ['midnight_train_clip_v2.mp4', CLIP],
  ]) {
    await page.getByRole('button', { name: new RegExp(fileName!.replace('.', '\\.')) }).click();
    const detail = page.getByRole('dialog', { name: fileName });
    await expect(detail.getByText('Not linked to any asset yet.')).toBeVisible();
    await detail.getByRole('button', { name: 'Link to asset' }).click();
    const link = page.getByRole('dialog', { name: 'Link file to an asset version' });
    await link.getByLabel('Asset').selectOption({ label: assetTitle! });
    await expect(link.getByLabel('Version').locator('option')).toHaveCount(2);
    await link.getByLabel('Version').selectOption({ index: 1 });
    await link.getByRole('button', { name: 'Link', exact: true }).click();
    await expect(detail.locator('li', { hasText: assetTitle! }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();
  }

  // ---------- 3. approve the clip: select it as the final version ----------
  await page.getByRole('tab', { name: 'Assets' }).click();
  await page.getByRole('button', { name: CLIP, exact: true }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Select as final' }).click();
  await expect(page.getByText('selected final')).toBeVisible();
  await page.keyboard.press('Escape');

  // ---------- 4. Publishing: plan and manually publish on two platforms ----------
  await page.goto('/publishing');
  await page.getByRole('button', { name: 'New variant' }).first().click();
  const variant = page.getByRole('dialog', { name: 'New variant' });
  await variant.getByLabel('Asset').selectOption({ label: CLIP });
  await variant.getByLabel('Title').fill(REEL);
  await variant.getByRole('button', { name: 'Create' }).click();

  const urls: Record<string, string> = {
    instagram: 'https://www.instagram.com/reel/journey123/',
    tiktok: 'https://www.tiktok.com/@journey_tt/video/7000000000000000001',
  };
  for (const [platform, handle] of [
    ['instagram', IG],
    ['tiktok', TT],
  ]) {
    await page.getByRole('button', { name: new RegExp(`${REEL} on ${platform} ${handle}`) }).click();
    const cell = page.getByRole('dialog', { name: new RegExp(`${REEL}.*${handle}`) });
    await cell.getByRole('button', { name: 'Plan', exact: true }).click();
    await expect(cell).toBeHidden();
    await page
      .getByRole('button', { name: new RegExp(`${REEL} on ${platform} ${handle}: Planned`, 'i') })
      .click();
    const planned = page.getByRole('dialog', { name: new RegExp(`${REEL}.*${handle}`) });
    await planned.getByLabel('Link to the live post').fill(urls[platform!]!);
    await planned.getByRole('button', { name: 'Mark as published' }).click();
    await expect(planned).toBeHidden();
    await expect(
      page.getByRole('button', { name: new RegExp(`${REEL} on ${platform} ${handle}: Published`, 'i') }),
    ).toBeVisible();
  }

  // ---------- 5. Collaboration: deal, deliverables linked to the posts, invoice, payment ----------
  await page.goto('/collaborations?tab=pipeline');
  await page.getByRole('button', { name: 'New deal' }).click();
  await page.getByLabel('Title').fill(DEAL);
  await page.getByLabel('Agreed amount').fill('1200');
  await page.getByRole('dialog').getByRole('button', { name: 'Create deal' }).click();
  await expect(page).toHaveURL(/\/collaborations\/deals\//);
  const dealUrl = page.url();

  for (const [title, handle] of [
    ['Instagram reel', IG],
    ['TikTok video', TT],
  ]) {
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Add deliverable' })
      .getByRole('textbox', { name: 'Deliverable' })
      .fill(title!);
    await page.getByRole('dialog', { name: 'Add deliverable' }).getByRole('button', { name: 'Add' }).click();
    const li = page.getByRole('listitem').filter({ hasText: title! });
    await expect(li).toBeVisible();
    await li.getByRole('button', { name: `Link a post to ${title}` }).click();
    const dlg = page.getByRole('dialog', { name: `Link a post to ${title}` });
    const select = dlg.getByLabel('Post');
    const value = await select.locator('option', { hasText: handle! }).getAttribute('value');
    expect(value, `post for ${handle} is offered`).toBeTruthy();
    await select.selectOption(value!);
    await dlg.getByRole('button', { name: 'Link', exact: true }).click();
    await expect(li.getByText(new RegExp(handle!))).toBeVisible();
    await expect(li.getByText(/Published/i).first()).toBeVisible();
  }

  // a post already used by one deliverable is not offered to the other
  await page
    .getByRole('listitem')
    .filter({ hasText: 'TikTok video' })
    .getByRole('button', { name: 'Link a post to TikTok video' })
    .click();
  const offered = page
    .getByRole('dialog', { name: 'Link a post to TikTok video' })
    .getByLabel('Post')
    .locator('option');
  await expect(offered.filter({ hasText: IG })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.goto('/collaborations?tab=invoices');
  await page.getByRole('button', { name: 'New invoice' }).click();
  const inv = page.getByRole('dialog');
  await inv.getByRole('combobox', { name: /^Deal/ }).selectOption({ label: DEAL });
  await inv.getByLabel('Amount').fill('1200');
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('cell', { name: /INV-/ }).first()).toBeVisible();
  await page.getByRole('link', { name: DEAL }).first().click();
  await expect(page).toHaveURL(dealUrl);
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
  await expect(
    page
      .getByLabel('Deal money')
      .getByText(/1,200\.00/)
      .first(),
  ).toBeVisible();

  // ---------- 6. Follow-up action; Todo is honest about not being connected ----------
  await page.goto('/today');
  await page.getByRole('button', { name: 'Add action' }).click();
  await page.getByLabel('What needs doing?').fill('Send Journey Brand the performance recap');
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  const action = page.getByRole('listitem').filter({ hasText: 'Send Journey Brand the performance recap' });
  await expect(action).toBeVisible();
  await expect(page.getByTestId('todo-not-configured')).toBeVisible();
  await expect(action.getByRole('button', { name: /Send .* to Todo/ })).toHaveCount(0);

  // ---------- 7. Dashboard shows the result ----------
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(/Hello/);
  const counts = page.getByRole('region', { name: 'Counts' });
  await expect(counts.getByText('Open actions')).toBeVisible();
  const analytics = await ownerApi(page, 'GET', '/analytics');
  expect(analytics.totals.manual).toBeGreaterThanOrEqual(2);
  expect(analytics.totals.verified).toBe(0); // entered by the owner, never claimed as platform-verified

  const deal = (await ownerApi(page, 'GET', `/deals?q=${encodeURIComponent('Journey Brand')}`))[0];
  const full = await ownerApi(page, 'GET', `/deals/${deal.id}`);
  expect(full.deliverables).toHaveLength(2);
  for (const d of full.deliverables) {
    expect(d.publications).toHaveLength(1);
    expect(d.publications[0].state).toBe('PUBLISHED_MANUAL');
  }
  expect(full.summary.outstandingMinor).toBe(0);
  // the simulated agent serves no bytes, so the media player's stream requests (503) are expected here
  expect(problems.filter((x) => !/\/files\/[0-9a-f-]+\/stream|status of 503/.test(x))).toEqual([]);
});
