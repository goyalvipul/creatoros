'use client';

import { useEffect, useState } from 'react';

function installedApp() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

/** Saves the original bytes. The preview image is a separate, smaller file. */
export function FileDownload({ href, name }: { href: string; name: string }) {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    setInstalled(installedApp());
  }, []);
  return (
    <a
      href={href}
      download={name}
      target={installed ? '_blank' : undefined}
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center self-center rounded border border-border px-2 py-1 text-xs hover:border-accent"
      onClick={(e) => {
        e.stopPropagation();
        if (!installed) return;
        // A home-screen app has no back button. Opening the file in the same window leaves a
        // black player and the only way out is to kill the app. Hand the file to the browser instead.
        e.preventDefault();
        window.open(href, '_blank', 'noopener,noreferrer');
      }}
    >
      Download
    </a>
  );
}
