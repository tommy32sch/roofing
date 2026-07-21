import type { LeadStatus } from '@/types';

/**
 * Status reads as a tinted chip with a colored dot rather than a solid fill.
 * A list is overwhelmingly one status (usually "New"), so solid saturated pills
 * turned every row into a block of color and drowned out the signals that
 * actually need attention — DNC, hot, overdue follow-up. The dot keeps status
 * scannable while letting the row stay calm.
 */
const STATUS_CONFIG: Record<LeadStatus, { label: string; chip: string; dot: string }> = {
  new: {
    label: 'New',
    chip: 'text-pipeline-new bg-pipeline-new/10 border-pipeline-new/25',
    dot: 'bg-pipeline-new',
  },
  contacted: {
    label: 'Contacted',
    chip: 'text-pipeline-contacted bg-pipeline-contacted/10 border-pipeline-contacted/25',
    dot: 'bg-pipeline-contacted',
  },
  appointment_set: {
    label: 'Appt Set',
    chip: 'text-pipeline-appointment bg-pipeline-appointment/10 border-pipeline-appointment/25',
    dot: 'bg-pipeline-appointment',
  },
  inspected: {
    label: 'Inspected',
    chip: 'text-pipeline-inspected bg-pipeline-inspected/10 border-pipeline-inspected/25',
    dot: 'bg-pipeline-inspected',
  },
  proposal_sent: {
    label: 'Proposal',
    chip: 'text-pipeline-proposal bg-pipeline-proposal/10 border-pipeline-proposal/25',
    dot: 'bg-pipeline-proposal',
  },
  // Terminal states carry more weight — these are the outcomes people scan for
  sold: {
    label: 'Sold',
    chip: 'text-pipeline-sold bg-pipeline-sold/15 border-pipeline-sold/40 font-semibold',
    dot: 'bg-pipeline-sold',
  },
  lost: {
    label: 'Lost',
    chip: 'text-muted-foreground bg-muted/50 border-border',
    dot: 'bg-pipeline-lost',
  },
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.new;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${config.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${config.dot}`} />
      {config.label}
    </span>
  );
}
