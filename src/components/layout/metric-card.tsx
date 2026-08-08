'use client';

import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  formatDelta,
  formatBaseline,
  isFavourable,
  type MetricDelta,
} from '@/lib/leads/metric-delta';

interface MetricCardProps {
  label: string;
  value: string;
  icon?: React.ElementType;
  /** Omit when there is no previous period to compare against. */
  delta?: MetricDelta | null;
  /**
   * Which way this metric should move. Revenue rises; overdue follow-ups fall.
   * Required whenever a delta is shown, because colour is the whole point and
   * getting it backwards paints a growing backlog green.
   */
  higherIsBetter?: boolean;
  /** Formats the baseline, e.g. currency. */
  formatValue?: (n: number) => string;
  className?: string;
}

/**
 * One number, what it did, and what it is being compared to.
 *
 * The comparison is the reason this exists. "59 live posts" means nothing on
 * its own; "59, up from 48" is a fact someone can act on. So the delta and the
 * baseline are part of the component rather than optional decoration, and a
 * card with no previous period says so instead of showing a blank slot.
 *
 * Colour comes from whether the movement is GOOD, not which way it points —
 * see isFavourable. It uses the status tokens rather than raw greens and reds
 * so it cannot drift from the rest of the app.
 */
export function MetricCard({
  label,
  value,
  icon: Icon,
  delta = null,
  higherIsBetter = true,
  formatValue,
  className,
}: MetricCardProps) {
  const favourable = delta ? isFavourable(delta, higherIsBetter) : null;
  const Arrow =
    delta?.direction === 'up' ? ArrowUp : delta?.direction === 'down' ? ArrowDown : Minus;

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate text-xs font-medium">{label}</span>
        </div>

        {/* tabular-nums so a figure changing between refreshes does not shift
            the layout under the reader's eye. */}
        <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>

        {delta ? (
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span
              className={cn(
                'flex items-center gap-0.5 text-xs font-medium tabular-nums',
                favourable === true && 'text-status-complete',
                favourable === false && 'text-status-attention',
                favourable === null && 'text-muted-foreground'
              )}
            >
              <Arrow className="h-3 w-3 shrink-0" />
              {formatDelta(delta)}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatBaseline(delta, formatValue)}
            </span>
          </div>
        ) : (
          /* Said plainly rather than left blank: an empty slot reads as a
             loading state that never resolves. */
          <p className="mt-1 text-xs text-muted-foreground">No earlier period to compare</p>
        )}
      </CardContent>
    </Card>
  );
}
