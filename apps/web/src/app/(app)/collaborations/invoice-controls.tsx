'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '@/components/ui';
import { post, refresh } from '@/lib/api';
import { title } from '@/lib/format';

export const INVOICE_STATUS_CHOICES = ['ISSUED', 'CONFIRMED', 'PAID', 'SENT', 'OVERDUE', 'VOID'] as const;

const TONE: Record<string, string> = {
  ISSUED: 'bg-info/15 text-info',
  SENT: 'bg-info/15 text-info',
  CONFIRMED: 'bg-ok/15 text-ok',
  PAID: 'bg-ok/15 text-ok',
  PARTIALLY_PAID: 'bg-warn/15 text-warn',
  OVERDUE: 'bg-bad/15 text-bad',
  VOID: 'bg-bad/15 text-bad',
  DRAFT: 'bg-panel2 text-muted',
};

function StatusLabel({
  status,
  current,
  disabled,
  onClick,
}: {
  status: string;
  current?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={current}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        TONE[status] ?? 'bg-panel2 text-muted',
        current && 'ring-2 ring-accent ring-offset-1 ring-offset-panel',
        disabled && 'opacity-60',
      )}
    >
      {title(status)}
    </button>
  );
}

export function InvoiceStatusSelect({
  invoice,
}: {
  invoice: { id: string; invoiceNo: string; status: string };
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const place = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 220;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = rect.bottom + 6;
    const top = below + 96 > window.innerHeight ? Math.max(8, rect.top - 96) : below;
    setBox({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onDoc = (event: MouseEvent) => {
      const node = event.target as Node;
      if (root.current?.contains(node) || menu.current?.contains(node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const choose = async (status: string) => {
    setOpen(false);
    if (status === invoice.status) return;
    setBusy(true);
    try {
      await post(`/invoices/${invoice.id}/status`, { status });
      await refresh('/invoices', '/finance', '/deals', '/briefing', '/actions');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const choices = (INVOICE_STATUS_CHOICES as readonly string[]).includes(invoice.status)
    ? INVOICE_STATUS_CHOICES
    : [invoice.status, ...INVOICE_STATUS_CHOICES];

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={`Status for ${invoice.invoiceNo}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
        className={clsx(
          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          TONE[invoice.status] ?? 'bg-panel2 text-muted',
          busy && 'opacity-60',
        )}
      >
        {title(invoice.status)}
      </button>
      {open &&
        box &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={`Choose a status for ${invoice.invoiceNo}`}
            className="fixed z-50 flex w-52 flex-wrap gap-1.5 rounded-xl border border-border bg-panel p-2 shadow-lg"
            style={{ top: box.top, left: box.left }}
          >
            {choices.map((status) => (
              <StatusLabel
                key={status}
                status={status}
                current={status === invoice.status}
                disabled={busy}
                onClick={() => void choose(status)}
              />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
