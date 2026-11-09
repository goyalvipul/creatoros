import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from './shell';

const me: { data?: unknown; error?: { status: number; message: string }; isLoading: boolean; mutate: () => void } = {
  data: undefined,
  error: undefined,
  isLoading: true,
  mutate: vi.fn(),
};

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock('@/lib/api', () => ({
  useApi: (path: string) => (path.startsWith('/notifications') ? { data: [], mutate: vi.fn() } : me),
  api: vi.fn(async () => ({ initialized: true })),
  post: vi.fn(),
  refresh: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}));

const session = {
  user: { name: 'Vipul', role: 'OWNER' },
  organization: { name: 'Mehak' },
  setup: { step: 'done', completedAt: '2026-01-01T00:00:00Z', steps: [] },
};

describe('Shell session states', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    process.env.NEXT_PUBLIC_CREATOROS_UX_V5 = '1';
    me.data = undefined;
    me.error = undefined;
    me.isLoading = true;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function show() {
    act(() => {
      root.render(
        <Shell>
          <p>Workspace body</p>
        </Shell>,
      );
    });
  }

  it('shows the opening state before the session arrives', () => {
    show();
    expect(host.textContent).toContain('Opening Creator OS');
    expect(host.textContent).not.toContain('Workspace body');
  });

  it('renders the workspace after loading without adding hooks', () => {
    show();
    me.isLoading = false;
    me.data = session;
    show();
    expect(host.textContent).toContain('Workspace body');
    expect(host.textContent).toContain('Search workspace');
    const bell = host.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement;
    act(() => bell.click());
    expect(document.body.textContent).toContain('Nothing new. Quiet is good.');
  });

  it('shows an error with a retry when the session request fails', () => {
    me.isLoading = false;
    me.error = { status: 500, message: 'Database unavailable' };
    show();
    expect(host.textContent).toContain('Database unavailable');
    expect(host.textContent).toContain('Retry');
    expect(host.textContent).not.toContain('Workspace body');
  });

  it('waits on the sign-in screen when the session is missing', () => {
    me.isLoading = false;
    me.error = { status: 401, message: 'Sign in required' };
    show();
    expect(host.textContent).toContain('Checking your session');
    expect(host.textContent).not.toContain('Workspace body');
  });
});
