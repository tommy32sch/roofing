import Link from 'next/link';
import type { FunnelRow } from '@/lib/reporting/contracts';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function FunnelLedger({ rows }: { rows: FunnelRow[] }) {
  return (
    <div className="border-y">
      <div className="grid grid-cols-[minmax(0,1fr)_4rem_7rem] border-b px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Stage</span>
        <span className="text-right">Leads</span>
        <span className="text-right">Value</span>
      </div>
      <div className="divide-y">
        {rows.map((row) => (
          <Link
            key={row.status}
            href={row.href}
            className="grid min-h-11 grid-cols-[minmax(0,1fr)_4rem_7rem] items-center px-3 text-sm hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
          >
            <span className="truncate font-medium">{row.label}</span>
            <span className="text-right font-mono tabular-nums">{row.count}</span>
            <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
              {money.format(row.value)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
