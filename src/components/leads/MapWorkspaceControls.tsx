'use client';

import {
  Check,
  ChevronDown,
  CloudHail,
  Hexagon,
  Wind,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MarketFilter } from '@/components/markets/market-filter';
import {
  DNC_RING_COLOR,
  DO_NOT_KNOCK_RING_COLOR,
  STATUS_COLORS,
  STORM_MIN_VALUES,
  STORM_TYPES,
  STORM_WINDOWS,
  stormAgeLegendEntries,
  stormLegendEntries,
  stormMinLabel,
  stormWindowLabel,
  stormZoneLegendEntries,
  type StormType,
} from '@/components/leads/map-constants';
import { LEAD_PRIORITY_OPTIONS, LEAD_STATUS_OPTIONS, type Market } from '@/types';

interface MapFiltersPanelProps {
  markets: Market[];
  marketsLoading: boolean;
  marketValue: string;
  status: string;
  priority: string;
  blockedReasons?: (string | null)[];
  onMarketChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onPriorityChange: (value: string) => void;
}

export function MapFiltersPanel({
  markets,
  marketsLoading,
  marketValue,
  status,
  priority,
  blockedReasons = [],
  onMarketChange,
  onStatusChange,
  onPriorityChange,
}: MapFiltersPanelProps) {
  const visibleReasons = blockedReasons.filter((reason): reason is string => Boolean(reason));

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Lead view
        </p>
        <div className="mt-2 grid gap-2">
          {!marketsLoading && (
            <MarketFilter
              markets={markets}
              value={marketValue}
              onChange={onMarketChange}
              className="w-full data-[size=default]:h-11"
            />
          )}
          <Select value={status} onValueChange={(value) => onStatusChange(value ?? 'all')}>
            <SelectTrigger className="w-full data-[size=default]:h-11" aria-label="Lead status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {LEAD_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={(value) => onPriorityChange(value ?? 'all')}>
            <SelectTrigger className="w-full data-[size=default]:h-11" aria-label="Lead priority">
              <SelectValue placeholder="All priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {LEAD_PRIORITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {visibleReasons.length > 0 && (
        <div className="border-t pt-3 text-xs leading-5 text-muted-foreground">
          {visibleReasons.map((reason) => <p key={reason}>{reason}</p>)}
        </div>
      )}
    </div>
  );
}

interface MapLayersPanelProps {
  stormTypes: StormType[];
  stormCounts: Record<StormType, number>;
  stormLoading: boolean;
  stormDays: number;
  stormZones: boolean;
  hailMin: number;
  windMin: number;
  onToggleType: (type: StormType) => void;
  onDaysChange: (days: number) => void;
  onZonesChange: (enabled: boolean) => void;
  onHailMinChange: (value: number) => void;
  onWindMinChange: (value: number) => void;
}

export function MapLayersPanel({
  stormTypes,
  stormCounts,
  stormLoading,
  stormDays,
  stormZones,
  hailMin,
  windMin,
  onToggleType,
  onDaysChange,
  onZonesChange,
  onHailMinChange,
  onWindMinChange,
}: MapLayersPanelProps) {
  const stormOn = stormTypes.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Storm reports
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {STORM_TYPES.map((type) => {
            const active = stormTypes.includes(type);
            const Icon = type === 'wind' ? Wind : CloudHail;
            const count = stormCounts[type];
            return (
              <Button
                key={type}
                variant={active ? 'default' : 'outline'}
                className="h-11"
                aria-pressed={active}
                onClick={() => onToggleType(type)}
              >
                <Icon className={`h-4 w-4 ${stormLoading && active ? 'animate-pulse' : ''}`} />
                {type === 'wind' ? 'Wind' : 'Hail'}
                {active && count > 0 ? ` ${count}` : ''}
              </Button>
            );
          })}
        </div>
      </div>

      {stormOn && (
        <div className="grid gap-2 border-t pt-3">
          <Select
            value={String(stormDays)}
            onValueChange={(value) => value && onDaysChange(Number.parseInt(value, 10))}
          >
            <SelectTrigger className="w-full data-[size=default]:h-11" aria-label="Storm window">
              <SelectValue>{stormWindowLabel(stormDays)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STORM_WINDOWS.map((window) => (
                <SelectItem key={window.days} value={String(window.days)}>{window.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={stormZones ? 'default' : 'outline'}
            className="h-11 justify-start"
            aria-pressed={stormZones}
            onClick={() => onZonesChange(!stormZones)}
          >
            <Hexagon className="h-4 w-4" />
            Storm zones
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" className="h-11 w-full justify-between">
                  {stormMinLabel(stormTypes, hailMin, windMin)}
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="w-52">
              {stormTypes.includes('hail') && (
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Hail size</DropdownMenuLabel>
                  {STORM_MIN_VALUES.hail.map((option) => (
                    <DropdownMenuItem key={`hail-${option.value}`} onClick={() => onHailMinChange(option.value)}>
                      <span className="flex-1">{option.label}</span>
                      {hailMin === option.value && <Check className="h-3.5 w-3.5" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              )}
              {stormTypes.length === 2 && <DropdownMenuSeparator />}
              {stormTypes.includes('wind') && (
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Wind speed</DropdownMenuLabel>
                  {STORM_MIN_VALUES.wind.map((option) => (
                    <DropdownMenuItem key={`wind-${option.value}`} onClick={() => onWindMinChange(option.value)}>
                      <span className="flex-1">{option.label}</span>
                      {windMin === option.value && <Check className="h-3.5 w-3.5" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

export function MapLegendPanel({
  stormTypes,
  stormZones,
}: {
  stormTypes: StormType[];
  stormZones: boolean;
}) {
  const stormOn = stormTypes.length > 0;

  return (
    <div className="space-y-4 text-xs text-muted-foreground">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Lead status
        </p>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5">
          {LEAD_STATUS_OPTIONS.map((option) => (
            <span key={option.value} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[option.value] }}
              />
              {option.label}
            </span>
          ))}
          <span className="col-span-2 flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-transparent"
              style={{ borderColor: DNC_RING_COLOR }}
            />
            Do Not Call · knock only
          </span>
          <span className="col-span-2 flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-transparent"
              style={{ borderColor: DO_NOT_KNOCK_RING_COLOR }}
            />
            Do Not Knock
          </span>
        </div>
      </div>

      {stormOn && (
        <div className="space-y-3 border-t pt-3">
          <LegendRow label="Severity" entries={stormLegendEntries(stormTypes).map((entry) => ({
            key: entry.key,
            label: entry.label,
            color: entry.color,
            opacity: 0.6,
            square: false,
          }))} />
          <LegendRow label="Report age" entries={stormAgeLegendEntries().map((entry) => ({
            key: entry.key,
            label: entry.label,
            color: 'currentColor',
            opacity: entry.fillOpacity,
            square: false,
          }))} />
          {stormZones && (
            <LegendRow label="Zone age" entries={stormZoneLegendEntries().map((entry) => ({
              key: entry.key,
              label: entry.label,
              color: entry.color,
              opacity: entry.opacity,
              square: true,
            }))} />
          )}
        </div>
      )}
    </div>
  );
}

function LegendRow({
  label,
  entries,
}: {
  label: string;
  entries: { key: string; label: string; color: string; opacity: number; square: boolean }[];
}) {
  return (
    <div>
      <p className="font-medium text-foreground">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-2">
        {entries.map((entry) => (
          <span key={entry.key} className="flex items-center gap-1.5">
            <span
              className={`h-2.5 w-2.5 ${entry.square ? 'rounded-[2px]' : 'rounded-full'}`}
              style={{ backgroundColor: entry.color, opacity: entry.opacity }}
            />
            {entry.label}
          </span>
        ))}
      </div>
    </div>
  );
}
