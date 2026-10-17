'use client';

import clsx from 'clsx';
import { Bell, LogOut, Menu, Moon, Plus, Search, Sun, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, post, refresh, setUnauthorizedHandler, useApi } from '@/lib/api';
import { NAV } from './nav';
import { CommandPalette, QuickAdd } from './palette';
import { Button, Spinner, useToast } from './ui';

const MOBILE_PRIMARY = ['/', '/today', '/production', '/library'];

export function useMe() {
  return useApi<{
    user: any;
    organization: any;
    setup: { step: string; completedAt: string | null; steps: string[] };
  }>('/me', { shouldRetryOnError: false, revalidateOnFocus: false });
}

function isActive(path: string, href: string) {
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => setTheme((document.documentElement.dataset.theme as 'light' | 'dark') ?? 'light'), []);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => {
        const next = theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        localStorage.setItem('cos-theme', next);
        setTheme(next);
      }}
    >
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

function NotificationBell() {
  const { data, mutate } = useApi<any[]>('/notifications', {
    query: { unreadOnly: true, limit: 20 },
    refreshInterval: 60_000,
  });
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const unread = data?.length ?? 0;
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-panel shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-semibold">Notifications</span>
              {unread > 0 && (
                <button
                  className="text-xs text-accent"
                  onClick={async () => {
                    await post('/notifications/read', { all: true });
                    await mutate();
                  }}
                >
                  Mark all read
                </button>
              )}
            </div>
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {(data ?? []).length === 0 && (
                <li className="p-4 text-sm text-muted">Nothing new. Quiet is good.</li>
              )}
              {(data ?? []).map((n) => (
                <li key={n.id}>
                  <button
                    className="block w-full px-3 py-2 text-left hover:bg-panel2"
                    onClick={async () => {
                      await post('/notifications/read', { ids: [n.id] });
                      await mutate();
                      setOpen(false);
                      if (n.deepLink) router.push(n.deepLink);
                    }}
                  >
                    <div className="text-sm font-medium">{n.title}</div>
                    {n.body && <div className="text-xs text-muted">{n.body}</div>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const toast = useToast();
  const me = useMe();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const gotoAuth = useCallback(async () => {
    try {
      const s = await api<{ initialized: boolean }>('/setup/status', { silent401: true });
      router.replace(s.initialized ? `/login?next=${encodeURIComponent(path)}` : '/setup');
    } catch {
      router.replace('/login');
    }
  }, [router, path]);

  useEffect(() => {
    setUnauthorizedHandler(() => void gotoAuth());
    return () => setUnauthorizedHandler(null);
  }, [gotoAuth]);

  useEffect(() => {
    if (me.error?.status === 401) void gotoAuth();
  }, [me.error, gotoAuth]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setMoreOpen(false), [path]);

  if (me.isLoading && !me.data)
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Opening Creator OS" />
      </div>
    );
  if (!me.data) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center text-sm text-muted">
        {me.error && me.error.status !== 401 ? (
          <div>
            <p className="mb-3 text-text">{me.error.message}</p>
            <Button onClick={() => void me.mutate()}>Retry</Button>
          </div>
        ) : (
          <Spinner label="Checking your session" />
        )}
      </div>
    );
  }

  const setupIncomplete = !me.data.setup.completedAt;
  const logout = async () => {
    try {
      await post('/auth/logout');
    } catch (e) {
      toast.error(e);
    }
    await refresh();
    router.replace('/login');
  };

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-panel md:flex">
        <Link href="/" className="flex items-center gap-2 px-4 py-4">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-xs font-extrabold text-accentfg">
            C/OS
          </span>
          <span className="font-semibold">Creator OS</span>
        </Link>
        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(path, n.href) ? 'page' : undefined}
              className={clsx(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm',
                isActive(path, n.href)
                  ? 'bg-accent/15 font-medium text-accent'
                  : 'text-muted hover:bg-panel2 hover:text-text',
              )}
            >
              <n.icon className="size-4" aria-hidden />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border p-3 text-xs text-muted">
          <div className="truncate font-medium text-text">{me.data.user.name}</div>
          <div className="truncate">{me.data.organization.name}</div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-panel/90 px-3 py-2 backdrop-blur md:px-6">
          <Link
            href="/"
            className="mr-1 grid size-8 place-items-center rounded-lg bg-accent text-[10px] font-extrabold text-accentfg md:hidden"
            aria-label="Home"
          >
            C/OS
          </Link>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-3 text-left text-sm text-muted md:max-w-md"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1 truncate">Search everything…</span>
            <kbd className="hidden rounded border border-border px-1.5 text-[10px] md:inline">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="primary" size="sm" onClick={() => setAddOpen(true)} aria-label="Quick add">
              <Plus className="size-4" /> <span className="hidden sm:inline">Quick add</span>
            </Button>
            <NotificationBell />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              aria-label="Sign out"
              className="hidden md:inline-flex"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>

        {setupIncomplete && path !== '/setup' && (
          <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-sm">
            Setup isn't finished.{' '}
            <Link href="/setup" className="font-medium text-accent underline">
              Continue setup
            </Link>
          </div>
        )}

        <main id="main" className="mx-auto w-full max-w-7xl p-3 pb-28 md:p-6 md:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Primary"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-panel md:hidden"
      >
        {NAV.filter((n) => MOBILE_PRIMARY.includes(n.href)).map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={isActive(path, n.href) ? 'page' : undefined}
            className={clsx(
              'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]',
              isActive(path, n.href) ? 'text-accent' : 'text-muted',
            )}
          >
            <n.icon className="size-5" aria-hidden />
            {n.label.split(' ')[0]}
          </Link>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted"
          aria-label="More sections"
        >
          <Menu className="size-5" aria-hidden />
          More
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-label="All sections">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMoreOpen(false)} />
          <div className="safe-bottom absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold">All sections</span>
              <button
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="grid size-9 place-items-center rounded-lg hover:bg-panel2"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={clsx(
                    'flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-border text-center text-xs',
                    isActive(path, n.href) ? 'border-accent text-accent' : 'text-muted',
                  )}
                >
                  <n.icon className="size-5" aria-hidden />
                  {n.label}
                </Link>
              ))}
              <button
                onClick={logout}
                className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-border text-xs text-muted"
              >
                <LogOut className="size-5" aria-hidden />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <QuickAdd open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
