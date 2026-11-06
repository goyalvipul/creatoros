import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: string; href: string }) => createElement('a', { href }, children),
}));

import About from '@/app/about/page';
import DataDeletion from '@/app/legal/data-deletion/page';
import Privacy from '@/app/legal/privacy/page';
import Terms from '@/app/legal/terms/page';

function html(node: ReturnType<typeof Terms>) {
  return renderToStaticMarkup(node);
}

describe('public legal pages', () => {
  it('names the individual operator and the privacy mailbox, and publishes no street or postal code', () => {
    for (const page of [html(Terms()), html(Privacy()), html(DataDeletion())]) {
      expect(page).toContain('Vipul Goyal');
      expect(page).toContain('privacy@kemokem.com');
      expect(page).toContain('mailto:privacy@kemokem.com');
      expect(page).not.toContain('1442053');
      expect(page).not.toContain('https://kemokem.com');
      expect(page).not.toContain('CreatorOS');
      expect(page).not.toContain('Needs review');
    }
  });

  it('describes an invitation-only tool and shows the policies without a sign-up form', () => {
    const page = html(About());
    expect(page).toContain('no public sign-up');
    expect(page).toContain('href="/terms"');
    expect(page).toContain('href="/privacy"');
    expect(page).toContain('href="/legal/data-deletion"');
    expect(page).not.toContain('<form');
    expect(page).not.toMatch(/\d{3,}\s+\w+\s+(way|street|avenue|road)/i);
  });

  it('keeps disconnect and deletion as different steps', () => {
    const page = html(DataDeletion());
    expect(page).toContain('Disconnect a social account');
    expect(page).toContain('Imported posts, comments, messages, and analytics remain.');
    expect(page).toContain('https://security.google.com/settings/security/permissions');
    expect(page).toContain('Do not include a password');
  });
});
