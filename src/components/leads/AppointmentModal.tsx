'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DateTimeFields } from '@/components/leads/DateTimeFields';

interface AppointmentModalProps {
  leadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

/**
 * Captures the appointment date/time when a lead is moved to appointment_set —
 * the server rejects that transition without a scheduled time
 * (appointment_form_required), same pattern as the sold/demographics flow.
 */
export function AppointmentModal({ leadId, open, onOpenChange, onSuccess }: AppointmentModalProps) {
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = scheduledAt !== '' && !Number.isNaN(new Date(scheduledAt).getTime());

  async function handleSubmit() {
    if (!isValid) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'appointment_set',
          appointment_scheduled_at: new Date(scheduledAt).toISOString(),
          appointment_notes: notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to save');
        return;
      }

      setScheduledAt('');
      setNotes('');
      onOpenChange(false);
      onSuccess();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setScheduledAt('');
    setNotes('');
    setError(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set Appointment</DialogTitle>
          <p className="text-sm text-muted-foreground">
            When is the inspection appointment? This goes on the calendar.
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <DateTimeFields
              idPrefix="appt"
              value={scheduledAt}
              onChange={setScheduledAt}
              disabled={loading}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="appt_notes">Notes from the call / knock</Label>
            <Textarea
              id="appt_notes"
              placeholder="Roof condition, homeowner concerns, gate codes, who will be home..."
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || loading}>
            {loading ? 'Saving...' : 'Set Appointment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
