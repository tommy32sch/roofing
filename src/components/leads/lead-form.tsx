'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LEAD_STATUS_OPTIONS,
  LEAD_PRIORITY_OPTIONS,
  ROOF_TYPE_OPTIONS,
} from '@/types';
import type { Lead, LeadSource } from '@/types';

interface LeadFormProps {
  lead?: Lead;
  isEdit?: boolean;
}

export function LeadForm({ lead, isEdit }: LeadFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<LeadSource[]>([]);

  const [form, setForm] = useState({
    first_name: lead?.first_name || '',
    last_name: lead?.last_name || '',
    phone: lead?.phone || '',
    phone2: lead?.phone2 || '',
    phone3: lead?.phone3 || '',
    email: lead?.email || '',
    email2: lead?.email2 || '',
    address_street: lead?.address_street || '',
    address_city: lead?.address_city || '',
    address_state: lead?.address_state || '',
    address_zip: lead?.address_zip || '',
    mailing_street: lead?.mailing_street || '',
    mailing_city: lead?.mailing_city || '',
    mailing_state: lead?.mailing_state || '',
    mailing_zip: lead?.mailing_zip || '',
    home_value: lead?.home_value?.toString() || '',
    year_built: lead?.year_built?.toString() || '',
    sqft: lead?.sqft?.toString() || '',
    lot_size: lead?.lot_size?.toString() || '',
    bedrooms: lead?.bedrooms?.toString() || '',
    bathrooms: lead?.bathrooms?.toString() || '',
    assessed_value: lead?.assessed_value?.toString() || '',
    roof_age: lead?.roof_age?.toString() || '',
    roof_type: lead?.roof_type || 'unknown',
    roof_score: lead?.roof_score?.toString() || '',
    roof_material_notes: lead?.roof_material_notes || '',
    status: lead?.status || 'new',
    priority: lead?.priority || 'medium',
    source_id: lead?.source_id?.toString() || '',
    source_notes: lead?.source_notes || '',
  });

  useEffect(() => {
    fetch('/api/admin/leads/sources')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setSources(data.sources);
      })
      .catch(() => {});
  }, []);

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.first_name.trim() || !form.last_name.trim()) {
      toast.error('First name and last name are required');
      return;
    }

    setLoading(true);

    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      phone: form.phone.trim() || null,
      phone2: form.phone2.trim() || null,
      phone3: form.phone3.trim() || null,
      email: form.email.trim() || null,
      email2: form.email2.trim() || null,
      address_street: form.address_street.trim() || null,
      address_city: form.address_city.trim() || null,
      address_state: form.address_state.trim() || null,
      address_zip: form.address_zip.trim() || null,
      mailing_street: form.mailing_street.trim() || null,
      mailing_city: form.mailing_city.trim() || null,
      mailing_state: form.mailing_state.trim() || null,
      mailing_zip: form.mailing_zip.trim() || null,
      home_value: form.home_value ? parseInt(form.home_value, 10) : null,
      year_built: form.year_built ? parseInt(form.year_built, 10) : null,
      sqft: form.sqft ? parseInt(form.sqft, 10) : null,
      lot_size: form.lot_size ? parseFloat(form.lot_size) : null,
      bedrooms: form.bedrooms ? parseInt(form.bedrooms, 10) : null,
      bathrooms: form.bathrooms ? parseFloat(form.bathrooms) : null,
      assessed_value: form.assessed_value ? parseInt(form.assessed_value, 10) : null,
      roof_age: form.roof_age ? parseInt(form.roof_age, 10) : null,
      roof_type: form.roof_type,
      roof_score: form.roof_score ? parseInt(form.roof_score, 10) : null,
      roof_material_notes: form.roof_material_notes.trim() || null,
      status: form.status,
      priority: form.priority,
      source_id: form.source_id ? parseInt(form.source_id, 10) : null,
      source_notes: form.source_notes.trim() || null,
    };

    try {
      const url = isEdit ? `/api/admin/leads/${lead?.id}` : '/api/admin/leads';
      const method = isEdit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        toast.error(data.error || 'Failed to save lead');
        return;
      }

      toast.success(isEdit ? 'Lead updated' : 'Lead created');
      router.push(`/admin/leads/${data.lead.id}`);
    } catch {
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Contact Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Contact Information</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="first_name">First Name *</Label>
            <Input
              id="first_name"
              value={form.first_name}
              onChange={(e) => updateField('first_name', e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last_name">Last Name *</Label>
            <Input
              id="last_name"
              value={form.last_name}
              onChange={(e) => updateField('last_name', e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={form.phone}
              onChange={(e) => updateField('phone', e.target.value)}
              placeholder="(555) 123-4567"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone2">Phone 2</Label>
            <Input
              id="phone2"
              type="tel"
              value={form.phone2}
              onChange={(e) => updateField('phone2', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email2">Email 2</Label>
            <Input
              id="email2"
              type="email"
              value={form.email2}
              onChange={(e) => updateField('email2', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone3">Phone 3</Label>
            <Input
              id="phone3"
              type="tel"
              value={form.phone3}
              onChange={(e) => updateField('phone3', e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Property Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Property Information</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="address_street">Street Address</Label>
            <Input
              id="address_street"
              value={form.address_street}
              onChange={(e) => updateField('address_street', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address_city">City</Label>
            <Input
              id="address_city"
              value={form.address_city}
              onChange={(e) => updateField('address_city', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="address_state">State</Label>
              <Input
                id="address_state"
                value={form.address_state}
                onChange={(e) => updateField('address_state', e.target.value)}
                maxLength={2}
                placeholder="TX"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address_zip">ZIP</Label>
              <Input
                id="address_zip"
                value={form.address_zip}
                onChange={(e) => updateField('address_zip', e.target.value)}
                maxLength={10}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="home_value">Estimated Value ($)</Label>
            <Input
              id="home_value"
              type="number"
              value={form.home_value}
              onChange={(e) => updateField('home_value', e.target.value)}
              placeholder="250000"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assessed_value">Assessed Value ($)</Label>
            <Input
              id="assessed_value"
              type="number"
              value={form.assessed_value}
              onChange={(e) => updateField('assessed_value', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="year_built">Year Built</Label>
            <Input
              id="year_built"
              type="number"
              value={form.year_built}
              onChange={(e) => updateField('year_built', e.target.value)}
              placeholder="1995"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sqft">Sqft</Label>
            <Input
              id="sqft"
              type="number"
              value={form.sqft}
              onChange={(e) => updateField('sqft', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lot_size">Lot Size (acres)</Label>
            <Input
              id="lot_size"
              type="number"
              step="0.01"
              value={form.lot_size}
              onChange={(e) => updateField('lot_size', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bedrooms">Bedrooms</Label>
            <Input
              id="bedrooms"
              type="number"
              value={form.bedrooms}
              onChange={(e) => updateField('bedrooms', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bathrooms">Bathrooms</Label>
            <Input
              id="bathrooms"
              type="number"
              step="0.5"
              value={form.bathrooms}
              onChange={(e) => updateField('bathrooms', e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Mailing Address */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Mailing Address</CardTitle>
          <p className="text-xs text-muted-foreground">If different from property address (absentee owner)</p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="mailing_street">Street</Label>
            <Input
              id="mailing_street"
              value={form.mailing_street}
              onChange={(e) => updateField('mailing_street', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mailing_city">City</Label>
            <Input
              id="mailing_city"
              value={form.mailing_city}
              onChange={(e) => updateField('mailing_city', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mailing_state">State</Label>
              <Input
                id="mailing_state"
                value={form.mailing_state}
                onChange={(e) => updateField('mailing_state', e.target.value)}
                maxLength={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mailing_zip">ZIP</Label>
              <Input
                id="mailing_zip"
                value={form.mailing_zip}
                onChange={(e) => updateField('mailing_zip', e.target.value)}
                maxLength={10}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Roof Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Roof Information</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="roof_type">Roof Type</Label>
            <Select value={form.roof_type} onValueChange={(v) => v && updateField('roof_type', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROOF_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="roof_age">Roof Age (years)</Label>
            <Input
              id="roof_age"
              type="number"
              value={form.roof_age}
              onChange={(e) => updateField('roof_age', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="roof_score">Roof Score (0-100)</Label>
            <Input
              id="roof_score"
              type="number"
              min="0"
              max="100"
              value={form.roof_score}
              onChange={(e) => updateField('roof_score', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="roof_material_notes">Material Notes</Label>
            <Input
              id="roof_material_notes"
              value={form.roof_material_notes}
              onChange={(e) => updateField('roof_material_notes', e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Lead Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Lead Information</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => v && updateField('status', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <Select value={form.priority} onValueChange={(v) => v && updateField('priority', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_PRIORITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Source</Label>
            <Select value={form.source_id} onValueChange={(v) => v && updateField('source_id', v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select source..." />
              </SelectTrigger>
              <SelectContent>
                {sources.map((src) => (
                  <SelectItem key={src.id} value={src.id.toString()}>
                    {src.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="source_notes">Source Notes</Label>
            <Input
              id="source_notes"
              value={form.source_notes}
              onChange={(e) => updateField('source_notes', e.target.value)}
              placeholder="e.g. PropStream export 3/15"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? 'Saving...' : isEdit ? 'Update Lead' : 'Create Lead'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
