'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function ProtectedAdminError({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center px-6 py-10 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="text-lg font-semibold">This workspace did not load</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            No data was changed. Try loading the workspace again.
          </p>
          <Button className="mt-5" onClick={reset}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
