import type { LucideIcon } from 'lucide-react';

/**
 * Empty state for a list or panel that has nothing to show yet.
 *
 * A bare "No activity yet." tells someone the screen isn't broken and nothing
 * else. An empty state is the one moment you have their full attention, so it
 * should say why it's empty and what fills it — that's the difference between a
 * screen that looks unfinished and one that looks considered.
 *
 * Keep `title` factual and `description` about what will populate it.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-14 text-center ${className}`}>
      {Icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
