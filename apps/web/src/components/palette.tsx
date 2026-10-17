'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, post, refresh } from '@/lib/api';
import { NAV } from './nav';
import { Badge, Dialog, Field, FormDialog, Input, Select, Textarea, useToast } from './ui';
import { dateInput, title as titleCase } from '@/lib/format';

type Hit = { key: string; label: string; sub?: string; href: string; kind: string };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Hit[]>([]);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setResults([]);
      setIdx(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const rows = await api<any[]>('/search', { query: { q: term } });
        setResults(rows.map((r) => ({ key: `${r.type}:${r.id}`, label: r.title, sub: r.subtitle, href: r.link ?? '/', kind: r.type })));
      } catch {
        setResults([]);
      } finally {
        setBusy(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const pages = useMemo<Hit[]>(() => NAV.filter((n) => !q || n.label.toLowerCase().includes(q.toLowerCase())).map((n) => ({ key: `nav:${n.href}`, label: n.label, href: n.href, kind: 'page' })), [q]);
  const all = [...pages, ...results];

  const go = (h?: Hit) => {
    if (!h) return;
    onClose();
    router.push(h.href);
  };

  return (
    <Dialog open={open} onClose={onClose} title="Search">
      <div className="space-y-3" onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, all.length - 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
        if (e.key === 'Enter') { e.preventDefault(); go(all[idx]); }
      }}>
        <Input ref={input} aria-label="Search everything" placeholder="Search ideas, projects, files, deals, threads… or jump to a page" value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} />
        <ul role="listbox" className="max-h-[50dvh] space-y-1 overflow-y-auto">
          {all.map((h, i) => (
            <li key={h.key} role="option" aria-selected={i === idx}>
              <button onClick={() => go(h)} onMouseEnter={() => setIdx(i)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${i === idx ? 'bg-accent/15' : 'hover:bg-panel2'}`}>
                <Badge tone={h.kind === 'page' ? 'accent' : 'neutral'}>{titleCase(h.kind)}</Badge>
                <span className="min-w-0 flex-1 truncate">{h.label}</span>
                {h.sub && <span className="hidden truncate text-xs text-muted sm:block">{h.sub}</span>}
              </button>
            </li>
          ))}
          {busy && <li className="px-3 py-2 text-sm text-muted">Searching…</li>}
          {!busy && q.trim().length >= 2 && results.length === 0 && <li className="px-3 py-2 text-sm text-muted">No records match “{q.trim()}”.</li>}
        </ul>
      </div>
    </Dialog>
  );
}

const IDEA_FORMATS = ['MUSIC_SINGLE', 'LYRIC_VIDEO', 'PERFORMANCE_REEL', 'SHORTS', 'BEHIND_THE_SCENES', 'PRODUCT_UGC', 'TRAVEL_VLOG', 'EDUCATION', 'OTHER'];

export function QuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<'idea' | 'action' | 'inquiry'>('idea');
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  useEffect(() => {
    if (open) setF({});
  }, [open, kind]);

  const submit = async () => {
    if (kind === 'idea') {
      if (!f.title?.trim()) throw new Error('Give the idea a title.');
      await post('/ideas', { title: f.title.trim(), pitch: f.pitch || undefined, format: f.format || undefined });
      await refresh('/ideas', '/briefing');
      toast.ok('Idea captured');
    } else if (kind === 'action') {
      if (!f.title?.trim()) throw new Error('Describe what needs doing.');
      await post('/actions', { title: f.title.trim(), priority: f.priority || undefined, dueAt: f.due ? new Date(`${f.due}T17:00:00`).toISOString() : undefined });
      await refresh('/actions', '/briefing');
      toast.ok('Added to your queue');
    } else {
      if (!f.brand?.trim() || !f.subject?.trim()) throw new Error('Brand and subject are required.');
      await post('/intake', { brand: f.brand.trim(), subject: f.subject.trim(), contactName: f.contactName || undefined, contactEmail: f.contactEmail || undefined, notes: f.notes || undefined, source: 'MANUAL' });
      await refresh('/threads', '/deals', '/briefing');
      toast.ok('Inquiry logged for triage');
    }
  };

  return (
    <FormDialog open={open} onClose={onClose} title="Quick add" submitLabel="Add" onSubmit={submit}>
      <Field label="What are you adding?">
        <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="idea">Content idea</option>
          <option value="action">To-do / reminder</option>
          <option value="inquiry">Brand inquiry (manual)</option>
        </Select>
      </Field>
      {kind === 'idea' && (
        <>
          <Field label="Title"><Input autoFocus value={f.title ?? ''} onChange={set('title')} placeholder="e.g. Rooftop acoustic session" /></Field>
          <Field label="One-line pitch (optional)"><Textarea rows={2} value={f.pitch ?? ''} onChange={set('pitch')} /></Field>
          <Field label="Format"><Select value={f.format ?? ''} onChange={set('format')}><option value="">—</option>{IDEA_FORMATS.map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</Select></Field>
        </>
      )}
      {kind === 'action' && (
        <>
          <Field label="Task"><Input autoFocus value={f.title ?? ''} onChange={set('title')} placeholder="e.g. Send revised invoice to Acme" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Due"><Input type="date" min={dateInput()} value={f.due ?? ''} onChange={set('due')} /></Field>
            <Field label="Priority"><Select value={f.priority ?? 'NORMAL'} onChange={set('priority')}>{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</Select></Field>
          </div>
        </>
      )}
      {kind === 'inquiry' && (
        <>
          <Field label="Brand / company"><Input autoFocus value={f.brand ?? ''} onChange={set('brand')} /></Field>
          <Field label="Subject"><Input value={f.subject ?? ''} onChange={set('subject')} placeholder="What are they asking for?" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact name"><Input value={f.contactName ?? ''} onChange={set('contactName')} /></Field>
            <Field label="Contact e-mail"><Input type="email" value={f.contactEmail ?? ''} onChange={set('contactEmail')} /></Field>
          </div>
          <Field label="Notes"><Textarea value={f.notes ?? ''} onChange={set('notes')} /></Field>
        </>
      )}
    </FormDialog>
  );
}
