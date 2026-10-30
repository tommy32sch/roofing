'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SETTINGS_SECTIONS } from '@/lib/settings/sections';
import { cn } from '@/lib/utils';

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections" className="min-w-0">
      <div className="flex gap-1 overflow-x-auto border-b border-border/70 pb-px lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:pr-4">
        {SETTINGS_SECTIONS.map((section) => {
          const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
          return (
            <Link
              key={section.id}
              href={section.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'min-h-11 shrink-0 border-b-2 border-transparent px-3 py-2 text-sm lg:border-b-0 lg:border-l-2',
                active
                  ? 'border-primary font-semibold text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {section.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
