import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { LEAD_STATUS_OPTIONS } from '@/types';
import type { LeadStatus } from '@/types';
import { startOfWeek, startOfMonth } from 'date-fns';

export async function GET() {
  try {
    const supabase = db();

    // Get all leads with source
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, first_name, last_name, address_city, address_state, status, priority, source_id, created_at, lead_sources(display_name)')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const allLeads = leads || [];
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const monthStart = startOfMonth(now);

    const totalLeads = allLeads.length;
    const leadsThisWeek = allLeads.filter((l) => new Date(l.created_at) >= weekStart).length;
    const leadsThisMonth = allLeads.filter((l) => new Date(l.created_at) >= monthStart).length;
    const hotLeads = allLeads.filter((l) => l.priority === 'hot').length;

    // Pipeline counts
    const statusCounts: Record<string, number> = {};
    allLeads.forEach((l) => {
      statusCounts[l.status] = (statusCounts[l.status] || 0) + 1;
    });

    const pipelineCounts = LEAD_STATUS_OPTIONS.map((s) => ({
      status: s.value as LeadStatus,
      label: s.label,
      count: statusCounts[s.value] || 0,
    }));

    // Conversion rate
    const sold = statusCounts['sold'] || 0;
    const lost = statusCounts['lost'] || 0;
    const conversionRate = sold + lost > 0 ? Math.round((sold / (sold + lost)) * 100) : 0;

    // Recent leads (top 10)
    const recentLeads = allLeads.slice(0, 10);

    // Leads by source
    const sourceCounts: Record<string, number> = {};
    allLeads.forEach((l) => {
      const sources = l.lead_sources as unknown as { display_name: string } | null;
      const sourceName = sources?.display_name || 'Unknown';
      sourceCounts[sourceName] = (sourceCounts[sourceName] || 0) + 1;
    });
    const leadsBySource = Object.entries(sourceCounts)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      success: true,
      stats: {
        totalLeads,
        leadsThisWeek,
        leadsThisMonth,
        hotLeads,
        pipelineCounts,
        conversionRate,
        recentLeads,
        leadsBySource,
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
