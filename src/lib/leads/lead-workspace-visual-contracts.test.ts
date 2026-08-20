import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const listPage = read('src/app/admin/(app)/leads/page.tsx');
const queueToolbar = read('src/components/leads/LeadQueueToolbar.tsx');
const detailPage = read('src/app/admin/(app)/leads/[leadId]/page.tsx');

describe('lead workspace visual contracts', () => {
  it('treats the lead list as a queue instead of a filter wall', () => {
    expect(listPage).toContain('Lead book');
    expect(listPage).toContain('Current queue');
    expect(listPage).toContain('<LeadQuickActions');
    expect(listPage).toContain('TableHeader className="sticky top-0');
    expect(queueToolbar).toContain('aria-label="Lead queue presets"');
    expect(queueToolbar).toContain('aria-controls="desktop-lead-filters"');
    expect(queueToolbar).toContain('desktopFiltersOpen && (');
    expect(queueToolbar).not.toContain('rounded-xl border bg-card/60 p-3 shadow-sm');
  });

  it('keeps desktop and phone results purpose-built for their available space', () => {
    expect(listPage).toContain('md:hidden" aria-busy={loading} aria-label="Lead results"');
    expect(listPage).toContain('hidden border-y md:block');
    expect(listPage).toContain('[&_[data-slot=table-container]]:overflow-auto');
    expect(listPage).toContain("Show 50 at a time");
    expect(listPage).toContain('Show all');
    expect(listPage).toContain('Call ${leadName}');
    expect(listPage).toContain('Text ${leadName}');
    expect(listPage).toContain('Directions to ${leadName}');
  });

  it('makes the homeowner record action-first with visible history', () => {
    expect(detailPage).toContain('Homeowner record');
    expect(detailPage).toContain('aria-label="Lead record actions"');
    expect(detailPage).toContain('aria-label="Lead record controls"');
    expect(detailPage).toContain('title="Activity timeline"');
    expect(detailPage).toContain('const timelineEvents = [');
    expect(detailPage).toContain('Full History');
    expect(detailPage).toContain('lg:grid-cols-[minmax(0,1fr)_22rem]');
    expect(detailPage).not.toContain('<Tabs');
    expect(detailPage).not.toContain('<Card');
  });

  it('keeps safety and operational actions in the redesigned record', () => {
    for (const label of [
      'Do Not Call',
      'Do Not Knock',
      'Flagged duplicate',
      'AppointmentOutcomeActions',
      'LeadPhotos',
      'Ownership and deal',
      'Storm data',
    ]) {
      expect(detailPage).toContain(label);
    }
  });
});
