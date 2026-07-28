'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudHail, Mail, Wind } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface AlertSubscription {
  user_id: string;
  user_name: string;
  email_enabled: boolean;
}

interface StormAlertRule {
  market_id: number;
  market_name: string;
  enabled: boolean;
  radius_miles: number;
  hail_min_inches: number;
  wind_min_mph: number;
  include_unmeasured_wind: boolean;
  last_success_at: string | null;
  last_error: string | null;
  subscriptions: AlertSubscription[];
  subscriber_user_ids: string[];
}

interface AlertUser {
  id: string;
  name: string;
  email: string;
  role: string;
  market_id: number | null;
}

export function StormAlertsCard() {
  const [rules, setRules] = useState<StormAlertRule[]>([]);
  const [users, setUsers] = useState<AlertUser[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingMarketId, setSavingMarketId] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/admin/storm-alerts/settings', { cache: 'no-store' }).then((res) => res.json()),
      fetch('/api/admin/users', { cache: 'no-store' }).then((res) => res.json()),
    ])
      .then(([settingsData, usersData]) => {
        if (cancelled) return;
        if (!settingsData.success) {
          setUnavailable(true);
          return;
        }
        setRules(
          (settingsData.rules ?? []).map((rule: Omit<StormAlertRule, 'subscriber_user_ids'>) => ({
            ...rule,
            subscriber_user_ids: (rule.subscriptions ?? [])
              .filter((subscription) => subscription.email_enabled)
              .map((subscription) => subscription.user_id),
          }))
        );
        setEmailConfigured(settingsData.email_configured === true);
        if (usersData.success) setUsers(usersData.users ?? []);
      })
      .catch(() => setUnavailable(true))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateRule(marketId: number, patch: Partial<StormAlertRule>) {
    setRules((prev) =>
      prev.map((rule) => (rule.market_id === marketId ? { ...rule, ...patch } : rule))
    );
  }

  function toggleRecipient(rule: StormAlertRule, userId: string, checked: boolean) {
    const next = checked
      ? [...new Set([...rule.subscriber_user_ids, userId])]
      : rule.subscriber_user_ids.filter((id) => id !== userId);
    updateRule(rule.market_id, { subscriber_user_ids: next });
  }

  async function save(rule: StormAlertRule) {
    setSavingMarketId(rule.market_id);
    try {
      const res = await fetch('/api/admin/storm-alerts/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market_id: rule.market_id,
          enabled: rule.enabled,
          radius_miles: rule.radius_miles,
          hail_min_inches: rule.hail_min_inches,
          wind_min_mph: rule.wind_min_mph,
          include_unmeasured_wind: rule.include_unmeasured_wind,
          subscriber_user_ids: rule.subscriber_user_ids,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || 'Failed to save storm alerts');
        return;
      }
      if (data.rule) {
        updateRule(rule.market_id, {
          ...data.rule,
          subscriber_user_ids: (data.rule.subscriptions ?? [])
            .filter((subscription: AlertSubscription) => subscription.email_enabled)
            .map((subscription: AlertSubscription) => subscription.user_id),
        });
      }
      toast.success(`${rule.market_name} storm alerts saved`);
    } catch {
      toast.error('Failed to save storm alerts');
    } finally {
      setSavingMarketId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Storm alerts</CardTitle>
        <CardDescription>
          Notify subscribed team members when preliminary NOAA hail or wind reports meet a
          market&apos;s thresholds.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <p className="text-sm text-muted-foreground">Loading alert settings...</p>}

        {!loading && unavailable && (
          <Alert>
            <AlertTriangle />
            <AlertTitle>Storm alerts are not available yet</AlertTitle>
            <AlertDescription>
              Apply the storm-alert database migration and configure the scheduled ingestion
              route before enabling notifications.
            </AlertDescription>
          </Alert>
        )}

        {!loading && !unavailable && (
          <>
            <Alert>
              {emailConfigured ? <CheckCircle2 /> : <Mail />}
              <AlertTitle>
                {emailConfigured ? 'Email delivery is configured' : 'Email delivery is not configured'}
              </AlertTitle>
              <AlertDescription>
                In-app alerts are persisted either way. Email requires both RESEND_API_KEY and
                RESEND_FROM_EMAIL.
              </AlertDescription>
            </Alert>

            {rules.map((rule) => {
              const eligibleUsers = users.filter(
                (user) => user.market_id == null || user.market_id === rule.market_id
              );
              return (
                <div key={rule.market_id} className="space-y-4 rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{rule.market_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {rule.last_success_at
                          ? `NOAA last checked ${new Date(rule.last_success_at).toLocaleString()}`
                          : 'NO successful scheduled NOAA check yet'}
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(checked) =>
                          updateRule(rule.market_id, { enabled: checked })
                        }
                      />
                      Enabled
                    </label>
                  </div>

                  {rule.last_error && (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      Latest ingestion error: {rule.last_error}
                    </p>
                  )}

                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor={`storm-radius-${rule.market_id}`}>Alert radius (miles)</Label>
                      <Input
                        id={`storm-radius-${rule.market_id}`}
                        type="number"
                        min="5"
                        max="150"
                        step="5"
                        value={rule.radius_miles}
                        onChange={(event) =>
                          updateRule(rule.market_id, {
                            radius_miles: Number(event.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`storm-hail-${rule.market_id}`} className="flex items-center gap-1">
                        <CloudHail className="h-3.5 w-3.5" />
                        Minimum hail (inches)
                      </Label>
                      <Input
                        id={`storm-hail-${rule.market_id}`}
                        type="number"
                        min="0.25"
                        max="6"
                        step="0.25"
                        value={rule.hail_min_inches}
                        onChange={(event) =>
                          updateRule(rule.market_id, {
                            hail_min_inches: Number(event.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`storm-wind-${rule.market_id}`} className="flex items-center gap-1">
                        <Wind className="h-3.5 w-3.5" />
                        Minimum wind (mph)
                      </Label>
                      <Input
                        id={`storm-wind-${rule.market_id}`}
                        type="number"
                        min="1"
                        max="200"
                        step="1"
                        value={rule.wind_min_mph}
                        onChange={(event) =>
                          updateRule(rule.market_id, {
                            wind_min_mph: Number(event.target.value),
                          })
                        }
                      />
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={rule.include_unmeasured_wind}
                      onCheckedChange={(checked) =>
                        updateRule(rule.market_id, {
                          include_unmeasured_wind: checked === true,
                        })
                      }
                    />
                    Alert on wind-damage reports that do not include a measured speed
                  </label>

                  <div className="space-y-2">
                    <Label>Email recipients</Label>
                    <div className="max-h-48 divide-y overflow-y-auto rounded-md border">
                      {eligibleUsers.length === 0 && (
                        <p className="p-3 text-sm text-muted-foreground">
                          No eligible users are assigned to this market.
                        </p>
                      )}
                      {eligibleUsers.map((user) => (
                        <label
                          key={user.id}
                          className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={rule.subscriber_user_ids.includes(user.id)}
                            onCheckedChange={(checked) =>
                              toggleRecipient(rule, user.id, checked === true)
                            }
                          />
                          <span>{user.name}</span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {user.email} · {user.role}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      onClick={() => save(rule)}
                      disabled={savingMarketId === rule.market_id}
                    >
                      {savingMarketId === rule.market_id ? 'Saving...' : `Save ${rule.market_name}`}
                    </Button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}
