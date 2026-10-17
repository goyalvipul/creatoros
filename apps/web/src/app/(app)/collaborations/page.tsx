'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Suspense, useState } from 'react';
import { useMe } from '@/components/shell';
import { Async, Badge, Button, Card, CardTitle, EmptyState, Field, FormDialog, Input, Notice, Options, PageHeader, Select, Spinner, Stat, StateBadge, Table, Tabs, Td, Textarea } from '@/components/ui';
import { post, refresh, useApi } from '@/lib/api';
import { ago, money, title as titleCase, toMinor, when } from '@/lib/format';
import { PRIORITIES } from '@/lib/options';

type Tab = 'inbox' | 'pipeline' | 'invoices' | 'partners';

export default function CollaborationsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Collaborations />
    </Suspense>
  );
}

function Collaborations() {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = (['inbox', 'pipeline', 'invoices', 'partners'] as const).find((t) => t === sp.get('tab')) ?? 'inbox';
  const [tab, setTabState] = useState<Tab>(initial);
  const setTab = (t: Tab) => { setTabState(t); router.replace(`/collaborations?tab=${t}`); };
  const [intake, setIntake] = useState(false);
  const [newDeal, setNewDeal] = useState(false);

  return (
    <>
      <PageHeader
        title="Collaborations"
        subtitle="Brand inquiries, deals, deliverables and money. A suggestion never creates a deal; you confirm every one."
        actions={<><Button onClick={() => setNewDeal(true)}><Plus className="size-4" /> New deal</Button><Button variant="primary" onClick={() => setIntake(true)}><Plus className="size-4" /> Log inquiry</Button></>}
      />
      <Tabs tabs={[{ id: 'inbox', label: 'Inbox' }, { id: 'pipeline', label: 'Pipeline' }, { id: 'invoices', label: 'Invoices & money' }, { id: 'partners', label: 'Partners' }]} value={tab} onChange={setTab} />
      {tab === 'inbox' && <Inbox />}
      {tab === 'pipeline' && <Pipeline />}
      {tab === 'invoices' && <Invoices />}
      {tab === 'partners' && <Partners />}
      <IntakeDialog open={intake} onClose={() => setIntake(false)} />
      <NewDealDialog open={newDeal} onClose={() => setNewDeal(false)} />
    </>
  );
}

function IntakeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ brand: '', contactName: '', contactEmail: '', subject: '', notes: '', offerType: 'UNKNOWN', value: '', currency: 'CAD' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <FormDialog open={open} onClose={onClose} title="Log an inquiry" submitLabel="Log inquiry" onSubmit={async () => {
      await post('/intake', { brand: f.brand.trim(), contactName: f.contactName.trim() || undefined, contactEmail: f.contactEmail.trim() || undefined, subject: f.subject.trim(), notes: f.notes.trim() || undefined, offerType: f.offerType, valueMinor: f.value ? (toMinor(f.value) ?? undefined) : undefined, currency: f.currency.toUpperCase(), source: 'MANUAL' });
      setF({ brand: '', contactName: '', contactEmail: '', subject: '', notes: '', offerType: 'UNKNOWN', value: '', currency: 'CAD' });
      await refresh('/threads', '/briefing', '/organizations');
    }}>
      <p className="text-sm text-muted">Paste an inquiry that came in by DM, WhatsApp or email. It lands in the inbox for triage.</p>
      <Field label="Brand / company"><Input required autoFocus value={f.brand} onChange={set('brand')} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact name"><Input value={f.contactName} onChange={set('contactName')} /></Field>
        <Field label="Contact e-mail"><Input type="email" value={f.contactEmail} onChange={set('contactEmail')} /></Field>
      </div>
      <Field label="Subject"><Input required value={f.subject} onChange={set('subject')} /></Field>
      <Field label="Message / notes"><Textarea rows={4} value={f.notes} onChange={set('notes')} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Offer type"><Select value={f.offerType} onChange={set('offerType')}><Options values={['UNKNOWN', 'FLAT_FEE', 'GIFTED', 'AFFILIATE', 'COMMISSION', 'MIXED']} /></Select></Field>
        <Field label="Offered amount"><Input inputMode="decimal" value={f.value} onChange={set('value')} /></Field>
        <Field label="Currency"><Input maxLength={3} value={f.currency} onChange={set('currency')} /></Field>
      </div>
    </FormDialog>
  );
}

function NewDealDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ title: '', value: '', currency: 'CAD', priority: 'NORMAL', termsDays: '30' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <FormDialog open={open} onClose={onClose} title="New deal" submitLabel="Create deal" onSubmit={async () => {
      const d = await post('/deals', { title: f.title.trim(), contractedValueMinor: f.value ? (toMinor(f.value) ?? undefined) : undefined, currency: f.currency.toUpperCase(), priority: f.priority, paymentTermsDays: Number(f.termsDays) || undefined, stage: 'QUALIFIED' });
      await refresh('/deals');
      onClose();
      router.push(`/collaborations/deals/${d.id}`);
    }}>
      <Field label="Title"><Input required autoFocus value={f.title} onChange={set('title')} placeholder="e.g. Brand X — 2 reels" /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Agreed amount"><Input inputMode="decimal" value={f.value} onChange={set('value')} /></Field>
        <Field label="Currency"><Input maxLength={3} value={f.currency} onChange={set('currency')} /></Field>
        <Field label="Payment terms (days)"><Input type="number" min={0} value={f.termsDays} onChange={set('termsDays')} /></Field>
      </div>
      <Field label="Priority"><Select value={f.priority} onChange={set('priority')}><Options values={PRIORITIES} /></Select></Field>
    </FormDialog>
  );
}

function Inbox() {
  const [state, setState] = useState('');
  const [triage, setTriage] = useState('');
  const threads = useApi<any[]>('/threads', { query: { state: state || undefined, triage: triage || undefined, limit: 100 } });
  const me = useMe();
  const tz = me.data?.organization?.timezone;
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select aria-label="Reply state" value={state} onChange={(e) => setState(e.target.value)}><Options values={['NEED_REPLY', 'WAITING_FOR_BRAND', 'WAITING_FOR_USER', 'DONE']} none="Any reply state" /></Select>
        <Select aria-label="Triage" value={triage} onChange={(e) => setTriage(e.target.value)}><Options values={['POSSIBLE', 'CONFIRMED', 'DISMISSED', 'MERGED']} none="Any triage state" /></Select>
      </div>
      <Async res={threads} empty={<EmptyState title="No conversations">Log an inquiry, or connect Gmail in Integrations to bring brand e-mail in (read-only).</EmptyState>}>
        {(rows) => (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-panel">
            {rows.map((t) => (
              <li key={t.id}>
                <Link href={`/collaborations/threads/${t.id}`} className="block px-3 py-3 hover:bg-panel2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{t.subject}</span>
                    <StateBadge state={t.state} />
                    {t.triageState === 'POSSIBLE' && <Badge tone="warn">review</Badge>}
                    {t.dealId && <Badge tone="info">deal</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">{t.fromEmail} · {t.preview}</div>
                  <div className="mt-0.5 text-xs text-muted">{t.lastInboundAt ? `Last message ${ago(t.lastInboundAt)}` : ''}{t.snoozeUntil ? ` · snoozed until ${when(t.snoozeUntil, tz)}` : ''}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </>
  );
}

function Pipeline() {
  const res = useApi<any>('/deals/pipeline');
  return (
    <Async res={res}>
      {(p) => {
        const cols = p.columns.filter((c: any) => c.count > 0 || ['QUALIFIED', 'NEGOTIATING', 'IN_PRODUCTION', 'AWAITING_PAYMENT'].includes(c.stage));
        if (p.columns.every((c: any) => c.count === 0)) return <EmptyState title="No deals yet">Confirm an inquiry from the inbox or create a deal.</EmptyState>;
        return (
          <div className="flex gap-3 overflow-x-auto pb-3" role="list" aria-label="Deal pipeline">
            {cols.map((c: any) => (
              <section key={c.stage} role="listitem" className="w-64 shrink-0 rounded-xl border border-border bg-panel2 p-2">
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h3 className="text-sm font-semibold">{titleCase(c.stage)}</h3>
                  <span className="text-xs text-muted">{c.count}</span>
                </div>
                {Object.entries(c.totals).length > 0 && <div className="mb-2 px-1 text-xs text-muted">{Object.entries(c.totals).map(([cur, v]) => money(v, cur)).join(' · ')}</div>}
                <ul className="space-y-2">
                  {c.items.map((d: any) => (
                    <li key={d.id}>
                      <Link href={`/collaborations/deals/${d.id}`} className="block rounded-lg border border-border bg-panel p-2 text-sm hover:border-accent/60">
                        <div className="font-medium">{d.title}</div>
                        <div className="text-xs text-muted">{d.brand}{d.valueMinor ? ` · ${money(d.valueMinor, d.currency)}` : ''}</div>
                        {d.nextDueAt && <div className="text-xs text-muted">Next: {when(d.nextDueAt, undefined, false)}</div>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        );
      }}
    </Async>
  );
}

function Invoices() {
  const fin = useApi<any>('/finance/summary');
  const [status, setStatus] = useState('');
  const inv = useApi<any[]>('/invoices', { query: { status: status || undefined } });
  const [adding, setAdding] = useState(false);
  const deals = useApi<any[]>('/deals', { query: { limit: 200 } });
  const [f, setF] = useState({ dealId: '', amount: '', currency: 'CAD', termsDays: '30', draft: false });
  return (
    <div className="space-y-5">
      <Async res={fin}>
        {(s) => {
          const cur = s.baseCurrency;
          const c = s.converted;
          return (
            <>
              <section aria-label="Money" className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Received" value={money(c.receivedMinor, cur)} tone="ok" />
                <Stat label="Outstanding" value={money(c.outstandingMinor, cur)} />
                <Stat label="Overdue" value={money(c.overdueMinor, cur)} tone={c.overdueMinor > 0 ? 'bad' : undefined} />
                <Stat label="Expenses" value={money(c.expensesMinor, cur)} />
              </section>
              {s.missingFxRates?.length > 0 && <Notice tone="warn" title="Exchange rates missing">Totals exclude {s.missingFxRates.join(', ')} until you add a rate (Settings → Finance). Amounts are never converted with an invented rate.</Notice>}
            </>
          );
        }}
      </Async>
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Invoice status" value={status} onChange={(e) => setStatus(e.target.value)}><Options values={['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID']} none="Any status" /></Select>
        <Button variant="primary" className="ml-auto" onClick={() => setAdding(true)}><Plus className="size-4" /> New invoice</Button>
      </div>
      <Async res={inv} empty={<EmptyState title="No invoices">Create an invoice from a deal when you are ready to bill.</EmptyState>}>
        {(rows) => (
          <Table head={['Invoice', 'Deal', 'Amount', 'Paid', 'Due', 'Status']}>
            {rows.map((i) => (
              <tr key={i.id}>
                <Td className="font-medium">{i.invoiceNo}</Td>
                <Td>{i.dealId ? <Link className="text-accent hover:underline" href={`/collaborations/deals/${i.dealId}`}>{i.dealTitle}</Link> : '—'}</Td>
                <Td>{money(i.amountMinor, i.currency)}</Td><Td>{money(i.paidMinor, i.currency)}</Td><Td>{i.dueAt ? when(i.dueAt, undefined, false) : '—'}</Td><Td><StateBadge state={i.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Async>
      <FormDialog open={adding} onClose={() => setAdding(false)} title="New invoice" submitLabel="Create" onSubmit={async () => {
        const amountMinor = toMinor(f.amount);
        if (!amountMinor) throw new Error('Enter a valid amount');
        await post('/invoices', { dealId: f.dealId || undefined, amountMinor, currency: f.currency.toUpperCase(), termsDays: Number(f.termsDays) || undefined, draft: f.draft });
        setF({ dealId: '', amount: '', currency: 'CAD', termsDays: '30', draft: false });
        await refresh('/invoices', '/finance', '/deals');
      }}>
        <Field label="Deal"><Select value={f.dealId} onChange={(e) => setF({ ...f, dealId: e.target.value })}><option value="">No deal</option>{(deals.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</Select></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Amount"><Input required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Currency"><Input maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} /></Field>
          <Field label="Terms (days)"><Input type="number" min={0} value={f.termsDays} onChange={(e) => setF({ ...f, termsDays: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.draft} onChange={(e) => setF({ ...f, draft: e.target.checked })} /> Save as draft (do not issue yet)</label>
      </FormDialog>
    </div>
  );
}

function Partners() {
  const orgs = useApi<any[]>('/organizations');
  const contacts = useApi<any[]>('/contacts');
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle>Brands & agencies</CardTitle>
        <Async res={orgs} empty={<p className="text-sm text-muted">None yet. They are created when you log an inquiry.</p>}>
          {(rows) => <ul className="divide-y divide-border">{rows.map((o) => <li key={o.id} className="flex items-center gap-2 py-2 text-sm"><span className="flex-1 font-medium">{o.name}</span><Badge>{titleCase(o.kind)}</Badge><span className="text-xs text-muted">{o.dealCount} deal{o.dealCount === 1 ? '' : 's'}</span></li>)}</ul>}
        </Async>
      </Card>
      <Card>
        <CardTitle>Contacts</CardTitle>
        <Async res={contacts} empty={<p className="text-sm text-muted">No contacts yet.</p>}>
          {(rows) => <ul className="divide-y divide-border">{rows.map((c) => <li key={c.id} className="py-2 text-sm"><div className="font-medium">{c.name}</div><div className="text-xs text-muted">{(c.emails ?? []).join(', ')}</div></li>)}</ul>}
        </Async>
      </Card>
    </div>
  );
}

