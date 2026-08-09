'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function AppShellUnavailable() {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center px-6 py-10 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
            <AlertTriangle className="h-6 w-6 text-amber-600" />
          </div>
          <h1 className="text-lg font-semibold">We could not load your workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your session is still safe. Check your connection and try again.
          </p>
          <Button
            className="mt-5"
            disabled={retrying}
            onClick={() => startRetry(() => router.refresh())}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
            {retrying ? 'Trying again…' : 'Try again'}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
