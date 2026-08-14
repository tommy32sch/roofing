import Link from 'next/link';
import { AlertTriangle, CalendarX2, Clock3, UserMinus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type {
  OperationsExceptionItem,
  OperationsExceptions,
} from '@/lib/reporting/contracts';
import { ReportEmptyState } from './report-empty-state';
import { DrillDownLink } from './drill-down-link';

const ICONS = {
  overdue_follow_up: Clock3,
  unassigned_lead: UserMinus,
  appointment_owner: CalendarX2,
  stalled_deal: AlertTriangle,
} as const;

function timeLabel(item: OperationsExceptionItem): string | null {
  if (!item.occurredAt || Number.isNaN(Date.parse(item.occurredAt))) return null;
  return formatDistanceToNow(new Date(item.occurredAt), { addSuffix: true });
}

export function ExceptionLedger({ data }: { data: OperationsExceptions }) {
  if (data.total === 0) {
    return (
      <ReportEmptyState
        title="No urgent work in this scope"
        description="Overdue follow-ups, missing owners, unassigned leads, and stalled deals will appear here."
      />
    );
  }

  return (
    <div className="border-y">
      <div className="grid grid-cols-2 border-b lg:grid-cols-4">
        {data.groups.map((group) => (
          <Link
            key={group.kind}
            href={group.href}
            title={group.rule}
            className="flex min-h-16 items-center justify-between gap-3 border-b px-3 py-2 text-sm hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 even:border-l lg:border-b-0 lg:border-l lg:first:border-l-0"
          >
            <span className="text-xs text-muted-foreground">{group.label}</span>
            <span className="font-mono text-lg font-semibold tabular-nums">{group.count}</span>
          </Link>
        ))}
      </div>

      <div className="divide-y">
        {data.items.map((item) => {
          const Icon = ICONS[item.kind];
          const when = timeLabel(item);
          return (
            <Link
              key={item.id}
              href={item.href}
              className="group grid min-h-16 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              <div className={`flex size-8 items-center justify-center border ${item.severity === 'urgent' ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400'}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  {when && <span className="text-xs tabular-nums text-muted-foreground">{when}</span>}
                </div>
                <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground/80">Rule: {item.rule}</p>
              </div>
              <span className="text-xs font-medium text-primary group-hover:underline">Open</span>
            </Link>
          );
        })}
      </div>

      {data.items.length < data.total && (
        <div className="flex justify-end border-t px-3">
          <DrillDownLink href={data.groups.find((group) => group.count > 0)?.href ?? '/admin/leads'}>
            View remaining work
          </DrillDownLink>
        </div>
      )}
    </div>
  );
}
