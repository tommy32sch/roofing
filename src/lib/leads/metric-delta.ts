/**
 * Comparing a metric to the period before it.
 *
 * A number on its own says almost nothing. "59 live posts" is good or bad only
 * against last month's 48, and it is that comparison — not the styling — that
 * makes a dashboard readable at a glance. This is the part that has to exist
 * before the cards are worth building.
 *
 * Deliberately dumb about meaning: it computes the change and leaves the
 * judgement to the caller, because "up" is not always good. More overdue
 * follow-ups is a worse week, and only the caller knows which direction each
 * metric wants to move.
 */

export type MetricDirection = 'up' | 'down' | 'flat';

export interface MetricDelta {
  current: number;
  previous: number;
  /** Absolute change. Negative when the metric fell. */
  change: number;
  /** Percentage change, or null when there is no baseline to divide by. */
  percent: number | null;
  direction: MetricDirection;
}

/**
 * Below this, a change is reported as flat.
 *
 * Without it every metric shows a tiny arrow every period from ordinary noise,
 * and an indicator that is always lit tells a reader nothing. Half a percent is
 * below what anyone would act on.
 */
export const FLAT_THRESHOLD_PERCENT = 0.5;

export function metricDelta(current: number, previous: number): MetricDelta {
  const change = current - previous;

  /*
   * Growth from zero has no percentage. 0 -> 12 is not "1200% up", it is the
   * first twelve — and dividing by zero to say otherwise produces Infinity,
   * which renders as garbage. The caller shows the absolute change instead.
   */
  const percent = previous === 0 ? null : (change / Math.abs(previous)) * 100;

  let direction: MetricDirection = 'flat';
  if (percent === null) {
    direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  } else if (Math.abs(percent) >= FLAT_THRESHOLD_PERCENT) {
    direction = percent > 0 ? 'up' : 'down';
  }

  return { current, previous, change, percent, direction };
}

/**
 * Whether a movement is good news, given which way this metric should go.
 *
 * Separate from direction because they are different questions. Revenue rising
 * is good; overdue follow-ups rising is not. Colouring purely by direction
 * would paint a growing backlog green.
 */
export function isFavourable(delta: MetricDelta, higherIsBetter: boolean): boolean | null {
  if (delta.direction === 'flat') return null;
  return higherIsBetter ? delta.direction === 'up' : delta.direction === 'down';
}

/** "+24.1%" / "-4.0%" / "+12" when there is no baseline to divide by. */
export function formatDelta(delta: MetricDelta): string {
  if (delta.direction === 'flat') return 'No change';
  if (delta.percent === null) {
    const sign = delta.change > 0 ? '+' : '';
    return `${sign}${delta.change.toLocaleString()}`;
  }
  const sign = delta.percent > 0 ? '+' : '';
  return `${sign}${delta.percent.toFixed(1)}%`;
}

/** The baseline line under a metric: "vs 48". */
export function formatBaseline(delta: MetricDelta, format?: (n: number) => string): string {
  return `vs ${format ? format(delta.previous) : delta.previous.toLocaleString()}`;
}

/** Whole dollars — cents are noise at dashboard scale. */
export function formatCurrency(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * The window a dashboard compares against.
 *
 * The previous period is the same LENGTH immediately before the current one, so
 * a 30-day view compares against the 30 days before it rather than a calendar
 * month. Calendar months are uneven, and a 28-day February would show as a
 * slump that never happened.
 */
export function previousPeriod(
  start: Date,
  end: Date
): { start: Date; end: Date } {
  const span = end.getTime() - start.getTime();
  return {
    start: new Date(start.getTime() - span),
    end: new Date(start.getTime()),
  };
}
