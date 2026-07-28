'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Bell, CloudHail, Wind } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { StormAlert } from '@/types';

const REFRESH_MS = 60_000;

function alertLabel(alert: StormAlert) {
  if (alert.type === 'hail') {
    return alert.peak_value == null
      ? 'Hail report'
      : `${alert.peak_value.toFixed(2).replace(/\.?0+$/, '')}" hail`;
  }
  return alert.peak_value == null ? 'Wind damage report' : `${Math.round(alert.peak_value)} mph wind`;
}

export function StormAlertBell() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<StormAlert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [available, setAvailable] = useState(false);

  const loadAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/storm-alerts?limit=10', { cache: 'no-store' });
      const data = await res.json();
      if (!data.success) return;
      setAlerts(data.alerts ?? []);
      setUnreadCount(data.unread_count ?? 0);
      setAvailable(true);
    } catch {
      // Notification polling must never disrupt the rest of the admin shell.
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(loadAlerts, 0);
    const interval = window.setInterval(loadAlerts, REFRESH_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [loadAlerts]);

  async function openAlert(alert: StormAlert) {
    if (!alert.read_at) {
      fetch(`/api/admin/storm-alerts/${alert.id}/read`, { method: 'POST' }).catch(() => {});
      setAlerts((prev) =>
        prev.map((item) =>
          item.id === alert.id ? { ...item, read_at: new Date().toISOString() } : item
        )
      );
      setUnreadCount((count) => Math.max(0, count - 1));
    }

    const params = new URLSearchParams({
      market_id: String(alert.market_id),
      storm: alert.type,
      days: '7',
      lat: String(alert.centroid_lat),
      lng: String(alert.centroid_lon),
      alert_id: alert.id,
    });
    router.push(`/admin/map?${params}`);
  }

  if (!available) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread storm alert${unreadCount !== 1 ? 's' : ''}`
            : 'Storm alerts'
        }
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-4 text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(92vw,24rem)]">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-medium">Storm alerts</p>
          <p className="text-[11px] text-muted-foreground">
            Preliminary NOAA reports near subscribed markets
          </p>
        </div>

        {alerts.length === 0 ? (
          <p className="px-3 py-5 text-center text-sm text-muted-foreground">
            No qualifying storm reports yet.
          </p>
        ) : (
          alerts.map((alert) => {
            const Icon = alert.type === 'hail' ? CloudHail : Wind;
            return (
              <DropdownMenuItem
                key={alert.id}
                onClick={() => openAlert(alert)}
                className="items-start gap-2.5 px-3 py-2.5"
              >
                <span
                  className={`mt-0.5 rounded-full p-1.5 ${
                    alert.read_at ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {alert.market_name} · {alertLabel(alert)}
                    </span>
                    {!alert.read_at && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {alert.report_count} report{alert.report_count !== 1 ? 's' : ''} · closest{' '}
                    {alert.closest_distance_miles.toFixed(0)} mi ·{' '}
                    {formatDistanceToNow(new Date(`${alert.occurred_on}T12:00:00Z`), {
                      addSuffix: true,
                    })}
                  </span>
                </span>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
