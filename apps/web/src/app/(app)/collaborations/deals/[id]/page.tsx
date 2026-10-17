'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useMe } from '@/components/shell';
import {
  ActionButton,
  Async,
  Badge,
  Button,
  Card,
  CardTitle,
  Field,
  FormDialog,
  Input,
  KV,
  Notice,
  Options,
  PageHeader,
  Select,
  StateBadge,
  Table,
  Td,
  Textarea,
} from '@/components/ui';
import { ApiError, post, refresh, useApi } from '@/lib/api';
import { money, title as titleCase, toMinor, when } from '@/lib/format';
import { DEAL_STAGES, PAYMENT_METHODS } from '@/lib/options';

const DELIVERABLE_STATUSES = [
  'PLANNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'PUBLISHED',
  'ACCEPTED',
];

export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const res = useApi<any>(`/deals/${id}`);
  const me = useMe();
  const tz = me.data?.organization?.timezone;
  const reload = () => refresh(`/deals/${id}`, '/deals', '/invoices', '/finance', '/briefing');
  const [error, setError] = useState<string | null>(null);
  const [unpaid, setUnpaid] = useState<string | null>(null);
  const [addDel, setAddDel] = useState(false);
  const [del, setDel] = useState({ title: '', dueAt: '' });
  const [evidence, setEvidence] = useState<{ id: string; status: string } | null>(null);
  const [linkFor, setLinkFor] = useState<any>(null);
  const [linkPost, setLinkPost] = useState('');
  const linkable = useApi<any[]>(linkFor ? '/publications' : null, {
    query: { deliverableId: linkFor?.id },
  });
  const [ev, setEv] = useState('');
  const [paying, setPaying] = useState<any>(null);
  const [pay, setPay] = useState({ amount: '', method: 'BANK_TRANSFER', reference: '', verified: true });

  const move = async (to: string, force = false) => {
    setError(null);
    try {
      await post(`/deals/${id}/stage`, { to, force: force || undefined });
      setUnpaid(null);
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'UNPAID_INVOICES') setUnpaid(to);
      else setError(e instanceof Error ? e.message : 'Could not change stage');
    }
  };

  const setStatus = async (dId: string, status: string) => {
    if (status === 'APPROVED' || status === 'ACCEPTED') {
      setEv('');
      setEvidence({ id: dId, status });
      return;
    }
    try {
      await post(`/deliverables/${dId}/status`, { status });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <Async res={res}>
      {(d) => (
        <>
          <p className="mb-2 text-sm">
            <Link href="/collaborations?tab=pipeline" className="text-accent">
              ← Pipeline
            </Link>
          </p>
          <PageHeader
            title={d.title}
            subtitle={
              <span className="flex flex-wrap items-center gap-1.5">
                <StateBadge state={d.stage} />
                <Badge>{titleCase(d.compensationType)}</Badge>
                {d.priority !== 'NORMAL' && <Badge tone="warn">{d.priority.toLowerCase()}</Badge>}
                {d.isDemo && <Badge tone="info">demo</Badge>}
              </span>
            }
            actions={
              <Select
                aria-label="Move deal to stage"
                value={d.stage}
                onChange={(e) => void move(e.target.value)}
              >
                {DEAL_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            }
          />
          {error && (
            <div className="mb-3">
              <Notice tone="bad">{error}</Notice>
            </div>
          )}

          <section aria-label="Deal money" className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Contracted', d.summary.contractedMinor],
              ['Invoiced', d.summary.invoicedMinor],
              ['Received', d.summary.receivedMinor],
              ['Outstanding', d.summary.outstandingMinor],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-xl border border-border bg-panel p-3">
                <div className="text-xs text-muted">{l}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{money(v, d.summary.currency)}</div>
              </div>
            ))}
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card>
                <CardTitle
                  action={
                    <Button size="sm" onClick={() => setAddDel(true)}>
                      <Plus className="size-4" /> Add
                    </Button>
                  }
                >
                  Deliverables
                </CardTitle>
                {d.deliverables.length === 0 ? (
                  <p className="text-sm text-muted">No deliverables yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {d.deliverables.map((x: any) => (
                      <li
                        key={x.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">
                            {x.title}
                            {x.quantity > 1 ? ` ×${x.quantity}` : ''}
                          </div>
                          <div className="text-xs text-muted">
                            {x.dueAt ? `Due ${when(x.dueAt, tz, false)}` : 'No due date'}
                            {x.approvalEvidence ? ` · Approval: ${x.approvalEvidence}` : ''}
                          </div>
                        </div>
                        <div className="flex w-full flex-wrap items-center gap-1.5 text-xs">
                          {(x.publications ?? []).map((p: any) => (
                            <span
                              key={p.id}
                              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5"
                            >
                              {titleCase(p.platform)} {p.handle} <StateBadge state={p.state} />
                              {p.url && (
                                <a className="text-accent" href={p.url} target="_blank" rel="noreferrer">
                                  open ↗
                                </a>
                              )}
                              <ActionButton
                                size="sm"
                                aria-label={`Unlink ${p.title ?? p.platform} from ${x.title}`}
                                onAction={async () => {
                                  await post(`/deliverables/${x.id}/link`, { publicationId: null });
                                  await reload();
                                }}
                              >
                                ×
                              </ActionButton>
                            </span>
                          ))}
                          <Button
                            size="sm"
                            aria-label={`Link a post to ${x.title}`}
                            onClick={() => {
                              setLinkPost('');
                              setLinkFor(x);
                            }}
                          >
                            Link post
                          </Button>
                        </div>
                        <Select
                          aria-label={`Status of ${x.title}`}
                          className="!w-auto"
                          value={x.status}
                          onChange={(e) => void setStatus(x.id, e.target.value)}
                        >
                          <Options values={DELIVERABLE_STATUSES} />
                        </Select>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardTitle>Invoices</CardTitle>
                {d.invoices.length === 0 ? (
                  <p className="text-sm text-muted">
                    No invoices. Create one under Collaborations → Invoices & money.
                  </p>
                ) : (
                  <Table head={['Invoice', 'Amount', 'Paid', 'Due', 'Status', '']}>
                    {d.invoices.map((i: any) => (
                      <tr key={i.id}>
                        <Td className="font-medium">{i.invoiceNo}</Td>
                        <Td>{money(i.amountMinor, i.currency)}</Td>
                        <Td>{money(i.paidTotalMinor, i.currency)}</Td>
                        <Td>{i.dueAt ? when(i.dueAt, tz, false) : '—'}</Td>
                        <Td>
                          <StateBadge state={i.status} />
                        </Td>
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            {i.status === 'DRAFT' && (
                              <ActionButton
                                size="sm"
                                onAction={async () => {
                                  await post(`/invoices/${i.id}/issue`, {});
                                  await reload();
                                }}
                              >
                                Issue
                              </ActionButton>
                            )}
                            {['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status) && (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => {
                                  setPay({
                                    amount: String((i.amountMinor - i.paidTotalMinor) / 100),
                                    method: 'BANK_TRANSFER',
                                    reference: '',
                                    verified: true,
                                  });
                                  setPaying(i);
                                }}
                              >
                                Record payment
                              </Button>
                            )}
                            {i.status !== 'VOID' && i.status !== 'PAID' && (
                              <ActionButton
                                size="sm"
                                confirm="Void this invoice?"
                                onAction={async () => {
                                  await post(`/invoices/${i.id}/void`, {});
                                  await reload();
                                }}
                              >
                                Void
                              </ActionButton>
                            )}
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
            </div>
            <div className="space-y-4">
              <Card>
                <CardTitle>Terms</CardTitle>
                <KV
                  items={[
                    ['Payment terms', d.paymentTermsDays != null ? `${d.paymentTermsDays} days` : '—'],
                    ['Contract', titleCase(d.contractStatus)],
                    ['Usage rights', d.usageRights ?? '—'],
                    ['Exclusivity', d.exclusivity ?? '—'],
                    ['Revisions', String(d.revisionRounds)],
                    ['Next due', d.nextDueAt ? when(d.nextDueAt, tz, false) : '—'],
                  ]}
                />
              </Card>
              <Card>
                <CardTitle>Conversations</CardTitle>
                {d.threads.length === 0 ? (
                  <p className="text-sm text-muted">None linked.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {d.threads.map((t: any) => (
                      <li key={t.id}>
                        <Link
                          className="text-accent hover:underline"
                          href={`/collaborations/threads/${t.id}`}
                        >
                          {t.subject}
                        </Link>{' '}
                        <StateBadge state={t.state} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          <FormDialog
            open={addDel}
            onClose={() => setAddDel(false)}
            title="Add deliverable"
            submitLabel="Add"
            onSubmit={async () => {
              await post(`/deals/${id}/deliverables`, {
                title: del.title.trim(),
                dueAt: del.dueAt ? new Date(del.dueAt).toISOString() : undefined,
              });
              setDel({ title: '', dueAt: '' });
              await reload();
            }}
          >
            <Field label="Deliverable">
              <Input
                required
                autoFocus
                value={del.title}
                onChange={(e) => setDel({ ...del, title: e.target.value })}
                placeholder="e.g. 1 Instagram reel"
              />
            </Field>
            <Field label="Due">
              <Input
                type="date"
                value={del.dueAt}
                onChange={(e) => setDel({ ...del, dueAt: e.target.value })}
              />
            </Field>
          </FormDialog>

          <FormDialog
            open={Boolean(linkFor)}
            onClose={() => setLinkFor(null)}
            title={`Link a post to ${linkFor?.title ?? ''}`}
            submitLabel="Link"
            onSubmit={async () => {
              await post(`/deliverables/${linkFor.id}/link`, { publicationId: linkPost });
              await reload();
            }}
          >
            <p className="text-sm text-muted">
              Linking records which post fulfils this deliverable. It does not change the deliverable&apos;s
              status, and it never publishes anything.
            </p>
            <Field label="Post">
              <Select required value={linkPost} onChange={(e) => setLinkPost(e.target.value)}>
                <option value="">Choose…</option>
                {(linkable.data ?? []).map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {titleCase(p.platform)} {p.handle}: {p.title ?? p.url ?? 'Untitled'} ({titleCase(p.state)})
                  </option>
                ))}
              </Select>
            </Field>
          </FormDialog>

          <FormDialog
            open={Boolean(evidence)}
            onClose={() => setEvidence(null)}
            title={`Mark as ${titleCase(evidence?.status ?? '')}`}
            submitLabel="Confirm"
            onSubmit={async () => {
              await post(`/deliverables/${evidence!.id}/status`, {
                status: evidence!.status,
                evidence: ev.trim(),
              });
              await reload();
            }}
          >
            <p className="text-sm text-muted">
              Approval is never assumed from an e-mail. Record who approved it and how, so there is evidence
              later.
            </p>
            <Field label="Evidence">
              <Textarea
                required
                rows={3}
                autoFocus
                value={ev}
                onChange={(e) => setEv(e.target.value)}
                placeholder="e.g. Approved by Sam (brand) by e-mail on 14 Oct"
              />
            </Field>
          </FormDialog>

          <FormDialog
            open={Boolean(unpaid)}
            onClose={() => setUnpaid(null)}
            title="Unpaid invoices remain"
            submitLabel="Close anyway"
            danger
            onSubmit={async () => {
              await move(unpaid!, true);
            }}
          >
            <p className="text-sm">
              This deal still has unpaid invoices. You can record the payments first, or close it anyway.
            </p>
          </FormDialog>

          <FormDialog
            open={Boolean(paying)}
            onClose={() => setPaying(null)}
            title={`Record payment for ${paying?.invoiceNo ?? ''}`}
            submitLabel="Record"
            onSubmit={async () => {
              const amountMinor = toMinor(pay.amount);
              if (!amountMinor) throw new Error('Enter a valid amount');
              await post(`/invoices/${paying.id}/payments`, {
                amountMinor,
                currency: paying.currency,
                method: pay.method,
                reference: pay.reference.trim() || undefined,
                verified: pay.verified,
              });
              await reload();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Amount (${paying?.currency ?? ''})`}>
                <Input
                  required
                  inputMode="decimal"
                  value={pay.amount}
                  onChange={(e) => setPay({ ...pay, amount: e.target.value })}
                />
              </Field>
              <Field label="Method">
                <Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  <Options values={PAYMENT_METHODS} />
                </Select>
              </Field>
            </div>
            <Field label="Reference">
              <Input
                value={pay.reference}
                onChange={(e) => setPay({ ...pay, reference: e.target.value })}
                placeholder="Transaction id or note"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pay.verified}
                onChange={(e) => setPay({ ...pay, verified: e.target.checked })}
              />{' '}
              I confirmed the money arrived in my account
            </label>
          </FormDialog>
        </>
      )}
    </Async>
  );
}
