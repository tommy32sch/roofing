import { describe, it, expect } from 'vitest';
import {
  buildTerritoryPackage,
  isUsablePackage,
  estimatePackageBytes,
  totalStorageBytes,
  formatBytes,
  packageFreshness,
  formatAge,
  packagedLeadCount,
  PACKAGE_SCHEMA_VERSION,
  STALE_AFTER_MS,
} from './territory-package';
import type { Territory } from '@/types';
import type { TerritoryExecutionLead } from '@/lib/territories/execution';

const REP = 'rep-1';
const NOW = Date.parse('2026-08-04T12:00:00.000Z');

/*
 * The package stores execution leads verbatim, so the fixture is one too —
 * anything narrower would stop proving that a package can rebuild the screen,
 * which is the reason the format changed.
 */
const lead = (id: string) => ({
  id,
  market_id: 1,
  first_name: 'Jane',
  last_name: 'Smith',
  latitude: 33.46,
  longitude: -112.0,
  status: 'new',
  priority: 'high',
  address_street: '1421 E Palm Ln',
  address_city: 'Phoenix',
  is_dnc: false,
  do_not_knock: false,
  last_knock_at: null,
  last_disposition: null,
  knock_count: 0,
  follow_up_date: null,
  progress_state: 'unworked',
  revisit_state: 'none',
} as unknown as TerritoryExecutionLead);

const territory = { id: 't-1', name: 'Coronado North', boundary: [[33.46, -112.0]] } as unknown as Territory;

const pkg = (over: Partial<ReturnType<typeof buildTerritoryPackage>> = {}) => ({
  ...buildTerritoryPackage({
    territoryId: 't-1',
    name: 'Coronado North',
    snapshot: { territory, leads: [lead('a'), lead('b')] },
    repId: REP,
    downloadedAt: new Date(NOW).toISOString(),
  }),
  ...over,
});

describe('buildTerritoryPackage', () => {
  it('stamps the current schema version', () => {
    expect(pkg().schemaVersion).toBe(PACKAGE_SCHEMA_VERSION);
  });

  it('keeps everything needed to rebuild the execution screen offline', () => {
    const p = pkg();
    expect(p.snapshot.territory).toBeTruthy();
    expect(p.snapshot.leads).toHaveLength(2);
    // Full execution leads, not a trimmed shape — the offline screen runs the
    // same classifiers as the online one and needs these facts.
    expect(p.snapshot.leads[0]).toHaveProperty('knock_count');
    expect(p.snapshot.leads[0]).toHaveProperty('do_not_knock');
    expect(packagedLeadCount(p)).toBe(2);
    expect(p.repId).toBe(REP);
  });
});

describe('isUsablePackage', () => {
  it('accepts a well-formed package belonging to this rep', () => {
    expect(isUsablePackage(pkg(), REP)).toBe(true);
  });

  /**
   * Ownership is validity, not a separate concern. Phones get shared and
   * accounts get switched; a package is a snapshot of leads someone was
   * authorised to see, so handing it to the next person to sign in would leak
   * exactly what the visibility rules scope.
   */
  it('refuses a package downloaded by a different rep', () => {
    expect(isUsablePackage(pkg(), 'someone-else')).toBe(false);
  });

  /**
   * A shape change must discard rather than migrate. Re-downloading costs one
   * request; feeding a stale shape to the execution screen shows a rep the
   * wrong doors.
   */
  it('refuses a package written by an older build', () => {
    expect(isUsablePackage(pkg({ schemaVersion: 0 }), REP)).toBe(false);
    expect(isUsablePackage(pkg({ schemaVersion: PACKAGE_SCHEMA_VERSION + 1 }), REP)).toBe(false);
  });

  it('refuses anything structurally broken', () => {
    expect(isUsablePackage(null, REP)).toBe(false);
    expect(isUsablePackage(undefined, REP)).toBe(false);
    expect(isUsablePackage('nope', REP)).toBe(false);
    expect(isUsablePackage({}, REP)).toBe(false);
    expect(isUsablePackage(pkg({ snapshot: undefined as never }), REP)).toBe(false);
    expect(isUsablePackage(pkg({ snapshot: { leads: [] } as never }), REP)).toBe(false);
    expect(isUsablePackage(pkg({ territoryId: '' }), REP)).toBe(false);
  });

  // An empty territory is legitimate — every door in it may be worked.
  it('accepts a package with no leads left', () => {
    expect(isUsablePackage(pkg({ snapshot: { territory, leads: [] } }), REP)).toBe(true);
  });
});

describe('estimatePackageBytes', () => {
  it('grows with the number of leads', () => {
    const small = estimatePackageBytes(pkg({ snapshot: { territory, leads: [lead('a')] } }));
    const large = estimatePackageBytes(
      pkg({ snapshot: { territory, leads: Array.from({ length: 50 }, (_, i) => lead(`l${i}`)) } })
    );
    expect(large).toBeGreaterThan(small * 10);
  });

  // Byte length, not string length: addresses and names are not all ASCII.
  it('counts bytes rather than characters', () => {
    const ascii = estimatePackageBytes(pkg({ name: 'aaaa' }));
    const wide = estimatePackageBytes(pkg({ name: 'éééé' }));
    expect(wide).toBeGreaterThan(ascii);
  });
});

describe('totalStorageBytes', () => {
  it('sums every package', () => {
    const total = totalStorageBytes([pkg(), pkg({ territoryId: 't-2' })]);
    expect(total).toBeGreaterThan(estimatePackageBytes(pkg()));
  });

  it('is zero with nothing downloaded', () => {
    expect(totalStorageBytes([])).toBe(0);
  });
});

describe('formatBytes', () => {
  it('reads at a glance rather than exactly', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(400)).toBe('1 KB');
    expect(formatBytes(412 * 1024)).toBe('412 KB');
    expect(formatBytes(1.4 * 1024 * 1024)).toBe('1.4 MB');
    expect(formatBytes(24 * 1024 * 1024)).toBe('24 MB');
  });

  it('survives nonsense', () => {
    expect(formatBytes(NaN)).toBe('0 KB');
    expect(formatBytes(-5)).toBe('0 KB');
  });
});

describe('packageFreshness', () => {
  it('is fresh immediately after download', () => {
    const f = packageFreshness(pkg(), NOW);
    expect(f.ageMs).toBe(0);
    expect(f.stale).toBe(false);
  });

  it('goes stale past the threshold', () => {
    const p = pkg({ downloadedAt: new Date(NOW - STALE_AFTER_MS - 1000).toISOString() });
    expect(packageFreshness(p, NOW).stale).toBe(true);
  });

  it('is not stale exactly at the threshold', () => {
    const p = pkg({ downloadedAt: new Date(NOW - STALE_AFTER_MS).toISOString() });
    expect(packageFreshness(p, NOW).stale).toBe(false);
  });

  // A clock that moved backwards must not report a negative age.
  it('clamps a future timestamp to zero', () => {
    const p = pkg({ downloadedAt: new Date(NOW + 60_000).toISOString() });
    expect(packageFreshness(p, NOW).ageMs).toBe(0);
  });

  it('treats an unparseable timestamp as stale', () => {
    expect(packageFreshness(pkg({ downloadedAt: 'not a date' }), NOW).stale).toBe(true);
  });
});

describe('formatAge', () => {
  it('describes the age the way a rep would say it', () => {
    expect(formatAge(0)).toBe('just now');
    expect(formatAge(30_000)).toBe('just now');
    expect(formatAge(60_000)).toBe('1 minute ago');
    expect(formatAge(5 * 60_000)).toBe('5 minutes ago');
    expect(formatAge(60 * 60_000)).toBe('1 hour ago');
    expect(formatAge(14 * 60 * 60_000)).toBe('14 hours ago');
    expect(formatAge(2 * 24 * 60 * 60_000)).toBe('2 days ago');
  });

  it('handles an unknown age', () => {
    expect(formatAge(Infinity)).toBe('unknown');
  });
});
