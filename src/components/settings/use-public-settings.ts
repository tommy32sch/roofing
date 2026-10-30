'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PublicAppSettings } from '@/lib/settings/public-settings';

export function usePublicSettings() {
  const [settings, setSettings] = useState<PublicAppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/settings');
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success || !data.settings) {
        throw new Error(data?.error || 'Could not load settings');
      }
      setSettings(data.settings as PublicAppSettings);
    } catch (cause) {
      setSettings(null);
      setError(cause instanceof Error ? cause.message : 'Could not load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { settings, setSettings, loading, error, load };
}
