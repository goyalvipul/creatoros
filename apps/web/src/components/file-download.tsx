'use client';

import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';

function installedApp() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

/**
 * A normal browser saves the file in this tab.
 * An installed app must open the address itself in the browser. window.open with a
 * feature string is a popup, and the installed app blocks it, so the tap does nothing.
 * The download attribute also keeps the navigation inside the app, which replaces the
 * page with a player and has no way back.
 */
export function downloadAnchor(installed: boolean, name: string): {
  download?: string;
  target?: '_blank';
  rel?: string;
} {
  if (installed) return { target: '_blank', rel: 'noopener noreferrer' };
  return { download: name };
}

/** Saves the original bytes. The preview image is a separate, smaller file. */
export function FileDownload({
  href,
  name,
  icon = false,
  label = 'Download',
}: {
  href: string;
  name: string;
  icon?: boolean;
  label?: string;
}) {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    setInstalled(installedApp());
  }, []);
  const anchor = downloadAnchor(installed, name);
  return (
    <a
      href={href}
      {...anchor}
      aria-label={icon ? 'Download original' : undefined}
      title={icon ? 'Download original' : undefined}
      className={
        icon
          ? 'inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-panel hover:bg-panel2'
          : 'inline-flex shrink-0 items-center self-center rounded border border-border px-2 py-1 text-xs hover:border-accent'
      }
      onClick={(e) => e.stopPropagation()}
    >
      {icon ? <Download className="size-4" aria-hidden /> : label}
    </a>
  );
}
