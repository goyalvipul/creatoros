'use client';

import clsx from 'clsx';
import { useId } from 'react';

const NAMES: Record<string, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  threads: 'Threads',
  snapchat: 'Snapchat',
  x: 'X',
  linkedin: 'LinkedIn',
  gmail: 'Gmail',
};

export function platformLabel(platform: string) {
  const key = platform.toLowerCase();
  return NAMES[key] ?? platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase();
}

/** Brand mark for a connected account. The name stays available to assistive tech and on hover. */
export function PlatformLogo({ platform, className = 'size-5' }: { platform: string; className?: string }) {
  const name = platformLabel(platform);
  const gid = useId().replace(/:/g, '');
  return (
    <span className={clsx('inline-flex shrink-0', className)} role="img" aria-label={name} title={name}>
      <Mark platform={platform.toLowerCase()} gid={gid} />
    </span>
  );
}

function Mark({ platform, gid }: { platform: string; gid: string }) {
  const common = { viewBox: '0 0 24 24', className: 'h-full w-full', 'aria-hidden': true as const };
  if (platform === 'youtube')
    return (
      <svg {...common}>
        <rect x="1" y="5" width="22" height="14" rx="4" fill="#FF0033" />
        <path d="M10 8.6v6.8l6.2-3.4z" fill="#fff" />
      </svg>
    );
  if (platform === 'instagram')
    return (
      <svg {...common}>
        <defs>
          <radialGradient id={gid} cx="30%" cy="110%" r="130%">
            <stop offset="0%" stopColor="#feda75" />
            <stop offset="35%" stopColor="#fa7e1e" />
            <stop offset="65%" stopColor="#d62976" />
            <stop offset="100%" stopColor="#4f5bd5" />
          </radialGradient>
        </defs>
        <rect width="24" height="24" rx="6" fill={`url(#${gid})`} />
        <rect x="6.2" y="6.2" width="11.6" height="11.6" rx="3.4" fill="none" stroke="#fff" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="2.7" fill="none" stroke="#fff" strokeWidth="1.6" />
        <circle cx="16.6" cy="7.5" r="1" fill="#fff" />
      </svg>
    );
  if (platform === 'facebook')
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="11" fill="#1877F2" />
        <path fill="#fff" d="M13.4 18.6v-5h1.7l.3-1.9h-2v-1.2c0-.6.2-1 .9-1H15.5V7.7c-.2 0-1-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1h-1.6v1.9h1.6v5h2.7z" />
      </svg>
    );
  if (platform === 'tiktok')
    return (
      <svg {...common}>
        <rect width="24" height="24" rx="6" fill="#111" />
        <path d="M14.2 6.2c.5 1.8 1.6 3 3.3 3.4v2.1c-1.2 0-2.3-.4-3.3-1.1v5.1a4.4 4.4 0 1 1-4.4-4.4c.2 0 .5 0 .7.1v2.2a2.2 2.2 0 1 0 1.5 2.1V6.2h2.2z" fill="#25F4EE" transform="translate(-0.6 0.4)" />
        <path d="M14.2 6.2c.5 1.8 1.6 3 3.3 3.4v2.1c-1.2 0-2.3-.4-3.3-1.1v5.1a4.4 4.4 0 1 1-4.4-4.4c.2 0 .5 0 .7.1v2.2a2.2 2.2 0 1 0 1.5 2.1V6.2h2.2z" fill="#FE2C55" transform="translate(0.6 -0.2)" />
        <path d="M14.2 6.2c.5 1.8 1.6 3 3.3 3.4v2.1c-1.2 0-2.3-.4-3.3-1.1v5.1a4.4 4.4 0 1 1-4.4-4.4c.2 0 .5 0 .7.1v2.2a2.2 2.2 0 1 0 1.5 2.1V6.2h2.2z" fill="#fff" />
      </svg>
    );
  if (platform === 'threads')
    return (
      <svg {...common}>
        <rect width="24" height="24" rx="6" fill="#000" />
        <path d="M16.4 10.4c-.6-2-2.2-3.3-4.2-3.3-2.6 0-4.4 2-4.4 4.8s1.8 4.9 4.5 4.9c1.6 0 2.9-.7 3.6-1.8" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M16.4 7.4v5.4c0 1.6-1.2 2.7-2.6 2.7s-2.6-1.2-2.6-2.8 1.1-2.7 2.6-2.7c.7 0 1.3.2 1.8.7" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  if (platform === 'snapchat')
    return (
      <svg {...common}>
        <rect width="24" height="24" rx="6" fill="#FFFC00" />
        <path fill="#111" d="M12 5.2c1.8 0 3 1.5 3 3.4v.7c.8.2 1.5.5 2 .9.3.2.2.6-.2.6-.7-.2-1.3-.3-1.8-.2.2.7.8 1.2 1.6 1.5.4.1.4.6 0 .7-1 .3-1.7.8-2.1 1.4.6.2 1.1.5 1.4.8.3.3 0 .7-.4.6-.8-.2-1.5-.2-2.1 0 .2.8.1 1.5-.4 2-.4.4-1 .6-1.8.6s-1.4-.2-1.8-.6c-.5-.5-.6-1.2-.4-2-.6-.2-1.3-.2-2.1 0-.4.1-.7-.3-.4-.6.3-.3.8-.6 1.4-.8-.4-.6-1.1-1.1-2.1-1.4-.4-.1-.4-.6 0-.7.8-.3 1.4-.8 1.6-1.5-.5-.1-1.1 0-1.8.2-.4 0-.5-.4-.2-.6.5-.4 1.2-.7 2-.9v-.7c0-1.9 1.2-3.4 3-3.4z" />
      </svg>
    );
  if (platform === 'x')
    return (
      <svg {...common}>
        <path fill="currentColor" d="M4 4.5h3.4l4.1 5.5 4.6-5.5H20l-6.2 7.4L20.2 19.5h-3.4l-4.5-6-5 6H3.4l6.6-7.9z" />
      </svg>
    );
  if (platform === 'linkedin')
    return (
      <svg {...common}>
        <rect width="24" height="24" rx="4" fill="#0A66C2" />
        <path fill="#fff" d="M6.6 9.6H9v8H6.6zm1.2-3.8a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zM10.6 9.6h2.3v1.1h.1c.3-.6 1.1-1.2 2.3-1.2 2.5 0 2.9 1.6 2.9 3.7v4.4h-2.4v-3.9c0-.9 0-2.1-1.3-2.1s-1.5 1-1.5 2v4h-2.4z" />
      </svg>
    );
  if (platform === 'gmail')
    return (
      <svg {...common}>
        <rect x="2" y="5" width="20" height="14" rx="2" fill="#fff" stroke="#ddd" />
        <path d="M3 6.5 12 13l9-6.5" fill="none" stroke="#EA4335" strokeWidth="1.6" />
        <path d="M3 18V8l5 3.6" fill="none" stroke="#34A853" strokeWidth="1.4" />
        <path d="M21 18V8l-5 3.6" fill="none" stroke="#4285F4" strokeWidth="1.4" />
      </svg>
    );
  const letter = (NAMES[platform] ?? platform).slice(0, 1).toUpperCase();
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.12" />
      <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">
        {letter}
      </text>
    </svg>
  );
}
