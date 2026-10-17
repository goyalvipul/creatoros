'use client';

import Link from 'next/link';
import { Pin, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Async,
  Badge,
  Card,
  Button,
  EmptyState,
  Field,
  FormDialog,
  Input,
  Options,
  PageHeader,
  Select,
  StateBadge,
  Tabs,
} from '@/components/ui';
import { post, useApi } from '@/lib/api';
import { title as titleCase, when } from '@/lib/format';
import { PROJECT_STAGES, PROJECT_TYPES, useBrands } from '@/lib/options';
import { useMe } from '@/components/shell';

export default function ProductionPage() {
  const router = useRouter();
  const me = useMe();
  const tz = me.data?.organization?.timezone;
  const [stage, setStage] = useState('ACTIVE');
  const projects = useApi<any[]>('/projects', { query: { limit: 200 } });
  const brands = useBrands();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: '', type: 'SHORT_FORM', brandId: '', dueAt: '' });

  const all = projects.data ?? [];
  const count = (s: string) => all.filter((p) => p.stage === s).length;
  const visible = all.filter((p) => (stage === 'ACTIVE' ? p.stage !== 'ARCHIVED' : p.stage === stage));
  const brandName = (id?: string) => brands.find((b) => b.id === id)?.name;

  return (
    <>
      <PageHeader
        title="Production"
        subtitle="Projects move from draft to distribution. The checklist keeps you honest before anything is marked ready."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> New project
          </Button>
        }
      />
      <Tabs
        tabs={[
          { id: 'ACTIVE', label: 'All active' },
          ...PROJECT_STAGES.map((s) => ({
            id: s,
            label: titleCase(s),
            badge: count(s) ? <span className="text-xs opacity-70">{count(s)}</span> : undefined,
          })),
        ]}
        value={stage}
        onChange={setStage}
      />
      <Async
        res={{
          ...projects,
          data:
            visible.length || projects.isLoading || projects.error
              ? projects.data
                ? visible
                : undefined
              : [],
        }}
        empty={
          <EmptyState
            title="No projects here"
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                Start a project
              </Button>
            }
          >
            Convert an idea or create a project directly.
          </EmptyState>
        }
      >
        {(rows) => (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/production/${p.id}`}
                  className="block h-full rounded-xl focus-visible:outline-2"
                >
                  <Card className="h-full transition-colors hover:border-accent/60">
                    <div className="flex items-start gap-2">
                      <h3 className="min-w-0 flex-1 font-medium">{p.title}</h3>
                      {p.pinned && <Pin className="size-4 text-accent" aria-label="Pinned" />}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <StateBadge state={p.stage} />
                      <Badge>{titleCase(p.type)}</Badge>
                      {brandName(p.brandId) && <Badge tone="info">{brandName(p.brandId)}</Badge>}
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-muted">
                      {p.sceneTotal > 0 && (
                        <div>
                          <div className="mb-1 flex justify-between">
                            <span>Scenes selected</span>
                            <span>
                              {p.sceneSelected}/{p.sceneTotal}
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
                            <div
                              className="h-full bg-accent"
                              style={{ width: `${(100 * p.sceneSelected) / p.sceneTotal}%` }}
                            />
                          </div>
                        </div>
                      )}
                      <div>
                        {p.openRequired} required checklist item{p.openRequired === 1 ? '' : 's'} open
                      </div>
                      {p.dueAt && <div>Due {when(p.dueAt, tz, false)}</div>}
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Async>

      <FormDialog
        open={adding}
        onClose={() => setAdding(false)}
        title="New project"
        submitLabel="Create"
        onSubmit={async () => {
          const p = await post('/projects', {
            title: f.title.trim(),
            type: f.type,
            brandId: f.brandId || undefined,
            dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : undefined,
          });
          setAdding(false);
          router.push(`/production/${p.id}`);
        }}
      >
        <Field label="Title">
          <Input required autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <Options values={PROJECT_TYPES} />
            </Select>
          </Field>
          <Field label="Due (optional)">
            <Input type="date" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} />
          </Field>
        </div>
        <Field label="Brand">
          <Select value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })}>
            <option value="">No brand</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      </FormDialog>
    </>
  );
}
