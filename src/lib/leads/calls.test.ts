import { describe, expect, it } from 'vitest';
import {
  COLD_CALL_DISPOSITIONS,
  COLD_CALL_DISPOSITION_VALUES,
  callLabel,
  statusForCallDisposition,
} from './calls';

describe('COLD_CALL_DISPOSITIONS', () => {
  it('exposes the exact selectable product list in order', () => {
    expect(COLD_CALL_DISPOSITIONS.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: 'left_voicemail', label: 'Left Voicemail' },
      { value: 'call_back', label: 'Call Back' },
      { value: 'appointment_set', label: 'Appointment Set' },
      { value: 'wrong_number', label: 'Wrong Number' },
      { value: 'do_not_call', label: 'Do Not Call' },
      { value: 'not_interested', label: 'Not Interested' },
    ]);
  });

  it('validates every option and rejects unknown values', () => {
    for (const result of COLD_CALL_DISPOSITIONS) {
      expect(COLD_CALL_DISPOSITION_VALUES.has(result.value)).toBe(true);
    }
    expect(COLD_CALL_DISPOSITION_VALUES.has('answered')).toBe(false);
  });
});

describe('statusForCallDisposition', () => {
  it('counts live responses as contact', () => {
    expect(statusForCallDisposition('call_back')).toBe('contacted');
    expect(statusForCallDisposition('do_not_call')).toBe('contacted');
    expect(statusForCallDisposition('not_interested')).toBe('contacted');
  });

  it('does not treat voicemail or a wrong number as contact', () => {
    expect(statusForCallDisposition('left_voicemail')).toBeNull();
    expect(statusForCallDisposition('wrong_number')).toBeNull();
  });

  it('does not bypass the required appointment workflow', () => {
    expect(statusForCallDisposition('appointment_set')).toBe('contacted');
  });
});

describe('callLabel', () => {
  it('renders human labels and falls back for historical unknowns', () => {
    expect(callLabel('left_voicemail')).toBe('Left Voicemail');
    expect(callLabel('appointment_set')).toBe('Appointment Set');
    expect(callLabel('mystery')).toBe('mystery');
  });
});
