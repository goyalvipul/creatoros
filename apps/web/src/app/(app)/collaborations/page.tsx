'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Star } from 'lucide-react';
import { Suspense, useState } from 'react';
import { useMe } from '@/components/shell';
import {
  ActionButton,
  Async,
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  FormDialog,
  Input,
  Notice,
  Options,
  PageHeader,
  Select,
  Spinner,
  Stat,
  StateBadge,
  Table,
  Tabs,
  Td,
  Textarea,
} from '@/components/ui';
import { del, patch, post, refresh, useApi } from '@/lib/api';
import { SuggestionCard } from './invoice-suggestions';
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
  const initial =
    (['inbox', 'pipeline', 'invoices', 'partners'] as const).find((t) => t === sp.get('tab')) ?? 'inbox';
  const [tab, setTabState] = useState<Tab>(initial);
  const setTab = (t: Tab) => {
    setTabState(t);
    router.replace(`/collaborations?tab=${t}`);
  };
  const [intake, setIntake] = useState(false);
  const [newDeal, setNewDeal] = useState(false);

  return (
    <>
      <PageHeader
        title="Collaborations"
        subtitle="Brand inquiries, deals, deliverables and money. A suggestion never creates a deal; you confirm every one."
        actions={
          <>
            <Button onClick={() => setNewDeal(true)}>
              <Plus className="size-4" /> New deal
            </Button>
            <Button variant="primary" onClick={() => setIntake(true)}>
              <Plus className="size-4" /> Log inquiry
            </Button>
          </>
        }
      />
      <Tabs
        tabs={[
          { id: 'inbox', label: 'Inbox' },
          { id: 'pipeline', label: 'Pipeline' },
          { id: 'invoices', label: 'Invoices & money' },
          { id: 'partners', label: 'Partners' },
        ]}
        value={tab}
        onChange={setTab}
      />
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
  const [f, setF] = useState({
    brand: '',
    contactName: '',
    contactEmail: '',
    subject: '',
    notes: '',
    offerType: 'UNKNOWN',
    value: '',
    currency: 'CAD',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Log an inquiry"
      submitLabel="Log inquiry"
      onSubmit={async () => {
        await post('/intake', {
          brand: f.brand.trim(),
          contactName: f.contactName.trim() || undefined,
          contactEmail: f.contactEmail.trim() || undefined,
          subject: f.subject.trim(),
          notes: f.notes.trim() || undefined,
          offerType: f.offerType,
          valueMinor: f.value ? (toMinor(f.value) ?? undefined) : undefined,
          currency: f.currency.toUpperCase(),
          source: 'MANUAL',
        });
        setF({
          brand: '',
          contactName: '',
          contactEmail: '',
          subject: '',
          notes: '',
          offerType: 'UNKNOWN',
          value: '',
          currency: 'CAD',
        });
        await refresh('/threads', '/briefing', '/organizations');
      }}
    >
      <p className="text-sm text-muted">
        Paste an inquiry that came in by DM, WhatsApp or email. It lands in the inbox for triage.
      </p>
      <Field label="Brand / company">
        <Input required autoFocus value={f.brand} onChange={set('brand')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact name">
          <Input value={f.contactName} onChange={set('contactName')} />
        </Field>
        <Field label="Contact e-mail">
          <Input type="email" value={f.contactEmail} onChange={set('contactEmail')} />
        </Field>
      </div>
      <Field label="Subject">
        <Input required value={f.subject} onChange={set('subject')} />
      </Field>
      <Field label="Message / notes">
        <Textarea rows={4} value={f.notes} onChange={set('notes')} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Offer type">
          <Select value={f.offerType} onChange={set('offerType')}>
            <Options values={['UNKNOWN', 'FLAT_FEE', 'GIFTED', 'AFFILIATE', 'COMMISSION', 'MIXED']} />
          </Select>
        </Field>
        <Field label="Offered amount">
          <Input inputMode="decimal" value={f.value} onChange={set('value')} />
        </Field>
        <Field label="Currency">
          <Input maxLength={3} value={f.currency} onChange={set('currency')} />
        </Field>
      </div>
    </FormDialog>
  );
}

function NewDealDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ title: '', value: '', currency: 'CAD', priority: 'NORMAL', termsDays: '30' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="New deal"
      submitLabel="Create deal"
      onSubmit={async () => {
        const d = await post('/deals', {
          title: f.title.trim(),
          contractedValueMinor: f.value ? (toMinor(f.value) ?? undefined) : undefined,
          currency: f.currency.toUpperCase(),
          priority: f.priority,
          paymentTermsDays: Number(f.termsDays) || undefined,
          stage: 'QUALIFIED',
        });
        await refresh('/deals');
        onClose();
        router.push(`/collaborations/deals/${d.id}`);
      }}
    >
      <Field label="Title">
        <Input
          required
          autoFocus
          value={f.title}
          onChange={set('title')}
          placeholder="e.g. Brand X — 2 reels"
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Agreed amount">
          <Input inputMode="decimal" value={f.value} onChange={set('value')} />
        </Field>
        <Field label="Currency">
          <Input maxLength={3} value={f.currency} onChange={set('currency')} />
        </Field>
        <Field label="Payment terms (days)">
          <Input type="number" min={0} value={f.termsDays} onChange={set('termsDays')} />
        </Field>
      </div>
      <Field label="Priority">
        <Select value={f.priority} onChange={set('priority')}>
          <Options values={PRIORITIES} />
        </Select>
      </Field>
    </FormDialog>
  );
}

type Folder = 'inbox' | 'starred' | 'followup' | 'pipeline' | 'archived';
const FOLDERS: { id: Folder; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'starred', label: 'Starred' },
  { id: 'followup', label: 'Follow-up' },
  { id: 'pipeline', label: 'In pipeline' },
  { id: 'archived', label: 'Archived' },
];

function Inbox() {
  const [folder, setFolder] = useState<Folder>('inbox');
  const [account, setAccount] = useState('');
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const accounts = useApi<any>('/mail/accounts');
  const threads = useApi<any[]>('/threads', {
    query: {
      scope: 'mail',
      folder,
      connectionId: account || undefined,
      state: state || undefined,
      q: q.trim() || undefined,
      limit: 100,
    },
  });
  const me = useMe();
  const tz = me.data?.organization?.timezone;
  const counts = account
    ? accounts.data?.accounts?.find((a: any) => a.id === account)?.counts
    : accounts.data?.totals;
  const reload = () => refresh('/threads', '/mail', '/actions', '/briefing');
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select aria-label="Mailbox" value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">All mailboxes</option>
          {(accounts.data?.accounts ?? []).map((a: any) => (
            <option key={a.id} value={a.id}>
              {a.label}
              {a.counts?.needReply ? ` (${a.counts.needReply} to reply)` : ''}
            </option>
          ))}
        </Select>
        <Select aria-label="Reply state" value={state} onChange={(e) => setState(e.target.value)}>
          <Options
            values={['NEED_REPLY', 'WAITING_FOR_BRAND', 'WAITING_FOR_USER', 'DONE']}
            none="Any reply state"
          />
        </Select>
        <Input
          aria-label="Search mail"
          placeholder="Search subject, sender or text"
          className="min-w-48 flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div role="tablist" aria-label="Mail folders" className="mb-4 flex flex-wrap gap-1.5">
        {FOLDERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            role="tab"
            aria-selected={folder === f.id}
            variant={folder === f.id ? 'primary' : 'secondary'}
            onClick={() => setFolder(f.id)}
          >
            {f.label}
            {counts ? ` ${counts[f.id === 'followup' ? 'followup' : f.id] ?? 0}` : ''}
          </Button>
        ))}
      </div>
      {accounts.data && accounts.data.accounts.length === 0 && (
        <div className="mb-4">
          <Notice tone="info" title="No Gmail account connected">
            Connect one or more Gmail accounts in Integrations. Pasted or logged inquiries still show here.
          </Notice>
        </div>
      )}
      <Async
        res={threads}
        empty={
          <EmptyState title={folder === 'inbox' ? 'Nothing to review' : `Nothing in ${folder}`}>
            {folder === 'starred'
              ? 'Emails you star in Gmail (after the next sync) or here show up in this tab.'
              : 'Log an inquiry, or connect Gmail in Integrations to bring brand e-mail in.'}
          </EmptyState>
        }
      >
        {(rows) => (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-panel">
            {rows.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2 hover:bg-panel2">
                <button
                  aria-label={t.starred ? 'Unstar' : 'Star'}
                  aria-pressed={t.starred}
                  className={t.starred ? 'text-warn' : 'text-muted hover:text-text'}
                  onClick={async () => {
                    await patch(`/threads/${t.id}/local`, { starred: !t.starred });
                    await reload();
                  }}
                >
                  <Star className={t.starred ? 'size-4 fill-current' : 'size-4'} />
                </button>
                <Link href={`/collaborations/threads/${t.id}`} className="block min-w-0 flex-1 py-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{t.subject || '(no subject)'}</span>
                    <StateBadge state={t.state} />
                    {t.triageState === 'POSSIBLE' && <Badge tone="warn">review</Badge>}
                    {t.dealId && <Badge tone="info">deal</Badge>}
                    {t.invoiceHints > 0 && <Badge tone="info">invoice?</Badge>}
                    {t.followUpAt && <Badge>follow up {ago(t.followUpAt)}</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">
                    {t.fromName ? `${t.fromName} · ` : ''}
                    {t.fromEmail} · {t.preview}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {!account && t.principal ? `${t.principal} · ` : ''}
                    {t.lastInboundAt ? `Last message ${ago(t.lastInboundAt)}` : ''}
                    {t.snoozeUntil ? ` · snoozed until ${when(t.snoozeUntil, tz)}` : ''}
                  </div>
                </Link>
                <div className="flex gap-1.5">
                  {folder !== 'pipeline' && (
                    <ActionButton
                      size="sm"
                      onAction={async () => {
                        await post(`/threads/${t.id}/move`, { to: 'PIPELINE' });
                        await reload();
                      }}
                      success="Moved to pipeline. An opportunity was created."
                    >
                      To pipeline
                    </ActionButton>
                  )}
                  {folder === 'archived' ? (
                    <ActionButton
                      size="sm"
                      onAction={async () => {
                        await post(`/threads/${t.id}/move`, { to: 'INBOX' });
                        await reload();
                      }}
                    >
                      Back to inbox
                    </ActionButton>
                  ) : (
                    <ActionButton
                      size="sm"
                      onAction={async () => {
                        await post(`/threads/${t.id}/move`, { to: 'ARCHIVE' });
                        await reload();
                      }}
                    >
                      Archive
                    </ActionButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Async>
      <p className="mt-3 text-xs text-muted">
        Star, archive and moves only change Creator OS; they never change Gmail.
      </p>
    </>
  );
}

function Pipeline() {
  const res = useApi<any>('/deals/pipeline');
  return (
    <Async res={res}>
      {(p) => {
        const cols = p.columns.filter(
          (c: any) =>
            c.count > 0 ||
            ['QUALIFIED', 'NEGOTIATING', 'IN_PRODUCTION', 'AWAITING_PAYMENT'].includes(c.stage),
        );
        if (p.columns.every((c: any) => c.count === 0))
          return (
            <EmptyState title="No deals yet">Confirm an inquiry from the inbox or create a deal.</EmptyState>
          );
        return (
          <div className="flex gap-3 overflow-x-auto pb-3" role="list" aria-label="Deal pipeline">
            {cols.map((c: any) => (
              <section
                key={c.stage}
                role="listitem"
                className="w-64 shrink-0 rounded-xl border border-border bg-panel2 p-2"
              >
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h3 className="text-sm font-semibold">{titleCase(c.stage)}</h3>
                  <span className="text-xs text-muted">{c.count}</span>
                </div>
                {Object.entries(c.totals).length > 0 && (
                  <div className="mb-2 px-1 text-xs text-muted">
                    {Object.entries(c.totals)
                      .map(([cur, v]) => money(v, cur))
                      .join(' · ')}
                  </div>
                )}
                <ul className="space-y-2">
                  {c.items.map((d: any) => (
                    <li key={d.id}>
                      <Link
                        href={`/collaborations/deals/${d.id}`}
                        className="block rounded-lg border border-border bg-panel p-2 text-sm hover:border-accent/60"
                      >
                        <div className="font-medium">{d.title}</div>
                        <div className="text-xs text-muted">
                          {d.brand}
                          {d.valueMinor ? ` · ${money(d.valueMinor, d.currency)}` : ''}
                        </div>
                        {d.nextDueAt && (
                          <div className="text-xs text-muted">
                            Next: {when(d.nextDueAt, undefined, false)}
                          </div>
                        )}
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

function FoundInEmail() {
  const sug = useApi<any[]>('/mail/invoice-suggestions');
  const [msg, setMsg] = useState('');
  return (
    <section aria-label="Invoices found in email" className="rounded-xl border border-border bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <h3 className="flex-1 text-sm font-semibold">
          Found in your email {sug.data?.length ? `(${sug.data.length})` : ''}
        </h3>
        <ActionButton
          size="sm"
          onAction={async () => {
            setMsg('Searching Gmail (this can take a minute)…');
            try {
              const r = await post('/mail/invoice-suggestions/scan', {});
              const g = r.gmail;
              setMsg(
                `Checked ${g.checked} mails from ${g.candidates} Gmail matches; ${r.found + g.found} new invoice suggestion(s); ${g.newlyStarred} newly starred.` +
                  (g.errors.length ? ` Problems: ${g.errors.join('; ')}` : ''),
              );
            } catch (e) {
              setMsg('');
              throw e;
            }
            await refresh('/mail', '/threads');
          }}
        >
          Scan email now
        </ActionButton>
      </div>
      {msg && <p className="border-b border-border px-3 py-2 text-xs text-muted">{msg}</p>}
      <Async
        res={sug}
        empty={
          <p className="px-3 py-4 text-sm text-muted">
            No invoices waiting for review. New Gmail messages are checked automatically; press “Scan email
            now” to check everything already synced. Only the email text is read, not PDF attachments.
          </p>
        }
      >
        {(rows) => (
          <ul className="divide-y divide-border">
            {rows.map((s) => (
              <SuggestionCard key={s.id} s={s} />
            ))}
          </ul>
        )}
      </Async>
    </section>
  );
}

function InvoiceActions({ inv }: { inv: any }) {
  const router = useRouter();
  const locked = inv.status === 'VOID';
  return (
    <div className="flex justify-end gap-1.5">
      {!locked && (
        <Button size="sm" onClick={() => router.push(`/collaborations/invoices/${inv.id}`)}>
          Edit
        </Button>
      )}
      {inv.paidMinor > 0 ? null : (
        <ActionButton
          size="sm"
          variant="danger"
          confirm={`Delete invoice ${inv.invoiceNo}? This cannot be undone.`}
          onAction={async () => {
            await del(`/invoices/${inv.id}`);
            await refresh('/invoices', '/finance', '/deals', '/mail');
          }}
          success="Invoice deleted"
        >
          Delete
        </ActionButton>
      )}
    </div>
  );
}

function Invoices() {
  const router = useRouter();
  const fin = useApi<any>('/finance/summary');
  const [status, setStatus] = useState('');
  const inv = useApi<any[]>('/invoices', { query: { status: status || undefined } });
  return (
    <div className="space-y-5">
      <Async res={fin}>
        {(s) => {
          const cur = s.baseCurrency;
          // With a currency that has no exchange rate there is no combined total: show each currency on its own.
          const c = s.converted;
          const per = s.perCurrency ?? {};
          const show = (key: 'received' | 'outstanding' | 'overdue' | 'expenses', convertedKey: string) => {
            if (c) return money(c[convertedKey], cur);
            const parts = Object.entries((per[key] ?? {}) as Record<string, number>).map(([k, v]) =>
              money(v, k),
            );
            return parts.length ? parts.join(' + ') : money(0, cur);
          };
          const overdueHas = c
            ? c.overdueMinor > 0
            : Object.values((per.overdue ?? {}) as Record<string, number>).some((v) => v > 0);
          return (
            <>
              <section aria-label="Money" className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Received" value={show('received', 'receivedMinor')} tone="ok" />
                <Stat label="Outstanding" value={show('outstanding', 'outstandingMinor')} />
                <Stat
                  label="Overdue"
                  value={show('overdue', 'overdueMinor')}
                  tone={overdueHas ? 'bad' : undefined}
                />
                <Stat label="Expenses" value={show('expenses', 'expensesMinor')} />
              </section>
              {s.missingFxRates?.length > 0 && (
                <Notice tone="warn" title="Exchange rates missing">
                  No exchange rate for {s.missingFxRates.join(', ')}, so totals are shown per currency instead
                  of combined. Add a rate in Settings → Finance to get one total. Amounts are never converted
                  with an invented rate.
                </Notice>
              )}
            </>
          );
        }}
      </Async>
      <FoundInEmail />
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Invoice status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <Options
            values={['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID']}
            none="Any status"
          />
        </Select>
        <Button variant="primary" className="ml-auto" onClick={() => router.push('/collaborations/invoices/new')}>
          <Plus className="size-4" /> New invoice
        </Button>
      </div>
      <Async
        res={inv}
        empty={
          <EmptyState title="No invoices">
            Create an invoice from a deal when you are ready to bill.
          </EmptyState>
        }
      >
        {(rows) => (
          <Table
            head={[
              'Invoice',
              'Deal',
              'Amount',
              `In ${rows[0]?.baseCurrency ?? 'CAD'}`,
              'Paid',
              'Due',
              'Status',
              '',
            ]}
          >
            {rows.map((i) => (
              <tr key={i.id}>
                <Td className="font-medium">{i.invoiceNo}</Td>
                <Td>
                  {i.dealId ? (
                    <Link className="text-accent hover:underline" href={`/collaborations/deals/${i.dealId}`}>
                      {i.dealTitle}
                    </Link>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td>{money(i.amountMinor, i.currency)}</Td>
                <Td>
                  {i.baseAmountMinor != null ? (
                    <span
                      title={
                        i.currency === i.baseCurrency
                          ? undefined
                          : `1 ${i.currency} = ${i.fxRate} ${i.baseCurrency} (${String(i.fxSource ?? '').replace('live:', 'live rate, ')}, ${ago(i.fxAt)})`
                      }
                    >
                      {money(i.baseAmountMinor, i.baseCurrency)}
                      {i.currency !== i.baseCurrency && (
                        <span className="block text-xs text-muted">@ {Number(i.fxRate).toFixed(4)}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">no rate</span>
                  )}
                </Td>
                <Td>{money(i.paidMinor, i.currency)}</Td>
                <Td>{i.dueAt ? when(i.dueAt, undefined, false) : '—'}</Td>
                <Td>
                  <StateBadge state={i.status} />
                </Td>
                <Td>
                  <InvoiceActions inv={i} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Async>
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
        <Async
          res={orgs}
          empty={<p className="text-sm text-muted">None yet. They are created when you log an inquiry.</p>}
        >
          {(rows) => (
            <ul className="divide-y divide-border">
              {rows.map((o) => (
                <li key={o.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="flex-1 font-medium">{o.name}</span>
                  <Badge>{titleCase(o.kind)}</Badge>
                  <span className="text-xs text-muted">
                    {o.dealCount} deal{o.dealCount === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>
      <Card>
        <CardTitle>Contacts</CardTitle>
        <Async res={contacts} empty={<p className="text-sm text-muted">No contacts yet.</p>}>
          {(rows) => (
            <ul className="divide-y divide-border">
              {rows.map((c) => (
                <li key={c.id} className="py-2 text-sm">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted">{(c.emails ?? []).join(', ')}</div>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>
    </div>
  );
}
