import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveEmailCapability,
  sendEmail,
  sendTestEmail,
} from './email';

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('email capability modes', () => {
  it('is disabled without complete configuration', () => {
    expect(resolveEmailCapability({})).toEqual({
      mode: 'disabled',
      testRecipient: null,
    });
  });

  it('requires explicit production mode even when a key and From address exist', () => {
    expect(resolveEmailCapability({
      RESEND_API_KEY: 're_test',
      RESEND_FROM_EMAIL: 'Roof Leads <alerts@example.com>',
    })).toEqual({
      mode: 'disabled',
      testRecipient: null,
    });
    expect(resolveEmailCapability({
      RESEND_EMAIL_MODE: 'production',
      RESEND_API_KEY: 're_test',
      RESEND_FROM_EMAIL: 'Roof Leads <alerts@example.com>',
    })).toEqual({
      mode: 'production',
      testRecipient: null,
    });
  });

  it('selects test mode only with an API key and fixed test recipient', () => {
    expect(resolveEmailCapability({
      RESEND_EMAIL_MODE: 'test',
      RESEND_API_KEY: 're_test',
      RESEND_TEST_EMAIL: 'owner@example.com',
      RESEND_FROM_EMAIL: 'ignored malformed sender',
    })).toEqual({
      mode: 'test',
      testRecipient: 'owner@example.com',
    });
  });

  it('fails closed for incomplete or unknown explicit modes', () => {
    expect(resolveEmailCapability({
      RESEND_EMAIL_MODE: 'test',
      RESEND_API_KEY: 're_test',
    }).mode).toBe('disabled');
    expect(resolveEmailCapability({
      RESEND_EMAIL_MODE: 'surprise',
      RESEND_API_KEY: 're_test',
      RESEND_FROM_EMAIL: 'alerts@example.com',
    }).mode).toBe('disabled');
  });
});

describe('test-only delivery isolation', () => {
  it('blocks normal storm and appointment email delivery without calling Resend', async () => {
    vi.stubEnv('RESEND_EMAIL_MODE', 'test');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_TEST_EMAIL', 'owner@example.com');
    vi.stubEnv('RESEND_FROM_EMAIL', 'malformed sender');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(Promise.all([
      sendEmail({
        to: 'subscriber@example.com',
        subject: 'Storm alert',
        html: '<p>Storm alert</p>',
      }),
      sendEmail({
        to: 'homeowner@example.com',
        subject: 'Appointment confirmation',
        html: '<p>Appointment confirmation</p>',
      }),
    ])).resolves.toEqual([
      { sent: false, reason: 'not_configured' },
      { sent: false, reason: 'not_configured' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses only the onboarding sender and configured account recipient for a test', async () => {
    vi.stubEnv('RESEND_EMAIL_MODE', 'test');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_TEST_EMAIL', 'owner@example.com');
    vi.stubEnv('RESEND_FROM_EMAIL', 'malformed sender');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'email_123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendTestEmail({
      subject: 'Connection test',
      html: '<p>Test</p>',
    })).resolves.toEqual({ sent: true, id: 'email_123' });

    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      from: 'Roof Leads <onboarding@resend.dev>',
      to: ['owner@example.com'],
      subject: 'Connection test',
    });
  });
});
