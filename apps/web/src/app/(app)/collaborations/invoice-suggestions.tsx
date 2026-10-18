'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ActionButton, Badge, Button, Field, FormDialog, Input, Select, Textarea } from '@/components/ui';
import { post, refresh, useApi } from '@/lib/api';
import { ago, dateInput, money, toMinor } from '@/lib/format';

const DIRECTION: Record<string, string> = {
  SENT_BY_ME: 'You sent this',
  BILL_TO_ME: 'Looks like a bill to you',
  PAYMENT_NOTICE: 'Looks like a payment notice',
  UNKNOWN: 'Direction unclear',
};

export function SuggestionCard({ s }: { s: any }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{s.invoiceNo ?? 'No invoice number'}</span>
          <span className="text-sm">
            {s.amountMinor ? money(s.amountMinor, s.currency ?? 'CAD') : 'amount not found'}
          </span>
          <Badge tone={s.direction === 'SENT_BY_ME' ? 'info' : 'neutral'}>
            {DIRECTION[s.direction] ?? s.direction}
          </Badge>
          <Badge>{Math.round(s.confidence * 100)}% sure</Badge>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted">
          <Link href={`/collaborations/threads/${s.threadId}`} className="text-accent hover:underline">
            {s.subject ?? '(no subject)'}
          </Link>
          {s.counterparty ? ` · ${s.counterparty}` : ''} · {ago(s.receivedAt)}
          {s.mailbox ? ` · ${s.mailbox}` : ''}
          {s.dueAt ? ` · due ${dateInput(s.dueAt)}` : ''}
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        Review &amp; add
      </Button>
      <ActionButton
        size="sm"
        onAction={async () => {
          await post(`/mail/invoice-suggestions/${s.id}/dismiss`);
          await refresh('/mail');
        }}
      >
        Not an invoice
      </ActionButton>
      <AcceptDialog s={s} open={open} onClose={() => setOpen(false)} />
    </li>
  );
}

function AcceptDialog({ s, open, onClose }: { s: any; open: boolean; onClose: () => void }) {
  const deals = useApi<any[]>('/deals', { query: { limit: 200 } });
  const [f, setF] = useState({
    as: s.direction === 'BILL_TO_ME' ? 'EXPENSE' : 'INVOICE',
    invoiceNo: s.invoiceNo ?? '',
    amount: s.amountMinor ? (s.amountMinor / 100).toFixed(2) : '',
    currency: s.currency ?? 'CAD',
    dueAt: s.dueAt ? dateInput(s.dueAt) : '',
    dealId: '',
    notes: '',
  });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Add from email"
      submitLabel={f.as === 'INVOICE' ? 'Add invoice' : 'Add expense'}
      onSubmit={async () => {
        const amountMinor = toMinor(f.amount);
        if (!amountMinor) throw new Error('Enter the amount from the email.');
        await post(`/mail/invoice-suggestions/${s.id}/accept`, {
          as: f.as,
          invoiceNo: f.invoiceNo.trim() || null,
          amountMinor,
          currency: f.currency.toUpperCase(),
          dueAt: f.dueAt || null,
          dealId: f.dealId || null,
          notes: f.notes.trim() || undefined,
        });
        await refresh('/mail', '/invoices', '/finance', '/deals');
      }}
    >
      <p className="text-xs text-muted">
        Found in “{s.subject ?? 'an email'}”. Check the numbers against the original; nothing is added until
        you confirm.
      </p>
      <Field label="Add as">
        <Select value={f.as} onChange={(e) => setF({ ...f, as: e.target.value })}>
          <option value="INVOICE">Invoice (money owed to me)</option>
          <option value="EXPENSE">Expense (money I paid or owe)</option>
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Invoice no.">
          <Input value={f.invoiceNo} onChange={(e) => setF({ ...f, invoiceNo: e.target.value })} />
        </Field>
        <Field label="Amount">
          <Input
            required
            inputMode="decimal"
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
          />
        </Field>
        <Field label="Currency">
          <Input
            maxLength={3}
            value={f.currency}
            onChange={(e) => setF({ ...f, currency: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Due date">
          <Input type="date" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} />
        </Field>
        <Field label="Deal">
          <Select value={f.dealId} onChange={(e) => setF({ ...f, dealId: e.target.value })}>
            <option value="">No deal</option>
            {(deals.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Note (optional)">
        <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} />
      </Field>
    </FormDialog>
  );
}
