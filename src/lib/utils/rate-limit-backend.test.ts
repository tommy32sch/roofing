import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The failure this covers is not "Upstash was never configured" — that path
 * already warned. It is "Upstash IS configured and the database is gone",
 * which passes every configuration check, throws inside the limiter call, and
 * was silently swallowed by the fallback.
 *
 * That is the expected end state of a free-tier database, not an edge case, and
 * it left brute-force protection as a per-instance counter for weeks with
 * nothing reporting it.
 */
describe('rate-limit backend health', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    vi.restoreAllMocks();
  });

  it('reports unconfigured when no credentials are present', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { rateLimitBackendStatus } = await import('./rate-limit');
    const status = rateLimitBackendStatus();
    expect(status.configured).toBe(false);
    expect(status.healthy).toBe(false);
  });

  /**
   * The core case. Credentials look entirely valid, so `configured` is true —
   * which is exactly why "are the env vars set?" was the wrong question — but a
   * real call fails and health must reflect that.
   */
  it('reports UNHEALTHY when configured credentials point at a dead host', async () => {
    // Reserved discard port: refuses immediately rather than hanging.
    process.env.UPSTASH_REDIS_REST_URL = 'https://127.0.0.1:9';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token-for-a-database-that-no-longer-exists';

    const { checkConfiguredRateLimit, rateLimitBackendStatus } = await import('./rate-limit');
    const result = await checkConfiguredRateLimit('probe', 'test', 5, '1 m');

    // The request still succeeds — refusing every login because Redis is down
    // would be a worse outage than weaker limiting.
    expect(result.success).toBe(true);

    const status = rateLimitBackendStatus();
    expect(status.configured).toBe(true);
    expect(status.healthy).toBe(false);
    expect(status.failures).toBeGreaterThan(0);
    expect(status.lastError).toBeTruthy();
  }, 30_000);

  it('logs an error the first time the backend fails, so it cannot rot unnoticed', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://127.0.0.1:9';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'dead';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { checkConfiguredRateLimit } = await import('./rate-limit');
    await checkConfiguredRateLimit('probe', 'test', 5, '1 m');

    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toMatch(/SECURITY.*unreachable/i);
  }, 30_000);

  // Once every ten minutes, not once per request — a dead backend under load
  // would otherwise drown the logs it is trying to be noticed in.
  it('throttles repeated warnings', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://127.0.0.1:9';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'dead';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { checkConfiguredRateLimit, rateLimitBackendStatus } = await import('./rate-limit');
    for (let i = 0; i < 3; i++) {
      await checkConfiguredRateLimit(`probe-${i}`, 'test', 5, '1 m');
    }

    expect(spy).toHaveBeenCalledTimes(1);
    // Every failure is still counted, even though only one was logged.
    expect(rateLimitBackendStatus().failures).toBe(3);
  }, 45_000);
});
