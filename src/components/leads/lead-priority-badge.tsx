import { Flame } from 'lucide-react';
import type { LeadPriority } from '@/types';

/**
 * Priority is deliberately near-silent at the default level.
 *
 * Almost every imported lead is "Medium", so rendering it as a filled blue pill
 * put a loud badge on every row that carried no information. Low/Medium now read
 * as quiet text; only High and Hot — the ones a rep should act on — get colour,
 * and Hot gets an icon so it survives a glance down a long list.
 */
const PRIORITY_CONFIG: Record<LeadPriority, { label: string; className: string; icon?: boolean }> = {
  low: { label: 'Low', className: 'text-muted-foreground/70' },
  medium: { label: 'Medium', className: 'text-muted-foreground' },
  high: { label: 'High', className: 'text-amber-600 dark:text-amber-400 font-medium' },
  hot: { label: 'Hot', className: 'text-red-600 dark:text-red-400 font-semibold', icon: true },
};

export function LeadPriorityBadge({ priority }: { priority: LeadPriority }) {
  const config = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium;
  return (
    <span className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${config.className}`}>
      {config.icon && <Flame className="h-3 w-3 shrink-0" />}
      {config.label}
    </span>
  );
}
