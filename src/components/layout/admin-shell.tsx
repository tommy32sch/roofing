'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, ChevronDown, Settings, LogOut, Menu, Moon, Sun, WifiOff } from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { RoofMark, SidebarNav } from '@/components/layout/app-sidebar';
import { getBottomTabs, getNavLocation, isNavActive } from '@/components/layout/nav-config';
import { StormAlertBell } from '@/components/storms/StormAlertBell';
import { useAppShell } from '@/components/providers/app-shell-provider';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setTheme } = useTheme();
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
  const navLocation = getNavLocation(pathname, user.role);
  const roleLabel = user.role === 'admin' ? 'Administrator' : user.role === 'setter' ? 'Setter' : 'Closer';

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
    <div className="min-h-screen bg-background">
      {session.isImpersonating && (
        <div className="sticky top-0 z-[60] flex items-center justify-between border-b border-primary/30 bg-[#2a2118] px-4 py-2 text-sm text-stone-100">
          <span>
            <span className="mr-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
              Impersonation
            </span>
            Viewing as <strong>{user.name}</strong> ({user.role})
          </span>
          <button
            onClick={handleRestoreAdmin}
            className="border border-primary/40 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
          >
            Return to Admin
          </button>
        </div>
      )}

      {(!connection.online || issues.length > 0) && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-status-offline/30 bg-status-offline/10 px-4 py-2 text-center text-xs text-foreground"
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
        <aside
          data-sidebar
          className="sticky top-0 hidden h-screen w-[17rem] shrink-0 border-r border-black/30 md:block"
        >
          <SidebarNav
            role={user.role}
            companyName={company.name}
            pathname={pathname}
            duplicateCount={duplicateCount}
          />
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
          <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center border-b bg-background/95 px-3 backdrop-blur-md md:px-8">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger className="mr-3 inline-flex h-10 w-10 items-center justify-center border-r text-muted-foreground transition-colors hover:text-foreground md:hidden">
                <Menu className="h-5 w-5" strokeWidth={1.8} />
                <span className="sr-only">Open navigation</span>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[18rem] gap-0 border-white/10 bg-[#191815] p-0 text-stone-100 [&_[data-slot=sheet-close]]:text-stone-400 [&_[data-slot=sheet-close]]:hover:bg-white/10 [&_[data-slot=sheet-close]]:hover:text-white"
              >
                <SidebarNav
                  role={user.role}
                  companyName={company.name}
                  pathname={pathname}
                  duplicateCount={duplicateCount}
                  onNavigate={() => setMobileOpen(false)}
                />
              </SheetContent>
            </Sheet>

            <Link href="/admin" className="flex min-w-0 items-center gap-2.5 md:hidden">
              <RoofMark className="h-7 w-7 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold leading-tight">{company.name}</span>
                <span className="block truncate font-mono text-[8px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {navLocation.label}
                </span>
              </span>
            </Link>

            <div className="hidden min-w-0 items-center gap-3 md:flex">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                {navLocation.section}
              </span>
              <span className="h-4 w-px bg-border" aria-hidden="true" />
              <span className="truncate text-sm font-semibold text-foreground">{navLocation.label}</span>
            </div>

            <div className="ml-auto flex h-full items-center">
              <div className="flex items-center gap-0.5 border-r pr-2">
                <StormAlertBell />

                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-9 w-9 items-center justify-center rounded-[3px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                    <Sun className="h-4 w-4 dark:hidden" />
                    <Moon className="hidden h-4 w-4 dark:block" />
                    <span className="sr-only">Choose theme</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-36 rounded-[4px]">
                    <DropdownMenuItem onClick={() => setTheme('light')}>Light</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme('dark')}>Dark</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme('system')}>System</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger className="ml-2 inline-flex max-w-[14rem] items-center gap-2.5 rounded-[3px] px-2 py-1.5 text-sm transition-colors hover:bg-muted">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] bg-foreground text-[11px] font-bold text-background">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="hidden min-w-0 text-left sm:block">
                    <span className="block truncate text-xs font-semibold leading-tight text-foreground">
                      {user.name}
                    </span>
                    <span className="block font-mono text-[8px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {roleLabel}
                    </span>
                  </span>
                  <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 rounded-[4px] p-1.5">
                  <DropdownMenuLabel className="px-2 py-2">
                    <span className="block truncate text-sm font-semibold text-foreground">{user.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground">
                      {user.email}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
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
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[96rem] flex-1 space-y-6 px-4 py-5 md:px-8 md:py-7 xl:px-10">
            {children}
          </main>
        </div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#191815]/98 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_32px_-22px_rgba(0,0,0,0.8)] backdrop-blur-md md:hidden"
        aria-label="Mobile navigation"
      >
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${bottomTabs.length}, minmax(0, 1fr))` }}
        >
          {bottomTabs.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 border-t-2 px-1 text-[10px] font-semibold transition-colors ${
                  active
                    ? 'border-primary bg-white/[0.05] text-primary'
                    : 'border-transparent text-stone-400 hover:text-stone-100'
                }`}
              >
                <item.icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
