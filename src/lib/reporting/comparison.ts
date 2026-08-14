import type { ReportComparison } from './contracts';

export function previousEqualPeriod(from: string, to: string): { from: string; to: string } {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    throw new Error('A valid report range is required');
  }
  const duration = end - start;
  return {
    from: new Date(start - duration).toISOString(),
    to: new Date(start).toISOString(),
  };
}

export function compareReportMetric(current: number, previous: number): ReportComparison {
  const delta = current - previous;
  return {
    previous,
    delta,
    percent: previous === 0 ? null : (delta / Math.abs(previous)) * 100,
    direction: delta === 0 ? 'flat' : previous === 0 ? 'new' : delta > 0 ? 'up' : 'down',
  };
}
