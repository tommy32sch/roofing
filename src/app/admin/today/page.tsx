'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock, Phone, MessageSquare, Navigation, Sun, DoorOpen,
  PhoneCall, AlertCircle, ChevronRight, Map as MapIcon,
} from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { FollowUpMenu } from '@/components/leads/FollowUpMenu';
import { MarketFilter } from '@/components/markets/market-filter';
import { useMarkets, ALL_MARKETS } from '@/components/markets/use-markets';
import { formatPhone, formatAddressShort, mapsUrl } from '@/lib/utils/format';
import { localDayBounds, followUpUrgency, defaultScope, type TodayScope } from '@/lib/leads/today';
import type { Lead, UserRole } from '@/types';

type TodayLead = Pick<
  Lead,
  | 'id' | 'first_name' | 'last_name' | 'phone' | 'phone2' | 'phone3' | 'email'
  | 'status' | 'priority' | 'address_street' | 'address_city' | 'address_state'
  | 'address_zip' | 'latitude' | 'longitude' | 'follow_up_date' | 'last_knock_at'
  | 'last_disposition' | 'knock_count' | 'is_dnc' | 'do_not_knock' | 'market_id'
>;

interface TodayAppointment {
  id: string;
  appointment_type: 'inspection' | 'adjuster';
  scheduled_at: string;
  notes: string | null;
  leads: TodayLead | null;
}

interface TodayData {
  appointments: TodayAppointment[];
  followUps: TodayLead[];
  callbacks: TodayLead[];
  counts: { followUps: number; callbacks: number; assignedToMe: number };
  limit: number;
}

/** The first phone we can actually dial. DNC leads have none stored by design. */
function firstPhone(lead: TodayLead): string | null {
  return lead.phone || lead.phone2 || lead.phone3 || null;
}

/**
 * One tappable row. The lead name and address open the lead; the actions are
 * separate targets so a mis-tap on a phone doesn't dial someone by accident.
 */
function LeadRow({
  lead,
  trailing,
  followUp,
  onFollowUpChange,
}: {
  lead: TodayLead;
  trailing?: React.ReactNode;
  /** Show the one-tap follow-up control. */
  followUp?: boolean;
  onFollowUpChange?: () => void;
}) {
  const phone = firstPhone(lead);
  const directions = mapsUrl(lead);

  // Stacks on a phone. Side by side, the time gutter plus three action buttons
  // left the info block 85px on a 375px screen and the customer's name
  // truncated to nothing. Stacked, the name gets the full row and the actions
  // become bigger one-handed targets.
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
      <Link href={`/admin/leads/${lead.id}`} className="min-w-0 sm:flex-1">
        {/* The name must win the space fight: min-w-0 + flex-1 on the name and
            shrink-0 on the chips. Without it the badge took the full row on a
            phone and truncated the customer's name to nothing. */}
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">
            {lead.first_name} {lead.last_name}
          </p>
          <span className="shrink-0">
            <LeadStatusBadge status={lead.status} />
          </span>
          {lead.is_dnc && (
            <span className="shrink-0 rounded border border-destructive/25 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
              DNC
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {formatAddressShort(lead) || 'No address'}
          {phone ? ` · ${formatPhone(phone)}` : ''}
        </p>
        {trailing}
      </Link>

      {/* Big, separated tap targets — this is used one-handed in a truck. */}
      <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
        {followUp && (
          <FollowUpMenu
            leadId={lead.id}
            followUpDate={lead.follow_up_date}
            onChange={onFollowUpChange}
            compact
          />
        )}
        {phone && (
          <>
            <a href={`tel:${phone}`} aria-label={`Call ${lead.first_name}`}>
              <Button variant="ghost" size="icon" className="h-9 w-9" tabIndex={-1}>
                <Phone className="h-4 w-4" />
              </Button>
            </a>
            <a href={`sms:${phone}`} aria-label={`Text ${lead.first_name}`}>
              <Button variant="ghost" size="icon" className="h-9 w-9" tabIndex={-1}>
                <MessageSquare className="h-4 w-4" />
              </Button>
            </a>
          </>
        )}
        {directions && (
          <a
            href={directions}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Directions to ${lead.first_name}`}
          >
            <Button variant="ghost" size="icon" className="h-9 w-9" tabIndex={-1}>
              <Navigation className="h-4 w-4" />
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Empty text for a single section.
 *
 * Deliberately not the full EmptyState: three stacked cards each with an icon
 * circle and two lines of prose turned "nothing due today" into three phone
 * screens of scrolling. One quiet line per section keeps the whole day readable
 * without swiping. The page-level empty state below still gets the full
 * treatment, because there it IS the message.
 */
function SectionEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-sm text-muted-foreground">{children}</p>;
}

function SectionCard({
  icon: Icon,
  title,
  count,
  accent,
  children,
}: {
  icon: React.ElementType;
  title: string;
  count?: number;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className={accent ? 'border-primary/30' : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={`h-4 w-4 ${accent ? 'text-primary' : 'text-muted-foreground'}`} />
          {title}
          {count != null && count > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums">
              {count}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function TodayPage() {
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);
  const [scope, setScope] = useState<TodayScope | null>(null);
  const { markets, homeMarketId, loading: marketsLoading } = useMarkets();
  const [market, setMarket] = useState('');
  const marketValue = market || (homeMarketId != null ? String(homeMarketId) : ALL_MARKETS);

  // The day is computed from the DEVICE clock — "today" differs between the
  // Arizona and Minnesota offices. Frozen per mount so a re-render can't shift
  // the window mid-session.
  const day = useMemo(() => localDayBounds(new Date()), []);

  useEffect(() => {
    fetch('/api/admin/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) return;
        setRole(d.admin.role);
        setScope((s) => s ?? defaultScope(d.admin.role));
      })
      .catch(() => {});
  }, []);

  const fetchToday = useCallback(async () => {
    if (!scope) return;
    const params = new URLSearchParams({ start: day.start, end: day.end, date: day.date, scope });
    if (market) params.set('market_id', market);
    try {
      const res = await fetch(`/api/admin/today?${params}`);
      const json = await res.json();
      if (json.success) setData(json);
    } catch {
      // leave the previous view up rather than blanking the screen
    } finally {
      setLoading(false);
    }
  }, [day, market, scope]);

  useEffect(() => {
    fetchToday();
  }, [fetchToday]);

  if (loading || !scope) {
    return (
      <div className="space-y-6">
        <PageHeader title="Today" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const appts = data?.appointments ?? [];
  const followUps = data?.followUps ?? [];
  const callbacks = data?.callbacks ?? [];
  const counts = data?.counts;
  const nothingAtAll = appts.length === 0 && followUps.length === 0 && callbacks.length === 0;
  // "Nothing assigned to you" is a different problem from "nothing due today",
  // and saying so is the difference between a screen that looks broken and one
  // that tells you what to fix.
  const nothingAssigned = scope === 'mine' && (counts?.assignedToMe ?? 0) === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Today"
        description={format(new Date(day.start), 'EEEE, MMMM d')}
        actions={
          <div className="flex items-center gap-2">
            {!marketsLoading && (
              <MarketFilter markets={markets} value={marketValue} onChange={setMarket} className="w-[150px]" />
            )}
            {/* Segmented rather than a dropdown: two options, and which one is
                active is the single most important thing on the screen. */}
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Whose work">
              {(['mine', 'all'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scope === s}
                  onClick={() => { setScope(s); setLoading(true); }}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    scope === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {s === 'mine' ? 'Mine' : 'Everyone'}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {/* Appointments — the only items with a fixed time, so they lead. */}
      <SectionCard icon={CalendarClock} title="Appointments" count={appts.length} accent={appts.length > 0}>
        {appts.length === 0 ? (
          <SectionEmpty>
            Nothing scheduled. Inspections and adjuster meetings for today land here.
          </SectionEmpty>
        ) : (
          <div className="space-y-2">
            {appts.map((a) => (
              <div key={a.id} className="flex items-start gap-3">
                <div className="w-16 shrink-0 pt-3 text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {format(new Date(a.scheduled_at), 'h:mm')}
                  </p>
                  <p className="text-[11px] uppercase text-muted-foreground">
                    {format(new Date(a.scheduled_at), 'a')}
                  </p>
                </div>
                <div className="min-w-0 flex-1">
                  {a.leads ? (
                    <LeadRow
                      lead={a.leads}
                      trailing={
                        <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                          {a.appointment_type}
                          {a.notes ? ` · ${a.notes}` : ''}
                        </p>
                      }
                    />
                  ) : (
                    <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                      Appointment with no lead attached
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Follow-ups — promises with a date on them. Overdue first. */}
      <SectionCard icon={PhoneCall} title="Follow-ups due" count={counts?.followUps}>
        {followUps.length === 0 ? (
          <SectionEmpty>
            Nothing due. Set a follow-up date on a lead and it appears here on the day it&apos;s
            due, then stays until you clear it.
          </SectionEmpty>
        ) : (
          <div className="space-y-2">
            {followUps.map((lead) => {
              const urgency = lead.follow_up_date
                ? followUpUrgency(lead.follow_up_date, day.date)
                : 'today';
              return (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  followUp
                  onFollowUpChange={fetchToday}
                  trailing={
                    <p
                      className={`mt-0.5 flex items-center gap-1 text-xs font-medium ${
                        urgency === 'overdue' ? 'text-destructive' : 'text-muted-foreground'
                      }`}
                    >
                      {urgency === 'overdue' && <AlertCircle className="h-3 w-3" />}
                      {urgency === 'overdue'
                        ? `Due ${format(new Date(`${lead.follow_up_date}T00:00:00`), 'MMM d')} — overdue`
                        : 'Due today'}
                    </p>
                  }
                />
              );
            })}
            {counts && counts.followUps > followUps.length && (
              <Link
                href="/admin/leads?sort=follow_up_date&order=asc"
                className="flex items-center justify-center gap-1 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {counts.followUps - followUps.length} more
                <ChevronRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        )}
      </SectionCard>

      {/* Callbacks — "come back later" logged at the door. Nothing else in the
          app surfaces these, so without this card they are simply lost. */}
      <SectionCard icon={DoorOpen} title="Callbacks from the door" count={counts?.callbacks}>
        {callbacks.length === 0 ? (
          <SectionEmpty>
            None waiting. Knocks logged as &quot;Callback&quot; collect here so an interested
            homeowner doesn&apos;t get forgotten.
          </SectionEmpty>
        ) : (
          <div className="space-y-2">
            {callbacks.map((lead) => (
              <LeadRow
                key={lead.id}
                lead={lead}
                followUp
                onFollowUpChange={fetchToday}
                trailing={
                  lead.last_knock_at ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Knocked {format(new Date(lead.last_knock_at), 'MMM d')}
                      {lead.knock_count > 1 ? ` · ${lead.knock_count}×` : ''}
                    </p>
                  ) : undefined
                }
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* When there is genuinely nothing scheduled, say what the day's work is
          rather than leaving three empty cards and no way forward. */}
      {nothingAtAll && (
        <Card className="border-dashed">
          <CardContent className="p-0">
            <EmptyState
              icon={nothingAssigned ? Sun : MapIcon}
              title={nothingAssigned ? 'Nothing is assigned to you yet' : 'Nothing scheduled — go knock'}
              description={
                nothingAssigned
                  ? 'No leads have you as their setter or closer, so this view is empty. An admin can assign leads from the Leads list, or switch to Everyone to see the whole team.'
                  : 'No appointments, follow-ups or callbacks are waiting. The map shows which doors have not been knocked yet.'
              }
              action={
                nothingAssigned ? (
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => { setScope('all'); setLoading(true); }}>
                      View everyone&apos;s
                    </Button>
                    {role === 'admin' && (
                      <Link href="/admin/leads"><Button>Assign leads</Button></Link>
                    )}
                  </div>
                ) : (
                  <Link href="/admin/map"><Button>Open the map</Button></Link>
                )
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
