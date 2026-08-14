export type IntegrationProvider = 'webhook' | 'email_import' | 'regrid';
export type IntegrationHealthState =
  | 'not_configured'
  | 'healthy'
  | 'stale'
  | 'failing'
  | 'paused';
export type IntegrationRunStatus = 'success' | 'failure' | 'rejected';

export interface IntegrationHealthFacts {
  configured: boolean;
  paused: boolean;
  configuredAt: string | null;
  expectedCadenceMinutes: number | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
}

export interface IntegrationHealthDecision {
  state: IntegrationHealthState;
  reason: string;
  reasonAt: string | null;
}

export interface IntegrationRunSummary {
  id: string;
  status: IntegrationRunStatus;
  startedAt: string;
  finishedAt: string;
  itemsReceived: number;
  itemsSucceeded: number;
  itemsFailed: number;
  errorSummary: string | null;
}

export type IntegrationConfigurationValue =
  | string
  | number
  | boolean
  | null
  | string[];

export interface IntegrationConnection {
  id: string;
  provider: IntegrationProvider;
  name: string;
  state: IntegrationHealthState;
  stateReason: string;
  stateReasonAt: string | null;
  configured: boolean;
  paused: boolean;
  expectedCadenceMinutes: number | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  recentVolume: number;
  recentVolumeWindowHours: number;
  safeErrorSummary: string | null;
  configuration: Record<string, IntegrationConfigurationValue>;
  recentRuns: IntegrationRunSummary[];
}

export interface IntegrationConnectionsResponse {
  success: true;
  generatedAt: string;
  connections: IntegrationConnection[];
  providerErrors: Partial<Record<IntegrationProvider, string>>;
}

export type IntegrationCadenceDecision =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

export function integrationCadence(value: unknown): IntegrationCadenceDecision {
  if (value == null || value === '') return { ok: true, value: null };
  const minutes = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 43_200) {
    return { ok: false, error: 'Cadence must be 5 to 43,200 minutes' };
  }
  return { ok: true, value: minutes };
}

export type AllowedSenderDecision =
  | { ok: true; value: string[] }
  | { ok: false; error: string };

/** Email addresses or @domain rules accepted by the existing intake matcher. */
export function allowedEmailSenders(value: unknown): AllowedSenderDecision {
  if (!Array.isArray(value)) return { ok: false, error: 'Allowed senders must be a list' };
  if (value.length > 100) return { ok: false, error: 'At most 100 sender rules are allowed' };

  const senders: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return { ok: false, error: 'Every sender rule must be text' };
    const sender = raw.trim().toLowerCase();
    if (!sender) continue;
    const validAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender);
    const validDomain = /^@[a-z0-9.-]+\.[a-z]{2,}$/i.test(sender);
    if (!validAddress && !validDomain) {
      return { ok: false, error: `Invalid sender rule: ${sender}` };
    }
    if (!senders.includes(sender)) senders.push(sender);
  }
  return { ok: true, value: senders };
}

function validInstant(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

/**
 * Explain health from durable facts. Push and event-driven providers have no
 * cadence by default, so quiet time alone can never make them stale.
 */
export function integrationHealth(
  facts: IntegrationHealthFacts,
  now = new Date()
): IntegrationHealthDecision {
  if (!facts.configured) {
    return {
      state: 'not_configured',
      reason: 'Setup is incomplete.',
      reasonAt: null,
    };
  }

  if (facts.paused) {
    return {
      state: 'paused',
      reason: 'This connection is paused.',
      reasonAt: facts.lastAttemptAt,
    };
  }

  const failureAt = validInstant(facts.lastFailureAt);
  const successAt = validInstant(facts.lastSuccessAt);
  if (
    facts.consecutiveFailures > 0 &&
    failureAt != null &&
    (successAt == null || failureAt > successAt)
  ) {
    return {
      state: 'failing',
      reason: `${facts.consecutiveFailures} consecutive ${
        facts.consecutiveFailures === 1 ? 'attempt has' : 'attempts have'
      } failed.`,
      reasonAt: facts.lastFailureAt,
    };
  }

  if (facts.expectedCadenceMinutes != null) {
    const referenceAt = successAt ?? validInstant(facts.configuredAt);
    const staleAfterMs = facts.expectedCadenceMinutes * 2 * 60_000;
    if (referenceAt != null && now.getTime() - referenceAt > staleAfterMs) {
      return {
        state: 'stale',
        reason: `No success within twice the expected ${facts.expectedCadenceMinutes}-minute cadence.`,
        reasonAt: facts.lastSuccessAt ?? facts.configuredAt,
      };
    }
  }

  return {
    state: 'healthy',
    reason: facts.lastSuccessAt
      ? 'The latest completed attempt succeeded.'
      : 'Configured and waiting for the first attempt.',
    reasonAt: facts.lastSuccessAt ?? facts.configuredAt,
  };
}

/** Keep provider output useful without persisting tokens or oversized bodies. */
export function safeIntegrationError(value: unknown): string | null {
  if (value == null) return null;
  const text = value instanceof Error ? value.message : String(value);
  const redacted = text
    .replace(/([?&](?:token|api[_-]?key|secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\b((?:api[_-]?key|token|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\b(?:rl_)?[a-f0-9]{40,}\b/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return redacted ? redacted.slice(0, 500) : null;
}
