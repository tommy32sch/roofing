'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAppShell } from '@/components/providers/app-shell-provider';
import {
  KNOCK_DISPOSITIONS,
  knockLabel,
  type SelectableKnockDisposition,
} from '@/lib/leads/knocks';
import { KNOCK_DRAFT_MAX_INPUT, type KnockDraft } from '@/lib/ai/knock-draft';
import { describeFollowUp } from '@/lib/leads/follow-up';
import { localDayBounds } from '@/lib/leads/today';
import { cn } from '@/lib/utils';

export interface ConfirmedKnockDraft {
  disposition: SelectableKnockDisposition;
  notes: string | null;
  /** "YYYY-MM-DD", or null to leave the lead's follow-up as it is. */
  followUpDate: string | null;
}

interface KnockDraftFieldProps {
  leadId: string;
  leadStreet: string | null;
  disabled?: boolean;
  /** Resolves true once the knock is saved (queued on the device). */
  onConfirm: (draft: ConfirmedKnockDraft) => boolean | Promise<boolean>;
  className?: string;
}

interface Review {
  disposition: SelectableKnockDisposition | null;
  notes: string;
  followUpDate: string;
  otherAddress: boolean;
}

/** Longer than the server's own model timeout, so the server answers first. */
const CLIENT_TIMEOUT_MS = 20_000;

const LABEL_CLASS =
  'font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground';

/**
 * "Say it": one sentence about the door, turned into a result to confirm.
 *
 * Render it with `key={leadId}`. The draft belongs to the lead on screen when
 * it was written; a new door must start empty rather than carry a review over.
 *
 * Voice comes from the phone keyboard's own dictation, which works where
 * in-page microphone access does not (the app blocks it, and iOS home-screen
 * apps handle it poorly). Nothing is saved until the rep taps Save; the save
 * goes through the same path as the result buttons.
 */
export function KnockDraftField({
  leadId,
  leadStreet,
  disabled = false,
  onConfirm,
  className,
}: KnockDraftFieldProps) {
  const { connection, features } = useAppShell();
  const [text, setText] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const reviewRef = useRef<HTMLDivElement>(null);

  if (!features.knockDraft) return null;

  const offline = !connection.online;
  const today = localDayBounds(new Date()).date;

  async function requestDraft(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || drafting || offline) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/knock-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(`${data?.error || 'Could not draft this result'}. Use the buttons instead.`);
        return;
      }
      const draft = data.draft as KnockDraft;
      setReview({
        disposition: draft.disposition,
        notes: draft.notes,
        followUpDate: draft.follow_up_date ?? '',
        otherAddress: draft.mentions_other_address,
      });
      // No result means the rep has to pick one, so open the choices.
      setChoosing(draft.disposition === null);
      requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ block: 'nearest' }));
    } catch {
      setError('No answer in time. Use the buttons instead.');
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (!review?.disposition || saving) return;
    setSaving(true);
    try {
      const saved = await onConfirm({
        disposition: review.disposition,
        notes: review.notes.trim() || null,
        followUpDate: review.followUpDate || null,
      });
      // On failure the caller has already said why; keep the review so the
      // rep can try again without retyping or paying for another draft.
      if (saved) {
        setReview(null);
        setText('');
      }
    } finally {
      setSaving(false);
    }
  }

  if (review) {
    const busy = saving || disabled;
    return (
      <div
        ref={reviewRef}
        className={cn('mt-2 space-y-2 border-t pt-2', className)}
        aria-label="Check the drafted result"
      >
        <p className={LABEL_CLASS}>Check before saving</p>

        <div className="flex items-center justify-between gap-2">
          <p className="text-sm">
            <span className="text-muted-foreground">Result: </span>
            <span className="font-medium">
              {review.disposition ? knockLabel(review.disposition) : 'Choose one'}
            </span>
          </p>
          {review.disposition && (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setChoosing((open) => !open)}
              disabled={busy}
            >
              {choosing ? 'Done' : 'Change'}
            </Button>
          )}
        </div>

        {choosing && (
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Choose the result">
            {KNOCK_DISPOSITIONS.map((result) => (
              <Button
                key={result.value}
                type="button"
                variant={review.disposition === result.value ? 'default' : 'outline'}
                className="min-h-11 h-auto whitespace-normal px-1.5 py-1.5 text-[11px] leading-tight"
                aria-pressed={review.disposition === result.value}
                disabled={busy}
                onClick={() => {
                  setReview({ ...review, disposition: result.value });
                  setChoosing(false);
                }}
              >
                {result.label}
              </Button>
            ))}
          </div>
        )}

        {review.disposition === 'do_not_knock' && (
          <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive">
            Do Not Knock is permanent for this house.
          </p>
        )}
        {review.otherAddress && (
          <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive">
            Your note names a different address. This saves to {leadStreet || 'this lead'}.
          </p>
        )}

        <label className="block">
          <span className={LABEL_CLASS}>Notes</span>
          <Textarea
            value={review.notes}
            onChange={(e) => setReview({ ...review, notes: e.target.value })}
            rows={2}
            className="mt-1 min-h-11"
            disabled={busy}
          />
        </label>

        <label className="block">
          <span className={LABEL_CLASS}>
            Follow up
            {review.followUpDate && (
              <span className="ml-1 normal-case tracking-normal">
                · {describeFollowUp(review.followUpDate, today)}
              </span>
            )}
          </span>
          <Input
            type="date"
            value={review.followUpDate}
            min={today}
            onChange={(e) => setReview({ ...review, followUpDate: e.target.value })}
            className="mt-1 h-11"
            disabled={busy}
          />
        </label>

        <div className="flex gap-2">
          <Button
            type="button"
            className="h-11 flex-1"
            onClick={() => void save()}
            disabled={!review.disposition || busy}
          >
            {saving ? 'Saving…' : 'Save result'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={() => setReview(null)}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={requestDraft} className={cn('mt-2 border-t pt-2', className)}>
      <label htmlFor={`knock-draft-${leadId}`} className={LABEL_CLASS}>
        Or say what happened
      </label>
      <div className="mt-1 flex gap-1.5">
        <Input
          id={`knock-draft-${leadId}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Not home, try Thursday after 5"
          maxLength={KNOCK_DRAFT_MAX_INPUT}
          enterKeyHint="send"
          autoComplete="off"
          className="h-11"
          disabled={drafting || disabled || offline}
        />
        <Button
          type="submit"
          variant="outline"
          className="h-11"
          disabled={!text.trim() || drafting || disabled || offline}
        >
          {drafting ? 'Drafting…' : 'Draft'}
        </Button>
      </div>
      <p className={cn('mt-1 text-[11px]', error ? 'text-destructive' : 'text-muted-foreground')}>
        {error ??
          (offline
            ? 'Needs a connection. Use the buttons above.'
            : 'Tap the mic on your keyboard to speak.')}
      </p>
    </form>
  );
}
