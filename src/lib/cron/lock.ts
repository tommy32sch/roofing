const LOCK_SECONDS = 240;

const memoryLocks = new Set<string>();

export interface CronLock {
  acquired: boolean;
  release: () => Promise<void>;
  backend: 'upstash' | 'memory';
}

/**
 * Cross-instance cron lock through the existing Upstash Redis connection.
 *
 * Local development falls back to a per-process lock. Database uniqueness still
 * makes the work idempotent if production Redis is temporarily unavailable.
 *
 * Keyed per job: two different cron routes must not block each other, which a
 * single shared key would cause the moment their schedules overlapped.
 */
export async function acquireCronLock(name: string): Promise<CronLock> {
  const key = `roof-leads:${name}`;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const configured = !!(url && token && url.startsWith('https://') && !url.includes('your_'));

  if (!configured) return acquireMemoryLock(key);

  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({ url: url!, token: token! });
    const owner = crypto.randomUUID();
    const result = await redis.set(key, owner, { nx: true, ex: LOCK_SECONDS });
    if (result !== 'OK') {
      return { acquired: false, backend: 'upstash', release: async () => {} };
    }
    return {
      acquired: true,
      backend: 'upstash',
      release: async () => {
        // Compare-and-delete: an expired lock may already belong to another run.
        await redis
          .eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            [key],
            [owner]
          )
          .catch(() => {});
      },
    };
  } catch {
    return acquireMemoryLock(key);
  }
}

function acquireMemoryLock(key: string): CronLock {
  if (memoryLocks.has(key)) {
    return { acquired: false, backend: 'memory', release: async () => {} };
  }
  memoryLocks.add(key);
  return {
    acquired: true,
    backend: 'memory',
    release: async () => {
      memoryLocks.delete(key);
    },
  };
}
