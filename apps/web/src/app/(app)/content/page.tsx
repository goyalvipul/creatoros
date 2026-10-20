'use client';

import { richHtmlToText } from '@creatoros/domain';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Lightbulb, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  ActionButton,
  Async,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormDialog,
  Input,
  Options,
  PageHeader,
  Select,
  StateBadge,
} from '@/components/ui';
import { del, patch, post, refresh, useApi } from '@/lib/api';
import { ago, title as titleCase } from '@/lib/format';
import { hasIdeaDraft } from '@/lib/idea-draft';
import { IDEA_STATUSES, PROJECT_TYPES, useBrands } from '@/lib/options';

function preview(idea: { conceptDetail?: string | null; pitch?: string | null }) {
  const text = richHtmlToText(idea.conceptDetail ?? '') || idea.pitch || '';
  if (!text) return null;
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

export default function ContentPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [brandId, setBrandId] = useState('');
  const [q, setQ] = useState('');
  const ideas = useApi<any[]>('/ideas', {
    query: { status: status || undefined, brandId: brandId || undefined, q: q || undefined, limit: 200 },
  });
  const brands = useBrands();
  const [converting, setConverting] = useState<any>(null);
  const [cv, setCv] = useState({ title: '', type: 'OTHER', dueAt: '' });
  const [resume, setResume] = useState(false);
  const reload = () => refresh('/ideas');
  useEffect(() => {
    setResume(hasIdeaDraft('new'));
  }, []);

  return (
    <>
      <PageHeader
        title="Content ideas"
        subtitle="Capture first, decide later. Approved ideas become production projects with a checklist."
        actions={
          <Button variant="primary" onClick={() => router.push('/content/new')}>
            <Plus className="size-4" /> {resume ? 'Resume writing' : 'New idea'}
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          aria-label="Search ideas"
          placeholder="Search ideas"
          className="w-56"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <Options values={IDEA_STATUSES} none="Any status" />
        </Select>
        <Select aria-label="Brand" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
          <option value="">Any brand</option>
          {brands.map((b: any) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>

      <Async
        res={ideas}
        empty={
          <EmptyState
            title="No ideas yet"
            action={
              <Button variant="primary" onClick={() => router.push('/content/new')}>
                {resume ? 'Resume writing' : 'Capture your first idea'}
              </Button>
            }
          >
            Anything counts: a hook, a lyric line, a trip, a collab pitch.
          </EmptyState>
        }
      >
        {(rows) => (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((i) => (
              <li key={i.id}>
                <Card className="h-full">
                  <div className="flex items-start gap-2">
                    <Lightbulb className="mt-0.5 size-4 shrink-0 text-warn" />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium">
                        <Link href={`/content/${i.id}`} className="hover:text-accent">
                          {i.title}
                        </Link>
                      </h3>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <StateBadge state={i.status} />
                        <Badge>{titleCase(i.format)}</Badge>
                        {i.priority !== 'NORMAL' && (
                          <Badge tone={i.priority === 'LOW' ? 'neutral' : 'warn'}>
                            {i.priority.toLowerCase()}
                          </Badge>
                        )}
                        {i.isDemo && <Badge tone="info">demo</Badge>}
                      </div>
                      {preview(i) && <p className="mt-2 text-sm text-muted">{preview(i)}</p>}
                      <p className="mt-2 text-xs text-muted">Captured {ago(i.createdAt)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => router.push(`/content/${i.id}`)}>
                      Edit
                    </Button>
                    {i.status === 'NEW' && (
                      <ActionButton
                        size="sm"
                        onAction={async () => {
                          await patch(`/ideas/${i.id}`, { status: 'RESEARCHING' });
                          await reload();
                        }}
                      >
                        Start researching
                      </ActionButton>
                    )}
                    {(i.status === 'NEW' || i.status === 'RESEARCHING') && (
                      <ActionButton
                        size="sm"
                        onAction={async () => {
                          await patch(`/ideas/${i.id}`, { status: 'APPROVED' });
                          await reload();
                        }}
                      >
                        Approve
                      </ActionButton>
                    )}
                    {i.status !== 'REJECTED' && i.status !== 'ARCHIVED' && (
                      <ActionButton
                        size="sm"
                        confirm="Reject this idea? You can still find it under the Rejected filter."
                        onAction={async () => {
                          await patch(`/ideas/${i.id}`, { status: 'REJECTED' });
                          await reload();
                        }}
                      >
                        Reject
                      </ActionButton>
                    )}
                    {i.status === 'REJECTED' && (
                      <ActionButton
                        size="sm"
                        onAction={async () => {
                          await patch(`/ideas/${i.id}`, { status: 'NEW' });
                          await reload();
                        }}
                      >
                        Bring back
                      </ActionButton>
                    )}
                    {i.status !== 'ARCHIVED' ? (
                      <ActionButton
                        size="sm"
                        onAction={async () => {
                          await patch(`/ideas/${i.id}`, { status: 'ARCHIVED' });
                          await reload();
                        }}
                      >
                        Archive
                      </ActionButton>
                    ) : (
                      <ActionButton
                        size="sm"
                        variant="primary"
                        onAction={async () => {
                          await patch(`/ideas/${i.id}`, { status: i.archivedFrom || 'NEW' });
                          await reload();
                        }}
                      >
                        Bring back
                      </ActionButton>
                    )}
                    {!i.convertedProjectId && i.status !== 'REJECTED' && i.status !== 'ARCHIVED' && (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setCv({
                            title: i.title.replace(/^DEMO Idea: /, 'DEMO '),
                            type: 'OTHER',
                            dueAt: '',
                          });
                          setConverting(i);
                        }}
                      >
                        Make a project
                      </Button>
                    )}
                    {i.convertedProjectId && (
                      <Link className="self-center text-sm text-accent" href={`/production/${i.convertedProjectId}`}>
                        Open project →
                      </Link>
                    )}
                    <ActionButton
                      size="sm"
                      variant="danger"
                      confirm="Delete this idea? A project already made from it stays in Production."
                      onAction={async () => {
                        await del(`/ideas/${i.id}`);
                        await reload();
                      }}
                    >
                      Delete
                    </ActionButton>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Async>

      <FormDialog
        open={Boolean(converting)}
        onClose={() => setConverting(null)}
        title="Make a production project"
        submitLabel="Create project"
        onSubmit={async () => {
          const p = await post(`/ideas/${converting.id}/convert`, {
            title: cv.title.trim() || undefined,
            type: cv.type,
            dueAt: cv.dueAt ? new Date(cv.dueAt).toISOString() : undefined,
          });
          await reload();
          setConverting(null);
          router.push(`/production/${p.project?.id ?? p.id}`);
        }}
      >
        <Field label="Project title">
          <Input required value={cv.title} onChange={(e) => setCv({ ...cv, title: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={cv.type} onChange={(e) => setCv({ ...cv, type: e.target.value })}>
              <Options values={PROJECT_TYPES} />
            </Select>
          </Field>
          <Field label="Due (optional)">
            <Input type="date" value={cv.dueAt} onChange={(e) => setCv({ ...cv, dueAt: e.target.value })} />
          </Field>
        </div>
        <p className="text-xs text-muted">
          A checklist for this project type is added automatically; you can edit it afterwards.
        </p>
      </FormDialog>
    </>
  );
}
