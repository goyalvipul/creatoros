'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';

function installedApp() {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

/**
 * A normal browser saves the file in this tab.
 * An installed phone app must not follow the link. Following it replaces the app
 * with a blank page. The tap fetches the file and hands it to the phone share sheet.
 */
export function downloadAnchor(installed: boolean, name: string): { download: string } {
  void installed;
  return { download: name };
}

export async function saveInstalledFile(href: string, name: string) {
  const res = await fetch(href, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('The file did not download.');
  const blob = await res.blob();
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  const share = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (share.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Saves the original bytes. The preview image is a separate, smaller file. */
export function FileDownload({
  href,
  name,
  icon = false,
  label = 'Download',
  busyLabel,
}: {
  href: string;
  name: string;
  icon?: boolean;
  label?: string;
  busyLabel?: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const anchor = downloadAnchor(false, name);
  const wait = Boolean(busyLabel) || installedApp();
  return (
    <a
      href={href}
      {...anchor}
      aria-disabled={busy || undefined}
      aria-label={icon ? 'Download original' : undefined}
      title={icon ? 'Download original' : note ?? undefined}
      className={
        icon
          ? `inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-panel hover:bg-panel2${busy ? ' pointer-events-none opacity-60' : ''}`
          : `inline-flex shrink-0 items-center self-center rounded border border-border px-2 py-1 text-xs hover:border-accent${busy ? ' pointer-events-none opacity-60' : ''}`
      }
      onClick={(event) => {
        event.stopPropagation();
        if (busy) {
          event.preventDefault();
          return;
        }
        if (!wait) return;
        event.preventDefault();
        setNote(null);
        setBusy(true);
        void saveInstalledFile(href, name)
          .catch((error: unknown) => {
            setNote(error instanceof Error ? error.message : 'The file did not download.');
          })
          .finally(() => setBusy(false));
      }}
    >
      {icon ? <Download className="size-4" aria-hidden /> : busy ? busyLabel : note ?? label}
    </a>
  );
}
