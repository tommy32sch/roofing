/**
 * Standard page header: title, optional supporting line, optional actions.
 *
 * Every page previously rolled its own header, so titles sat at different
 * sizes, some had a count or description and some didn't, and action buttons
 * landed at different heights. Sharing one component is most of what makes a
 * set of screens feel like a single product rather than a set of pages.
 *
 * Actions wrap below the title on narrow screens instead of overflowing.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border/70 pb-4">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] font-semibold leading-none tracking-[-0.035em]">{title}</h1>
        {description && (
          <p className="mt-2 text-[13px] text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
