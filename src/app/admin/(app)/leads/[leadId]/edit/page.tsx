import { notFound, redirect } from 'next/navigation';
import { resolveLeadRef } from '@/lib/leads/lead-ref.server';
import { LeadEdit } from './lead-edit';

/** Same address rules as the lead page: resolve, canonicalize, pass the id. */
export default async function EditLeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId: segment } = await params;
  const lead = await resolveLeadRef(segment);
  if (!lead) notFound();
  if (decodeURIComponent(segment) !== lead.slug) redirect(`/admin/leads/${lead.slug}/edit`);
  return <LeadEdit leadId={lead.id} />;
}
