'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  MARITAL_STATUS_OPTIONS,
  AGE_RANGE_OPTIONS,
  INCOME_RANGE_OPTIONS,
  EDUCATION_OPTIONS,
  DECISION_MAKER_OPTIONS,
} from '@/types';

interface WonLeadModalProps {
  leadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface DemographicForm {
  career: string;
  family_size: string;
  marital_status: string;
  age_range: string;
  household_income_range: string;
  education_level: string;
  years_in_home: string;
  insurance_carrier: string;
  decision_maker: string;
  referral_source: string;
}

const EMPTY_FORM: DemographicForm = {
  career: '',
  family_size: '',
  marital_status: '',
  age_range: '',
  household_income_range: '',
  education_level: '',
  years_in_home: '',
  insurance_carrier: '',
  decision_maker: '',
  referral_source: '',
};

const FAMILY_SIZE_OPTIONS = ['1', '2', '3', '4', '5', '6', '7+'];

export function WonLeadModal({ leadId, open, onOpenChange, onSuccess }: WonLeadModalProps) {
  const [form, setForm] = useState<DemographicForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof DemographicForm) => (value: string | null) =>
    setForm(prev => ({ ...prev, [field]: value ?? '' }));

  const filledCount = Object.values(form).filter(v => v.trim() !== '').length;
  const totalFields = Object.keys(EMPTY_FORM).length;
  const isValid = filledCount === totalFields;

  async function handleSubmit() {
    if (!isValid) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'sold',
          career: form.career.trim(),
          family_size: form.family_size === '7+' ? 7 : parseInt(form.family_size, 10),
          marital_status: form.marital_status,
          age_range: form.age_range,
          household_income_range: form.household_income_range,
          education_level: form.education_level,
          years_in_home: parseInt(form.years_in_home, 10),
          insurance_carrier: form.insurance_carrier.trim(),
          decision_maker: form.decision_maker,
          referral_source: form.referral_source.trim(),
        }),
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to save');
        return;
      }

      setForm(EMPTY_FORM);
      onOpenChange(false);
      onSuccess();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setForm(EMPTY_FORM);
    setError(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mark Lead as Won</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Complete the homeowner profile before closing this lead.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 bg-muted rounded-full h-1.5">
              <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${(filledCount / totalFields) * 100}%` }} />
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{filledCount}/{totalFields}</span>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2 space-y-1">
            <Label htmlFor="career">Career / Occupation<span className="text-destructive ml-0.5">*</span></Label>
            <Input
              id="career"
              placeholder="e.g. Teacher, Contractor, Nurse"
              value={form.career}
              onChange={e => set('career')(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label>Marital Status<span className="text-destructive ml-0.5">*</span></Label>
            <Select value={form.marital_status} onValueChange={set('marital_status')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {MARITAL_STATUS_OPTIONS.map(o => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Family Size<span className="text-destructive ml-0.5">*</span></Label>
            <Select value={form.family_size} onValueChange={set('family_size')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {FAMILY_SIZE_OPTIONS.map(o => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Age Range<span className="text-destructive ml-0.5">*</span></Label>
            <Select value={form.age_range} onValueChange={set('age_range')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {AGE_RANGE_OPTIONS.map(o => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Household Income<span className="text-destructive ml-0.5">*</span></Label>
            <Select value={form.household_income_range} onValueChange={set('household_income_range')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {INCOME_RANGE_OPTIONS.map(o => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Education Level<span className="text-destructive ml-0.5">*</span></Label>
            <Select value={form.education_level} onValueChange={set('education_level')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {EDUCATION_OPTIONS.map(o => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Decision Maker<span className="text-destructive ml-0.5">*</span></Label>
            <Select value={form.decision_maker} onValueChange={set('decision_maker')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {DECISION_MAKER_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="years_in_home">Years in Home<span className="text-destructive ml-0.5">*</span></Label>
            <Input
              id="years_in_home"
              type="number"
              min={0}
              placeholder="e.g. 5"
              value={form.years_in_home}
              onChange={e => set('years_in_home')(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="insurance_carrier">Insurance Carrier<span className="text-destructive ml-0.5">*</span></Label>
            <Input
              id="insurance_carrier"
              placeholder="e.g. State Farm"
              value={form.insurance_carrier}
              onChange={e => set('insurance_carrier')(e.target.value)}
            />
          </div>

          <div className="col-span-2 space-y-1">
            <Label htmlFor="referral_source">How Did They Hear About You?<span className="text-destructive ml-0.5">*</span></Label>
            <Input
              id="referral_source"
              placeholder="e.g. Door knock, Neighbor referral, Facebook ad"
              value={form.referral_source}
              onChange={e => set('referral_source')(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || loading}>
            {loading ? 'Saving...' : !isValid ? `${totalFields - filledCount} field${totalFields - filledCount !== 1 ? 's' : ''} remaining` : 'Mark as Won'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
