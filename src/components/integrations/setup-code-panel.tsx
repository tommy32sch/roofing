'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function SetupCodePanel({
  title,
  summary,
  code,
}: {
  title: string;
  summary: string;
  code: string;
}) {
  return (
    <details className="border-t border-border/70 pt-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-medium">
        {title}
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-muted-foreground">{summary}</p>
        <div className="relative">
          <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre">{code}</pre>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="absolute top-2 right-2"
            onClick={() => {
              void navigator.clipboard.writeText(code);
              toast.success('Script copied to clipboard');
            }}
          >
            Copy
          </Button>
        </div>
      </div>
    </details>
  );
}
