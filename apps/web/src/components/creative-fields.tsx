'use client';

import { sanitizeRichHtml } from '@creatoros/domain';
import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Field, Input, Textarea } from '@/components/ui';
import { useApi } from '@/lib/api';

export type CreativeForm = {
  songTitle: string;
  songFileId: string;
  conceptDetail: string;
  audience: string;
  competitor: string;
  hook: string;
  narrative: string;
  distributionPlan: string;
};

export const emptyCreative = (): CreativeForm => ({
  songTitle: '',
  songFileId: '',
  conceptDetail: '',
  audience: '',
  competitor: '',
  hook: '',
  narrative: '',
  distributionPlan: '',
});

export function creativeFrom(row: {
  songTitle?: string | null;
  songFileId?: string | null;
  conceptDetail?: string | null;
  audience?: string | null;
  competitor?: string | null;
  hook?: string | null;
  narrative?: string | null;
  distributionPlan?: string | null;
}): CreativeForm {
  return {
    songTitle: row.songTitle ?? '',
    songFileId: row.songFileId ?? '',
    conceptDetail: row.conceptDetail ?? '',
    audience: row.audience ?? '',
    competitor: row.competitor ?? '',
    hook: row.hook ?? '',
    narrative: row.narrative ?? '',
    distributionPlan: row.distributionPlan ?? '',
  };
}

export function creativePayload(form: CreativeForm) {
  const text = (value: string) => value.trim() || null;
  return {
    songTitle: text(form.songTitle),
    songFileId: form.songFileId || null,
    conceptDetail: form.conceptDetail.trim() || null,
    audience: text(form.audience),
    competitor: text(form.competitor),
    hook: text(form.hook),
    narrative: text(form.narrative),
    distributionPlan: text(form.distributionPlan),
  };
}

export function RichHtml({ html }: { html?: string | null }) {
  const safe = sanitizeRichHtml(html ?? '');
  if (!safe) return <span className="text-muted">—</span>;
  return <div className="text-sm leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5" dangerouslySetInnerHTML={{ __html: safe }} />;
}

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function speechCtor(): (new () => SpeechRec) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function RichEditor({
  value,
  onChange,
  tall,
}: {
  value: string;
  onChange: (html: string) => void;
  tall?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [canDictate, setCanDictate] = useState(false);
  useEffect(() => {
    setCanDictate(Boolean(speechCtor()));
  }, []);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = value;
    // The parent remounts this editor when a different idea is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => recRef.current?.stop(), []);
  const publish = () => onChange(ref.current?.innerHTML ?? '');
  const mark = (command: 'bold' | 'italic' | 'underline' | 'insertUnorderedList') => {
    ref.current?.focus();
    document.execCommand(command);
    publish();
  };
  const insertText = (text: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const wrote = document.execCommand('insertText', false, text);
    if (!wrote) el.append(document.createTextNode(text));
    publish();
  };
  const stopDictation = () => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
    setInterim('');
  };
  const startDictation = async () => {
    const Ctor = speechCtor();
    if (!Ctor) {
      setSpeechError('Dictation needs Chrome or Edge.');
      return;
    }
    if (!window.isSecureContext) {
      setSpeechError('Dictation needs the https address. An http link cannot use the microphone on a laptop.');
      return;
    }
    setSpeechError(null);
    try {
      // Desktop Chrome will not prompt from speech recognition alone, and it refuses if this click's default was cancelled.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      setSpeechError(
        name === 'NotAllowedError'
          ? 'The microphone was blocked. Allow it for this site in the browser, and allow the browser itself in the laptop’s privacy settings.'
          : name === 'NotFoundError'
            ? 'This laptop has no microphone the browser can use.'
            : 'The browser could not open the microphone.',
      );
      return;
    }
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let finalText = '';
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i]?.[0]?.transcript ?? '';
        if (event.results[i]?.isFinal) finalText += piece;
        else pending += piece;
      }
      if (finalText) insertText(finalText.endsWith(' ') ? finalText : `${finalText} `);
      setInterim(pending);
    };
    rec.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      setSpeechError(
        event.error === 'not-allowed'
          ? 'Microphone permission is blocked for this site.'
          : 'Dictation stopped. Your browser sends speech to its own service, and that call failed.',
      );
      setListening(false);
      setInterim('');
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setSpeechError('Dictation is already running.');
    }
  };
  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-1">
        {(
          [
            ['bold', 'B', 'Bold'],
            ['italic', 'I', 'Italic'],
            ['underline', 'U', 'Underline'],
            ['insertUnorderedList', 'List', 'List'],
          ] as const
        ).map(([command, label, name]) => (
          <button
            key={command}
            type="button"
            aria-label={name}
            className="min-h-8 rounded-md border border-border px-2 text-xs hover:bg-panel2"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => mark(command)}
          >
            <span className={command === 'bold' ? 'font-bold' : command === 'italic' ? 'italic' : command === 'underline' ? 'underline' : ''}>
              {label}
            </span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={listening}
          aria-label={listening ? 'Stop dictation' : 'Dictate'}
          disabled={!canDictate && !listening}
          title={canDictate ? 'Dictate into the detailed concept. Chrome sends the audio to its speech service.' : 'Dictation needs Chrome or Edge.'}
          className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-panel2 disabled:opacity-50"
          onClick={() => void (listening ? stopDictation() : startDictation())}
        >
          {listening ? <Square className="size-3" /> : <Mic className="size-3" />}
          {listening ? 'Stop' : 'Dictate'}
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="Detailed concept"
        className={`rounded-lg border border-border bg-bg px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-accent ${tall ? 'min-h-72' : 'min-h-28'}`}
        onInput={publish}
      />
      {interim && (
        <p className="mt-1 text-sm text-muted" aria-live="polite">
          {interim}
        </p>
      )}
      {speechError && <p className="mt-1 text-xs text-bad">{speechError}</p>}
      <p className="mt-1 text-xs text-muted">Bold, italic, underline, and lists. Emoji work from your keyboard. Dictate uses your browser’s speech service.</p>
    </div>
  );
}

export function CreativeFields({
  formKey,
  value,
  onChange,
  showConcept = true,
}: {
  formKey: string;
  value: CreativeForm;
  onChange: (next: CreativeForm) => void;
  showConcept?: boolean;
}) {
  const [songQ, setSongQ] = useState('');
  const audio = useApi<{ items: { id: string; displayPath?: string; name?: string }[] }>('/library', {
    query: { kind: 'AUDIO', q: songQ || undefined, limit: 8 },
  });
  const set = (patch: Partial<CreativeForm>) => onChange({ ...value, ...patch });
  const picked = audio.data?.items?.find((file) => file.id === value.songFileId);

  return (
    <>
      {showConcept && (
        <Field label="Detailed concept">
          <RichEditor key={formKey} value={value.conceptDetail} onChange={(conceptDetail) => set({ conceptDetail })} />
        </Field>
      )}
      <Field label="Song" hint="A title, and an audio file from the library when you already have one.">
        <Input value={value.songTitle} placeholder="Song title" onChange={(e) => set({ songTitle: e.target.value })} />
        <Input
          className="mt-2"
          aria-label="Search audio files"
          placeholder="Search library audio"
          value={songQ}
          onChange={(e) => setSongQ(e.target.value)}
        />
        {value.songFileId && (
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <span className="truncate">{picked?.displayPath ?? picked?.name ?? 'Audio attached'}</span>
            <Button type="button" size="sm" onClick={() => set({ songFileId: '' })}>
              Remove
            </Button>
          </div>
        )}
        {(audio.data?.items ?? []).length > 0 && (
          <ul className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-border text-sm">
            {audio.data!.items.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  className="block w-full truncate px-2 py-1.5 text-left hover:bg-panel2"
                  onClick={() => set({ songFileId: file.id })}
                >
                  {file.displayPath ?? file.name ?? file.id}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Field>
      <Field label="Audience" hint="Who should care, and why.">
        <Textarea rows={3} value={value.audience} onChange={(e) => set({ audience: e.target.value })} />
      </Field>
      <Field label="Competitor" hint="Evidence you have actually seen. This is not a prediction of virality.">
        <Textarea rows={3} value={value.competitor} onChange={(e) => set({ competitor: e.target.value })} />
      </Field>
      <Field label="Hook and attention strategy" hint="What makes somebody stop scrolling.">
        <Textarea rows={3} value={value.hook} onChange={(e) => set({ hook: e.target.value })} />
      </Field>
      <Field label="Creative concept and narrative" hint="How the topic becomes an experience.">
        <Textarea rows={4} value={value.narrative} onChange={(e) => set({ narrative: e.target.value })} />
      </Field>
      <Field label="Distribution, packaging, and discovery" hint="How it is packaged and how people find it.">
        <Textarea rows={3} value={value.distributionPlan} onChange={(e) => set({ distributionPlan: e.target.value })} />
      </Field>
    </>
  );
}
