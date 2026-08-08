import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import { applyMarketFilter } from '@/lib/leads/markets';
import { applyLeadVisibilityFilter } from '@/lib/leads/lead-visibility';
import { LEAD_STATUS_OPTIONS } from '@/types';
import type { LeadStatus } from '@/types';
import { startOfWeek, startOfMonth } from 'date-fns';
import { previousPeriod } from '@/lib/leads/metric-delta';

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const supabase = db();

    const today = new Date().toISOString().slice(0, 10);

    // Office scoping: explicit ?market_id, else the caller's home market. The
    // dashboard blends both offices into one total otherwise, which describes
    // neither of them.
    const marketId = await marketFilterFor(admin.sub, new URL(request.url).searchParams.get('market_id'));

    // Overdue follow-ups count
    const overdueQuery = applyLeadVisibilityFilter(
      applyMarketFilter(
        supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .lte('follow_up_date', today)
          .not('follow_up_date', 'is', null)
          .not('status', 'in', '("sold","lost")'),
        marketId
      ),
      admin.role
    );
    const { count: overdueFollowUps } = await overdueQuery;

    // Get all leads with source
    const leadsQuery = applyLeadVisibilityFilter(
      applyMarketFilter(
        supabase
          .from('leads')
          // address_street is required — street-only imports have no city/state, so
          // without it the dashboard shows "No address" for most leads.
          .select('id, first_name, last_name, address_street, address_city, address_state, status, priority, source_id, deal_value, estimated_roof_value, created_at, lead_sources(display_name)'),
        marketId
      ),
      admin.role
    );
    const { data: leads, error } = await leadsQuery
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

    // Pipeline and won value
    const ACTIVE_STATUSES = new Set(['new', 'contacted', 'appointment_set', 'inspected', 'proposal_sent']);
    const totalPipelineValue = allLeads
      .filter((l) => ACTIVE_STATUSES.has(l.status) && l.deal_value)
      .reduce((sum, l) => sum + Number(l.deal_value), 0);
    const totalWonValue = allLeads
      .filter((l) => l.status === 'sold' && l.deal_value)
      .reduce((sum, l) => sum + Number(l.deal_value), 0);
    // Estimated roof value across active (still-open) leads.
    const totalEstimatedRoofValue = allLeads
      .filter((l) => ACTIVE_STATUSES.has(l.status) && l.estimated_roof_value)
      .reduce((sum, l) => sum + Number(l.estimated_roof_value), 0);

    /*
     * Compare the last 30 days with the 30 days before them.
     *
     * Computed here from leads already in memory. No extra query is needed.
     *
     * Only counts that can be honestly dated are compared. A lead has
     * created_at but no sold_at, so "won" means a lead that ARRIVED in the
     * window and has since sold. It does not mean a sale closed in the window.
     * The dashboard labels it that way.
     */
    const WINDOW_DAYS = 30;
    const windowEnd = now;
    const windowStart = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
    const prior = previousPeriod(windowStart, windowEnd);

    const createdBetween = (from: Date, to: Date) =>
      allLeads.filter((l) => {
        const t = new Date(l.created_at).getTime();
        return t >= from.getTime() && t < to.getTime();
      });

    const currentWindow = createdBetween(windowStart, windowEnd);
    const priorWindow = createdBetween(prior.start, prior.end);

    const windowSummary = (rows: typeof allLeads) => ({
      newLeads: rows.length,
      hot: rows.filter((l) => l.priority === 'hot').length,
      won: rows.filter((l) => l.status === 'sold').length,
      wonValue: rows
        .filter((l) => l.status === 'sold' && l.deal_value)
        .reduce((sum, l) => sum + Number(l.deal_value), 0),
    });

    /*
     * One point per day, oldest first. Days with no leads are kept as zero.
     * If the gaps were dropped, a quiet week would compress and the line would
     * show growth that did not happen.
     */
    const dailyCounts = new Map<string, number>();
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      dailyCounts.set(day, 0);
    }
    for (const l of currentWindow) {
      const day = new Date(l.created_at).toISOString().slice(0, 10);
      if (dailyCounts.has(day)) dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1);
    }
    const leadTrend = [...dailyCounts.entries()].map(([date, value]) => ({ date, value }));

    return NextResponse.json({
      success: true,
      stats: {
        totalLeads,
        period: {
          days: WINDOW_DAYS,
          current: windowSummary(currentWindow),
          previous: windowSummary(priorWindow),
        },
        leadTrend,
        leadsThisWeek,
        leadsThisMonth,
        hotLeads,
        pipelineCounts,
        conversionRate,
        recentLeads,
        leadsBySource,
        totalPipelineValue,
        totalWonValue,
        totalEstimatedRoofValue,
        overdueFollowUps: overdueFollowUps ?? 0,
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
