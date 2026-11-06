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
  { href: '/', label: 'Home', v5: 'Today', group: 'work', icon: Home },
  { href: '/today', label: 'Inbox & Today', v5: 'Inbox & Tasks', group: 'work', icon: Inbox },
  { href: '/content', label: 'Content', v5: 'Content', group: 'work', icon: Lightbulb },
  { href: '/production', label: 'Production', v5: 'Production', group: 'work', icon: Clapperboard },
  { href: '/comfy', label: 'ComfyUI', v5: 'Create Studio', group: 'work', icon: Cpu },
  { href: '/library', label: 'Library', v5: 'Library', group: 'work', icon: FolderKanban },
  { href: '/publishing', label: 'Publishing', v5: 'Publishing', group: 'work', icon: Share2 },
  { href: '/calendar', label: 'Calendar', v5: 'Calendar', group: 'work', icon: CalendarDays },
  { href: '/collaborations', label: 'Collaborations', v5: 'Collaborations', group: 'grow', icon: Handshake },
  { href: '/socials', label: 'Socials', v5: 'Socials', group: 'grow', icon: MessagesSquare },
  { href: '/workflows', label: 'Workflows', v5: 'Workflows', group: 'grow', icon: Workflow },
  { href: '/analytics', label: 'Analytics', v5: 'Analytics', group: 'grow', icon: LineChart },
  { href: '/channels', label: 'Channels', v5: 'Channels', group: 'system', icon: Layers },
  { href: '/storage', label: 'Storage & Devices', v5: 'Storage & Devices', group: 'system', icon: HardDrive },
  { href: '/integrations', label: 'Integrations', v5: 'Integrations', group: 'system', icon: Plug },
  { href: '/settings', label: 'Settings', v5: 'Settings', group: 'system', icon: Settings },
] as const;

export const NAV_GROUPS = [
  { id: 'work', label: 'Your work' },
  { id: 'grow', label: 'Grow & operate' },
  { id: 'system', label: 'System & settings' },
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
