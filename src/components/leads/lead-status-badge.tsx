import { Badge } from '@/components/ui/badge';
import type { LeadStatus } from '@/types';

const STATUS_CONFIG: Record<LeadStatus, { label: string; className: string }> = {
  new: { label: 'New', className: 'bg-pipeline-new text-white hover:bg-pipeline-new/90' },
  contacted: { label: 'Contacted', className: 'bg-pipeline-contacted text-white hover:bg-pipeline-contacted/90' },
  appointment_set: { label: 'Appt Set', className: 'bg-pipeline-appointment text-white hover:bg-pipeline-appointment/90' },
  inspected: { label: 'Inspected', className: 'bg-pipeline-inspected text-white hover:bg-pipeline-inspected/90' },
  proposal_sent: { label: 'Proposal', className: 'bg-pipeline-proposal text-white hover:bg-pipeline-proposal/90' },
  sold: { label: 'Sold', className: 'bg-pipeline-sold text-white hover:bg-pipeline-sold/90' },
  lost: { label: 'Lost', className: 'bg-pipeline-lost text-white hover:bg-pipeline-lost/90' },
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.new;
  return <Badge className={config.className}>{config.label}</Badge>;
}
