'use client';

import { use, useEffect, useState } from 'react';
import { BrandLogo } from '@/components/brand-mark';
import { Button, Field, Input, Textarea } from '@/components/ui';

type Kit = {
  artistName: string;
  positioning: string;
  bio: string;
  photos: { url: string; alt: string }[];
  platforms: { platform: string; handle: string; url: string | null; followers: number | null; followersState: string; source: string | null; updatedAt: string | null }[];
  topContent: { title: string | null; platform: string; url: string | null; views: number; provenance: string }[];
  collaborations: { name: string; note: string }[];
  contact: { email: string | null };
  period: { label: string };
  updatedAt: string | null;
  sources: string[];
};

export default function PublicKitPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [kit, setKit] = useState<Kit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    let stop = false;
    void fetch(`/api/v1/public/media-kits/${encodeURIComponent(slug)}`, { headers: { accept: 'application/json' } })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message || 'This page is not published.');
        if (!stop) setKit(json.data);
      })
      .catch((e: Error) => {
        if (!stop) setError(e.message);
      });
    return () => {
      stop = true;
    };
  }, [slug]);
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <BrandLogo className="h-12" />
      {error && <p className="text-sm text-warn">{error}</p>}
      {kit && (
        <>
          <header>
            <h1 className="text-3xl font-semibold">{kit.artistName}</h1>
            {kit.positioning && <p className="mt-1 text-muted">{kit.positioning}</p>}
            {kit.bio && <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{kit.bio}</p>}
            <p className="mt-2 text-xs text-muted">{kit.period.label}{kit.updatedAt ? ` · updated ${new Date(kit.updatedAt).toLocaleString()}` : ''}</p>
          </header>
          <section className="grid gap-3 sm:grid-cols-3">
            {kit.platforms.map((p) => (
              <article key={p.platform} className="rounded-xl border border-border bg-panel p-3">
                <h2 className="text-sm font-medium">{p.platform}</h2>
                <p className="text-sm">{p.url ? <a href={p.url}>{p.handle}</a> : p.handle}</p>
                <p className="mt-2 text-xl font-semibold tabular-nums">
                  {p.followersState === 'VALUE' || p.followersState === 'ZERO' ? p.followers?.toLocaleString() : 'Unavailable'}
                </p>
                <p className="text-xs text-muted">{p.source || 'No verified follower snapshot'}</p>
              </article>
            ))}
          </section>
          {kit.topContent.length > 0 && (
            <section>
              <h2 className="mb-2 font-medium">Top posts</h2>
              <ul className="space-y-2 text-sm">
                {kit.topContent.map((p) => (
                  <li key={`${p.platform}-${p.url}`}>
                    {p.url ? <a href={p.url}>{p.title || p.url}</a> : p.title} · {p.views.toLocaleString()} views · {p.provenance}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {kit.collaborations.length > 0 && (
            <section>
              <h2 className="mb-2 font-medium">Collaborations</h2>
              <ul className="text-sm">{kit.collaborations.map((c) => <li key={c.name}>{c.name}{c.note ? ` — ${c.note}` : ''}</li>)}</ul>
            </section>
          )}
          {kit.sources.map((s) => <p key={s} className="text-xs text-muted">{s}</p>)}
          <form
            className="space-y-3 rounded-xl border border-border bg-panel p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const res = await fetch(`/api/v1/public/media-kits/${encodeURIComponent(slug!)}/inquiries`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-requested-with': 'creatoros' },
                body: JSON.stringify({ name: data.get('name'), email: data.get('email'), message: data.get('message') }),
              });
              if (!res.ok) {
                const json = await res.json().catch(() => null);
                setError(json?.error?.message || 'Could not send that.');
                return;
              }
              setSent(true);
            }}
          >
            <h2 className="font-medium">Inquiry</h2>
            {sent ? <p className="text-sm">Sent. Nothing was posted publicly.</p> : (
              <>
                <Field label="Name"><Input name="name" required /></Field>
                <Field label="Email"><Input name="email" type="email" required /></Field>
                <Field label="Message"><Textarea name="message" required rows={4} /></Field>
                <Button type="submit" variant="primary">Send</Button>
              </>
            )}
          </form>
        </>
      )}
    </main>
  );
}
