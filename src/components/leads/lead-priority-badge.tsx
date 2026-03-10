import { Badge } from '@/components/ui/badge';
import type { LeadPriority } from '@/types';

const PRIORITY_CONFIG: Record<LeadPriority, { label: string; className: string }> = {
  low: { label: 'Low', className: 'bg-muted text-muted-foreground' },
  medium: { label: 'Medium', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  high: { label: 'High', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
  hot: { label: 'Hot', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
};

export function LeadPriorityBadge({ priority }: { priority: LeadPriority }) {
  const config = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium;
  return <Badge variant="secondary" className={config.className}>{config.label}</Badge>;
}
