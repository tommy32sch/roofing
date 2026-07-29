import { describe, it, expect } from 'vitest';
import {
  isAppointmentOutcome,
  appointmentOutcomeLabel,
  isSettledOutcome,
  isAwaitingOutcome,
  summariseOutcomes,
  canRecordOutcome,
  APPOINTMENT_OUTCOMES,
} from './appointment-outcomes';

const NOW = '2026-07-29T12:00:00.000Z';
const past = (o: string) => ({ scheduled_at: '2026-07-28T10:00:00.000Z', outcome: o });
const future = (o: string) => ({ scheduled_at: '2026-07-30T10:00:00.000Z', outcome: o });

describe('isAppointmentOutcome', () => {
  it('accepts the known outcomes', () => {
    for (const o of APPOINTMENT_OUTCOMES) expect(isAppointmentOutcome(o)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isAppointmentOutcome('showed')).toBe(false);
    expect(isAppointmentOutcome('')).toBe(false);
    expect(isAppointmentOutcome(null)).toBe(false);
    expect(isAppointmentOutcome(3)).toBe(false);
  });
});

describe('appointmentOutcomeLabel', () => {
  it('renders human labels', () => {
    expect(appointmentOutcomeLabel('no_show')).toBe('No-show');
    expect(appointmentOutcomeLabel('completed')).toBe('Completed');
  });

  it('falls back to the raw value rather than blank', () => {
    expect(appointmentOutcomeLabel('mystery')).toBe('mystery');
  });
});

describe('isSettledOutcome', () => {
  it('treats a decided result as settled', () => {
    expect(isSettledOutcome('completed')).toBe(true);
    expect(isSettledOutcome('no_show')).toBe(true);
    expect(isSettledOutcome('cancelled')).toBe(true);
  });

  it('does not treat a pending booking as settled', () => {
    expect(isSettledOutcome('scheduled')).toBe(false);
  });
});

describe('isAwaitingOutcome', () => {
  // These are the honest gap: neither a show nor a no-show, just admin nobody
  // has done. Counting them either way would distort the rate.
  it('flags a past appointment with no result recorded', () => {
    expect(isAwaitingOutcome(past('scheduled'), NOW)).toBe(true);
  });

  it('does not flag a future appointment', () => {
    expect(isAwaitingOutcome(future('scheduled'), NOW)).toBe(false);
  });

  it('does not flag one that already has a result', () => {
    expect(isAwaitingOutcome(past('completed'), NOW)).toBe(false);
    expect(isAwaitingOutcome(past('no_show'), NOW)).toBe(false);
  });

  it('does not flag unparseable dates', () => {
    expect(isAwaitingOutcome({ scheduled_at: 'nope', outcome: 'scheduled' }, NOW)).toBe(false);
  });
});

describe('summariseOutcomes', () => {
  it('counts each outcome and separates upcoming from awaiting', () => {
    const out = summariseOutcomes(
      [
        past('completed'),
        past('completed'),
        past('no_show'),
        past('cancelled'),
        past('scheduled'), // awaiting
        future('scheduled'), // upcoming
      ],
      NOW
    );
    expect(out).toMatchObject({
      total: 6,
      completed: 2,
      noShow: 1,
      cancelled: 1,
      awaiting: 1,
      upcoming: 1,
    });
  });

  // The rate that matters, and the denominator choice behind it.
  it('computes show and no-show rates from decided appointments', () => {
    const out = summariseOutcomes([past('completed'), past('completed'), past('no_show')], NOW);
    expect(out.showRate).toBeCloseTo(2 / 3, 6);
    expect(out.noShowRate).toBeCloseTo(1 / 3, 6);
  });

  // A cancellation is a different event from being left on the doorstep.
  // Including it would let a rep improve their no-show rate by cancelling
  // appointments they expected to lose.
  it('excludes cancellations from the rate denominator', () => {
    const withCancels = summariseOutcomes(
      [past('completed'), past('no_show'), past('cancelled'), past('cancelled')],
      NOW
    );
    const without = summariseOutcomes([past('completed'), past('no_show')], NOW);
    expect(withCancels.showRate).toBe(without.showRate);
    expect(withCancels.cancelled).toBe(2);
  });

  // "No data" and "everybody no-showed" must not render identically.
  it('returns null rates rather than zero when nothing is decided', () => {
    const out = summariseOutcomes([future('scheduled'), past('cancelled')], NOW);
    expect(out.showRate).toBeNull();
    expect(out.noShowRate).toBeNull();
  });

  it('handles an empty list', () => {
    expect(summariseOutcomes([], NOW)).toMatchObject({
      total: 0,
      showRate: null,
      noShowRate: null,
    });
  });

  it('rates always sum to one when anything is decided', () => {
    const out = summariseOutcomes([past('completed'), past('no_show'), past('no_show')], NOW);
    expect((out.showRate ?? 0) + (out.noShowRate ?? 0)).toBeCloseTo(1, 6);
  });
});

describe('canRecordOutcome', () => {
  const base = {
    role: 'setter',
    userId: 'rep-1',
    appointmentCreatedBy: 'rep-1',
    appointmentAssignedTo: null,
    existingOutcomeBy: null,
  };

  it('lets a rep record the result of their own appointment', () => {
    expect(canRecordOutcome(base)).toBe(true);
  });

  it('lets a rep record when the lead is assigned to them', () => {
    expect(
      canRecordOutcome({ ...base, appointmentCreatedBy: 'someone', appointmentAssignedTo: 'rep-1' })
    ).toBe(true);
  });

  it('stops a rep touching an appointment that is not theirs', () => {
    expect(
      canRecordOutcome({ ...base, appointmentCreatedBy: 'other', appointmentAssignedTo: 'other' })
    ).toBe(false);
  });

  // A disappointing result must not be quietly rewritten by the person it
  // reflects on.
  it('stops a rep overwriting an outcome someone else recorded', () => {
    expect(canRecordOutcome({ ...base, existingOutcomeBy: 'manager-1' })).toBe(false);
  });

  it('lets a rep correct their own earlier entry', () => {
    expect(canRecordOutcome({ ...base, existingOutcomeBy: 'rep-1' })).toBe(true);
  });

  it('lets an admin record or overwrite anything', () => {
    expect(
      canRecordOutcome({
        role: 'admin',
        userId: 'admin-1',
        appointmentCreatedBy: 'other',
        appointmentAssignedTo: 'other',
        existingOutcomeBy: 'someone-else',
      })
    ).toBe(true);
  });
});
