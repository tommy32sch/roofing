import {
  Home, Users, Map, CalendarDays, ScrollText, TrendingUp,
  Upload, UserCog, BarChart2, Webhook, Settings, PlusCircle,
} from 'lucide-react';
import type { UserRole } from '@/types';

/**
 * Single source of truth for navigation.
 *
 * The sidebar, the mobile sheet and the bottom tab bar all read from here, so a
 * new section can't appear in one and be forgotten in the others.
 *
 * Sections are grouped rather than listed flat: eleven undifferentiated links
 * read as a pile, and grouping communicates that daily work, reporting and
 * configuration are different kinds of thing.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  /** Shows the flagged-duplicate count. */
  badge?: 'duplicates';
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export function getNavGroups(role: UserRole): NavGroup[] {
  const groups: NavGroup[] = [
    {
      label: 'Workspace',
      items: [
        { href: '/admin', label: 'Dashboard', icon: Home },
        { href: '/admin/leads', label: 'Leads', icon: Users, badge: 'duplicates' },
        { href: '/admin/map', label: 'Map', icon: Map },
        { href: '/admin/calendar', label: 'Calendar', icon: CalendarDays },
      ],
    },
    {
      label: 'Insights',
      items: [
        { href: '/admin/activity', label: 'Activity', icon: ScrollText },
        { href: '/admin/performance', label: 'Performance', icon: TrendingUp },
        ...(role === 'admin'
          ? [{ href: '/admin/analytics', label: 'Analytics', icon: BarChart2 }]
          : []),
      ],
    },
  ];

  const manage: NavItem[] = [];
  if (role !== 'closer') manage.push({ href: '/admin/leads/import', label: 'Import', icon: Upload });
  if (role === 'admin') {
    manage.push(
      { href: '/admin/users', label: 'Users', icon: UserCog },
      { href: '/admin/integrations', label: 'Integrations', icon: Webhook },
      { href: '/admin/settings', label: 'Settings', icon: Settings },
    );
  }
  if (manage.length) groups.push({ label: 'Manage', items: manage });

  return groups;
}

/** Phone tab bar — only the handful of things a rep needs in the field. */
export function getBottomTabs(role: UserRole): NavItem[] {
  const tabs: NavItem[] = [
    { href: '/admin', label: 'Dashboard', icon: Home },
    { href: '/admin/leads', label: 'Leads', icon: Users },
    { href: '/admin/map', label: 'Map', icon: Map },
  ];
  if (role !== 'closer') tabs.push({ href: '/admin/leads/new', label: 'Add', icon: PlusCircle });
  if (role === 'admin') tabs.push({ href: '/admin/settings', label: 'Settings', icon: Settings });
  return tabs;
}

/** Exact match for the dashboard root; prefix match elsewhere. */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  // /admin/leads must not light up for /admin/leads/import, which is its own item
  if (href === '/admin/leads') {
    return pathname === '/admin/leads' || /^\/admin\/leads\/(?!import|new)/.test(pathname);
  }
  return pathname.startsWith(href);
}
