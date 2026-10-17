import {
  CalendarDays,
  Clapperboard,
  FolderKanban,
  Handshake,
  HardDrive,
  Home,
  Inbox,
  Layers,
  LineChart,
  Lightbulb,
  Plug,
  Settings,
  Share2,
} from 'lucide-react';

export const NAV = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/today', label: 'Inbox & Today', icon: Inbox },
  { href: '/content', label: 'Content', icon: Lightbulb },
  { href: '/production', label: 'Production', icon: Clapperboard },
  { href: '/library', label: 'Library', icon: FolderKanban },
  { href: '/publishing', label: 'Publishing', icon: Share2 },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/collaborations', label: 'Collaborations', icon: Handshake },
  { href: '/analytics', label: 'Analytics', icon: LineChart },
  { href: '/channels', label: 'Channels', icon: Layers },
  { href: '/storage', label: 'Storage & Devices', icon: HardDrive },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

/** Sections a read-only viewer cannot open (the API refuses them too): email/CRM, media library, devices, integrations. */
const VIEWER_HIDDEN: readonly string[] = ['/today', '/library', '/collaborations', '/storage', '/integrations'];

export function navFor(role?: string) {
  return role === 'VIEWER' ? NAV.filter((n) => !VIEWER_HIDDEN.includes(n.href)) : NAV;
}
