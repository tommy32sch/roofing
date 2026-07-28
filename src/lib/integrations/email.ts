/**
 * Outbound email via Resend.
 *
 * Uses the REST API directly rather than the SDK — one fetch, no dependency.
 *
 * Failing to notify must never fail the thing being notified about: every path
 * here resolves to a result object instead of throwing, so a missing API key,
 * a Resend outage, or a bad address can't roll back an appointment the rep just
 * booked. Callers log the result; the appointment is already saved.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TEST_SENDER = 'Roof Leads <onboarding@resend.dev>';
const TIMEOUT_MS = 10_000;

export type EmailMode = 'disabled' | 'test' | 'production';

export interface EmailCapability {
  mode: EmailMode;
  testRecipient: string | null;
}

export interface EmailAttachment {
  filename: string;
  /** Raw UTF-8 content; base64-encoded before sending. */
  content: string;
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
  /** Provider-level dedupe for retryable outbox deliveries. */
  idempotencyKey?: string;
}

export type SendEmailResult =
  | { sent: true; id: string }
  | { sent: false; reason: 'not_configured' | 'no_recipient' | 'error'; detail?: string };

/**
 * Resolve email behavior explicitly so Resend's onboarding sender can never
 * masquerade as production delivery.
 *
 * Missing, incomplete, and unknown modes fail closed. Production delivery must
 * be opted into explicitly after its sender domain is verified.
 */
export function resolveEmailCapability(
  env: Record<string, string | undefined>
): EmailCapability {
  const requestedMode = env.RESEND_EMAIL_MODE?.trim().toLowerCase();
  const hasApiKey = Boolean(env.RESEND_API_KEY?.trim());

  if (requestedMode === 'test') {
    const testRecipient = env.RESEND_TEST_EMAIL?.trim() || null;
    return hasApiKey && testRecipient
      ? { mode: 'test', testRecipient }
      : { mode: 'disabled', testRecipient: null };
  }

  if (requestedMode === 'disabled') {
    return { mode: 'disabled', testRecipient: null };
  }

  if (requestedMode !== 'production') {
    return { mode: 'disabled', testRecipient: null };
  }

  return hasApiKey && Boolean(env.RESEND_FROM_EMAIL?.trim())
    ? { mode: 'production', testRecipient: null }
    : { mode: 'disabled', testRecipient: null };
}

export function getEmailCapability(): EmailCapability {
  return resolveEmailCapability(process.env);
}

/** True only when real recipients may be contacted. */
export function isEmailConfigured(): boolean {
  return getEmailCapability().mode === 'production';
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    return { sent: false, reason: 'not_configured' };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    return { sent: false, reason: 'not_configured' };
  }

  return deliverEmail(input, apiKey, from);
}

/**
 * Test-only delivery is intentionally separate from sendEmail: the recipient
 * and Resend onboarding sender both come from trusted server configuration.
 * Callers cannot turn this into an arbitrary email relay.
 */
export async function sendTestEmail(
  input: Omit<SendEmailInput, 'to'>
): Promise<SendEmailResult> {
  const capability = getEmailCapability();
  const apiKey = process.env.RESEND_API_KEY;
  if (capability.mode !== 'test' || !capability.testRecipient || !apiKey) {
    return { sent: false, reason: 'not_configured' };
  }

  return deliverEmail(
    { ...input, to: capability.testRecipient },
    apiKey,
    RESEND_TEST_SENDER
  );
}

async function deliverEmail(
  input: SendEmailInput,
  apiKey: string,
  from: string
): Promise<SendEmailResult> {
  const to = (Array.isArray(input.to) ? input.to : [input.to]).map((a) => a.trim()).filter(Boolean);
  if (to.length === 0) return { sent: false, reason: 'no_recipient' };

  const payload: Record<string, unknown> = {
    from,
    to,
    subject: input.subject,
    html: input.html,
  };
  if (input.text) payload.text = input.text;
  if (input.replyTo) payload.reply_to = input.replyTo;
  if (input.attachments?.length) {
    payload.attachments = input.attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content, 'utf8').toString('base64'),
    }));
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey;

    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { sent: false, reason: 'error', detail: body?.message || `HTTP ${res.status}` };
    }
    return { sent: true, id: body?.id ?? 'unknown' };
  } catch (err) {
    return { sent: false, reason: 'error', detail: err instanceof Error ? err.message : 'request failed' };
  }
}
