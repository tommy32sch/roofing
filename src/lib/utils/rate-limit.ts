import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

let hasWarnedNoUpstash = false;

const rateLimiters = new Map<string, Ratelimit>();

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token || !url.startsWith('https://') || url.includes('your_')) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Rate limiting is required in production. Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.'
      );
    }
    if (!hasWarnedNoUpstash) {
      console.warn('[SECURITY] Rate limiting disabled — Upstash not configured');
      hasWarnedNoUpstash = true;
    }
    return null;
  }

  return new Redis({ url, token });
}

function getLimiter(prefix: string, maxRequests: number, window: string): Ratelimit | null {
  const key = `${prefix}:${maxRequests}:${window}`;
  if (rateLimiters.has(key)) return rateLimiters.get(key)!;

  const redis = getRedis();
  if (!redis) return null;

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
  const limiter = getLimiter('default', 5, '1 m');
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
  const limiter = getLimiter(prefix, maxRequests, window);
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
