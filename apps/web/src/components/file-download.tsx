'use client';

/** Saves the original bytes. The preview image is a separate, smaller file. */
export function FileDownload({ href, name }: { href: string; name: string }) {
  return (
    <a
      href={href}
      download={name}
      className="inline-flex shrink-0 items-center self-center rounded border border-border px-2 py-1 text-xs hover:border-accent"
      onClick={(e) => e.stopPropagation()}
    >
      Download
    </a>
  );
}
