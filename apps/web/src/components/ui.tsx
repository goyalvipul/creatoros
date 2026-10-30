'use client';

import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import {
  createContext,
  type ComponentProps,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ApiError } from '@/lib/api';
import { title as titleCase } from '@/lib/format';

/* ---------- Buttons ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  busy?: boolean;
};
export function Button({
  variant = 'secondary',
  size = 'md',
  busy,
  className,
  children,
  disabled,
  ...rest
}: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition select-none disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'min-h-8 px-2.5 text-xs' : 'min-h-10 px-3.5 text-sm',
        variant === 'primary' && 'bg-accent text-accentfg hover:opacity-90',
        variant === 'secondary' && 'border border-border bg-panel hover:bg-panel2',
        variant === 'ghost' && 'hover:bg-panel2',
        variant === 'danger' && 'border border-bad/40 text-bad hover:bg-bad/10',
        className,
      )}
    >
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** A button that runs an async action, shows progress and reports failures as a toast. */
export function ActionButton({
  onAction,
  success,
  children,
  confirm,
  ...rest
}: Omit<BtnProps, 'onClick'> & { onAction: () => Promise<unknown>; success?: string; confirm?: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button
      {...rest}
      busy={busy}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true);
        try {
          await onAction();
          if (success) toast.ok(success);
        } catch (e) {
          toast.error(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}

/* ---------- Form fields ---------- */
const field =
  'w-full rounded-lg border border-border bg-panel px-3 min-h-10 py-2 text-sm placeholder:text-muted/70 focus:border-accent';
export function Input(props: ComponentProps<'input'>) {
  return <input {...props} className={clsx(field, props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={clsx(field, props.className)} />;
}
export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={clsx(field, 'pr-8', props.className)}>
      {children}
    </select>
  );
}
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  // the control is nested inside the <label>, so it is programmatically labelled without needing ids
  return (
    <label className={clsx('block space-y-1', className)}>
      <span className="block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
      {error && <span className="block text-xs text-bad">{error}</span>}
    </label>
  );
}
export function Options({ values, none }: { values: readonly string[]; none?: string }) {
  return (
    <>
      {none !== undefined && <option value="">{none}</option>}
      {values.map((v) => (
        <option key={v} value={v}>
          {titleCase(v)}
        </option>
      ))}
    </>
  );
}

/* ---------- Layout bits ---------- */
export function Card({
  children,
  className,
  as: As = 'section',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
} & Omit<HTMLAttributes<HTMLElement>, 'as'>) {
  return (
    <As className={clsx('rounded-xl border border-border bg-panel p-4', className)} {...rest}>
      {children}
    </As>
  );
}
export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">{children}</h2>
      {action}
    </div>
  );
}
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  return (
    <div className="rounded-xl border border-border bg-panel p-3">
      <div className="text-xs text-muted">{label}</div>
      <div
        className={clsx(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'ok' && 'text-ok',
          tone === 'warn' && 'text-warn',
          tone === 'bad' && 'text-bad',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 p-4 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}…
    </div>
  );
}
export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg =
    error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{msg}</div>
      {retry && (
        <Button size="sm" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}
export function Notice({
  tone = 'info',
  children,
  title,
  dismissible = tone === 'info' || tone === 'ok',
  dismissKey,
  onDismiss,
}: {
  tone?: 'info' | 'warn' | 'bad' | 'ok';
  children: ReactNode;
  title?: string;
  /** Shows a close button. With `dismissKey` the choice is remembered in this browser. */
  dismissible?: boolean;
  dismissKey?: string;
  onDismiss?: () => void;
}) {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (dismissKey && localStorage.getItem(`notice:${dismissKey}`) === '1') setClosed(true);
  }, [dismissKey]);
  if (closed) return null;
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  const cls = {
    info: 'border-info/40 bg-info/10 text-text',
    warn: 'border-warn/40 bg-warn/10 text-text',
    bad: 'border-bad/40 bg-bad/10 text-text',
    ok: 'border-ok/40 bg-ok/10 text-text',
  }[tone];
  const ic = { info: 'text-info', warn: 'text-warn', bad: 'text-bad', ok: 'text-ok' }[tone];
  return (
    <div className={clsx('flex items-start gap-2 rounded-xl border p-3 text-sm', cls)}>
      <Icon className={clsx('mt-0.5 size-4 shrink-0', ic)} aria-hidden />
      <div className="min-w-0">
        {title && <div className="font-medium">{title}</div>}
        <div className="text-muted">{children}</div>
      </div>
      {dismissible && (
        <button
          type="button"
          aria-label="Close message"
          className="-m-1 ml-auto shrink-0 rounded p-1 text-muted hover:bg-panel2 hover:text-text focus-visible:outline focus-visible:outline-2"
          onClick={() => {
            if (dismissKey) localStorage.setItem(`notice:${dismissKey}`, '1');
            setClosed(true);
            onDismiss?.();
          }}
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/* ---------- Badges ---------- */
const tones: Record<string, string> = {
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  bad: 'bg-bad/15 text-bad',
  info: 'bg-info/15 text-info',
  neutral: 'bg-panel2 text-muted',
  accent: 'bg-accent/15 text-accent',
};
export function Badge({
  tone = 'neutral',
  children,
  title,
  className,
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATE_TONES: Record<string, keyof typeof tones> = {
  AVAILABLE: 'ok',
  ONLINE: 'ok',
  ACTIVE: 'ok',
  PUBLISHED: 'ok',
  PAID: 'ok',
  PAID_CLOSED: 'ok',
  SELECTED: 'ok',
  COMPLETED: 'ok',
  SUCCEEDED: 'ok',
  DONE: 'ok',
  VERIFIED: 'ok',
  APPROVED: 'ok',
  READY: 'ok',
  CONNECTED: 'ok',
  INDEXED: 'ok',
  OPEN: 'info',
  PLANNED: 'info',
  SCHEDULED: 'info',
  ISSUED: 'info',
  SENT: 'info',
  CONFIRMED: 'ok',
  NEW: 'info',
  DRAFT: 'neutral',
  IN_PROGRESS: 'info',
  IN_PRODUCTION: 'info',
  RUNNING: 'info',
  ARCHIVED: 'neutral',
  PENDING: 'neutral',
  STILL_WRITING: 'warn',
  MISSING_CANDIDATE: 'warn',
  DEVICE_OFFLINE: 'warn',
  OFFLINE: 'warn',
  UNREACHABLE: 'warn',
  PARTIAL_SYNC: 'warn',
  PAUSED: 'warn',
  NEED_REPLY: 'warn',
  OVERDUE: 'bad',
  HIGH: 'warn',
  URGENT: 'bad',
  USER_ENTERED: 'neutral',
  CONFIRMED_MISSING: 'bad',
  FAILED: 'bad',
  REVOKED: 'bad',
  ERROR: 'bad',
  BLOCKED_EXTERNAL: 'warn',
  UNCONFIGURED: 'neutral',
  NOT_CONFIGURED: 'neutral',
  PERMISSION_DENIED: 'bad',
  PROBE_FAILED: 'bad',
  LOST: 'bad',
  DECLINED: 'bad',
  VOID: 'bad',
  BEHIND: 'warn',
  AT_RISK: 'warn',
  ON_TRACK: 'ok',
  AHEAD: 'ok',
};
export function StateBadge({ state }: { state?: string | null }) {
  if (!state) return <Badge>—</Badge>;
  return <Badge tone={STATE_TONES[state] ?? 'neutral'}>{titleCase(state)}</Badge>;
}

const PROV: Record<string, { tone: keyof typeof tones; text: string; hint: string }> = {
  VERIFIED: {
    tone: 'ok',
    text: 'Verified',
    hint: 'Fetched from the platform with your authorised connection.',
  },
  VERIFIED_PLATFORM: {
    tone: 'ok',
    text: 'Verified by platform',
    hint: 'Fetched from the platform with your authorised connection.',
  },
  UNKNOWN: { tone: 'neutral', text: 'Unknown source', hint: 'Where this number came from was not recorded.' },
  USER_ENTERED: {
    tone: 'neutral',
    text: 'Entered by you',
    hint: 'You typed this in; it has not been checked against the platform.',
  },
  ESTIMATED: { tone: 'warn', text: 'Estimated', hint: 'Derived from other data and may be incomplete.' },
  IMPORTED: { tone: 'info', text: 'Imported', hint: 'Imported from a file or another system.' },
};
export function Provenance({ value }: { value?: string | null }) {
  const p = PROV[value ?? ''] ?? { tone: 'neutral' as const, text: titleCase(value ?? 'unknown'), hint: '' };
  return (
    <Badge tone={p.tone} title={p.hint}>
      {p.text}
    </Badge>
  );
}

/* ---------- Tabs ---------- */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; badge?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-border bg-panel p-1"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            'flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium',
            value === t.id ? 'bg-accent text-accentfg' : 'text-muted hover:bg-panel2',
          )}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

/* ---------- Dialog / drawer ---------- */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className={clsx(
        'm-auto w-[calc(100vw-1.5rem)] rounded-2xl border border-border bg-panel p-0 text-text shadow-2xl backdrop:backdrop-blur-sm',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="grid size-9 place-items-center rounded-lg hover:bg-panel2"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="overflow-y-auto p-4">{children}</div>
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>
          )}
        </div>
      )}
    </dialog>
  );
}

/** Dialog containing a form with submit handling, busy state and error display. */
export function FormDialog({
  open,
  onClose,
  title,
  submitLabel = 'Save',
  onSubmit,
  children,
  wide,
  danger,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel?: string;
  onSubmit: () => Promise<unknown>;
  children: ReactNode;
  wide?: boolean;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      wide={wide}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onSubmit();
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        {children}
        {error != null && <ErrorNote error={error} />}
      </form>
    </Dialog>
  );
}

/* ---------- Toasts ---------- */
type Toast = { id: number; tone: 'ok' | 'bad'; text: string };
const ToastCtx = createContext<{ ok: (t: string) => void; error: (e: unknown) => void }>({
  ok: () => {},
  error: () => {},
});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, tone, text }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), tone === 'bad' ? 8000 : 3500);
  }, []);
  const api = {
    ok: (t: string) => push('ok', t),
    error: (e: unknown) => push('bad', e instanceof Error ? e.message : String(e)),
  };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-3 md:bottom-6"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'bad' ? 'alert' : 'status'}
            className={clsx(
              'pointer-events-auto max-w-md rounded-xl border px-4 py-2.5 text-sm shadow-lg',
              t.tone === 'ok' ? 'border-ok/40 bg-panel text-text' : 'border-bad/50 bg-panel text-bad',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Data helpers ---------- */
export function Async<T>({
  res,
  children,
  empty,
}: {
  res: { data?: T; error?: unknown; isLoading: boolean; mutate: () => unknown };
  children: (d: T) => ReactNode;
  empty?: ReactNode;
}) {
  if (res.error && !res.data) return <ErrorNote error={res.error} retry={() => void res.mutate()} />;
  if (res.isLoading && !res.data) return <Spinner />;
  if (
    res.data === undefined ||
    res.data === null ||
    (empty !== undefined && Array.isArray(res.data) && res.data.length === 0)
  )
    return <>{empty ?? null}</>;
  return <>{children(res.data)}</>;
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DefinitionTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="ml-1 inline-grid size-4 cursor-help place-items-center rounded-full bg-panel2 text-[10px] text-muted"
      aria-label={text}
    >
      ?
    </span>
  );
}

export function Table({
  head,
  children,
  className,
}: {
  head: ReactNode[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('overflow-x-auto rounded-xl border border-border', className)}>
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="bg-panel2 text-xs text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-panel">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={clsx('px-3 py-2 align-top', className)}>{children}</td>
);
