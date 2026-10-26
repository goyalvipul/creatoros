import {
  CalendarDays,
  Clapperboard,
  FolderKanban,
  Cpu,
  Handshake,
  HardDrive,
  Home,
  Inbox,
  Layers,
  LineChart,
  Lightbulb,
  MessagesSquare,
  Workflow,
  Plug,
  Settings,
  Share2,
} from 'lucide-react';

export const NAV = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/today', label: 'Inbox & Today', icon: Inbox },
  { href: '/content', label: 'Content', icon: Lightbulb },
  { href: '/production', label: 'Production', icon: Clapperboard },
  { href: '/comfy', label: 'ComfyUI', icon: Cpu },
  { href: '/library', label: 'Library', icon: FolderKanban },
  { href: '/publishing', label: 'Publishing', icon: Share2 },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/collaborations', label: 'Collaborations', icon: Handshake },
  { href: '/socials', label: 'Socials', icon: MessagesSquare },
  { href: '/workflows', label: 'Workflows', icon: Workflow },
  { href: '/analytics', label: 'Analytics', icon: LineChart },
  { href: '/channels', label: 'Channels', icon: Layers },
  { href: '/storage', label: 'Storage & Devices', icon: HardDrive },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

/** Only the owner can open these. Editors and viewers keep Home, Inbox & Today, Content, Production and Library. */
export const OWNER_ONLY = [
  '/publishing',
  '/calendar',
  '/collaborations',
  '/socials',
  '/workflows',
  '/comfy',
  '/analytics',
  '/channels',
  '/storage',
  '/integrations',
  '/settings',
] as const;

/** Viewers also stay out of the inbox queue and the media library. */
const VIEWER_HIDDEN = ['/today', '/library'] as const;

export function navFor(role?: string) {
  if (role === 'OWNER') return NAV;
  const hidden: readonly string[] = role === 'VIEWER' ? [...OWNER_ONLY, ...VIEWER_HIDDEN] : OWNER_ONLY;
  return NAV.filter((n) => !hidden.includes(n.href));
}

export function canOpen(role: string | undefined, path: string) {
  if (role === 'OWNER') return true;
  const blocked = role === 'VIEWER' ? [...OWNER_ONLY, ...VIEWER_HIDDEN] : OWNER_ONLY;
  return !blocked.some((href) => path === href || path.startsWith(`${href}/`));
}
