import { describe, expect, it } from 'vitest';
import { integrationHealth, safeIntegrationError } from './health';

const now = new Date('2026-08-14T18:00:00.000Z');
const base = {
  configured: true,
  paused: false,
  configuredAt: '2026-08-14T16:00:00.000Z',
  expectedCadenceMinutes: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  consecutiveFailures: 0,
};

describe('integrationHealth', () => {
  it('keeps incomplete and paused setup distinct', () => {
    expect(integrationHealth({ ...base, configured: false }, now).state).toBe('not_configured');
    expect(integrationHealth({ ...base, paused: true }, now).state).toBe('paused');
  });

  it('marks an unresolved failure as failing', () => {
    const result = integrationHealth({
      ...base,
      lastFailureAt: '2026-08-14T17:30:00.000Z',
      lastSuccessAt: '2026-08-14T17:00:00.000Z',
      consecutiveFailures: 2,
    }, now);

    expect(result.state).toBe('failing');
    expect(result.reason).toContain('2 consecutive attempts');
  });

  it('uses twice the configured cadence as the explicit stale boundary', () => {
    expect(integrationHealth({
      ...base,
      expectedCadenceMinutes: 30,
      lastSuccessAt: '2026-08-14T16:59:59.000Z',
    }, now).state).toBe('stale');

    expect(integrationHealth({
      ...base,
      expectedCadenceMinutes: 30,
      lastSuccessAt: '2026-08-14T17:01:00.000Z',
    }, now).state).toBe('healthy');
  });

  it('never calls an event-driven connection stale without a cadence', () => {
    expect(integrationHealth({
      ...base,
      configuredAt: '2025-01-01T00:00:00.000Z',
      lastSuccessAt: '2025-01-01T00:00:00.000Z',
    }, now).state).toBe('healthy');
  });
});

describe('safeIntegrationError', () => {
  it('redacts tokens and bounds provider output', () => {
    const value = safeIntegrationError(
      `Request failed?token=${'a'.repeat(64)} ${'x'.repeat(700)}`
    );

    expect(value).not.toContain('a'.repeat(64));
    expect(value).toContain('token=[redacted]');
    expect(value?.length).toBeLessThanOrEqual(500);
  });
});
