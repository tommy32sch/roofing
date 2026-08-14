import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const reportScope = read('src/components/reporting/report-scope-bar.tsx');
const teamPulse = read('src/components/reporting/team-pulse-ledger.tsx');
const activityRoute = read('src/app/api/admin/contact-activity/route.ts');
const leadRoute = read('src/app/api/admin/leads/[leadId]/route.ts');
const leadDetail = read('src/app/admin/(app)/leads/[leadId]/page.tsx');

describe('contact activity tracking contracts', () => {
  it('counts both structured channels inside a bounded reporting window', () => {
    expect(activityRoute).toContain(".from('lead_knocks')");
    expect(activityRoute).toContain(".from('lead_calls')");
    expect(activityRoute).toContain(".gte('knocked_at', start!)");
    expect(activityRoute).toContain(".lt('knocked_at', end!)");
    expect(activityRoute).toContain(".gte('called_at', start!)");
    expect(activityRoute).toContain(".lt('called_at', end!)");
    expect(activityRoute).toContain("leads!inner");
    expect(activityRoute).toContain("'leads.market_id'");
    expect(activityRoute).toContain("resolveContactActivityUser");
  });

  it('offers Today, Week and Month plus account filtering and lead links', () => {
    for (const period of ["'today'", "'week'", "'month'"]) {
      expect(reportScope).toContain(period);
    }
    expect(reportScope).toContain('All team');
    expect(reportScope).toContain('My work');
    expect(teamPulse).toContain('row.knocks');
    expect(teamPulse).toContain('row.calls');
    expect(teamPulse).toContain('href={row.href}');
  });

  it('embeds exact structured history in the lead overview', () => {
    expect(leadRoute).toContain('lead_knocks: knocks || []');
    expect(leadRoute).toContain('lead_calls: calls || []');
    expect(leadDetail).toContain('lead.knock_count.toLocaleString()');
    expect(leadDetail).toContain('lead.call_count.toLocaleString()');
    expect(leadDetail).toContain('Full History');
    expect(leadDetail).toContain('event.accountName');
  });
});
