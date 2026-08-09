import type { UserRole } from '@/types';

/** Broad UI capabilities. Record-level access stays in each server policy. */
export interface AppPermissions {
  canAddLeads: boolean;
  canImportLeads: boolean;
  canManageIntegrations: boolean;
  canManageMarkets: boolean;
  canManageSettings: boolean;
  canManageTerritories: boolean;
  canManageUsers: boolean;
  canViewAnalytics: boolean;
  canViewTeamData: boolean;
  canBulkAssignLeads: boolean;
  canDeleteLeads: boolean;
  canExecuteTerritories: boolean;
}

export function permissionsForRole(role: UserRole): AppPermissions {
  const isAdmin = role === 'admin';
  return {
    // Every account can add and import. Server routes stamp the creator and
    // still enforce record-level access.
    canAddLeads: true,
    canImportLeads: true,
    canManageIntegrations: isAdmin,
    canManageMarkets: isAdmin,
    canManageSettings: isAdmin,
    canManageTerritories: isAdmin,
    canManageUsers: isAdmin,
    canViewAnalytics: isAdmin,
    canViewTeamData: isAdmin,
    canBulkAssignLeads: isAdmin,
    canDeleteLeads: isAdmin,
    canExecuteTerritories: role === 'admin' || role === 'setter',
  };
}
