import Link from 'next/link';
import type { TeamPulseRow } from '@/lib/reporting/contracts';

const COLUMNS = ['Knocks', 'Calls', 'Appts', 'Outcomes', 'Sold'];

export function TeamPulseLedger({ rows }: { rows: TeamPulseRow[] }) {
  return (
    <div className="overflow-x-auto border-y">
      <div className="min-w-[620px]">
        <div className="grid grid-cols-[minmax(10rem,1fr)_repeat(5,4.5rem)] border-b px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Team member</span>
          {COLUMNS.map((column) => <span key={column} className="text-right">{column}</span>)}
        </div>
        <div className="divide-y">
          {rows.map((row) => (
            <Link
              key={row.memberId}
              href={row.href}
              className="grid min-h-12 grid-cols-[minmax(10rem,1fr)_repeat(5,4.5rem)] items-center px-3 text-sm hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{row.name}</span>
                <span className="block text-[11px] capitalize text-muted-foreground">{row.role}</span>
              </span>
              {[row.knocks, row.calls, row.appointments, row.outcomes, row.soldJobs].map((value, index) => (
                <span key={COLUMNS[index]} className="text-right font-mono tabular-nums">{value}</span>
              ))}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
