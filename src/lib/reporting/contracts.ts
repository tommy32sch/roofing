import type { LeadStatus, UserRole } from '@/types';

export const REPORT_PERIODS = ['today', 'week', 'month', 'year', 'custom'] as const;

export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export type ReportActorScope =
  | { kind: 'all' }
  | { kind: 'mine' }
  | { kind: 'member'; memberId: string };

/**
 * The client-owned part of a report scope.
 *
 * `from` and `to` are half-open instants. `localDate` is separate because
 * follow-up dates are PostgreSQL DATE values and cannot be compared safely by
 * asking a UTC server what day it is for the user's device.
 */
export interface ReportScopeSelection {
  period: ReportPeriod;
  from: string;
  to: string;
  localDate: string;
  marketId: number | null;
  actor: ReportActorScope;
}

/** The validated scope returned with every report response. */
export interface ReportScope extends ReportScopeSelection {
  asOf: string;
}

export interface ReportMemberOption {
  id: string;
  name: string;
  role: UserRole;
}

export interface ReportComparison {
  previous: number;
  delta: number;
  percent: number | null;
  direction: 'up' | 'down' | 'flat' | 'new';
}

export type ReportMetricKey =
  | 'new_leads'
  | 'contacts'
  | 'appointments'
  | 'sold_jobs'
  | 'revenue';

export interface ReportMetric {
  key: ReportMetricKey;
  label: string;
  value: number;
  unit: 'count' | 'currency';
  comparison: ReportComparison;
  href: string;
}

export type OperationsExceptionKind =
  | 'overdue_follow_up'
  | 'unassigned_lead'
  | 'appointment_owner'
  | 'stalled_deal';

export interface OperationsExceptionItem {
  id: string;
  kind: OperationsExceptionKind;
  severity: 'urgent' | 'warning';
  title: string;
  detail: string;
  rule: string;
  href: string;
  occurredAt: string | null;
}

export interface OperationsExceptionGroup {
  kind: OperationsExceptionKind;
  label: string;
  count: number;
  rule: string;
  href: string;
}

export interface OperationsExceptions {
  total: number;
  items: OperationsExceptionItem[];
  groups: OperationsExceptionGroup[];
}

export interface FunnelRow {
  status: LeadStatus;
  label: string;
  count: number;
  value: number;
  href: string;
}

export interface TeamPulseRow {
  memberId: string;
  name: string;
  role: UserRole;
  knocks: number;
  calls: number;
  appointments: number;
  outcomes: number;
  soldJobs: number;
  href: string;
}

export interface TrendPoint {
  from: string;
  to: string;
  value: number;
}

export interface ReportSection<T> {
  status: 'ready' | 'error';
  data: T;
  error: string | null;
}

export type OperationsSectionName =
  | 'exceptions'
  | 'metrics'
  | 'trend'
  | 'funnel'
  | 'teamPulse';

export interface OperationsOverviewData {
  scope: ReportScope;
  scopeLabel: string;
  members: ReportMemberOption[];
  sections: {
    exceptions: ReportSection<OperationsExceptions>;
    metrics: ReportSection<ReportMetric[]>;
    trend: ReportSection<TrendPoint[]>;
    funnel: ReportSection<FunnelRow[]>;
    teamPulse: ReportSection<TeamPulseRow[]>;
  };
  partialErrors: { section: OperationsSectionName; message: string }[];
}

export interface OperationsOverviewResponse {
  success: true;
  overview: OperationsOverviewData;
}

export interface ReportingApiError {
  success: false;
  error: string;
}

export type ReportFreshness = 'fresh' | 'stale' | 'invalid';

export const REPORT_STALE_AFTER_MS = 5 * 60 * 1000;

export function reportFreshness(
  asOf: string,
  nowMs = Date.now(),
  staleAfterMs = REPORT_STALE_AFTER_MS
): ReportFreshness {
  const generatedAt = Date.parse(asOf);
  if (Number.isNaN(generatedAt)) return 'invalid';
  return nowMs - generatedAt > staleAfterMs ? 'stale' : 'fresh';
}
