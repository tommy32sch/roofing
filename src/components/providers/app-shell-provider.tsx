'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
import type { AppShellData, AppShellIssueCode } from '@/lib/app-shell/types';

interface AppShellContextValue extends AppShellData {
  connection: { online: boolean };
  isRefreshing: boolean;
  refresh: () => void;
  hasIssue: (code: AppShellIssueCode) => boolean;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

function subscribeToConnection(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getConnectionSnapshot() {
  return navigator.onLine;
}

function getServerConnectionSnapshot() {
  return true;
}

export function AppShellProvider({
  data,
  children,
}: {
  data: AppShellData;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const online = useSyncExternalStore(
    subscribeToConnection,
    getConnectionSnapshot,
    getServerConnectionSnapshot
  );

  const refresh = useCallback(() => {
    startRefresh(() => router.refresh());
  }, [router]);

  const hasIssue = useCallback(
    (code: AppShellIssueCode) => data.issues.some((issue) => issue.code === code),
    [data.issues]
  );

  const value = useMemo<AppShellContextValue>(
    () => ({
      ...data,
      connection: { online },
      isRefreshing,
      refresh,
      hasIssue,
    }),
    [data, hasIssue, isRefreshing, online, refresh]
  );

  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>;
}

export function useAppShell(): AppShellContextValue {
  const value = useContext(AppShellContext);
  if (!value) {
    throw new Error('useAppShell must be used inside AppShellProvider');
  }
  return value;
}
