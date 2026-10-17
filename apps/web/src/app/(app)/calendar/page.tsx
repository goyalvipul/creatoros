'use client';

import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Async, Badge, Button, Card, EmptyState, PageHeader, StateBadge } from '@/components/ui';
import { useApi } from '@/lib/api';
import { parseDate, title as titleCase } from '@/lib/format';

const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function CalendarPage() {
  const now = new Date();
  const [cursor, setCursor] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const gridStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - cursor.getDay());
  const gridEnd = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + 42);
  const res = useApi<any>('/calendar', {
    query: { from: gridStart.toISOString(), to: gridEnd.toISOString() },
  });
  const [selected, setSelected] = useState(key(now));
  const shift = (n: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i),
  );

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Planned and published posts by day. Reminders only; nothing is posted automatically."
      />
      <div className="mb-3 flex items-center gap-2">
        <Button aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <h2 className="min-w-40 text-center text-lg font-semibold" aria-live="polite">
          {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h2>
        <Button aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight className="size-4" />
        </Button>
        <Button
          className="ml-auto"
          onClick={() => {
            setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
            setSelected(key(now));
          }}
        >
          Today
        </Button>
      </div>
      <Async res={res}>
        {(cal) => {
          const items = (d: string) => (cal.days?.[d] ?? []) as any[];
          const sel = items(selected);
          return (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <div
                  className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border text-xs"
                  role="grid"
                  aria-label="Month"
                >
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                    <div key={d} className="bg-panel2 py-1 text-center text-muted" role="columnheader">
                      {d}
                    </div>
                  ))}
                  {days.map((d) => {
                    const k = key(d);
                    const list = items(k);
                    const inMonth = d.getMonth() === cursor.getMonth();
                    return (
                      <button
                        key={k}
                        role="gridcell"
                        aria-label={`${d.toDateString()}: ${list.length} item${list.length === 1 ? '' : 's'}`}
                        aria-selected={selected === k}
                        onClick={() => setSelected(k)}
                        className={clsx(
                          'min-h-14 bg-panel p-1 text-left align-top hover:bg-panel2 sm:min-h-20',
                          !inMonth && 'opacity-40',
                          selected === k && 'outline-2 -outline-offset-2 outline-accent',
                          k === key(now) && 'font-bold text-accent',
                        )}
                      >
                        <div>{d.getDate()}</div>
                        {list.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-0.5">
                            {list.slice(0, 4).map((x) => (
                              <span
                                key={x.id}
                                className={clsx(
                                  'size-1.5 rounded-full sm:size-2',
                                  x.publishedAt ? 'bg-ok' : 'bg-warn',
                                )}
                              />
                            ))}
                            {list.length > 4 && (
                              <span className="text-[10px] text-muted">+{list.length - 4}</span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-muted">
                  <span className="mr-1 inline-block size-2 rounded-full bg-ok" /> published{' '}
                  <span className="mx-1 inline-block size-2 rounded-full bg-warn" /> planned · times shown in{' '}
                  {cal.timezone}
                </p>
              </div>
              <Card>
                <h3 className="mb-2 font-semibold">
                  {new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}
                </h3>
                {sel.length === 0 ? (
                  <EmptyState title="Nothing on this day" />
                ) : (
                  <ul className="space-y-2">
                    {sel.map((x) => (
                      <li key={x.id} className="rounded-lg border border-border p-2 text-sm">
                        <div className="font-medium">{x.title ?? 'Untitled'}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge>{titleCase(x.platform)}</Badge>
                          <span className="text-xs text-muted">{x.handle}</span>
                          <StateBadge state={x.state} />
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {parseDate(x.publishedAt ?? x.plannedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: cal.timezone,
                          })}
                        </div>
                        {x.url && (
                          <a className="text-xs text-accent" href={x.url} target="_blank" rel="noreferrer">
                            Open post ↗
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          );
        }}
      </Async>
    </>
  );
}
