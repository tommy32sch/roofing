const LOCK_KEY = 'roof-leads:storm-alert-cron';
const LOCK_SECONDS = 240;

let memoryLocked = false;

export interface StormCronLock {
  acquired: boolean;
  release: () => Promise<void>;
  backend: 'upstash' | 'memory';
}

/**
 * Cross-instance cron lock through the existing Upstash Redis connection.
 *
 * Local development falls back to a process lock. Database uniqueness still
 * makes the work idempotent if production Redis is temporarily unavailable.
 */
export async function acquireStormCronLock(): Promise<StormCronLock> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const configured = !!(url && token && url.startsWith('https://') && !url.includes('your_'));

  if (!configured) return acquireMemoryLock();

  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({ url: url!, token: token! });
    const owner = crypto.randomUUID();
    const result = await redis.set(LOCK_KEY, owner, { nx: true, ex: LOCK_SECONDS });
    if (result !== 'OK') {
      return { acquired: false, backend: 'upstash', release: async () => {} };
    }
    return {
      acquired: true,
      backend: 'upstash',
      release: async () => {
        // Compare-and-delete: an expired lock may already belong to another run.
        await redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          [LOCK_KEY],
          [owner]
        ).catch(() => {});
      },
    };
  } catch {
    return acquireMemoryLock();
  }
}

function acquireMemoryLock(): StormCronLock {
  if (memoryLocked) {
    return { acquired: false, backend: 'memory', release: async () => {} };
  }
  memoryLocked = true;
  return {
    acquired: true,
    backend: 'memory',
    release: async () => {
      memoryLocked = false;
    },
  };
}
