'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Building2,
  Home,
  Users,
  PlusCircle,
  Upload,
  Settings,
  LogOut,
  Menu,
  Moon,
  Sun,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

const navItems = [
  { href: '/admin', label: 'Dashboard', icon: Home },
  { href: '/admin/leads', label: 'Leads', icon: Users },
  { href: '/admin/leads/import', label: 'Import', icon: Upload },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

const bottomTabs = [
  { href: '/admin', label: 'Dashboard', icon: Home },
  { href: '/admin/leads', label: 'Leads', icon: Users },
  { href: '/admin/leads/new', label: 'Add', icon: PlusCircle },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [companyName, setCompanyName] = useState('Roof Leads');
  const [adminName, setAdminName] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    fetch('/api/admin/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setCompanyName(data.companyName || 'Roof Leads');
          setAdminName(data.admin?.name || '');
        }
      })
      .catch(() => {});
  }, []);

  async function handleLogout() {
    try {
      await fetch('/api/admin/auth/logout', { method: 'POST' });
      toast.success('Logged out');
      router.push('/admin/login');
    } catch {
      toast.error('Logout failed');
    }
  }

  function isActive(href: string) {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  }

  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen pb-16 md:pb-0">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center px-4 md:px-6">
          {/* Mobile hamburger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              className="md:hidden mr-2 inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Menu className="h-5 w-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <div className="flex h-14 items-center border-b px-4">
                <Building2 className="mr-2 h-5 w-5 text-primary" />
                <span className="font-semibold">{companyName}</span>
              </div>
              <nav className="flex flex-col gap-1 p-2">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                      isActive(item.href)
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>

          {/* Logo */}
          <Link href="/admin" className="flex items-center gap-2 mr-6">
            <Building2 className="h-5 w-5 text-primary" />
            <span className="font-semibold hidden sm:inline">{companyName}</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  isActive(item.href)
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link href="/admin/leads/new">
              <Button size="sm" className="hidden md:flex gap-1">
                <PlusCircle className="h-4 w-4" />
                Add Lead
              </Button>
            </Link>

            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
                {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setTheme('light')}>Light</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('dark')}>Dark</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('system')}>System</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                {adminName || 'Account'}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => router.push('/admin/settings')}>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">
        {children}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
        <div className="flex justify-around py-1">
          {bottomTabs.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 text-xs transition-colors ${
                isActive(item.href)
                  ? 'text-primary'
                  : 'text-muted-foreground'
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
