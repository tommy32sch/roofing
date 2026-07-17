let hasWarnedNoUpstash = false;

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
    if (!limiter) return inMemoryLimit(`${prefix}:${identifier}`, maxRequests, window);
    const result = await limiter.limit(identifier);
    return { success: result.success, limit: result.limit, remaining: result.remaining, reset: result.reset };
  } catch {
    return inMemoryLimit(`${prefix}:${identifier}`, maxRequests, window);
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
