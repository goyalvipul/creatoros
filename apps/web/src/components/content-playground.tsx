'use client';

import { richHtmlToText, BUILT_IN_TEMPLATES } from '@creatoros/domain';
import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CreativeFields, RichEditor, creativeFrom, creativePayload, type CreativeForm } from '@/components/creative-fields';
import {
  Async,
  Button,
  Dialog,
  Field,
  FormDialog,
  Input,
  Options,
  Select,
} from '@/components/ui';
import { del, patch, post, refresh, useApi } from '@/lib/api';
import { title as titleCase } from '@/lib/format';
import { IDEA_FORMATS, IDEA_STATUSES, PRIORITIES, PROJECT_TYPES, useBrands } from '@/lib/options';

type IdeaRow = {
  id: string;
  title: string;
  pitch?: string | null;
  conceptDetail?: string | null;
  status: string;
  format: string;
  priority: string;
  brandId?: string | null;
  convertedProjectId?: string | null;
  isDemo?: boolean;
  archivedFrom?: string | null;
  audience?: string | null;
  createdAt?: string | null;
};

type IdeaDetail = IdeaRow & CreativeForm & {
  contentPillars?: string[] | null;
  score?: number | null;
  language?: string | null;
  channelId?: string | null;
  notes?: string | null;
  genre?: string | null;
  tags?: string[] | null;
  lyricsDraft?: string | null;
  storyboard?: string | null;
  creativeBrief?: string | null;
  referenceLinks?: string[] | null;
  effortHours?: number | null;
};

const COLORS = ['#fff0ca', '#e6eddf', '#f8e2dd'];
const COLOR_PREFIX = 'sticky:';
const COLOR_STORE = 'cos-idea-colors';

function storedColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(COLOR_STORE);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function colorFromTags(tags?: string[] | null) {
  const hit = (tags ?? []).find((tag) => tag.startsWith(COLOR_PREFIX));
  return hit ? hit.slice(COLOR_PREFIX.length) : null;
}

function blurb(idea: { conceptDetail?: string | null; pitch?: string | null }) {
  const text = richHtmlToText(idea.conceptDetail ?? '') || idea.pitch || '';
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function capturedAgo(iso?: string | null) {
  if (!iso) return '';
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `Captured ${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `Captured ${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `Captured ${hr}h ago`;
  return `Captured ${Math.round(hr / 24)}d ago`;
}

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  NEW: { bg: '#dbe7ff', fg: '#1e4d8c' },
  RESEARCHING: { bg: '#ffe7c2', fg: '#8a4b08' },
  APPROVED: { bg: '#d7f0df', fg: '#1d6b3a' },
  REJECTED: { bg: '#ffd6d6', fg: '#8d2a2a' },
  ARCHIVED: { bg: '#e6e6e2', fg: '#4a4a46' },
};

function statusTone(status: string) {
  return STATUS_TONE[status] ?? { bg: '#efeae2', fg: '#1c1916' };
}

/** Same transitions as the live Content list. */
function statusChoices(idea: { status: string; archivedFrom?: string | null }) {
  const choices: { status: string; label: string }[] = [];
  if (idea.status === 'NEW') choices.push({ status: 'RESEARCHING', label: 'Start researching' });
  if (idea.status === 'NEW' || idea.status === 'RESEARCHING') choices.push({ status: 'APPROVED', label: 'Approve' });
  if (idea.status !== 'REJECTED' && idea.status !== 'ARCHIVED') choices.push({ status: 'REJECTED', label: 'Reject' });
  if (idea.status === 'REJECTED') choices.push({ status: 'NEW', label: 'Bring back' });
  if (idea.status !== 'ARCHIVED') choices.push({ status: 'ARCHIVED', label: 'Archive' });
  else choices.push({ status: idea.archivedFrom || 'NEW', label: 'Bring back' });
  return choices;
}

function nextStickyColor(rows: IdeaRow[], wallColors: Record<string, string>) {
  const latest = rows[0];
  const prev = latest ? (wallColors[latest.id] ?? COLORS[0] ?? '') : '';
  const idx = COLORS.indexOf(prev);
  return COLORS[(idx + 1) % COLORS.length] ?? COLORS[0] ?? '#fff0ca';
}

export function ContentPlayground() {
  const router = useRouter();
  const brands = useBrands();
  const channels = useApi<any[]>('/channels');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [brandId, setBrandId] = useState('');
  const ideas = useApi<IdeaRow[]>('/ideas', {
    query: { status: status || undefined, brandId: brandId || undefined, q: q || undefined, limit: 200 },
  });
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [openNonce, setOpenNonce] = useState(0);
  const [noteColor, setNoteColor] = useState(COLORS[0] ?? '#fff0ca');
  const [wallColors, setWallColors] = useState<Record<string, string>>({});
  const [flickId, setFlickId] = useState<string | null>(null);
  const closing = useRef(false);
  const dismissToken = useRef(0);
  const colorTouched = useRef(false);
  const detail = useApi<IdeaDetail>(selectedId && selectedId !== 'new' ? `/ideas/${selectedId}` : null);
  const [draft, setDraft] = useState<IdeaDetail | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateKey, setTemplateKey] = useState('general');
  const [converting, setConverting] = useState(false);
  const [projectType, setProjectType] = useState('OTHER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cardError, setCardError] = useState('');
  const [cardBusy, setCardBusy] = useState<string | null>(null);
  const [convertId, setConvertId] = useState<string | null>(null);
  const [convertTitle, setConvertTitle] = useState('');
  const [picker, setPicker] = useState<{ id: string; kind: 'status' | 'brand' } | null>(null);
  const assignedBrand = useRef(new Set<string>());

  useEffect(() => {
    setWallColors(storedColors());
  }, []);

  useEffect(() => {
    if (selectedId !== 'new' || brands.length !== 1) return;
    const id = brands[0]?.id;
    if (!id) return;
    setDraft((current) => (current && current.id === 'new' && !current.brandId ? { ...current, brandId: id } : current));
  }, [selectedId, brands]);

  useEffect(() => {
    if (brands.length !== 1) return;
    const only = brands[0];
    if (!only) return;
    const missing = (ideas.data ?? []).filter((idea) => !idea.brandId && !assignedBrand.current.has(idea.id));
    if (missing.length === 0) return;
    for (const idea of missing) assignedBrand.current.add(idea.id);
    void (async () => {
      await Promise.all(missing.map((idea) => patch(`/ideas/${idea.id}`, { brandId: only.id })));
      await refresh('/ideas');
    })();
  }, [brands, ideas.data]);

  const rememberColor = (id: string, color: string) => {
    const next = { ...storedColors(), [id]: color };
    try {
      localStorage.setItem(COLOR_STORE, JSON.stringify(next));
    } catch {
      /* private mode */
    }
    setWallColors(next);
  };

  useEffect(() => {
    if (selectedId === 'new') {
      colorTouched.current = false;
      setDraft({
        id: 'new',
        title: '',
        status: 'NEW',
        format: 'OTHER',
        priority: 'NORMAL',
        language: 'en',
        brandId: brands.length === 1 ? brands[0]?.id ?? null : null,
        contentPillars: [],
        score: null,
        ...creativeFrom({}),
      });
      return;
    }
    if (detail.data && detail.data.id === selectedId) {
      setDraft({ ...detail.data, ...creativeFrom(detail.data) });
      const saved = colorFromTags(detail.data.tags);
      if (saved && !colorTouched.current) {
        setNoteColor(saved);
        rememberColor(detail.data.id, saved);
      }
    }
  }, [selectedId, detail.data]);

  const pillarText = (draft?.contentPillars ?? []).join(',');

  const openNote = (id: string | 'new', color: string) => {
    dismissToken.current += 1;
    closing.current = false;
    colorTouched.current = false;
    setNoteColor(color);
    setFlickId(id === 'new' ? null : id);
    setSelectedId(id);
    setOpenNonce((n) => n + 1);
  };

  const freshColor = () => nextStickyColor(ideas.data ?? [], wallColors);

  const patchIdea = async (id: string, body: { status?: string; brandId?: string | null }) => {
    setCardBusy(id);
    setCardError('');
    try {
      await patch(`/ideas/${id}`, body);
      await refresh('/ideas');
    } catch (e) {
      setCardError(e instanceof Error ? e.message : 'That change was not saved.');
    } finally {
      setCardBusy(null);
    }
  };

  const startConvert = (id: string, title: string) => {
    setConvertId(id);
    setConvertTitle(title);
    setProjectType('OTHER');
    setConverting(true);
  };

  const persist = async (current: IdeaDetail, id: string | 'new', color: string) => {
    if (!current.title.trim()) return null;
    setBusy(true);
    setError('');
    try {
      const body = {
        title: current.title.trim(),
        format: current.format,
        priority: current.priority,
        status: current.status,
        brandId: current.brandId || (brands.length === 1 ? brands[0]?.id ?? null : null),
        channelId: current.channelId || null,
        language: current.language || 'en',
        contentPillars: (current.contentPillars ?? []).map((p) => p.trim()).filter(Boolean),
        score: current.score ?? null,
        notes: current.notes ?? null,
        genre: current.genre ?? null,
        tags: [...(current.tags ?? []).filter((tag) => !tag.startsWith(COLOR_PREFIX)), `${COLOR_PREFIX}${color}`],
        lyricsDraft: current.lyricsDraft ?? null,
        storyboard: current.storyboard ?? null,
        creativeBrief: current.creativeBrief ?? null,
        referenceLinks: current.referenceLinks ?? [],
        effortHours: current.effortHours ?? null,
        pitch: null,
        ...creativePayload(current),
      };
      if (id === 'new') {
        const created = await post<IdeaDetail>('/ideas', body);
        rememberColor(created.id, color);
        await refresh('/ideas');
        return created.id;
      }
      await patch(`/ideas/${id}`, body);
      rememberColor(id, color);
      await refresh('/ideas');
      return id;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That idea was not saved.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft || selectedId == null) return;
    const savedId = await persist(draft, selectedId, noteColor);
    if (!savedId) return;
    dismissToken.current += 1;
    closing.current = true;
    setSelectedId(null);
    setDraft(null);
  };

  const dismiss = async () => {
    if (closing.current) return;
    closing.current = true;
    const token = ++dismissToken.current;
    const snapshot = draft;
    const id = selectedId;
    const color = noteColor;
    setSelectedId(null);
    setDraft(null);
    try {
      if (snapshot?.title.trim() && id) {
        const saved = await persist(snapshot, id, color);
        if (token !== dismissToken.current) return;
        if (!saved) {
          setSelectedId(id);
          setDraft(snapshot);
          setNoteColor(color);
          setOpenNonce((n) => n + 1);
        }
      }
    } finally {
      if (token === dismissToken.current) closing.current = false;
    }
  };

  useEffect(() => {
    if (selectedId == null) closing.current = false;
  }, [selectedId]);

  return (
    <div>
      <div className="mb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
            Creative sandbox · separate from Production
          </p>
          <h1 className="mt-1 font-serif text-3xl tracking-tight">Content playground</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => openNote('new', freshColor())}>
            + Capture idea
          </Button>
          <Button onClick={() => setTemplatesOpen(true)}>Templates</Button>
        </div>
        </div>
        <p className="mt-1 whitespace-nowrap text-[12px] leading-none text-muted">
          An intentionally unstructured space for ideas, lyrics, links, rough notes and experiments. Nothing becomes a project until you decide.
        </p>
      </div>

      <div className="mb-4 flex flex-nowrap items-center gap-2">
        <Input aria-label="Search ideas" placeholder="Search ideas" className="!w-auto min-w-0 flex-1" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto min-w-36 shrink-0">
          <Options values={IDEA_STATUSES} none="Any status" />
        </Select>
        <Select aria-label="Brand" value={brandId} onChange={(e) => setBrandId(e.target.value)} className="!w-auto min-w-36 shrink-0">
          <option value="">Any brand</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <section className="idea-board rounded-2xl border border-border bg-panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Your idea wall</h2>
              <p className="text-xs text-muted">Explore before committing. Select any note to refine it.</p>
            </div>
            <span className="rounded-full bg-panel2 px-2 py-1 text-xs text-muted">{ideas.data?.length ?? 0} ideas</span>
          </div>
          <Async res={ideas}>
            {(rows) => (
              <ul className="idea-wall">
                {cardError && (
                  <li className="col-span-full">
                    <p className="text-sm text-bad">{cardError}</p>
                  </li>
                )}
                {rows.length === 0 && (
                  <li className="col-span-full">
                    <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
                      No ideas yet. Capture one and it shows up here as a colored note.
                    </p>
                  </li>
                )}
                {rows.map((idea, i) => {
                  const color = wallColors[idea.id] ?? COLORS[i % COLORS.length] ?? '#fff0ca';
                  return (
                    <li key={idea.id}>
                      <article
                        onClick={() => {
                          setPicker(null);
                          openNote(idea.id, color);
                        }}
                        onAnimationEnd={() => setFlickId((current) => (current === idea.id ? null : current))}
                        className={clsx(
                          'idea-note relative flex h-full min-h-48 cursor-pointer flex-col rounded-2xl p-5 text-left text-[#1c1916]',
                          flickId === idea.id && 'idea-flick',
                        )}
                        style={{
                          ['--note' as string]: color,
                          backgroundColor: color,
                        }}
                      >
                        <h3 className="pr-7 font-serif text-xl leading-snug tracking-tight">{idea.title}</h3>
                        <button
                          type="button"
                          aria-label={`Remove ${idea.title}`}
                          className="absolute right-3 top-3 grid size-7 place-items-center rounded-full text-base leading-none text-[#1c1916]/60 hover:bg-black/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!window.confirm('Remove this idea? A project already made from it stays in Production.')) return;
                            void (async () => {
                              if (selectedId === idea.id) {
                                dismissToken.current += 1;
                                closing.current = true;
                                setSelectedId(null);
                                setDraft(null);
                              }
                              await del(`/ideas/${idea.id}`);
                              await refresh('/ideas');
                            })();
                          }}
                        >
                          ×
                        </button>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <div className="relative">
                            <button
                              type="button"
                              aria-haspopup="menu"
                              aria-expanded={picker?.id === idea.id && picker.kind === 'status'}
                              disabled={cardBusy === idea.id}
                              onClick={() =>
                                setPicker((current) =>
                                  current?.id === idea.id && current.kind === 'status' ? null : { id: idea.id, kind: 'status' },
                                )
                              }
                              className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                              style={{ background: statusTone(idea.status).bg, color: statusTone(idea.status).fg }}
                            >
                              {titleCase(idea.status)}
                            </button>
                            {picker?.id === idea.id && picker.kind === 'status' && (
                              <div role="menu" aria-label="Idea status" className="absolute left-0 top-full z-20 mt-1 flex w-52 flex-wrap gap-1.5 rounded-xl border border-black/10 bg-white p-2 shadow-lg">
                                {statusChoices(idea).map((choice) => (
                                  <button
                                    key={`${choice.label}-${choice.status}`}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={idea.status === choice.status}
                                    className={clsx(
                                      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap',
                                      idea.status === choice.status && 'ring-2 ring-[#233f36] ring-offset-1 ring-offset-white',
                                    )}
                                    style={{ background: statusTone(choice.status).bg, color: statusTone(choice.status).fg }}
                                    onClick={() => {
                                      if (
                                        choice.status === 'REJECTED' &&
                                        !window.confirm('Reject this idea? You can still find it under the Rejected filter.')
                                      ) {
                                        return;
                                      }
                                      setPicker(null);
                                      void patchIdea(idea.id, { status: choice.status });
                                    }}
                                  >
                                    {choice.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="relative">
                            {brands.length > 1 ? (
                              <button
                                type="button"
                                aria-haspopup="menu"
                                aria-expanded={picker?.id === idea.id && picker.kind === 'brand'}
                                disabled={cardBusy === idea.id}
                                onClick={() =>
                                  setPicker((current) =>
                                    current?.id === idea.id && current.kind === 'brand' ? null : { id: idea.id, kind: 'brand' },
                                  )
                                }
                                className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold"
                              >
                                {brands.find((b) => b.id === idea.brandId)?.name ?? 'No brand'}
                              </button>
                            ) : (
                              <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold">
                                {brands[0]?.name ?? 'No brand'}
                              </span>
                            )}
                            {picker?.id === idea.id && picker.kind === 'brand' && brands.length > 1 && (
                              <div role="menu" aria-label="Brand" className="absolute left-0 top-full z-20 mt-1 flex w-52 flex-wrap gap-1.5 rounded-xl border border-black/10 bg-white p-2 shadow-lg">
                                {brands.map((brand) => (
                                  <button
                                    key={brand.id}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={idea.brandId === brand.id}
                                    className={clsx(
                                      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap',
                                      idea.brandId === brand.id ? 'bg-[#d7f0df] ring-2 ring-[#233f36] ring-offset-1 ring-offset-white' : 'bg-[#f3f1ea]',
                                    )}
                                    onClick={() => {
                                      setPicker(null);
                                      void patchIdea(idea.id, { brandId: brand.id });
                                    }}
                                  >
                                    {brand.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        {blurb(idea) && <p className="mt-3 line-clamp-4 text-sm leading-relaxed opacity-80">{blurb(idea)}</p>}
                        <p className="mt-auto pt-4 text-xs opacity-70">
                          {capturedAgo(idea.createdAt)}
                          {idea.convertedProjectId ? ' · has a project' : ''}
                        </p>
                        {(idea.convertedProjectId || (idea.status !== 'REJECTED' && idea.status !== 'ARCHIVED')) && (
                        <div className="mt-2 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                          {idea.convertedProjectId ? (
                            <Link
                              href={`/production/${idea.convertedProjectId}`}
                              className="rounded-lg bg-[#233f36] px-2 py-1 text-[11px] font-semibold text-white"
                            >
                              Open project
                            </Link>
                          ) : (
                            <button
                              type="button"
                              className="rounded-lg bg-[#233f36] px-2 py-1 text-[11px] font-semibold text-white"
                              onClick={() => startConvert(idea.id, idea.title)}
                            >
                              Make a project
                            </button>
                          )}
                        </div>
                        )}
                      </article>
                    </li>
                  );
                })}
                <li>
                  <button
                    type="button"
                    onClick={() => openNote('new', freshColor())}
                    className="flex h-full min-h-48 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#c5d4c2] bg-[#f4f7f2] text-sm text-muted"
                  >
                    <span className="text-lg leading-none">+</span>
                    Another thought
                  </button>
                </li>
              </ul>
            )}
          </Async>
        </section>

        <Dialog
          open={selectedId != null}
          onClose={() => {
            void dismiss();
          }}
          title={selectedId === 'new' ? 'Catch a thought' : 'Selected idea'}
          wide
          nonce={openNonce}
          surface={noteColor}
          footer={
            draft ? (
              <>
                {selectedId && selectedId !== 'new' && !draft.convertedProjectId && (
                  <Button variant="primary" onClick={() => startConvert(selectedId, draft.title)}>
                    Convert to project
                  </Button>
                )}
                <Button onClick={() => void save()} busy={busy} disabled={!draft.title.trim()} className="!bg-[#233f36] !text-[#fffaf6]">
                  Save idea
                </Button>
              </>
            ) : null
          }
        >
          {!draft && <p className="text-sm">Opening this note…</p>}
          {draft && (
            <div className="space-y-3">
              <div>
                <p className="mb-2 text-xs font-bold">Note color</p>
                <div className="flex gap-2">
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Sticky color ${color}`}
                      aria-pressed={noteColor === color}
                      onClick={() => {
                        colorTouched.current = true;
                        setNoteColor(color);
                      }}
                      className={clsx(
                        'size-8 rounded-full border border-black/10',
                        noteColor === color && 'ring-2 ring-[#1c1916] ring-offset-2',
                      )}
                      style={{ background: color }}
                    />
                  ))}
                </div>
              </div>
              <Field label="Working title">
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </Field>
              <Field label="Free-form notes">
                <RichEditor
                  key={draft.id}
                  value={draft.conceptDetail}
                  onChange={(conceptDetail) => setDraft({ ...draft, conceptDetail })}
                />
              </Field>
              <p className="text-xs text-muted">Messy is welcome. Drafts can remain unfinished.</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Category / pillar">
                  <Input
                    value={pillarText}
                    placeholder="Travel, music…"
                    onChange={(e) => setDraft({ ...draft, contentPillars: e.target.value.split(',') })}
                  />
                </Field>
                <Field label="Score">
                  <Select
                    value={
                      draft.score == null ? '' : String(draft.score > 10 ? Math.round(draft.score / 10) : draft.score)
                    }
                    onChange={(e) => setDraft({ ...draft, score: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">—</option>
                    {Array.from({ length: 11 }, (_, n) => (
                      <option key={n} value={n}>
                        {n}/10
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Audience / language / channel">
                <Input
                  value={draft.audience}
                  placeholder="Optional — rough thoughts are enough"
                  onChange={(e) => setDraft({ ...draft, audience: e.target.value })}
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Input
                    aria-label="Language"
                    value={draft.language ?? 'en'}
                    onChange={(e) => setDraft({ ...draft, language: e.target.value })}
                  />
                  <Select
                    aria-label="Channel"
                    value={draft.channelId ?? ''}
                    onChange={(e) => setDraft({ ...draft, channelId: e.target.value || null })}
                  >
                    <option value="">No channel</option>
                    {(channels.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Format">
                  <Select value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value })}>
                    <Options values={IDEA_FORMATS} />
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
                    <Options values={PRIORITIES} />
                  </Select>
                </Field>
              </div>
              <Field label="Status">
                <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                  <Options values={IDEA_STATUSES} />
                </Select>
              </Field>
              <Field label="Brand">
                <Select
                  value={draft.brandId ?? ''}
                  onChange={(e) => setDraft({ ...draft, brandId: e.target.value || null })}
                >
                  <option value="">No brand yet</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <CreativeFields
                formKey={`${draft.id}-rest`}
                showConcept={false}
                value={draft}
                onChange={(next) => setDraft({ ...draft, ...next })}
              />
              <Field label="Lyrics draft">
                <Input value={draft.lyricsDraft ?? ''} onChange={(e) => setDraft({ ...draft, lyricsDraft: e.target.value })} />
              </Field>
              <Field label="References" hint="One URL per line.">
                <Input
                  value={(draft.referenceLinks ?? []).join(' ')}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      referenceLinks: e.target.value.split(/\s+/).map((u) => u.trim()).filter(Boolean),
                    })
                  }
                />
              </Field>
              {error && <p className="text-sm text-bad">{error}</p>}
              {draft.convertedProjectId && (
                <Link className="block text-sm font-bold text-[#1f634f]" href={`/production/${draft.convertedProjectId}`}>
                  Open the Production project
                </Link>
              )}
              {selectedId && selectedId !== 'new' && (
                <Link className="block text-xs font-bold text-[#1f634f]" href={`/content/${selectedId}`}>
                  Open the full writing page
                </Link>
              )}
              <p className="rounded-xl bg-panel2 px-3 py-2 text-xs text-muted">
                Converting is explicit and keeps the backlink. Template for the next conversion:{' '}
                {BUILT_IN_TEMPLATES.find((t) => t.key === templateKey)?.name ?? templateKey}. An idea is never
                automatically moved into Production.
              </p>
            </div>
          )}
        </Dialog>
      </div>

      <FormDialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        title="Project template"
        submitLabel="Use this template"
        onSubmit={async () => setTemplatesOpen(false)}
      >
        <Field label="Used when you convert this idea">
          <Select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
            {BUILT_IN_TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-muted">The template builds the Production checklist. It does not create a project by itself.</p>
      </FormDialog>

      <FormDialog
        open={converting && convertId != null}
        onClose={() => {
          setConverting(false);
          setConvertId(null);
        }}
        title="Convert to a production project"
        submitLabel="Create project"
        onSubmit={async () => {
          if (!convertId || !convertTitle.trim()) return;
          if (selectedId === convertId) await save();
          const p = await post<{ project?: { id: string }; id?: string }>(`/ideas/${convertId}/convert`, {
            title: convertTitle.trim(),
            type: projectType,
            templateKey,
          });
          setConverting(false);
          setConvertId(null);
          router.push(`/production/${p.project?.id ?? p.id}`);
        }}
      >
        <Field label="Project title">
          <Input value={convertTitle} onChange={(e) => setConvertTitle(e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={projectType} onChange={(e) => setProjectType(e.target.value)}>
            <Options values={PROJECT_TYPES} />
          </Select>
        </Field>
        <p className="text-xs text-muted">
          Checklist template: {BUILT_IN_TEMPLATES.find((t) => t.key === templateKey)?.name}. Converting twice returns the
          same project.
        </p>
      </FormDialog>
    </div>
  );
}
