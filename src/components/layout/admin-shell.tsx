'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, Building2, Settings, LogOut, Menu, Moon, Sun, WifiOff } from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { SidebarNav } from '@/components/layout/app-sidebar';
import { getBottomTabs, isNavActive } from '@/components/layout/nav-config';
import { StormAlertBell } from '@/components/storms/StormAlertBell';
import { useAppShell } from '@/components/providers/app-shell-provider';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const {
    company,
    connection,
    issues,
    permissions,
    refresh,
    isRefreshing,
    session,
    user,
  } = useAppShell();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState(0);

  useEffect(() => {
    if (!permissions.canManageUsers) return;
    fetch('/api/admin/leads?show_duplicates=true&is_flagged_duplicate=true&limit=1')
      .then(r => r.json())
      .then(d => { if (d.success) setDuplicateCount(d.total || 0); })
      .catch(() => {});
  }, [permissions.canManageUsers]);

  async function handleRestoreAdmin() {
    try {
      const res = await fetch('/api/admin/auth/restore', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        window.location.href = '/admin/users';
      } else {
        toast.error('Could not restore admin session — try logging out and back in');
      }
    } catch {
      toast.error('Failed to restore admin session');
    }
  }

  const bottomTabs = getBottomTabs(user.role);

  async function handleLogout() {
    try {
      await fetch('/api/admin/auth/logout', { method: 'POST' });
      // Full document load: the provider persists across client navigation and
      // must never carry one account's shell or offline ownership into another.
      window.location.href = '/admin/login';
    } catch {
      toast.error('Logout failed');
    }
  }
  return (
    <div className="min-h-screen">
      {session.isImpersonating && (
        <div className="sticky top-0 z-50 flex items-center justify-between bg-amber-500 px-4 py-2 text-sm font-medium text-white">
          <span>Viewing as <strong>{user.name}</strong> ({user.role})</span>
          <button
            onClick={handleRestoreAdmin}
            className="rounded bg-white/20 px-3 py-1 text-xs transition-colors hover:bg-white/30"
          >
            Return to Admin
          </button>
        </div>
      )}

      {(!connection.online || issues.length > 0) && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-900 dark:text-amber-100"
        >
          {!connection.online ? (
            <>
              <WifiOff className="h-3.5 w-3.5" />
              <span>You are offline. Saved data stays visible, but updates may not load.</span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{issues.map((issue) => issue.message).join(' ')}</span>
              <button
                type="button"
                className="font-medium underline underline-offset-2 disabled:opacity-50"
                onClick={refresh}
                disabled={isRefreshing}
              >
                {isRefreshing ? 'Trying again…' : 'Try again'}
              </button>
            </>
          )}
        </div>
      )}

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-sidebar-border md:block">
          <SidebarNav
            role={user.role}
            companyName={company.name}
            pathname={pathname}
            duplicateCount={duplicateCount}
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
          {/* Slim bar: mobile brand + hamburger on small screens, account controls on all */}
          <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger className="-ml-2 inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open navigation</span>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <SidebarNav
                  role={user.role}
                  companyName={company.name}
                  pathname={pathname}
                  duplicateCount={duplicateCount}
                  onNavigate={() => setMobileOpen(false)}
                />
              </SheetContent>
            </Sheet>

            <Link href="/admin" className="flex items-center gap-2 md:hidden">
              <Building2 className="h-5 w-5 text-primary" />
              <span className="truncate font-semibold">{company.name}</span>
            </Link>

            <div className="ml-auto flex items-center gap-1">
              <StormAlertBell />

              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
                  {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                  <span className="sr-only">Choose theme</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setTheme('light')}>Light</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme('dark')}>Dark</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme('system')}>System</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex max-w-[12rem] items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="hidden truncate sm:inline">{user.name}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {permissions.canManageSettings && (
                    <>
                      <DropdownMenuItem onClick={() => router.push('/admin/settings')}>
                        <Settings className="mr-2 h-4 w-4" />
                        Settings
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 md:px-6 md:py-8">
            {children}
          </main>
        </div>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
        <div className="flex justify-around py-1">
          {bottomTabs.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isNavActive(pathname, item.href) ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 text-xs transition-colors ${
                isNavActive(pathname, item.href) ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
