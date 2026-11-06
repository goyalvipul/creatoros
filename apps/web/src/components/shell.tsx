'use client';

import clsx from 'clsx';
import { BrandLogo, BrandSplash, BrandSymbol } from '@/components/brand-mark';
import { Bell, LogOut, Menu, Moon, Plus, Search, Sun, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, post, refresh, setUnauthorizedHandler, useApi } from '@/lib/api';
import { clearOutboxErrors, flushOutbox, useOutbox } from '@/lib/outbox';
import { canOpen, NAV_GROUPS, navFor } from './nav';
import { CommandPalette, QuickAdd } from './palette';
import { Button, useToast } from './ui';
import { uxV5 } from './ux-v5-flag';

const MOBILE_PRIMARY = ['/', '/today', '/production', '/library'];
const MOBILE_V5 = ['/', '/content', '/production', '/publishing'];

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

function NavLink({
  href,
  active,
  v5,
  label,
  extra,
  children,
}: {
  href: string;
  active: boolean;
  v5: boolean;
  label: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'flex items-center gap-[11px] rounded-[10px] px-3 py-2.5 text-sm font-semibold',
        active
          ? v5
            ? 'v6-nav-on bg-panel2 font-medium text-[color:var(--nav)]'
            : 'bg-accent/15 font-medium text-accent'
          : 'text-muted hover:bg-panel2 hover:text-text',
      )}
    >
      {children}
      {label}
      {extra}
    </Link>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    const root = document.documentElement;
    if (uxV5()) root.dataset.ux = 'v5';
    else delete root.dataset.ux;
    setTheme((root.dataset.theme as 'light' | 'dark') ?? 'light');
  }, []);
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

function OfflineSyncBanner() {
  const box = useOutbox();
  if (!box.count && !box.note) return null;
  const waiting = box.count === 1 ? '1 change is saved on this phone.' : `${box.count} changes are saved on this phone.`;
  return (
    <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-sm">
      {box.syncing
        ? 'Saving to Creator OS…'
        : box.note
          ? box.note
          : box.online
            ? `${waiting} Waiting to sync.`
            : `${waiting} They will sync when you are back online.`}
      {box.note ? (
        <button
          className="ml-2 font-medium text-accent underline"
          onClick={() => {
            clearOutboxErrors();
            void flushOutbox(true);
          }}
        >
          Try again
        </button>
      ) : null}
    </div>
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
              <span className="flex items-center gap-2 text-sm font-semibold">
                Notifications
                {uxV5() && (
                  <Link href="/notifications" className="text-xs font-medium text-accent" onClick={() => setOpen(false)}>
                    Open page
                  </Link>
                )}
              </span>
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

function useInstalledApp() {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    setInstalled(nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches);
  }, []);
  return installed;
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const toast = useToast();
  const me = useMe();
  const role: string | undefined = me.data?.user?.role;
  const nav = navFor(role);
  const v5 = uxV5();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const installed = useInstalledApp();

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
        <BrandSplash label="Opening Creator OS" />
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
          <BrandSplash label="Checking your session" />
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

  const labelOf = (n: (typeof nav)[number]) => (v5 ? n.v5 : n.label);
  const mobileHrefs = v5 ? MOBILE_V5 : MOBILE_PRIMARY;
  const mobileNav = mobileHrefs
    .map((href) => nav.find((n) => n.href === href))
    .filter((n): n is (typeof nav)[number] => Boolean(n));

  return (
    <div className={clsx('min-h-dvh md:grid', v5 ? 'md:grid-cols-[238px_1fr]' : 'md:grid-cols-[15rem_1fr]')}>
      {/* Desktop sidebar */}
      <aside className={clsx('sticky top-0 hidden h-dvh flex-col border-r border-border bg-panel md:flex', v5 ? 'px-[13px] pt-[23px]' : '')}>
        <Link href="/" className={clsx('block', v5 ? 'px-[11px] pb-[22px]' : 'px-4 py-4')}>
          {installed ? <BrandSymbol className="size-9" /> : <BrandLogo className={v5 ? 'h-14' : 'h-12'} />}
        </Link>
        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {v5
            ? NAV_GROUPS.map((group) => {
                const order = ['/', '/today', '/content', '/production', '/comfy', '/library', '/publishing', '/calendar'];
                const items = nav
                  .filter((n) => n.group === group.id)
                  .sort((a, b) => order.indexOf(a.href) - order.indexOf(b.href));
                if (!items.length) return null;
                return (
                  <div key={group.id} className="mb-3">
                    <div className="px-3 pb-2 pt-[18px] text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#a0aca3]">
                      {group.label}
                    </div>
                    {items.map((n) => (
                      <NavLink
                        key={n.href}
                        href={n.href}
                        active={isActive(path, n.href)}
                        v5={v5}
                        label={n.v5}
                      >
                        <n.icon className="size-4" aria-hidden />
                      </NavLink>
                    ))}
                  </div>
                );
              })
            : nav.map((n) => (
                <NavLink key={n.href} href={n.href} active={isActive(path, n.href)} v5={false} label={n.label}>
                  <n.icon className="size-4" aria-hidden />
                </NavLink>
              ))}
        </nav>
        <div className="border-t border-border p-3 text-xs text-muted">
          {v5 ? (
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-full bg-[#193d37] text-[10px] font-semibold text-[#f7ceab]">
                {String(me.data.user.name ?? 'C')
                  .split(' ')
                  .slice(0, 2)
                  .map((p: string) => p[0])
                  .join('')
                  .toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-text">{me.data.organization.name}</span>
                <span className="block truncate">{me.data.user.role === 'OWNER' ? 'Owner' : me.data.user.role}</span>
              </span>
            </div>
          ) : (
            <>
              <div className="truncate font-medium text-text">{me.data.user.name}</div>
              <div className="truncate">{me.data.organization.name}</div>
            </>
          )}
        </div>
      </aside>

      <div className="min-w-0">
        <header className={clsx('sticky top-0 z-30 border-b border-border backdrop-blur', v5 ? 'bg-bg/95' : 'bg-panel/95')}>
          <div className="safe-top md:hidden" />
          <div className={clsx('flex items-center gap-3', v5 ? 'min-h-[70px] px-4 md:px-[30px]' : 'px-3 py-2 md:px-6')}>
          <Link
            href="/"
            className="mr-1 md:hidden"
            aria-label="Home"
          >
            {installed ? <BrandSymbol className="size-9" /> : <BrandLogo className="h-11" />}
          </Link>
          {v5 && (
            <p className="hidden min-w-0 text-sm text-muted md:block">
              <span>Workspace</span>
              <span className="px-1">/</span>
              <span className="text-text">
                {path.startsWith('/notifications')
                  ? 'Notifications'
                  : labelOf(nav.find((n) => isActive(path, n.href)) ?? nav[0]!)}
              </span>
            </p>
          )}
          <button
            onClick={() => setPaletteOpen(true)}
            className={clsx(
              'flex min-h-10 min-w-0 flex-1 items-center gap-2 border border-border px-3 text-left text-sm text-muted',
              v5 ? 'ml-auto max-w-none rounded-[10px] bg-panel md:max-w-[230px]' : 'rounded-full bg-bg md:max-w-md',
            )}
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1 truncate">{v5 ? 'Search projects, assets, people…' : 'Search everything…'}</span>
            <kbd className="hidden rounded border border-border px-1.5 text-[10px] md:inline">Ctrl K</kbd>
          </button>
          <div className="flex items-center gap-2">
            {!v5 && (
              <Button variant="primary" size="sm" onClick={() => setAddOpen(true)} aria-label="Quick add">
                <Plus className="size-4" /> <span className="hidden sm:inline">Quick add</span>
              </Button>
            )}
            <NotificationBell />
            <ThemeToggle />
            {v5 && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setAddOpen(true)}
                aria-label="Quick add"
                className="!rounded-[10px] !bg-[#233f36] !px-4 !text-white"
              >
                <Plus className="size-4" /> <span className="hidden sm:inline">New</span>
              </Button>
            )}
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
          </div>
        </header>

        <OfflineSyncBanner />

        {setupIncomplete && path !== '/setup' && (
          <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-sm">
            Setup isn't finished.{' '}
            <Link href="/setup" className="font-medium text-accent underline">
              Continue setup
            </Link>
          </div>
        )}

        <main
          id="main"
          className={clsx(
            'mx-auto w-full p-3 pb-28 md:pb-10',
            uxV5() ? 'max-w-[1560px] md:px-8 md:py-7' : 'max-w-7xl md:p-6',
          )}
        >
          {canOpen(role, path) ? (
            children
          ) : (
            <p className="text-sm text-muted">This section is only available to the owner.</p>
          )}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Primary"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-panel md:hidden"
      >
        {mobileNav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(path, n.href) ? 'page' : undefined}
              className={clsx(
                'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]',
                isActive(path, n.href) ? (v5 ? 'text-[color:var(--nav)]' : 'text-accent') : 'text-muted',
              )}
            >
              <n.icon className="size-5" aria-hidden />
              {labelOf(n).split(' ')[0]}
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
          <div className={clsx('absolute inset-0', v5 ? 'bg-bg' : 'bg-black/50')} onClick={() => setMoreOpen(false)} />
          <div className={clsx('safe-bottom bg-panel p-4', v5 ? 'absolute inset-0 overflow-y-auto' : 'absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border')}>
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold">{v5 ? 'All workspaces' : 'All sections'}</span>
              <button
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="grid size-9 place-items-center rounded-lg hover:bg-panel2"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={clsx(
                    'flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-border text-center text-xs',
                    isActive(path, n.href) ? 'border-accent text-accent' : 'text-muted',
                  )}
                >
                  <n.icon className="size-5" aria-hidden />
                  {labelOf(n)}
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

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} role={role} />
            <QuickAdd open={addOpen} onClose={() => setAddOpen(false)} role={role} />
    </div>
  );
}
