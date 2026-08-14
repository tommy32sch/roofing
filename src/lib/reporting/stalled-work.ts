import type { LeadStatus } from '@/types';

export const STALLED_WORK_DAYS = {
  appointment_set: 3,
  inspected: 5,
  proposal_sent: 7,
} as const satisfies Partial<Record<LeadStatus, number>>;

export type StalledDealStatus = keyof typeof STALLED_WORK_DAYS;

export function stalledWorkThresholdDays(status: LeadStatus): number | null {
  return status in STALLED_WORK_DAYS
    ? STALLED_WORK_DAYS[status as StalledDealStatus]
    : null;
}

export function isStalledWork(input: {
  status: LeadStatus;
  lastWorkAt: string;
  asOf: string;
}): boolean {
  const thresholdDays = stalledWorkThresholdDays(input.status);
  if (thresholdDays == null) return false;
  const lastWorkAt = Date.parse(input.lastWorkAt);
  const asOf = Date.parse(input.asOf);
  if (Number.isNaN(lastWorkAt) || Number.isNaN(asOf)) return false;
  return asOf - lastWorkAt >= thresholdDays * 86_400_000;
}
