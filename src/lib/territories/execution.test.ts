import { describe, expect, it } from 'vitest';
import type { Territory } from '@/types';
import {
  buildTerritoryExecutionLead,
  canExecuteTerritories,
  classifyTerritoryProgress,
  classifyTerritoryRevisit,
  findNearestUnworkedLead,
  nextTerritoryLeadId,
  refreshTerritoryExecutionLead,
  summarizeTerritoryExecution,
  type TerritoryClassificationClock,
  type TerritoryExecutionLead,
  type TerritoryExecutionLeadInput,
  type TerritoryLeadFacts,
} from './execution';

const CLOCK: TerritoryClassificationClock = {
  today: '2026-08-02',
  now: '2026-08-02T18:00:00.000Z',
};

function facts(overrides: Partial<TerritoryLeadFacts> = {}): TerritoryLeadFacts {
  return {
    status: 'new',
    follow_up_date: null,
    last_knock_at: null,
    last_disposition: null,
    knock_count: 0,
    do_not_knock: false,
    last_call_at: null,
    last_call_disposition: null,
    call_count: 0,
    appointments: [],
    ...overrides,
  };
}

function leadInput(overrides: Partial<TerritoryExecutionLeadInput> = {}): TerritoryExecutionLeadInput {
  return {
    id: 'lead-a',
    market_id: 1,
    first_name: 'A',
    last_name: 'Lead',
    latitude: 33,
    longitude: -112,
    status: 'new',
    priority: 'medium',
    estimated_roof_value: null,
    address_street: '1 Main St',
    address_city: 'Phoenix',
    is_dnc: false,
    hail_date: null,
    hail_size_inches: null,
    last_knock_at: null,
    last_disposition: null,
    knock_count: 0,
    do_not_knock: false,
    last_call_at: null,
    last_call_disposition: null,
    call_count: 0,
    follow_up_date: null,
    appointments: [],
    ...overrides,
  };
}

function territory(overrides: Partial<Territory> = {}): Territory {
  return {
    id: 'territory-a',
    market_id: 1,
    name: 'North route',
    boundary: [[32, -113], [34, -113], [34, -111]],
    color: '#2563eb',
    owner_user_id: null,
    owner_name: null,
    owner_role: null,
    archived_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('territory progress classification', () => {
  it('uses the exclusive appointment > follow-up > contacted > knocked > unworked precedence', () => {
    expect(classifyTerritoryProgress(facts())).toBe('unworked');
    expect(classifyTerritoryProgress(facts({ knock_count: 1 }))).toBe('knocked');
    expect(classifyTerritoryProgress(facts({ status: 'contacted', knock_count: 1 }))).toBe('contacted');
    expect(
      classifyTerritoryProgress(facts({ status: 'contacted', follow_up_date: '2026-08-04' }))
    ).toBe('follow_up');
    expect(
      classifyTerritoryProgress(
        facts({ status: 'contacted', follow_up_date: '2026-08-04', appointments: [{ outcome: 'scheduled' }] })
      )
    ).toBe('appointment');
  });

  it('uses non-cancelled rows and the explicit status fallback, but not lost alone', () => {
    expect(classifyTerritoryProgress(facts({ appointments: [{ outcome: 'completed' }] }))).toBe('appointment');
    expect(
      classifyTerritoryProgress(facts({ appointments: [{ outcome: 'cancelled' }], knock_count: 1 }))
    ).toBe('knocked');
    for (const status of ['appointment_set', 'inspected', 'proposal_sent', 'sold']) {
      expect(classifyTerritoryProgress(facts({ status })), status).toBe('appointment');
    }
    expect(classifyTerritoryProgress(facts({ status: 'lost' }))).toBe('contacted');
    expect(
      classifyTerritoryProgress(facts({ status: 'lost', appointments: [{ outcome: 'scheduled' }] }))
    ).toBe('appointment');
  });

  it('only treats the newest cross-channel callback as active', () => {
    expect(
      classifyTerritoryProgress(facts({
        last_knock_at: '2026-08-01T10:00:00Z',
        last_disposition: 'callback',
        knock_count: 1,
      }))
    ).toBe('follow_up');
    expect(
      classifyTerritoryProgress(facts({
        last_knock_at: '2026-08-01T10:00:00Z',
        last_disposition: 'callback',
        knock_count: 1,
        last_call_at: '2026-08-01T11:00:00Z',
        last_call_disposition: 'wrong_number',
        call_count: 1,
      }))
    ).toBe('contacted');
  });
});

describe('territory revisit derivation', () => {
  it('distinguishes explicit due and scheduled dates using the rep local date', () => {
    expect(classifyTerritoryRevisit(facts({ follow_up_date: '2026-08-02' }), CLOCK)).toBe('due');
    expect(classifyTerritoryRevisit(facts({ follow_up_date: '2026-08-03' }), CLOCK)).toBe('scheduled');
  });

  it('surfaces undated callbacks and not-home doors after fourteen days', () => {
    expect(classifyTerritoryRevisit(facts({
      last_call_at: '2026-08-01T12:00:00Z',
      last_call_disposition: 'call_back',
      call_count: 1,
    }), CLOCK)).toBe('needs_schedule');
    expect(classifyTerritoryRevisit(facts({
      last_knock_at: '2026-07-19T18:00:00Z',
      last_disposition: 'not_home',
      knock_count: 1,
    }), CLOCK)).toBe('due');
    expect(classifyTerritoryRevisit(facts({
      last_knock_at: '2026-07-20T18:00:00Z',
      last_disposition: 'not_home',
      knock_count: 1,
    }), CLOCK)).toBe('none');
  });

  it('never queues closed, do-not-knock, or appointment leads', () => {
    expect(classifyTerritoryRevisit(facts({ status: 'lost', follow_up_date: '2026-08-01' }), CLOCK)).toBe('none');
    expect(classifyTerritoryRevisit(facts({ do_not_knock: true, follow_up_date: '2026-08-01' }), CLOCK)).toBe('none');
    expect(classifyTerritoryRevisit(facts({ status: 'appointment_set', follow_up_date: '2026-08-01' }), CLOCK)).toBe('none');
  });
});

describe('territory summary and nearest-door helpers', () => {
  it('returns canonical coverage and state values', () => {
    const empty = summarizeTerritoryExecution(territory(), [], CLOCK.now);
    expect(empty).toMatchObject({ coverage_percent: 0, state: 'empty', total_leads: 0 });

    const unworked = buildTerritoryExecutionLead(leadInput(), CLOCK);
    const notStarted = summarizeTerritoryExecution(territory({ created_at: '2026-08-01T00:00:00Z' }), [unworked], CLOCK.now);
    expect(notStarted).toMatchObject({ coverage_percent: 0, state: 'not_started', never_started: true });

    const stalled = summarizeTerritoryExecution(territory(), [unworked], CLOCK.now);
    expect(stalled).toMatchObject({ state: 'stalled', stalled: true });

    const knocked = buildTerritoryExecutionLead(leadInput({
      id: 'lead-b',
      knock_count: 1,
      last_knock_at: '2026-08-02T12:00:00Z',
      last_disposition: 'not_home',
    }), CLOCK);
    const active = summarizeTerritoryExecution(territory(), [unworked, knocked], CLOCK.now);
    expect(active).toMatchObject({ coverage_percent: 50, state: 'active' });

    const contacted = buildTerritoryExecutionLead(leadInput({ id: 'lead-c', status: 'contacted' }), CLOCK);
    const complete = summarizeTerritoryExecution(territory(), [contacted], CLOCK.now);
    expect(complete).toMatchObject({ coverage_percent: 100, state: 'complete', stalled: false });

    const blocked = buildTerritoryExecutionLead(
      leadInput({ id: 'blocked-only', do_not_knock: true }),
      CLOCK
    );
    expect(summarizeTerritoryExecution(territory(), [blocked], CLOCK.now)).toMatchObject({
      coverage_percent: 0,
      blocked_leads: 1,
      state: 'complete',
      stalled: false,
    });
  });

  it('marks outstanding work stalled at seven elapsed days, not before', () => {
    const unworked = buildTerritoryExecutionLead(leadInput(), CLOCK);
    expect(
      summarizeTerritoryExecution(
        territory({ created_at: '2026-07-26T18:00:00.000Z' }),
        [unworked],
        CLOCK.now
      ).state
    ).toBe('stalled');
    expect(
      summarizeTerritoryExecution(
        territory({ created_at: '2026-07-26T18:00:00.001Z' }),
        [unworked],
        CLOCK.now
      ).state
    ).toBe('not_started');
  });

  it('orders only actionable unworked leads and leaves location client-side', () => {
    const farther = buildTerritoryExecutionLead(leadInput({ id: 'b', latitude: 33.001 }), CLOCK);
    const nearer = buildTerritoryExecutionLead(leadInput({ id: 'a', latitude: 33.0001 }), CLOCK);
    const worked = buildTerritoryExecutionLead(leadInput({ id: 'worked', latitude: 33, knock_count: 1 }), CLOCK);
    const blocked = buildTerritoryExecutionLead(leadInput({ id: 'blocked', latitude: 33, do_not_knock: true }), CLOCK);
    expect(findNearestUnworkedLead([farther, worked, blocked, nearer], { latitude: 33, longitude: -112 }))
      .toMatchObject({ lead: { id: 'a' } });

    const tieB = buildTerritoryExecutionLead(leadInput({ id: 'b', latitude: 33 }), CLOCK);
    const tieA = buildTerritoryExecutionLead(leadInput({ id: 'a', latitude: 33 }), CLOCK);
    expect(findNearestUnworkedLead([tieB, tieA], { latitude: 33, longitude: -112 }))
      .toMatchObject({ lead: { id: 'a' } });
  });

  it('refreshes optimistic field overlays without losing appointment evidence', () => {
    const initial = buildTerritoryExecutionLead(leadInput({ appointments: [{ outcome: 'scheduled' }] }), CLOCK);
    const overlaid: TerritoryExecutionLead = {
      ...initial,
      last_knock_at: '2026-08-02T17:00:00Z',
      last_disposition: 'callback',
      knock_count: 1,
    };
    const refreshed = refreshTerritoryExecutionLead(overlaid, CLOCK);
    expect(refreshed.has_appointment).toBe(true);
    expect(refreshed.progress_state).toBe('appointment');
    expect(refreshed.revisit_state).toBe('none');
    expect(refreshed.last_field_activity_at).toBe('2026-08-02T17:00:00Z');
  });

  it('advances from an offline-worked door but holds callbacks until they are scheduled', () => {
    const next = buildTerritoryExecutionLead(
      leadInput({ id: 'next', latitude: 33.0001 }),
      CLOCK
    );
    const workedOverlay = refreshTerritoryExecutionLead(
      {
        ...buildTerritoryExecutionLead(leadInput({ id: 'current' }), CLOCK),
        last_knock_at: CLOCK.now,
        last_disposition: 'not_home',
        knock_count: 1,
      },
      CLOCK
    );
    expect(
      nextTerritoryLeadId(
        [workedOverlay, next],
        'current',
        { latitude: 33, longitude: -112 }
      )
    ).toBe('next');
    expect(nextTerritoryLeadId([workedOverlay, next], 'current', null)).toBeNull();

    const callbackOverlay = refreshTerritoryExecutionLead(
      { ...workedOverlay, last_disposition: 'callback' },
      CLOCK
    );
    expect(
      nextTerritoryLeadId(
        [callbackOverlay, next],
        'current',
        { latitude: 33, longitude: -112 }
      )
    ).toBe('current');
  });
});

describe('territory execution roles', () => {
  it('allows admins and setters but not closers', () => {
    expect(canExecuteTerritories('admin')).toBe(true);
    expect(canExecuteTerritories('setter')).toBe(true);
    expect(canExecuteTerritories('closer')).toBe(false);
  });
});
