import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';

type Breakdown = { value: string; count: number; pct: number }[];

function breakdown(items: (string | null | undefined)[], total: number): Breakdown {
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (!item) continue;
    counts[item] = (counts[item] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([value, count]) => ({ value, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
}

function generateRecommendation(
  careers: Breakdown,
  ages: Breakdown,
  incomes: Breakdown,
  familySizes: Breakdown,
  decisionMakers: Breakdown,
  total: number,
): string {
  if (total < 3) {
    return 'Not enough won leads with demographic data to generate a recommendation. Close at least 3 deals with full profiles to unlock targeting insights.';
  }

  const topCareer = careers[0]?.value ?? 'homeowners';
  const topAge = ages[0]?.value ?? 'various ages';
  const topIncome = incomes[0]?.value ?? 'various income levels';
  const topFamily = familySizes[0]?.value ?? 'various sizes';

  const jointCount = decisionMakers.find(d => d.value === 'joint')?.count ?? 0;
  const soleCount = decisionMakers.find(d => d.value === 'sole')?.count ?? 0;
  const decisionNote = jointCount > soleCount
    ? 'Prioritize joint decision-maker households — most won deals involve both partners making the call.'
    : 'Single decision-makers represent the majority of won deals — use messaging that empowers solo homeowners to act quickly.';

  return (
    `Target ${topAge}-year-old ${topCareer}s with ${topIncome} household income and family sizes around ${topFamily}. ` +
    decisionNote
  );
}

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || 'all';

    const supabase = db();
    interface WonLead {
      career: string | null;
      family_size: number | null;
      marital_status: string | null;
      age_range: string | null;
      household_income_range: string | null;
      education_level: string | null;
      decision_maker: string | null;
      insurance_carrier: string | null;
      referral_source: string | null;
      demographic_captured_at: string | null;
    }

    let dbQuery = supabase
      .from('leads')
      .select(
        'career, family_size, marital_status, age_range, household_income_range, ' +
        'education_level, decision_maker, insurance_carrier, referral_source, demographic_captured_at'
      )
      .eq('status', 'sold')
      .not('demographic_captured_at', 'is', null);

    if (range !== 'all') {
      const days = range === '30d' ? 30 : range === '90d' ? 90 : 365;
      const since = new Date();
      since.setDate(since.getDate() - days);
      dbQuery = dbQuery.gte('demographic_captured_at', since.toISOString());
    }

    const { data: rawLeads, error } = await dbQuery;

    const leads = rawLeads as WonLead[] | null;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const safeLeads = leads ?? [];
    const total = safeLeads.length;

    const careers = breakdown(safeLeads.map(l => l.career), total);
    const familySizes = breakdown(safeLeads.map(l => l.family_size?.toString() ?? null), total);
    const maritalStatuses = breakdown(safeLeads.map(l => l.marital_status), total);
    const ageRanges = breakdown(safeLeads.map(l => l.age_range), total);
    const incomes = breakdown(safeLeads.map(l => l.household_income_range), total);
    const education = breakdown(safeLeads.map(l => l.education_level), total);
    const decisionMakers = breakdown(safeLeads.map(l => l.decision_maker), total);
    const insurance = breakdown(safeLeads.map(l => l.insurance_carrier), total);
    const referrals = breakdown(safeLeads.map(l => l.referral_source), total);

    // Top 3 career + marital_status combos
    const comboCounts: Record<string, number> = {};
    for (const lead of safeLeads) {
      if (!lead.career || !lead.marital_status) continue;
      const key = `${lead.career} · ${lead.marital_status}`;
      comboCounts[key] = (comboCounts[key] || 0) + 1;
    }
    const topCombos = Object.entries(comboCounts)
      .map(([combo, count]) => ({ combo, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    const recommendation = generateRecommendation(careers, ageRanges, incomes, familySizes, decisionMakers, total);

    return NextResponse.json({
      success: true,
      total,
      recommendation,
      breakdowns: {
        careers,
        familySizes,
        maritalStatuses,
        ageRanges,
        incomes,
        education,
        decisionMakers,
        insurance,
        referrals,
      },
      topCombos,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
