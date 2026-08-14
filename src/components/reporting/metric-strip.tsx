import Link from 'next/link';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import type { ReportMetric } from '@/lib/reporting/contracts';

function formatValue(metric: ReportMetric): string {
  if (metric.unit === 'currency') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(metric.value);
  }
  return metric.value.toLocaleString();
}

function comparisonLabel(metric: ReportMetric): string {
  const comparison = metric.comparison;
  if (comparison.direction === 'new') return 'New vs prior period';
  if (comparison.direction === 'flat') return 'No change vs prior';
  return `${Math.abs(comparison.percent ?? 0).toFixed(0)}% vs prior`;
}

export function MetricStrip({ metrics }: { metrics: ReportMetric[] }) {
  return (
    <div className="grid border-y sm:grid-cols-2 lg:grid-cols-5">
      {metrics.map((metric) => {
        const Direction =
          metric.comparison.direction === 'up'
            ? ArrowUpRight
            : metric.comparison.direction === 'down'
              ? ArrowDownRight
              : ArrowRight;
        return (
          <Link
            key={metric.key}
            href={metric.href}
            className="group flex min-h-28 flex-col justify-between border-b px-4 py-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 sm:border-r lg:border-b-0 lg:last:border-r-0"
          >
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {metric.label}
            </p>
            <div>
              <p className="text-2xl font-semibold tabular-nums tracking-tight">
                {formatValue(metric)}
              </p>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Direction className="h-3.5 w-3.5" />
                {comparisonLabel(metric)}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
