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
      console.warn('[SECURITY] Rate limiting disabled — Upstash not configured');
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

function noopResult(maxRequests: number): RateLimitResult {
  return { success: true, limit: maxRequests, remaining: maxRequests, reset: Date.now() + 60000 };
}

export async function checkRateLimit(identifier: string): Promise<RateLimitResult> {
  const limiter = await getLimiter('default', 5, '1 m');
  if (!limiter) return noopResult(5);

  const result = await limiter.limit(identifier);
  return { success: result.success, limit: result.limit, remaining: result.remaining, reset: result.reset };
}

export async function checkConfiguredRateLimit(
  identifier: string,
  prefix: string,
  maxRequests: number,
  window: string = '1 m'
): Promise<RateLimitResult> {
  const limiter = await getLimiter(prefix, maxRequests, window);
  if (!limiter) return noopResult(maxRequests);

  const result = await limiter.limit(identifier);
  return { success: result.success, limit: result.limit, remaining: result.remaining, reset: result.reset };
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
