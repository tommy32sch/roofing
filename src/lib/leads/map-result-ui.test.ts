import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const map = read('src/components/leads/LeadMap.tsx');
const sheet = read('src/components/leads/LeadResultSheet.tsx');
const page = read('src/app/admin/(app)/map/page.tsx');
const geoRoute = read('src/app/api/admin/leads/geo/route.ts');
const detail = read('src/app/admin/(app)/leads/[leadId]/page.tsx');

describe('map lead-result UI contracts', () => {
  it('opens a bottom sheet with large targets and both exact option sources', () => {
    expect(sheet).toContain('side="bottom"');
    expect(sheet).toContain('max-h-[85dvh]');
    expect(sheet).toContain('KNOCK_DISPOSITIONS');
    expect(sheet).toContain('COLD_CALL_DISPOSITIONS');
    expect(sheet).toContain('className="min-h-11');
    expect(sheet).toContain("channel: 'knock'");
    expect(sheet).toContain("channel: 'cold_call'");
  });

  it('offers both actions to every authenticated map role and blocks by channel only', () => {
    const actionBlock = map.slice(
      map.indexOf('{onOpenResult && ('),
      map.indexOf('{/* A "Callback" knock')
    );
    expect(actionBlock).toContain('Knocked');
    expect(actionBlock).toContain('Cold called');
    expect(actionBlock).toContain('disabled={lead.do_not_knock}');
    expect(actionBlock).toContain('disabled={lead.is_dnc}');
    expect(actionBlock).not.toContain('isAdmin');

    const callbackBlock = page.slice(
      page.indexOf('onOpenResult={'),
      page.indexOf('onFollowUpChange=')
    );
    expect(callbackBlock).toContain('(lead, channel) => setResultTarget');
    expect(callbackBlock).not.toContain('isAdmin');
  });

  it('shows the newest knock and call summaries and preserves callback follow-up', () => {
    expect(map).toContain('lead.last_knock_at');
    expect(map).toContain('lead.last_call_at');
    expect(map).toContain('callLabel(lead.last_call_disposition)');
    expect(map).toContain('shouldPromptForFollowUp(lead)');
  });

  it('optimistically overlays both channels and requests their geo summaries', () => {
    expect(page).toContain(
      'applyQueuedCalls(applyQueuedKnocks(leads, queuedKnocks), queuedCalls)'
    );
    expect(geoRoute).toContain('last_call_at');
    expect(geoRoute).toContain('last_call_disposition');
    expect(geoRoute).toContain('call_count');
  });

  it('keeps the popup phone payload inside the existing role access boundary', () => {
    const geoSelection = geoRoute.slice(
      geoRoute.indexOf('.select('),
      geoRoute.indexOf(".eq('is_flagged_duplicate'", geoRoute.indexOf('.select('))
    );
    expect(geoSelection).toContain('phone');
    expect(geoSelection).toContain('address_state');
    expect(geoSelection).toContain('address_zip');
    expect(geoRoute).toContain('applyLeadAccessFilter(query, { id: admin.sub, role: admin.role })');
    expect(geoRoute.indexOf('applyLeadAccessFilter')).toBeLessThan(geoRoute.indexOf('await query'));
  });

  it('never renders direct phone actions for a DNC map lead', () => {
    expect(map).toContain('!lead.is_dnc && primaryPhone');
    expect(map).toContain('href={`tel:${primaryPhone}`}');
    expect(map).toContain('href={`sms:${primaryPhone}`}');

    const directPhoneActions = map.slice(
      map.indexOf('aria-label={`Lead actions'),
      map.indexOf('Directions to ')
    );
    expect(directPhoneActions).toContain('!lead.is_dnc && primaryPhone');
    expect(directPhoneActions).toContain('tel:');
    expect(directPhoneActions).toContain('sms:');
    expect(directPhoneActions).not.toContain('lead.do_not_knock');
  });

  it('does not leave phone actions active after a manual Do Not Call result', () => {
    expect(detail).toContain('primaryPhone && !lead.is_dnc');
    expect(detail).toContain('phone && !lead.is_dnc');
    expect(detail).toContain('Do not call this lead.');
    expect(detail).not.toContain('The phone\\n                      number was not stored');
  });

  it('durably saves a result before opening required follow-on forms', () => {
    const save = page.indexOf('await resultOutbox.enqueue');
    expect(save).toBeGreaterThan(-1);
    expect(page.indexOf('setAppointmentLeadId', save)).toBeGreaterThan(save);
    expect(page.indexOf('setWonLeadId', save)).toBeGreaterThan(save);
    expect(page).toContain("userRole === 'setter'");
    expect(page).toContain('resultOutbox.online');
  });
});
