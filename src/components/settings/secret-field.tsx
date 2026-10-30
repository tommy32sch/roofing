'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function SecretField({
  id,
  label,
  description,
  configured,
  value,
  onChange,
  onClear,
  clearing,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  configured: boolean;
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  clearing?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={configured ? 'Enter a new key to replace the stored key' : 'Paste the API key'}
        className="min-h-11"
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">
        {configured
          ? 'A key is stored. This field stays empty on purpose. Leave it blank to keep the stored key.'
          : description}
      </p>
      {configured && onClear && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={onClear}
          disabled={disabled || clearing}
        >
          {clearing ? 'Removing…' : 'Remove stored key'}
        </Button>
      )}
    </div>
  );
}
