/**
 * Single source of truth for how a role is displayed.
 *
 * Users and Performance each had their own colour map and they disagreed —
 * admin was blue on one page and purple on the other. Roles are context rather
 * than a headline, so this matches the quiet chip-with-a-dot treatment used by
 * the lead status badges.
 */
const ROLE_DOT: Record<string, string> = {
  admin: 'bg-purple-500',
  setter: 'bg-blue-500',
  closer: 'bg-green-500',
};

export function RoleBadge({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground capitalize whitespace-nowrap">
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${ROLE_DOT[role] ?? 'bg-muted-foreground'}`} />
      {role}
    </span>
  );
}
