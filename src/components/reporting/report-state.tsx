import { AlertCircle, CheckCircle2, Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATE = {
  error: { icon: AlertCircle, className: 'border-destructive/30 bg-destructive/5' },
  stale: { icon: Clock3, className: 'border-amber-500/30 bg-amber-500/5' },
  empty: { icon: CheckCircle2, className: 'border-border bg-muted/20' },
} as const;

export function ReportState({
  variant,
  title,
  description,
  action,
  compact = false,
}: {
  variant: keyof typeof STATE;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  const config = STATE[variant];
  const Icon = config.icon;
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex flex-wrap items-center gap-3 border px-4',
        compact ? 'min-h-11 py-2' : 'min-h-16 py-3',
        config.className
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
