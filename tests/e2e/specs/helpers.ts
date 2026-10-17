import { expect, type Page } from '@playwright/test';

export const OWNER = {
  name: 'Vipul Test',
  email: 'owner@e2e.test',
  password: 'Quartz-Lantern-Harbor-77',
  org: 'E2E Studio',
};

export const SECTIONS: { path: string; heading: RegExp }[] = [
  { path: '/', heading: /^Hello/ },
  { path: '/today', heading: /Inbox & Today/ },
  { path: '/content', heading: /Content ideas/ },
  { path: '/production', heading: /^Production$/ },
  { path: '/library', heading: /^Library$/ },
  { path: '/publishing', heading: /^Publishing$/ },
  { path: '/calendar', heading: /^Calendar$/ },
  { path: '/collaborations', heading: /^Collaborations$/ },
  { path: '/analytics', heading: /^Analytics$/ },
  { path: '/channels', heading: /^Channels$/ },
  { path: '/storage', heading: /Storage & Devices/ },
  { path: '/integrations', heading: /^Integrations$/ },
  { path: '/settings', heading: /^Settings$/ },
];

/** Collects uncaught page errors and failed API calls so a section can't silently break. */
export function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource.*(400|401|404|409|422)/i.test(m.text()))
      problems.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return problems;
}

export async function signIn(page: Page, email = OWNER.email, password = OWNER.password) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(/Hello/);
}

export async function expectNoHorizontalOverflow(page: Page) {
  // on mobile emulation innerWidth grows with the content, so compare with the configured viewport instead
  const width = page.viewportSize()!.width;
  const over = await page.evaluate(
    (w) => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - w,
    width,
  );
  expect(over, 'page must not scroll horizontally').toBeLessThanOrEqual(1);
}
