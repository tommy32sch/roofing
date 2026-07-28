import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, rateLimitMock, sendEmailMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  rateLimitMock: vi.fn(),
  sendEmailMock: vi.fn(),
}));

vi.mock('@/lib/auth/jwt', () => ({
  getAuthenticatedAdmin: authMock,
}));

vi.mock('@/lib/utils/rate-limit', () => ({
  checkConfiguredRateLimit: rateLimitMock,
}));

vi.mock('@/lib/integrations/email', () => ({
  sendEmail: sendEmailMock,
}));

import { POST } from '@/app/api/admin/storm-alerts/test-email/route';

const ADMIN = {
  sub: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.com',
  name: 'Owner',
  role: 'admin' as const,
  iat: 0,
  exp: 0,
};

beforeEach(() => {
  authMock.mockReset();
  rateLimitMock.mockReset();
  sendEmailMock.mockReset();
  rateLimitMock.mockResolvedValue({
    success: true,
    limit: 3,
    remaining: 2,
    reset: Date.now() + 3_600_000,
  });
});

describe('storm alert test email route', () => {
  it('requires authentication', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('allows only admins', async () => {
    authMock.mockResolvedValue({ ...ADMIN, role: 'setter' });

    const response = await POST();

    expect(response.status).toBe(403);
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('limits repeated sends per signed-in admin', async () => {
    authMock.mockResolvedValue(ADMIN);
    rateLimitMock.mockResolvedValue({
      success: false,
      limit: 3,
      remaining: 0,
      reset: Date.now() + 3_600_000,
    });

    const response = await POST();

    expect(response.status).toBe(429);
    expect(rateLimitMock).toHaveBeenCalledWith(ADMIN.sub, 'storm-test-email', 3, '1 h');
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('sends only to the signed-in admin', async () => {
    authMock.mockResolvedValue(ADMIN);
    sendEmailMock.mockResolvedValue({ sent: true, id: 'email_123' });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, to: ADMIN.email });
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(sendEmailMock.mock.calls[0][0]).toMatchObject({
      to: ADMIN.email,
      subject: 'Roof Leads storm alerts are ready',
    });
  });

  it('returns a safe provider failure without claiming delivery', async () => {
    authMock.mockResolvedValue(ADMIN);
    sendEmailMock.mockResolvedValue({
      sent: false,
      reason: 'error',
      detail: 'Sender domain is not verified',
    });

    const response = await POST();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Sender domain is not verified',
    });
  });
});
