'use client';

import Link from 'next/link';
import { Building2, PlusCircle } from 'lucide-react';
import { getNavGroups, isNavActive, type NavGroup } from './nav-config';
import type { UserRole } from '@/types';

/**
 * Primary navigation.
 *
 * Replaces a horizontal top bar that could not hold eleven sections — at
 * 1440px the account menu was pushed off-screen and the page scrolled
 * sideways. A sidebar scales to any number of sections, leaves room for
 * grouping, and frees each page to own its own header.
 *
 * Rendered inline on desktop and inside the mobile sheet, so both stay in step.
 */

interface Props {
  role: UserRole;
  companyName: string;
  pathname: string;
  duplicateCount: number;
  /** Closes the mobile sheet after navigating. */
  onNavigate?: () => void;
}

export function SidebarNav({ role, companyName, pathname, duplicateCount, onNavigate }: Props) {
  const groups: NavGroup[] = getNavGroups(role);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
        <Building2 className="h-5 w-5 shrink-0 text-primary" />
        <span className="truncate font-semibold">{companyName}</span>
      </div>

      {/* Primary action, given the prominence it earns in a lead-driven tool */}
      {role !== 'closer' && (
        <div className="px-3 pt-3">
          <Link
            href="/admin/leads/new"
            onClick={onNavigate}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <PlusCircle className="h-4 w-4" />
            Add Lead
          </Link>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isNavActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                      active
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
                    }`}
                  >
                    <item.icon
                      className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : ''}`}
                    />
                    <span className="truncate">{item.label}</span>
                    {item.badge === 'duplicates' && duplicateCount > 0 && role === 'admin' && (
                      <span
                        title={`${duplicateCount} flagged duplicate${duplicateCount === 1 ? '' : 's'}`}
                        className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-white"
                      >
                        {duplicateCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}
