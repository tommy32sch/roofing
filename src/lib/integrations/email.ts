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
const TIMEOUT_MS = 10_000;

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
}

export type SendEmailResult =
  | { sent: true; id: string }
  | { sent: false; reason: 'not_configured' | 'no_recipient' | 'error'; detail?: string };

/** True when both an API key and a verified From address are present. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    return { sent: false, reason: 'not_configured' };
  }

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
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
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
