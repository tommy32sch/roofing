import { Button } from '@/components/ui/button';

export function SettingsSectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Settings
      </p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export function SettingsSaveBar({
  changed,
  saving,
  label,
  disabled,
  onSave,
}: {
  changed: string[];
  saving: boolean;
  label: string;
  disabled?: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground" role="status">
        {changed.length > 0 ? `Changed: ${changed.join(', ')}` : 'No unsaved changes'}
      </p>
      <Button
        type="button"
        className="min-h-11"
        onClick={onSave}
        disabled={disabled || saving || changed.length === 0}
      >
        {saving ? 'Saving…' : label}
      </Button>
    </div>
  );
}
