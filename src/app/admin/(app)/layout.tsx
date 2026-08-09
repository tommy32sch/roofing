import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/layout/admin-shell';
import { AppShellUnavailable } from '@/components/layout/app-shell-unavailable';
import { AppShellProvider } from '@/components/providers/app-shell-provider';
import { loadAppShell } from '@/lib/app-shell/server';

/** Session-scoped data must be resolved for every full document request. */
export const dynamic = 'force-dynamic';

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await loadAppShell();

  if (result.status === 'unauthenticated') {
    redirect('/admin/login');
  }

  if (result.status === 'unavailable') {
    return <AppShellUnavailable />;
  }

  return (
    <AppShellProvider data={result.data}>
      <AdminShell>{children}</AdminShell>
    </AppShellProvider>
  );
}
