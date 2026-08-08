'use client';

import { cn } from '@/lib/utils';

export interface TrendPoint {
  /** ISO date. Used for the axis labels and the accessible summary. */
  date: string;
  value: number;
}

interface TrendChartProps {
  points: TrendPoint[];
  /** Formats values in the axis and the summary, e.g. currency. */
  format?: (n: number) => string;
  label: string;
  className?: string;
}

const W = 600;
const H = 180;
const PAD_L = 44;
const PAD_B = 22;
const PAD_T = 8;

/**
 * A filled trend line over time, drawn by hand in SVG.
 *
 * No chart library on purpose: a rep loads this on a phone, sometimes on
 * cellular, and the smallest React charting package costs about 100KB to draw
 * one series. This is a path and some ticks.
 *
 * Rendered in a viewBox with preserveAspectRatio="none" so it stretches to any
 * container width without a resize observer or a re-render — which also means
 * it works during the first paint, before JavaScript has measured anything.
 */
export function TrendChart({ points, format, label, className }: TrendChartProps) {
  if (points.length === 0) {
    return (
      <div className={cn('flex h-44 items-center justify-center rounded-lg border', className)}>
        <p className="text-xs text-muted-foreground">Nothing recorded in this period yet</p>
      </div>
    );
  }

  const values = points.map((p) => p.value);
  const max = Math.max(...values, 0);
  /*
   * The axis always starts at zero. Cropping it to the data exaggerates small
   * movements into cliffs, which is the most common way a chart lies without
   * anyone intending it to.
   */
  const top = max === 0 ? 1 : max;

  const x = (i: number) =>
    PAD_L + (i / Math.max(1, points.length - 1)) * (W - PAD_L - 8);
  const y = (v: number) => PAD_T + (1 - v / top) * (H - PAD_T - PAD_B);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
  const area = `${line} L ${x(points.length - 1)} ${H - PAD_B} L ${x(0)} ${H - PAD_B} Z`;

  const fmt = format ?? ((n: number) => n.toLocaleString());
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-44 w-full"
        role="img"
        aria-label={`${label}: ${fmt(first.value)} on ${first.date} rising to ${fmt(last.value)} on ${last.date}`}
      >
        {/* Gridlines at zero, half and full. Three is enough to read a value
            against; more turns into hatching at this height. */}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD_L}
              x2={W - 8}
              y1={y(top * f)}
              y2={y(top * f)}
              className="stroke-border"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PAD_L - 6}
              y={y(top * f) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[9px]"
            >
              {fmt(top * f)}
            </text>
          </g>
        ))}

        <path d={area} className="fill-primary/15" />
        {/* non-scaling-stroke keeps the line one pixel wide however far the
            viewBox is stretched horizontally. */}
        <path
          d={line}
          className="stroke-primary"
          strokeWidth={2}
          fill="none"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>

      <div className="flex justify-between px-1 text-[10px] text-muted-foreground">
        <span>{first.date}</span>
        <span>{last.date}</span>
      </div>
    </div>
  );
}
