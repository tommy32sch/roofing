let hasWarnedNoUpstash = false;

/**
 * State of the durable rate-limit backend.
 *
 * This exists because the interesting failure is not "Upstash was never
 * configured" — that path already warns. It is "Upstash IS configured and the
 * database is gone", which looks healthy to every config check, throws inside
 * the limiter call, and gets swallowed by the fallback. A free-tier database is
 * reaped after inactivity, so this is the expected end state, not an edge case.
 *
 * Left unobserved, brute-force protection quietly becomes a per-instance
 * counter that resets on every cold start while the app reports nothing.
 */
let backendFailures = 0;
let lastBackendFailureAt = 0;
let lastBackendErrorMessage: string | null = null;
let lastBackendSuccessAt = 0;

/** Re-warn at most once every ten minutes so logs stay readable under load. */
const BACKEND_WARN_INTERVAL_MS = 10 * 60 * 1000;

function noteBackendFailure(error: unknown): void {
  backendFailures += 1;
  lastBackendErrorMessage = error instanceof Error ? error.message : String(error);
  const now = Date.now();
  if (now - lastBackendFailureAt > BACKEND_WARN_INTERVAL_MS) {
    lastBackendFailureAt = now;
    console.error(
      `[SECURITY] Rate-limit backend is configured but unreachable (${lastBackendErrorMessage}). ` +
        `Falling back to per-instance in-memory counters, which reset on cold start — ` +
        `brute-force protection is effectively absent. Failures so far: ${backendFailures}.`
    );
  }
}

/**
 * Whether durable rate limiting is actually working right now.
 *
 * Reported rather than inferred: "the env vars are set" is exactly the check
 * that was already passing while the backend was dead.
 */
export function rateLimitBackendStatus(): {
  configured: boolean;
  healthy: boolean;
  failures: number;
  lastError: string | null;
  lastSuccessAt: number | null;
} {
  const configured = hasUpstashConfig();
  return {
    configured,
    // Healthy means a real call has succeeded more recently than the last
    // failure — not merely that credentials exist.
    healthy: configured && lastBackendSuccessAt > lastBackendFailureAt,
    failures: backendFailures,
    lastError: lastBackendErrorMessage,
    lastSuccessAt: lastBackendSuccessAt || null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rateLimiters = new Map<string, any>();

function hasUpstashConfig(): boolean {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return !!(url && token && url.startsWith('https://') && !url.includes('your_'));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getRedis(): Promise<any | null> {
  if (!hasUpstashConfig()) {
    if (!hasWarnedNoUpstash) {
      console.warn('[SECURITY] Upstash not configured — using in-memory rate limiting (per-instance, resets on cold start)');
      hasWarnedNoUpstash = true;
    }
    return null;
  }

  const { Redis } = await import('@upstash/redis');
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLimiter(prefix: string, maxRequests: number, window: string): Promise<any | null> {
  const key = `${prefix}:${maxRequests}:${window}`;
  if (rateLimiters.has(key)) return rateLimiters.get(key)!;

  const redis = await getRedis();
  if (!redis) return null;

  const { Ratelimit } = await import('@upstash/ratelimit');
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(maxRequests, window as `${number} ${'s' | 'ms' | 'm' | 'h' | 'd'}`),
    analytics: true,
    prefix: `roof-leads:${prefix}`,
  });

  rateLimiters.set(key, limiter);
  return limiter;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

// In-memory sliding-window fallback, used when Upstash is unavailable or errors.
// This degrades rate limiting to best-effort per-instance protection instead of
// turning it off entirely (the old fail-open behavior, which silently removed
// brute-force protection from login). On serverless it's per-instance and resets
// on cold start — weaker than Redis, but never leaves auth endpoints unprotected.
const memoryHits = new Map<string, number[]>();

function parseWindowMs(window: string): number {
  const match = window.trim().match(/^(\d+)\s*(ms|s|m|h|d)$/);
  if (!match) return 60_000;
  const n = parseInt(match[1], 10);
  const factor: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (factor[match[2]] ?? 60_000);
}

function inMemoryLimit(key: string, maxRequests: number, window: string): RateLimitResult {
  const windowMs = parseWindowMs(window);
  const now = Date.now();
  const hits = (memoryHits.get(key) || []).filter((t) => now - t < windowMs);
  const success = hits.length < maxRequests;
  if (success) hits.push(now);
  if (hits.length > 0) memoryHits.set(key, hits);
  else memoryHits.delete(key);
  return {
    success,
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - hits.length),
    reset: now + windowMs,
  };
}

export async function checkRateLimit(identifier: string): Promise<RateLimitResult> {
  return checkConfiguredRateLimit(identifier, 'default', 5, '1 m');
}

export async function checkConfiguredRateLimit(
  identifier: string,
  prefix: string,
  maxRequests: number,
  window: string = '1 m'
): Promise<RateLimitResult> {
  try {
    const limiter = await getLimiter(prefix, maxRequests, window);
    // No limiter means Upstash was never configured, which getRedis already
    // warned about. A configured-but-broken backend is the case handled below.
    if (!limiter) return inMemoryLimit(`${prefix}:${identifier}`, maxRequests, window);
    const result = await limiter.limit(identifier);
    lastBackendSuccessAt = Date.now();
    return { success: result.success, limit: result.limit, remaining: result.remaining, reset: result.reset };
  } catch (error) {
    // Still falls back rather than failing the request — refusing every login
    // because Redis is down would be a worse outage than weaker limiting. But
    // it is no longer silent.
    noteBackendFailure(error);
    return inMemoryLimit(`${prefix}:${identifier}`, maxRequests, window);
  }
}

/**
 * Forget an identifier's recorded attempts.
 *
 * Called after a successful login so that signing in doesn't spend the
 * brute-force budget. Without it, the limit punishes the wrong people: an
 * attacker's guesses are failures by definition, while a legitimate user
 * switching between accounts a few times gets locked out of their own app —
 * and, because the rejection happens before the password is even checked, it
 * looks like the correct password stopped working.
 */
export async function resetRateLimit(
  identifier: string,
  prefix: string,
  maxRequests: number,
  window: string = '1 m'
): Promise<void> {
  memoryHits.delete(`${prefix}:${identifier}`);
  try {
    const limiter = await getLimiter(prefix, maxRequests, window);
    await limiter?.resetUsedTokens?.(identifier);
  } catch {
    // Best effort — the in-memory copy is already cleared, and failing to reset
    // a limiter must never fail the login that just succeeded.
  }
}

export function getClientIP(headers: Headers): string {
  const vercelForwarded = headers.get('x-vercel-forwarded-for');
  if (vercelForwarded) return vercelForwarded.split(',')[0].trim();

  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();

  const realIP = headers.get('x-real-ip');
  if (realIP) return realIP;

  return 'unknown';
}
