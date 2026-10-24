import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { applyLeadAccessFilter } from '@/lib/leads/lead-visibility';
import { leadCodeBounds, leadSlug, parseLeadRef } from '@/lib/leads/lead-path';

export interface ResolvedLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  /** The canonical address segment; redirect when the request used another. */
  slug: string;
}

/**
 * Turn a lead page address segment into the lead it names, or null.
 *
 * Accepts the readable name-code form and the old full-UUID form. Only leads
 * the signed-in user may open are considered, so an address cannot reveal
 * whether someone else's lead exists.
 */
export async function resolveLeadRef(segment: string): Promise<ResolvedLead | null> {
  const ref = parseLeadRef(segment);
  if (!ref) return null;
  const admin = await getAuthenticatedAdmin();
  if (!admin) return null;

  let query = db().from('leads').select('id, first_name, last_name');
  if (ref.kind === 'uuid') {
    query = query.eq('id', ref.id);
  } else {
    const { from, to } = leadCodeBounds(ref.code);
    // A UUID range on the primary key: an index lookup, not a scan.
    query = query.gte('id', from).lte('id', to);
  }
  query = applyLeadAccessFilter(query, { id: admin.sub, role: admin.role });

  const { data, error } = await query.order('created_at', { ascending: true }).limit(5);
  if (error || !data?.length) return null;

  const withSlugs = data.map((lead) => ({ ...lead, slug: leadSlug(lead) }));
  if (ref.kind === 'uuid' || withSlugs.length === 1) return withSlugs[0];
  // Two leads sharing a code is rare; the name part decides, then the oldest.
  return withSlugs.find((lead) => lead.slug === ref.slug) ?? withSlugs[0];
}
