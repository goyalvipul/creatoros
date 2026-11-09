'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, post, refresh, useApi } from './api';

export type WorkspaceBrand = { id: string; name: string; coverPath?: string | null };

export function WorkspaceMark({ brand }: { brand: { id: string; name: string; coverPath?: string | null } }) {
  const [broken, setBroken] = useState(false);
  const letter = brand.name.trim().slice(0, 1).toUpperCase() || 'W';
  const photo = Boolean(brand.coverPath) && !broken;
  return (
    <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-md bg-[#193d37] text-[11px] font-semibold text-[#f7ceab]">
      {photo ? (
        <img
          alt=""
          src={`/api/v1/today/cover?brandId=${brand.id}`}
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        letter
      )}
    </span>
  );
}

const KEY = 'cos-workspace';
const EVENT = 'cos-workspace';

export function useWorkspace() {
  const catalog = useApi<WorkspaceBrand[]>('/catalog', { revalidateOnFocus: false });
  const brands = Array.isArray(catalog.data) ? catalog.data : [];
  const [saved, setSaved] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const apply = () => setSaved(window.localStorage.getItem(KEY));
    apply();
    setHydrated(true);
    window.addEventListener(EVENT, apply);
    window.addEventListener('storage', apply);
    return () => {
      window.removeEventListener(EVENT, apply);
      window.removeEventListener('storage', apply);
    };
  }, []);

  const current = hydrated ? (brands.find((brand) => brand.id === saved) ?? brands[0] ?? null) : null;

  useEffect(() => {
    if (!hydrated || !current) return;
    if (window.localStorage.getItem(KEY) === current.id) return;
    window.localStorage.setItem(KEY, current.id);
    window.dispatchEvent(new Event(EVENT));
  }, [hydrated, current]);

  function select(next: string) {
    window.localStorage.setItem(KEY, next);
    setSaved(next);
    window.dispatchEvent(new Event(EVENT));
  }

  async function create(name: string) {
    const brand = await post<WorkspaceBrand>('/brands', { name: name.trim() });
    await refresh('/catalog');
    select(brand.id);
    return brand;
  }

  return {
    id: current?.id ?? null,
    brand: current,
    brands,
    select,
    create,
    ready: catalog.data !== undefined || Boolean(catalog.error),
  };
}

export function WorkspaceSwitch({
  canCreate,
  layout = 'menu',
}: {
  canCreate: boolean;
  layout?: 'menu' | 'inline';
}) {
  const { brand, brands, select, create } = useWorkspace();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(layout === 'inline');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = brand?.name ?? 'Workspace';

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (!next) {
      setError('Name the workspace.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await create(next);
      setName('');
      if (layout === 'menu') setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That workspace was not created.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open || layout !== 'menu') return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, layout]);

  const list = (
    <div className={layout === 'menu' ? 'absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl border border-border bg-panel p-2 text-text shadow-lg' : 'mt-2 space-y-1'}>
      <p className="px-2 pb-1 text-[10px] font-extrabold tracking-[0.14em] text-muted">WORKSPACES</p>
      {brands.map((item) => (
        <button
          key={item.id}
          type="button"
          className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-medium hover:bg-panel2"
          aria-current={item.id === brand?.id ? 'true' : undefined}
          onClick={() => {
            select(item.id);
            if (layout === 'menu') setOpen(false);
          }}
        >
          <WorkspaceMark brand={item} />
          {item.name}
        </button>
      ))}
      {canCreate ? (
        <form className="mt-1 flex gap-1" onSubmit={(event) => void onCreate(event)}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New workspace"
            aria-label="New workspace name"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-bg px-2 text-sm"
          />
          <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-[#193d37] px-3 text-xs font-semibold text-[#f7ceab]">
            {busy ? '…' : 'Add'}
          </button>
        </form>
      ) : null}
      {error ? <p className="px-2 pt-1 text-xs text-bad">{error}</p> : null}
    </div>
  );

  if (layout === 'inline') {
    return (
      <div className="mb-4">
        <p className="text-sm font-semibold">{label}</p>
        {list}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 text-left font-medium text-text"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <WorkspaceMark brand={brand ?? { id: '', name: label }} />
        <span className="truncate">{label}</span>
      </button>
      {open ? list : null}
    </div>
  );
}

/** Header control. Visible on the phone, where the sidebar is hidden. */
export function WorkspaceBar({ canCreate }: { canCreate: boolean }) {
  const { brand, brands, select, create } = useWorkspace();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = brand?.name ?? '…';

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (!next) {
      setError('Name the workspace.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await create(next);
      setName('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That workspace was not created.');
    } finally {
      setBusy(false);
    }
  }

  const rect = open ? buttonRef.current?.getBoundingClientRect() : null;
  const menu =
    open && rect
      ? createPortal(
          <>
            <button type="button" aria-label="Close workspaces" className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              role="listbox"
              aria-label="Workspaces"
              className="fixed z-50 w-64 rounded-xl border border-border bg-panel p-2 text-text shadow-lg"
              style={{ top: rect.bottom + 8, left: Math.min(rect.left, Math.max(8, window.innerWidth - 272)) }}
            >
              {brands.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={item.id === brand?.id}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-medium hover:bg-panel2"
                  onClick={() => {
                    select(item.id);
                    setOpen(false);
                  }}
                >
                  <WorkspaceMark brand={item} />
                  {item.name}
                </button>
              ))}
              {canCreate ? (
                <form className="mt-1 flex gap-1" onSubmit={(event) => void onCreate(event)}>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="New workspace"
                    aria-label="New workspace name"
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-bg px-2 text-sm"
                  />
                  <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-[#193d37] px-3 text-xs font-semibold text-[#f7ceab]">
                    {busy ? '…' : 'Add'}
                  </button>
                </form>
              ) : null}
              {error ? <p className="px-2 pt-1 text-xs text-bad">{error}</p> : null}
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="flex min-w-0 max-w-[13rem] items-center gap-1.5 text-left text-sm md:max-w-none"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <WorkspaceMark brand={brand ?? { id: '', name: label }} />
        <span className="shrink-0 text-muted">Workspace</span>
        <span className="text-muted" aria-hidden>
          /
        </span>
        <span className="truncate font-medium text-text">{label}</span>
      </button>
      {menu}
    </>
  );
}
