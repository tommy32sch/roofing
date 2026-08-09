import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/layout/empty-state';

interface DataErrorStateProps {
  title: string;
  description?: string;
  onRetry: () => void;
  compact?: boolean;
}

/** A request failure is a distinct state. It must never render as empty data. */
export function DataErrorState({
  title,
  description = 'Check your connection and try again.',
  onRetry,
  compact = false,
}: DataErrorStateProps) {
  if (compact) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/25 bg-destructive/5 px-4 py-3"
      >
        <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <Card role="alert">
      <CardContent className="p-0">
        <EmptyState
          icon={AlertCircle}
          title={title}
          description={description}
          action={
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Try again
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}
