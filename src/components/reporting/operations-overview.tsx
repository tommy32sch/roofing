'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, BarChart3, RefreshCw, Route, UsersRound } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { useAppShell } from '@/components/providers/app-shell-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  OperationsOverviewData,
  OperationsOverviewResponse,
  ReportActorScope,
  ReportPeriod,
  ReportScopeSelection,
  ReportingApiError,
} from '@/lib/reporting/contracts';
import { reportFreshness } from '@/lib/reporting/contracts';
import {
  localReportPeriodBounds,
  parseReportScopeUrl,
  reportScopeForDevice,
  reportScopeKey,
  serializeReportScope,
} from '@/lib/reporting/scope';
import { ExceptionLedger } from './exception-ledger';
import { FunnelLedger } from './funnel-ledger';
import { MetricStrip } from './metric-strip';
import { ReportEmptyState } from './report-empty-state';
import { ReportScopeBar } from './report-scope-bar';
import { ReportState } from './report-state';
import { TeamPulseLedger } from './team-pulse-ledger';
import { TrendStrip } from './trend-strip';

function OperationsOverviewLoading() {
  return (
    <div className="space-y-5">
      <PageHeader title="Operations overview" description="Loading the current management brief…" />
      <Skeleton className="h-20 w-full rounded-none" />
      <section className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-72 w-full rounded-none" />
      </section>
      <Skeleton className="h-28 w-full rounded-none" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-72 w-full rounded-none" />
        <Skeleton className="h-72 w-full rounded-none" />
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  count,
}: {
  eyebrow: string;
  title: string;
  description: string;
  count?: number;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {count != null && (
        <span className="font-mono text-2xl font-semibold tabular-nums">{count}</span>
      )}
    </div>
  );
}

function OperationsOverviewContent() {
  const { user, markets } = useAppShell();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const [deviceAnchor] = useState(() => new Date());
  const [overview, setOverview] = useState<OperationsOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const requestRef = useRef<AbortController | null>(null);

  const scope = useMemo(
    () =>
      reportScopeForDevice(
        parseReportScopeUrl(new URLSearchParams(searchParamsString)),
        {
          role: user.role,
          homeMarketId: user.homeMarketId,
          now: deviceAnchor,
        }
      ),
    [deviceAnchor, searchParamsString, user.homeMarketId, user.role]
  );
  const scopeKey = reportScopeKey(scope);

  useEffect(() => {
    if (searchParamsString !== scopeKey) {
      router.replace(`${pathname}?${scopeKey}`, { scroll: false });
    }
  }, [pathname, router, scopeKey, searchParamsString]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async (keepCurrent: boolean) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (keepCurrent) setRefreshing(true);
    else {
      setLoading(true);
      setOverview(null);
    }
    setError('');

    try {
      const response = await fetch(`/api/admin/operations-overview?${scopeKey}`, {
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as
        | OperationsOverviewResponse
        | ReportingApiError
        | null;
      if (!response.ok || !body?.success) {
        throw new Error(body && !body.success ? body.error : 'Operations overview did not load');
      }
      if (requestRef.current === controller) setOverview(body.overview);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      if (requestRef.current === controller) {
        setError(cause instanceof Error ? cause.message : 'Operations overview did not load');
      }
    } finally {
      if (requestRef.current === controller) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [scopeKey]);

  useEffect(() => {
    void load(false);
    return () => requestRef.current?.abort();
  }, [load]);

  const navigateScope = useCallback((next: ReportScopeSelection) => {
    router.push(`${pathname}?${serializeReportScope(next)}`, { scroll: false });
  }, [pathname, router]);

  const changePeriod = useCallback((period: Exclude<ReportPeriod, 'custom'>) => {
    const bounds = localReportPeriodBounds(period, new Date());
    navigateScope({ ...scope, ...bounds });
  }, [navigateScope, scope]);

  const changeMarket = useCallback((marketId: number | null) => {
    navigateScope({ ...scope, marketId });
  }, [navigateScope, scope]);

  const changeActor = useCallback((actor: ReportActorScope) => {
    navigateScope({ ...scope, actor });
  }, [navigateScope, scope]);

  if (loading && !overview) return <OperationsOverviewLoading />;

  if (!overview) {
    return (
      <div className="space-y-5">
        <PageHeader title="Operations overview" />
        <ReportScopeBar
          scope={scope}
          role={user.role}
          userName={user.name}
          markets={markets}
          members={[]}
          onPeriodChange={changePeriod}
          onMarketChange={changeMarket}
          onActorChange={changeActor}
        />
        <ReportState
          variant="error"
          title="Operations overview did not load"
          description={error || 'Check the report scope and try again.'}
          action={<Button variant="outline" onClick={() => void load(false)}>Try again</Button>}
        />
      </div>
    );
  }

  const stale = reportFreshness(overview.scope.asOf, clock) === 'stale';
  const asOf = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(overview.scope.asOf));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations overview"
        description={`${overview.scopeLabel} · exact as of ${asOf}`}
        actions={
          <Button
            variant="outline"
            className="h-11"
            disabled={refreshing}
            onClick={() => void load(true)}
          >
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </Button>
        }
      />

      <ReportScopeBar
        scope={scope}
        role={user.role}
        userName={user.name}
        markets={markets}
        members={overview.members}
        onPeriodChange={changePeriod}
        onMarketChange={changeMarket}
        onActorChange={changeActor}
      />

      {error && (
        <ReportState
          compact
          variant="error"
          title="Refresh failed"
          description={`${error} The last loaded brief remains visible.`}
          action={<Button variant="outline" size="sm" onClick={() => void load(true)}>Retry</Button>}
        />
      )}
      {stale && !error && (
        <ReportState
          compact
          variant="stale"
          title="This brief is more than five minutes old"
          description={`Last completed ${asOf}.`}
          action={<Button variant="outline" size="sm" onClick={() => void load(true)}>Refresh</Button>}
        />
      )}
      {overview.partialErrors.length > 0 && (
        <ReportState
          compact
          variant="error"
          title="Some report sections are unavailable"
          description={overview.partialErrors.map((item) => item.message).join(' ')}
        />
      )}

      <section className="space-y-3" aria-labelledby="exceptions-heading">
        <div id="exceptions-heading">
          <SectionHeading
            eyebrow="Action ledger"
            title="Needs attention"
            description="The rule under each row explains why it is here."
            count={overview.sections.exceptions.status === 'ready'
              ? overview.sections.exceptions.data.total
              : undefined}
          />
        </div>
        {overview.sections.exceptions.status === 'error' ? (
          <ReportState
            variant="error"
            title="Exceptions did not load"
            description={overview.sections.exceptions.error ?? undefined}
          />
        ) : (
          <ExceptionLedger data={overview.sections.exceptions.data} />
        )}
      </section>

      <section className="space-y-3" aria-labelledby="movement-heading">
        <div id="movement-heading">
          <SectionHeading
            eyebrow="Period movement"
            title="What changed"
            description="Every figure uses this scope and the preceding range of equal length."
          />
        </div>
        {overview.sections.metrics.status === 'error' ? (
          <ReportState variant="error" title="Metrics did not load" />
        ) : overview.sections.metrics.data.length === 0 ? (
          <ReportEmptyState
            icon={BarChart3}
            title="No period metrics"
            description="Activity in the selected range will appear here."
          />
        ) : (
          <MetricStrip metrics={overview.sections.metrics.data} />
        )}
      </section>

      <section className="space-y-3" aria-labelledby="trend-heading">
        <div id="trend-heading">
          <SectionHeading
            eyebrow="Intake signal"
            title="New lead pace"
            description="A compact view of when leads entered during this period."
          />
        </div>
        {overview.sections.trend.status === 'error' ? (
          <ReportState variant="error" title="Lead pace did not load" />
        ) : (
          <TrendStrip points={overview.sections.trend.data} />
        )}
      </section>

      <div className="grid gap-7 xl:grid-cols-[0.85fr_1.15fr]">
        <section className="space-y-3" aria-labelledby="funnel-heading">
          <div id="funnel-heading">
            <SectionHeading
              eyebrow="Current book"
              title="Funnel ledger"
              description="Open a row to work the matching Lead Book queue."
            />
          </div>
          {overview.sections.funnel.status === 'error' ? (
            <ReportState variant="error" title="Funnel did not load" />
          ) : (
            <FunnelLedger rows={overview.sections.funnel.data} />
          )}
        </section>

        <section className="space-y-3" aria-labelledby="team-heading">
          <div id="team-heading">
            <SectionHeading
              eyebrow="Production ledger"
              title="Team pulse"
              description="Knocks, calls, scheduled appointments, recorded outcomes, and sold jobs."
            />
          </div>
          {overview.sections.teamPulse.status === 'error' ? (
            <ReportState variant="error" title="Team pulse did not load" />
          ) : overview.sections.teamPulse.data.length === 0 ? (
            <ReportEmptyState
              icon={UsersRound}
              title="No team activity in this period"
              description="Recorded field work will appear here by account."
            />
          ) : (
            <TeamPulseLedger rows={overview.sections.teamPulse.data} />
          )}
        </section>
      </div>

      <div className="flex min-h-11 items-center gap-2 border-t pt-4 text-xs text-muted-foreground">
        <Route className="h-4 w-4" />
        Drill-down links keep this market, team, and date scope where the destination supports it.
        {overview.partialErrors.length > 0 && <AlertTriangle className="ml-auto h-4 w-4" />}
      </div>
    </div>
  );
}

export function OperationsOverview() {
  return (
    <Suspense fallback={<OperationsOverviewLoading />}>
      <OperationsOverviewContent />
    </Suspense>
  );
}
