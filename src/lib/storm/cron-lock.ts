import { acquireCronLock, type CronLock } from '@/lib/cron/lock';

export type StormCronLock = CronLock;

/**
 * Storm-alert cron lock.
 *
 * The mechanism lives in @/lib/cron/lock so every scheduled job shares one
 * implementation; the key stays here so this job can only ever block itself.
 */
export async function acquireStormCronLock(): Promise<StormCronLock> {
  return acquireCronLock('storm-alert-cron');
}
