import type { TrendPoint } from '@/lib/reporting/contracts';

export function TrendStrip({ points }: { points: TrendPoint[] }) {
  const max = Math.max(1, ...points.map((point) => point.value));
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  return (
    <div className="flex h-24 items-end gap-1 border-y px-3 py-3" aria-label="New lead trend">
      {points.map((point) => (
        <div
          key={point.from}
          className="group flex h-full min-w-0 flex-1 items-end"
          title={`${formatter.format(new Date(point.from))}: ${point.value} new lead${point.value === 1 ? '' : 's'}`}
        >
          <div
            className="w-full min-w-1 bg-primary/70 transition-colors group-hover:bg-primary"
            style={{ height: `${Math.max(point.value > 0 ? 8 : 2, (point.value / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}
