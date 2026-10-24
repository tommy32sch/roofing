import { notFound, redirect } from 'next/navigation';
import { resolveLeadRef } from '@/lib/leads/lead-ref.server';
import { LeadDetail } from './lead-detail';

/**
 * /admin/leads/jane-smith-3f9c2a1b — resolve the readable address (or an old
 * full-UUID link) on the server, redirect to the canonical form, and hand the
 * screen the real id it uses with the API.
 */
export default async function LeadDetailPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId: segment } = await params;
  const lead = await resolveLeadRef(segment);
  if (!lead) notFound();
  if (decodeURIComponent(segment) !== lead.slug) redirect(`/admin/leads/${lead.slug}`);
  return <LeadDetail leadId={lead.id} />;
}
