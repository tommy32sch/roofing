import type { AppPermissions } from '@/lib/auth/permissions';
import type { Market, UserRole } from '@/types';

export interface AppShellUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  homeMarketId: number | null;
}

export type AppShellIssueCode = 'company_unavailable' | 'markets_unavailable';

export interface AppShellIssue {
  code: AppShellIssueCode;
  message: string;
}

export interface AppShellData {
  user: AppShellUser;
  company: { name: string };
  markets: Market[];
  permissions: AppPermissions;
  session: {
    isImpersonating: boolean;
    impersonatedById: string | null;
  };
  issues: AppShellIssue[];
  loadedAt: string;
}

export type AppShellLoadResult =
  | { status: 'ready'; data: AppShellData }
  | { status: 'unauthenticated' }
  | { status: 'unavailable' };
