import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { assignDuplicates } from '@/lib/leads/dedupe';

/**
 * Re-run duplicate detection across every existing lead using the current rule
 * (canonical address, plus APN when present). Useful after the matching rule
 * changes, or when leads were imported under an older one — it both clears
 * stale false positives and flags duplicates that were missed.
 *
 * Only writes rows whose flag actually changes. Admin-only; the UI confirms first.
 */
export async function POST() {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = db();

    // Oldest first, so the earliest lead at an address stays the original.
    // Paged past the 1000-row cap — a truncated read would mis-assign duplicates.
    type Row = {
      id: string;
      apn: string | null;
      address_street: string | null;
      address_city: string | null;
      address_zip: string | null;
      is_flagged_duplicate: boolean;
      duplicate_of_id: string | null;
    };
    const leads: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('leads')
        .select('id, apn, address_street, address_city, address_zip, is_flagged_duplicate, duplicate_of_id')
        .order('created_at', { ascending: true })
        .range(from, from + 999);
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      leads.push(...((data as Row[]) || []));
      if (!data || data.length < 1000) break;
    }

    const assigned = assignDuplicates(leads);

    // Only touch rows whose duplicate state actually changes
    const toUnflag: string[] = [];
    const toFlag = new Map<string, string[]>(); // duplicate_of_id → lead ids
    for (const lead of leads) {
      const dupOf = assigned.get(lead.id) ?? null;
      if (dupOf === null) {
        if (lead.is_flagged_duplicate) toUnflag.push(lead.id);
      } else if (!lead.is_flagged_duplicate || lead.duplicate_of_id !== dupOf) {
        toFlag.set(dupOf, [...(toFlag.get(dupOf) || []), lead.id]);
      }
    }

    const CHUNK = 200;
    for (let i = 0; i < toUnflag.length; i += CHUNK) {
      const { error } = await supabase
        .from('leads')
        .update({ is_flagged_duplicate: false, duplicate_of_id: null })
        .in('id', toUnflag.slice(i, i + CHUNK));
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
    }
    let flagged = 0;
    for (const [dupOf, ids] of toFlag) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const { error } = await supabase
          .from('leads')
          .update({ is_flagged_duplicate: true, duplicate_of_id: dupOf })
          .in('id', chunk);
        if (error) {
          return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }
        flagged += chunk.length;
      }
    }

    return NextResponse.json({
      success: true,
      checked: leads.length,
      unflagged: toUnflag.length,
      flagged,
      totalDuplicates: [...assigned.values()].filter(Boolean).length,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
