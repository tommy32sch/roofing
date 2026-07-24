'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Market } from '@/types';
import { ALL_MARKETS } from './use-markets';

interface Props {
  markets: Market[];
  /** Current selection: a market id as a string, or ALL_MARKETS. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Office picker used on every filtered screen.
 *
 * Renders nothing when there is at most one office — a single-market company
 * should not carry a dropdown that can only say one thing.
 */
export function MarketFilter({ markets, value, onChange, className }: Props) {
  if (markets.length < 2) return null;

  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger className={className ?? 'sm:w-[150px]'} aria-label="Market">
        {/* This Select renders the raw value unless SelectValue is given
            explicit children — without this the trigger reads "all" or "2"
            instead of "All Markets" or "Minnesota". */}
        <SelectValue>
          {value === ALL_MARKETS
            ? 'All Markets'
            : markets.find((m) => String(m.id) === value)?.name ?? 'All Markets'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_MARKETS}>All Markets</SelectItem>
        {markets.map((m) => (
          <SelectItem key={m.id} value={String(m.id)}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
