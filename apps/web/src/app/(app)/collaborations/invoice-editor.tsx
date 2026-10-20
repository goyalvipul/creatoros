'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMe } from '@/components/shell';
import { Button, ErrorNote, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import { patch, post, refresh, useApi } from '@/lib/api';
import { dateInput, money, toMinor } from '@/lib/format';

type LineForm = { description: string; quantity: string; unitPrice: string; taxPercent: string };

type InvoiceForm = {
  invoiceNo: string;
  issuedAt: string;
  dueAt: string;
  currency: string;
  dealId: string;
  billFrom: string;
  billTo: string;
  bankDetails: string;
  notes: string;
  draft: boolean;
  lines: LineForm[];
};

const blankLine = (): LineForm => ({ description: '', quantity: '1', unitPrice: '', taxPercent: '0' });

function blankForm(from = ''): InvoiceForm {
  const issued = new Date();
  const due = new Date(issued.getTime() + 30 * 86400_000);
  return {
    invoiceNo: '',
    issuedAt: dateInput(issued),
    dueAt: dateInput(due),
    currency: 'USD',
    dealId: '',
    billFrom: from,
    billTo: '',
    bankDetails: '',
    notes: '',
    draft: false,
    lines: [blankLine()],
  };
}

function priced(lines: LineForm[]) {
  return lines.map((line) => {
    const quantity = Number(line.quantity);
    const unit = toMinor(line.unitPrice);
    const taxPercent = Number(line.taxPercent);
    const net = Number.isFinite(quantity) && unit != null ? Math.round(quantity * unit) : 0;
    const tax = Number.isFinite(taxPercent) ? Math.round((net * taxPercent) / 100) : 0;
    return { net, tax, amount: net + tax };
  });
}

export function InvoiceEditor({ invoiceId }: { invoiceId?: string }) {
  const router = useRouter();
  const me = useMe();
  const existing = useApi<any>(invoiceId ? `/invoices/${invoiceId}` : null);
  const deals = useApi<any[]>('/deals', { query: { limit: 200 } });
  const [form, setForm] = useState<InvoiceForm | null>(invoiceId ? null : blankForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const seededFrom = useRef(false);

  useEffect(() => {
    if (invoiceId || seededFrom.current || !me.data) return;
    seededFrom.current = true;
    setForm((current) =>
      current && !current.billFrom ? { ...current, billFrom: me.data.organization.name } : current,
    );
  }, [invoiceId, me.data]);

  useEffect(() => {
    if (!invoiceId || !existing.data || form) return;
    const inv = existing.data;
    const lines = (inv.lines ?? []) as any[];
    setForm({
      invoiceNo: inv.invoiceNo ?? '',
      issuedAt: inv.issuedAt ? dateInput(inv.issuedAt) : '',
      dueAt: inv.dueAt ? dateInput(inv.dueAt) : '',
      currency: inv.currency ?? 'USD',
      dealId: inv.dealId ?? '',
      billFrom: inv.billFrom ?? '',
      billTo: inv.billTo ?? '',
      bankDetails: inv.bankDetails ?? '',
      notes: inv.notes ?? '',
      draft: inv.status === 'DRAFT',
      lines: lines.length
        ? lines.map((line) => ({
            description: line.description ?? '',
            quantity: String(Number(line.quantity)),
            unitPrice: (Number(line.unitPriceMinor) / 100).toFixed(2),
            taxPercent: String(Number(line.taxPercent)),
          }))
        : [
            {
              description: '',
              quantity: '1',
              unitPrice: (Number(inv.amountMinor) / 100).toFixed(2),
              taxPercent: '0',
            },
          ],
    });
  }, [invoiceId, existing.data, form]);

  if (invoiceId && existing.error && !existing.data) {
    return <ErrorNote error={existing.error} retry={() => void existing.mutate()} />;
  }
  if (!form) return <Spinner />;

  const totals = priced(form.lines);
  const subtotal = totals.reduce((sum, row) => sum + row.net, 0);
  const tax = totals.reduce((sum, row) => sum + row.tax, 0);
  const due = subtotal + tax;
  const set = (patch: Partial<InvoiceForm>) => setForm({ ...form, ...patch });
  const setLine = (index: number, patch: Partial<LineForm>) =>
    set({ lines: form.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)) });

  const save = async () => {
    const lines = form.lines.map((line) => {
      const unitPriceMinor = toMinor(line.unitPrice);
      const quantity = Number(line.quantity);
      const taxPercent = Number(line.taxPercent);
      if (!line.description.trim()) throw new Error('Each line needs a description.');
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be greater than zero.');
      if (unitPriceMinor == null) throw new Error('Enter a unit price for every line.');
      if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100)
        throw new Error('Tax percent must be between 0 and 100.');
      return { description: line.description.trim(), quantity, unitPriceMinor, taxPercent };
    });
    const body = {
      invoiceNo: form.invoiceNo.trim() || undefined,
      currency: form.currency.trim().toUpperCase(),
      issuedAt: form.issuedAt || null,
      dueAt: form.dueAt || null,
      dealId: form.dealId || null,
      billFrom: form.billFrom.trim() || null,
      billTo: form.billTo.trim() || null,
      bankDetails: form.bankDetails.trim() || null,
      notes: form.notes.trim() || null,
      lines,
      ...(invoiceId ? {} : { draft: form.draft }),
    };
    setBusy(true);
    setError(null);
    try {
      if (invoiceId) {
        await patch(`/invoices/${invoiceId}`, body);
        await refresh('/invoices', `/invoices/${invoiceId}`, '/finance', '/deals');
      } else {
        const created = await post<any>('/invoices', body);
        await refresh('/invoices', '/finance', '/deals');
        router.replace(`/collaborations/invoices/${created.id}`);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mx-auto max-w-4xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-sm">
        <Link href="/collaborations?tab=invoices" className="text-accent">
          ← Invoices
        </Link>
      </p>
      <div className="rounded-2xl border border-border bg-panel p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold">Invoice</h1>
          <Field label="Currency">
            <Input
              required
              maxLength={3}
              className="w-24"
              disabled={Number(existing.data?.paidTotalMinor ?? 0) > 0}
              value={form.currency}
              onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
            />
          </Field>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Date">
            <Input type="date" value={form.issuedAt} onChange={(e) => set({ issuedAt: e.target.value })} />
          </Field>
          <Field label="Due">
            <Input type="date" value={form.dueAt} onChange={(e) => set({ dueAt: e.target.value })} />
          </Field>
          <Field label="Invoice #">
            <Input
              value={form.invoiceNo}
              placeholder="Assigned if left blank"
              onChange={(e) => set({ invoiceNo: e.target.value })}
            />
          </Field>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="From">
            <Textarea
              rows={5}
              value={form.billFrom}
              placeholder={'Your company\nStreet\nCity, region\nPostal code'}
              onChange={(e) => set({ billFrom: e.target.value })}
            />
          </Field>
          <Field label="To">
            <Textarea
              rows={5}
              value={form.billTo}
              placeholder={'Client name\nStreet\nCity\nPostal code\nCountry\nemail@client.com'}
              onChange={(e) => set({ billTo: e.target.value })}
            />
          </Field>
        </div>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 pr-2 font-medium">Description</th>
                <th className="w-20 py-2 pr-2 font-medium">Quantity</th>
                <th className="w-28 py-2 pr-2 font-medium">Unit price</th>
                <th className="w-20 py-2 pr-2 font-medium">Tax %</th>
                <th className="w-28 py-2 pr-2 font-medium">Amount</th>
                <th className="w-16 py-2" />
              </tr>
            </thead>
            <tbody>
              {form.lines.map((line, index) => (
                <tr key={index} className="border-b border-border/70 align-top">
                  <td className="py-2 pr-2">
                    <Textarea
                      rows={2}
                      aria-label={`Description ${index + 1}`}
                      value={line.description}
                      onChange={(e) => setLine(index, { description: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      inputMode="decimal"
                      aria-label={`Quantity ${index + 1}`}
                      value={line.quantity}
                      onChange={(e) => setLine(index, { quantity: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      inputMode="decimal"
                      aria-label={`Unit price ${index + 1}`}
                      value={line.unitPrice}
                      onChange={(e) => setLine(index, { unitPrice: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      inputMode="decimal"
                      aria-label={`Tax percent ${index + 1}`}
                      value={line.taxPercent}
                      onChange={(e) => setLine(index, { taxPercent: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-2 pt-3">{money(totals[index]?.amount ?? 0, form.currency || 'USD')}</td>
                  <td className="py-2">
                    {form.lines.length > 1 && (
                      <Button type="button" size="sm" onClick={() => set({ lines: form.lines.filter((_, i) => i !== index) })}>
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button type="button" className="mt-3" onClick={() => set({ lines: [...form.lines, blankLine()] })}>
          Add line
        </Button>
        <dl className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd>{money(subtotal, form.currency || 'USD')}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Tax</dt>
            <dd>{money(tax, form.currency || 'USD')}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-1 font-semibold">
            <dt>Amount due</dt>
            <dd>{money(due, form.currency || 'USD')}</dd>
          </div>
        </dl>
        <div className="mt-6">
          <Field label="Pay to account details" hint="Bank name, account name, account number, routing or IBAN, and the rail such as ACH or wire.">
            <Textarea
              rows={5}
              value={form.bankDetails}
              placeholder={'ACH\nBank name\nAccount name\nAccount number\nRouting number'}
              onChange={(e) => set({ bankDetails: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <Field label="Deal">
        <Select value={form.dealId} onChange={(e) => set({ dealId: e.target.value })}>
          <option value="">No deal</option>
          {(deals.data ?? []).map((deal) => (
            <option key={deal.id} value={deal.id}>
              {deal.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Internal notes">
        <Textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
      {!invoiceId && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.draft} onChange={(e) => set({ draft: e.target.checked })} />
          Save as draft (do not issue yet)
        </label>
      )}
      {error ? <ErrorNote error={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={() => router.push('/collaborations?tab=invoices')}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {invoiceId ? 'Save invoice' : 'Create invoice'}
        </Button>
      </div>
    </form>
  );
}
