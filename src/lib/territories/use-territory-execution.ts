'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyQueuedCalls, type QueuedCall } from '@/lib/leads/call-sync';
import { applyQueuedKnocks, type QueuedKnock } from '@/lib/leads/knock-sync';
import { localDayBounds } from '@/lib/leads/today';
import {
  findNearestUnworkedLead,
  nextTerritoryLeadId,
  refreshTerritoryExecutionLead,
  summarizeTerritoryExecution,
  type TerritoryExecutionLead,
  type TerritoryExecutionSnapshot,
} from './execution';
import {
  requestTerritoryLocation,
  TerritoryGeolocationError,
  type TerritoryUserLocation,
} from './geolocation';

interface UseTerritoryExecutionOptions {
  enabled: boolean;
  queuedKnocks: QueuedKnock[];
  queuedCalls: QueuedCall[];
}

function executionDate(): string {
  return localDayBounds(new Date()).date;
}

function executionClock() {
  const now = new Date();
  return { today: localDayBounds(now).date, now: now.toISOString() };
}

function updateExecutionQuery(territoryId: string | null) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (territoryId) url.searchParams.set('execution', territoryId);
  else url.searchParams.delete('execution');
  window.history.replaceState(window.history.state, '', url);
}

/**
 * Client coordinator for one focused territory session.
 *
 * The server owns authorization, membership and the canonical snapshot. Device
 * location and unsynced results stay in memory/IndexedDB and are overlaid here,
 * so the next-door choice advances immediately without sending rep location to
 * the server or inventing a second persisted progress record.
 */
export function useTerritoryExecution({
  enabled,
  queuedKnocks,
  queuedCalls,
}: UseTerritoryExecutionOptions) {
  const [snapshot, setSnapshot] = useState<TerritoryExecutionSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentLeadId, setCurrentLeadId] = useState<string | null>(null);
  const [location, setLocation] = useState<TerritoryUserLocation | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [clock, setClock] = useState(executionClock);
  const attemptedDeepLinkRef = useRef<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const locationRequestIdRef = useRef(0);

  const load = useCallback(async (territoryId: string, updateUrl = true) => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date: executionDate() });
      const response = await fetch(
        `/api/admin/territories/${encodeURIComponent(territoryId)}/execution?${params}`,
        { cache: 'no-store' }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success || !body.snapshot) {
        throw new Error(body?.error || 'Failed to load territory work');
      }
      if (requestId !== loadRequestIdRef.current) return null;
      const next = body.snapshot as TerritoryExecutionSnapshot;
      setSnapshot(next);
      if (updateUrl) updateExecutionQuery(next.territory.id);
      return next;
    } catch (cause) {
      if (requestId !== loadRequestIdRef.current) return null;
      const message = cause instanceof Error ? cause.message : 'Failed to load territory work';
      setError(message);
      return null;
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }, []);

  const start = useCallback(async (territoryId: string) => {
    locationRequestIdRef.current += 1;
    setCurrentLeadId(null);
    setLocation(null);
    setLocationError(null);
    setLocating(false);
    return load(territoryId, true);
  }, [load]);

  const refresh = useCallback(async () => {
    if (!snapshot) return null;
    return load(snapshot.territory.id, false);
  }, [load, snapshot]);

  const exit = useCallback(() => {
    loadRequestIdRef.current += 1;
    locationRequestIdRef.current += 1;
    setSnapshot(null);
    setLoading(false);
    setError(null);
    setCurrentLeadId(null);
    setLocation(null);
    setLocationError(null);
    setLocating(false);
    updateExecutionQuery(null);
  }, []);

  useEffect(() => {
    if (!enabled || snapshot || loading || typeof window === 'undefined') return;
    const territoryId = new URLSearchParams(window.location.search).get('execution');
    if (!territoryId || attemptedDeepLinkRef.current === territoryId) return;
    attemptedDeepLinkRef.current = territoryId;
    void load(territoryId, false);
  }, [enabled, load, loading, snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const tick = () => setClock(executionClock());
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [snapshot]);

  const leads = useMemo(() => {
    if (!snapshot) return [];
    const optimistic = applyQueuedCalls(
      applyQueuedKnocks([...snapshot.leads], queuedKnocks),
      queuedCalls
    );
    return optimistic.map((lead) => refreshTerritoryExecutionLead(lead, clock));
  }, [clock, queuedCalls, queuedKnocks, snapshot]);

  const summary = useMemo(
    () => snapshot
      ? summarizeTerritoryExecution(snapshot.territory, leads, clock.now)
      : null,
    [clock.now, leads, snapshot]
  );

  const currentLead = useMemo(
    () => leads.find((lead) => lead.id === currentLeadId) ?? null,
    [currentLeadId, leads]
  );

  useEffect(() => {
    if (!currentLeadId) return;
    const nextId = nextTerritoryLeadId(
      leads,
      currentLeadId,
      location ? { latitude: location.lat, longitude: location.lng } : null
    );
    if (nextId !== currentLeadId) setCurrentLeadId(nextId);
  }, [currentLeadId, leads, location]);

  const manualQueue = useMemo(() => {
    const priority = (lead: TerritoryExecutionLead) =>
      lead.revisit_state === 'due'
        ? 0
        : lead.revisit_state === 'needs_schedule'
          ? 1
          : lead.progress_state === 'unworked'
            ? 2
            : 3;
    return leads
      .filter(
        (lead) =>
          lead.actionable &&
          !lead.do_not_knock &&
          (lead.revisit_state === 'due' ||
            lead.revisit_state === 'needs_schedule' ||
            lead.progress_state === 'unworked')
      )
      .sort(
        (a, b) =>
          priority(a) - priority(b) ||
          (a.address_street ?? '').localeCompare(b.address_street ?? '') ||
          a.id.localeCompare(b.id)
      );
  }, [leads]);

  const findNearest = useCallback(async () => {
    const requestId = ++locationRequestIdRef.current;
    setLocating(true);
    setLocationError(null);
    try {
      const nextLocation = await requestTerritoryLocation();
      if (requestId !== locationRequestIdRef.current) return null;
      setLocation(nextLocation);
      const nearest = findNearestUnworkedLead(leads, {
        latitude: nextLocation.lat,
        longitude: nextLocation.lng,
      });
      setCurrentLeadId(nearest?.lead.id ?? null);
      if (!nearest) setLocationError('Every eligible door in this territory has been worked.');
      return nearest?.lead ?? null;
    } catch (cause) {
      if (requestId !== locationRequestIdRef.current) return null;
      setCurrentLeadId(null);
      setLocationError(
        cause instanceof TerritoryGeolocationError
          ? cause.message
          : 'Your location could not be determined. Choose a door from the queue.'
      );
      return null;
    } finally {
      if (requestId === locationRequestIdRef.current) setLocating(false);
    }
  }, [leads]);

  const selectLead = useCallback((lead: TerritoryExecutionLead) => {
    setCurrentLeadId(lead.id);
  }, []);

  const revisitDueIds = useMemo(
    () => new Set(
      leads
        .filter(
          (lead) => lead.revisit_state === 'due' || lead.revisit_state === 'needs_schedule'
        )
        .map((lead) => lead.id)
    ),
    [leads]
  );

  return {
    active: snapshot !== null,
    snapshot,
    territory: snapshot?.territory ?? null,
    leads,
    summary,
    currentLead,
    location,
    locationError,
    locating,
    loading,
    error,
    manualQueue,
    revisitDueIds,
    start,
    refresh,
    exit,
    findNearest,
    selectLead,
  };
}
