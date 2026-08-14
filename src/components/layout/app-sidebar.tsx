'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
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
    <div
      data-slot="sidebar"
      className="flex h-full flex-col bg-[#191815] text-stone-100 dark:bg-[#11100f]"
    >
      <div className="flex h-20 shrink-0 items-center border-b border-white/10 px-5 pr-12 md:pr-5">
        <Link
          href="/admin"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-3"
          aria-label={`${companyName} dashboard`}
        >
          <RoofMark className="h-9 w-9 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-bold leading-tight tracking-[-0.01em] text-white">
              {companyName}
            </span>
            <span className="mt-1 block font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-stone-500">
              Roofing sales
            </span>
          </span>
        </Link>
      </div>

      <div className="px-4 pb-2 pt-5">
        <Link
          href="/admin/leads/new"
          onClick={onNavigate}
          className="flex h-11 w-full items-center justify-between rounded-[3px] bg-primary pl-4 pr-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <span>Add lead</span>
          <span className="flex h-6 w-6 items-center justify-center border-l border-primary-foreground/25 pl-2">
            <Plus className="h-4 w-4" />
          </span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-6 pt-4" aria-label="Main navigation">
        {groups.map((group) => (
          <div key={group.label} className="mb-6 last:mb-0">
            <div className="mb-2 flex items-center gap-2 px-3">
              <span className="h-px w-3 bg-primary/70" aria-hidden="true" />
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-stone-400">
                {group.label}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              {group.items.map((item) => {
                const active = isNavActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`group flex min-h-10 items-center gap-3 border-l-2 px-3 py-2 text-[13px] transition-colors ${
                      active
                        ? 'border-primary bg-white/[0.08] font-semibold text-white'
                        : 'border-transparent text-stone-400 hover:border-white/20 hover:bg-white/[0.04] hover:text-stone-100'
                    }`}
                  >
                    <item.icon
                      className={`h-[17px] w-[17px] shrink-0 ${
                        active ? 'text-primary' : 'text-stone-500 group-hover:text-stone-300'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                    {item.badge === 'duplicates' && duplicateCount > 0 && role === 'admin' && (
                      <span
                        title={`${duplicateCount} flagged duplicate${duplicateCount === 1 ? '' : 's'}`}
                        className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-[3px] bg-destructive px-1 text-[10px] font-bold tabular-nums text-white"
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

/** A small roofline drawn for this product instead of a stock building icon. */
export function RoofMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M4 17.25 18 6l14 11.25"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M8.5 16.5V29h19V16.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
      />
      <path d="M13 23h10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}
