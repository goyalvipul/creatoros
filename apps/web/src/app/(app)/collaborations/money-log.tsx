'use client';

import { useRef, useState } from 'react';
import { useMe } from '@/components/shell';
import { ActionButton, Async, Button, EmptyState, Field, Input, Select, Stat, Table, Td, Textarea } from '@/components/ui';
import { del, patch, post, refresh, useApi } from '@/lib/api';
import { dateInput, money, title as titleCase, toMinor, when } from '@/lib/format';

const BUSINESS = ['SOFTWARE', 'GPU_COMPUTE', 'MUSIC', 'TALENT', 'ADS', 'TRAVEL', 'OTHER'] as const;
const PERSONAL = ['MEDICAL', 'CHARITY', 'HOME_OFFICE', 'EDUCATION', 'PROFESSIONAL', 'CHILDCARE', 'TRANSIT', 'SUPPLIES', 'OTHER'] as const;

type Row = {
  id: string;
  description: string | null;
  amountMinor: number;
  currency: string;
  category: string;
  taxCategory: string | null;
  incurredAt: string;
  notes: string | null;
  hasReceipt: boolean;
  baseCurrency: string;
  baseAmountMinor: number | null;
};

function yearIn(tz: string) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(new Date()));
}

export function ExpensesTab() {
  const fin = useApi<any>('/finance/summary');
  const rows = useApi<Row[]>('/expenses', { query: { scope: 'BUSINESS' } });
  const [editing, setEditing] = useState<Row | null>(null);
  return (
    <div className="space-y-5">
      <Async res={fin}>
        {(s) => {
          const cur = s.baseCurrency ?? 'CAD';
          const c = s.converted;
          const paid = c?.receivedMinor ?? null;
          const spent = c?.expensesMinor ?? null;
          const earnings = paid != null && spent != null ? paid - spent : null;
          return (
            <section aria-label="Earnings" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label="Paid" value={paid != null ? money(paid, cur) : 'Add exchange rates'} tone="ok" />
              <Stat label="Expenses" value={spent != null ? money(spent, cur) : '—'} />
              <Stat label="Earnings" value={earnings != null ? money(earnings, cur) : '—'} tone={earnings != null && earnings < 0 ? 'bad' : 'ok'} />
            </section>
          );
        }}
      </Async>
      <p className="text-sm text-muted">Paid is every invoice marked Paid. Earnings are that amount minus these business expenses. Personal tax entries are not included.</p>
      <ExpenseForm key={editing?.id ?? 'new'} scope="BUSINESS" editing={editing} onDone={() => setEditing(null)} />
      <ExpenseTable rows={rows} kind="BUSINESS" onEdit={setEditing} />
    </div>
  );
}

export function PersonalTaxesTab() {
  const me = useMe();
  const tz = me.data?.organization?.timezone || 'America/Vancouver';
  const [year, setYear] = useState(() => yearIn('America/Vancouver'));
  const [editing, setEditing] = useState<Row | null>(null);
  const rows = useApi<Row[]>('/expenses', { query: { scope: 'PERSONAL', year } });
  const years = Array.from({ length: 7 }, (_, i) => yearIn(tz) - i);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">
          Personal costs for year-end taxes. These stay off the business earnings total.
        </p>
        <Field label="Year">
          <Select aria-label="Tax year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Async res={rows}>
        {(items) => {
          const list = Array.isArray(items) ? items : [];
          const cur = list[0]?.baseCurrency ?? 'CAD';
          const missing = list.some((row) => row.baseAmountMinor == null);
          const total = list.reduce((sum, row) => sum + (row.baseAmountMinor ?? 0), 0);
          const by = new Map<string, number>();
          for (const row of list) {
            const key = row.taxCategory || 'OTHER';
            by.set(key, (by.get(key) ?? 0) + (row.baseAmountMinor ?? 0));
          }
          return (
            <section aria-label="Tax year total" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Stat label={`${year} total`} value={missing ? 'A rate is missing' : money(total, cur)} />
              <Stat label="Entries" value={String(list.length)} />
              {by.size > 0 ? (
                <ul className="sm:col-span-2 grid gap-1 text-sm">
                  {[...by.entries()].map(([name, amount]) => (
                    <li key={name} className="flex justify-between gap-3">
                      <span>{titleCase(name)}</span>
                      <span>{missing ? '—' : money(amount, cur)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        }}
      </Async>
      <ExpenseForm key={editing?.id ?? 'new'} scope="PERSONAL" year={year} editing={editing} onDone={() => setEditing(null)} />
      <ExpenseTable rows={rows} kind="PERSONAL" onEdit={setEditing} />
    </div>
  );
}

function ExpenseForm({
  scope,
  year,
  editing,
  onDone,
}: {
  scope: 'BUSINESS' | 'PERSONAL';
  year?: number;
  editing?: Row | null;
  onDone?: () => void;
}) {
  const categories = scope === 'PERSONAL' ? PERSONAL : BUSINESS;
  const [description, setDescription] = useState(editing?.description ?? '');
  const [amount, setAmount] = useState(editing ? (editing.amountMinor / 100).toFixed(2) : '');
  const [currency, setCurrency] = useState(editing?.currency ?? 'CAD');
  const [category, setCategory] = useState<string>(
    editing ? (scope === 'PERSONAL' ? editing.taxCategory || 'OTHER' : editing.category) : categories[0],
  );
  const [incurredAt, setIncurredAt] = useState(editing ? dateInput(editing.incurredAt) : dateInput(new Date()));
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [photo, setPhoto] = useState<{ type: string; base64: string; preview: string } | null>(
    editing?.hasReceipt ? { type: 'image/jpeg', base64: '', preview: `/api/v1/expenses/${editing.id}/receipt` } : null,
  );
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  function take(file: File | undefined) {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose a photo.');
      return;
    }
    if (file.size > 8_000_000) {
      setError('That photo must be under 8 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const preview = String(reader.result ?? '');
      setPhoto({ type: file.type || 'image/jpeg', base64: preview.split(',')[1] ?? '', preview });
    };
    reader.readAsDataURL(file);
    setRemoveReceipt(false);
  }

  return (
    <form
      className="grid gap-3 rounded-xl border border-border p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const amountMinor = toMinor(amount);
        if (amountMinor == null || amountMinor <= 0) {
          setError('Enter an amount greater than zero.');
          return;
        }
        setBusy(true);
        setError('');
        try {
          const body = {
            description,
            amountMinor,
            currency,
            category: scope === 'BUSINESS' ? category : undefined,
            taxCategory: scope === 'PERSONAL' ? category : undefined,
            incurredAt: incurredAt ? new Date(`${incurredAt}T12:00:00`).toISOString() : null,
            notes: notes || null,
            receiptBase64: photo?.base64 || null,
            receiptType: photo?.base64 ? photo.type : null,
            removeReceipt,
          };
          if (editing) await patch(`/expenses/${editing.id}`, body);
          else await post('/expenses', { ...body, scope });
          setDescription('');
          setAmount('');
          setNotes('');
          setPhoto(null);
          setRemoveReceipt(false);
          onDone?.();
          await refresh('/expenses', '/finance');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'That expense was not saved.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What it was">
          <Input required value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Amount">
          <Input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Currency">
          <Input value={currency} maxLength={8} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Date">
          <Input type="date" required value={incurredAt} onChange={(e) => setIncurredAt(e.target.value)} />
        </Field>
        <Field label={scope === 'PERSONAL' ? 'Tax category' : 'Category'}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((item) => (
              <option key={item} value={item}>
                {titleCase(item)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Notes">
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={camera} className="sr-only" type="file" accept="image/*" capture="environment" onChange={(e) => take(e.target.files?.[0])} />
        <input ref={library} className="sr-only" type="file" accept="image/*" onChange={(e) => take(e.target.files?.[0])} />
        <Button type="button" onClick={() => camera.current?.click()}>
          Take a photo
        </Button>
        <Button type="button" onClick={() => library.current?.click()}>
          Choose a photo
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {editing ? 'Save' : 'Log expense'}
        </Button>
        {editing ? (
          <Button
            type="button"
            onClick={() => {
              onDone?.();
            }}
          >
            Cancel
          </Button>
        ) : null}
        {photo?.preview && !photo.base64 ? (
          <Button
            type="button"
            onClick={() => {
              setPhoto(null);
              setRemoveReceipt(true);
            }}
          >
            Remove photo
          </Button>
        ) : null}
        {year && !editing ? <span className="text-xs text-muted">Saved in {year} when the date is in that year.</span> : null}
      </div>
      {photo ? <img src={photo.preview} alt="Receipt" className="h-24 w-24 rounded object-cover" /> : null}
      {error ? <p className="text-sm text-bad">{error}</p> : null}
    </form>
  );
}

function ExpenseTable({
  rows,
  kind,
  onEdit,
}: {
  rows: ReturnType<typeof useApi<Row[]>>;
  kind: 'BUSINESS' | 'PERSONAL';
  onEdit: (row: Row) => void;
}) {
  return (
    <Async
      res={rows}
      empty={<EmptyState title="Nothing logged yet">Add an amount, or attach a photo of the receipt.</EmptyState>}
    >
      {(items) => (
        <Table head={['Date', 'What', 'Category', 'Amount', 'Receipt', '']}>
          {(Array.isArray(items) ? items : []).map((row) => (
            <tr key={row.id}>
              <Td>{when(row.incurredAt, undefined, false)}</Td>
              <Td>
                <div className="font-medium">{row.description}</div>
                {row.notes ? <div className="text-xs text-muted">{row.notes}</div> : null}
              </Td>
              <Td>{titleCase(kind === 'PERSONAL' ? row.taxCategory || 'OTHER' : row.category)}</Td>
              <Td>
                {money(row.amountMinor, row.currency)}
                {row.baseAmountMinor != null && row.currency !== row.baseCurrency ? (
                  <span className="block text-xs text-muted">{money(row.baseAmountMinor, row.baseCurrency)}</span>
                ) : null}
              </Td>
              <Td>
                {row.hasReceipt ? (
                  <a className="text-accent" href={`/api/v1/expenses/${row.id}/receipt`} target="_blank" rel="noreferrer">
                    Photo
                  </a>
                ) : (
                  '—'
                )}
              </Td>
              <Td>
                <div className="flex justify-end gap-1.5">
                <Button size="sm" onClick={() => onEdit(row)}>
                  Edit
                </Button>
                <ActionButton
                  size="sm"
                  variant="danger"
                  confirm="Remove this expense?"
                  onAction={async () => {
                    await del(`/expenses/${row.id}`);
                    await refresh('/expenses', '/finance');
                  }}
                >
                  Delete
                </ActionButton>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Async>
  );
}
