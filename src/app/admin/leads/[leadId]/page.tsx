'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Edit2,
  Trash2,
  Phone,
  Mail,
  MapPin,
  Home,
  Calendar,
  MessageSquare,
  PhoneCall,
  ArrowRightLeft,
  FileText,
  Eye,
  Plus,
  CloudRain,
  Building,
  Sparkles,
  MailOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { LeadPriorityBadge } from '@/components/leads/lead-priority-badge';
import { LEAD_STATUS_OPTIONS, LEAD_PRIORITY_OPTIONS } from '@/types';
import type { LeadWithActivities, LeadActivity, ActivityType } from '@/types';

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  note: MessageSquare,
  call: PhoneCall,
  email: Mail,
  visit: Eye,
  status_change: ArrowRightLeft,
  created: FileText,
  updated: Edit2,
};

const ACTIVITY_TYPE_OPTIONS: { value: ActivityType; label: string }[] = [
  { value: 'note', label: 'Note' },
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'visit', label: 'Visit' },
];

export default function LeadDetailPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = use(params);
  const router = useRouter();
  const [lead, setLead] = useState<LeadWithActivities | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Activity form
  const [activityType, setActivityType] = useState<ActivityType>('note');
  const [activityContent, setActivityContent] = useState('');
  const [activityLoading, setActivityLoading] = useState(false);

  async function fetchLead() {
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`);
      const data = await res.json();
      if (data.success) {
        setLead(data.lead);
      } else {
        toast.error('Lead not found');
        router.push('/admin/leads');
      }
    } catch {
      toast.error('Failed to load lead');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLead();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function handleStatusChange(newStatus: string | null) {
    if (!newStatus) return;
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Status updated');
        fetchLead();
      }
    } catch {
      toast.error('Failed to update status');
    }
  }

  async function handlePriorityChange(newPriority: string | null) {
    if (!newPriority) return;
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: newPriority }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Priority updated');
        fetchLead();
      }
    } catch {
      toast.error('Failed to update priority');
    }
  }

  async function handleAddActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!activityContent.trim()) return;

    setActivityLoading(true);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activity_type: activityType,
          content: activityContent.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Activity added');
        setActivityContent('');
        fetchLead();
      }
    } catch {
      toast.error('Failed to add activity');
    } finally {
      setActivityLoading(false);
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Lead deleted');
        router.push('/admin/leads');
      }
    } catch {
      toast.error('Failed to delete lead');
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!lead) return null;

  const fullAddress = [lead.address_street, lead.address_city, lead.address_state, lead.address_zip]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/leads">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">
              {lead.first_name} {lead.last_name}
            </h1>
            {fullAddress && (
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="h-3 w-3" />
                {fullAddress}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/admin/leads/${leadId}/edit`}>
            <Button variant="outline" size="sm">
              <Edit2 className="h-4 w-4 mr-1" />
              Edit
            </Button>
          </Link>
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger
              className="inline-flex items-center justify-center rounded-md bg-destructive px-3 py-1.5 text-sm text-white hover:bg-destructive/90"
            >
              <Trash2 className="h-4 w-4" />
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Lead</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Are you sure you want to delete {lead.first_name} {lead.last_name}? This action cannot be undone.
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleDelete}>Delete</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          <Select value={lead.status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-[150px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Priority:</span>
          <Select value={lead.priority} onValueChange={handlePriorityChange}>
            <SelectTrigger className="w-[120px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_PRIORITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <LeadStatusBadge status={lead.status} />
        <LeadPriorityBadge priority={lead.priority} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">
            Activity ({lead.lead_activities?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          {/* Enrichment badge */}
          {lead.enriched_at && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-1.5 w-fit">
              <Sparkles className="h-3 w-3" />
              Enriched via {lead.enrichment_source || 'unknown'} on {format(new Date(lead.enriched_at), 'MMM d, yyyy')}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Contact */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Contact</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {lead.phone && (
                  <a href={`tel:${lead.phone}`} className="flex items-center gap-2 text-sm hover:text-primary">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    {lead.phone}
                  </a>
                )}
                {lead.phone2 && (
                  <a href={`tel:${lead.phone2}`} className="flex items-center gap-2 text-sm hover:text-primary">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    {lead.phone2} <span className="text-xs text-muted-foreground">(2)</span>
                  </a>
                )}
                {lead.phone3 && (
                  <a href={`tel:${lead.phone3}`} className="flex items-center gap-2 text-sm hover:text-primary">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    {lead.phone3} <span className="text-xs text-muted-foreground">(3)</span>
                  </a>
                )}
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="flex items-center gap-2 text-sm hover:text-primary">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    {lead.email}
                  </a>
                )}
                {lead.email2 && (
                  <a href={`mailto:${lead.email2}`} className="flex items-center gap-2 text-sm hover:text-primary">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    {lead.email2} <span className="text-xs text-muted-foreground">(2)</span>
                  </a>
                )}
                {!lead.phone && !lead.email && (
                  <p className="text-sm text-muted-foreground">No contact info</p>
                )}
              </CardContent>
            </Card>

            {/* Property */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Property</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {fullAddress && (
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <span>{fullAddress}</span>
                  </div>
                )}
                {lead.home_value && (
                  <div className="flex items-center gap-2">
                    <Home className="h-4 w-4 text-muted-foreground" />
                    Est. ${lead.home_value.toLocaleString()}
                  </div>
                )}
                {lead.assessed_value && (
                  <div className="flex items-center gap-2">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    Assessed ${lead.assessed_value.toLocaleString()}
                  </div>
                )}
                {lead.year_built && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    Built {lead.year_built}
                  </div>
                )}
                <Separator />
                <div className="grid grid-cols-2 gap-1">
                  {lead.sqft && <div><span className="text-muted-foreground">Sqft:</span> {lead.sqft.toLocaleString()}</div>}
                  {lead.lot_size && <div><span className="text-muted-foreground">Lot:</span> {lead.lot_size} acres</div>}
                  {lead.bedrooms && <div><span className="text-muted-foreground">Beds:</span> {lead.bedrooms}</div>}
                  {lead.bathrooms && <div><span className="text-muted-foreground">Baths:</span> {lead.bathrooms}</div>}
                  {lead.stories && <div><span className="text-muted-foreground">Stories:</span> {lead.stories}</div>}
                  {lead.owner_type && <div><span className="text-muted-foreground">Owner:</span> {lead.owner_type}</div>}
                  {lead.apn && <div className="col-span-2"><span className="text-muted-foreground">APN:</span> {lead.apn}</div>}
                  {lead.last_sale_date && <div><span className="text-muted-foreground">Last sold:</span> {lead.last_sale_date}</div>}
                  {lead.last_sale_price && <div><span className="text-muted-foreground">Sale price:</span> ${lead.last_sale_price.toLocaleString()}</div>}
                </div>
              </CardContent>
            </Card>

            {/* Mailing Address (absentee owner indicator) */}
            {lead.mailing_street && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <MailOpen className="h-3.5 w-3.5" />
                    Mailing Address
                    {fullAddress && lead.mailing_street.toLowerCase() !== lead.address_street?.toLowerCase() && (
                      <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200 px-1.5 py-0.5 rounded ml-1">Absentee</span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <p>{lead.mailing_street}</p>
                  <p>{[lead.mailing_city, lead.mailing_state, lead.mailing_zip].filter(Boolean).join(', ')}</p>
                </CardContent>
              </Card>
            )}

            {/* Roof */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Roof</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Type:</span>{' '}
                    {lead.roof_type === 'unknown' ? '-' : lead.roof_type.replace('_', ' ')}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Age:</span>{' '}
                    {lead.roof_age ? `${lead.roof_age} yrs` : '-'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Score:</span>{' '}
                    {lead.roof_score !== null ? `${lead.roof_score}/100` : '-'}
                  </div>
                  {lead.roof_material_notes && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Notes:</span>{' '}
                      {lead.roof_material_notes}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Storm Data (conditional) */}
            {(lead.hail_date || lead.hail_size_inches) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <CloudRain className="h-3.5 w-3.5" />
                    Storm Data
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {lead.hail_date && (
                      <div><span className="text-muted-foreground">Hail date:</span> {lead.hail_date}</div>
                    )}
                    {lead.hail_size_inches && (
                      <div><span className="text-muted-foreground">Hail size:</span> {lead.hail_size_inches}&quot;</div>
                    )}
                    {lead.storm_id && (
                      <div className="col-span-2"><span className="text-muted-foreground">Storm ID:</span> {lead.storm_id}</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Source */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Source</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>{(lead.lead_sources as { display_name: string } | undefined)?.display_name || 'Unknown'}</p>
                {lead.source_notes && (
                  <p className="text-muted-foreground mt-1">{lead.source_notes}</p>
                )}
                <p className="text-muted-foreground mt-2">
                  Created {format(new Date(lead.created_at), 'MMM d, yyyy')}
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="activity" className="space-y-4 mt-4">
          {/* Add activity form */}
          <Card>
            <CardContent className="pt-4">
              <form onSubmit={handleAddActivity} className="space-y-3">
                <div className="flex gap-2">
                  <Select value={activityType} onValueChange={(v) => v && setActivityType(v as ActivityType)}>
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTIVITY_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="submit" size="sm" disabled={activityLoading || !activityContent.trim()}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
                <Textarea
                  placeholder="Add a note, call summary, or update..."
                  value={activityContent}
                  onChange={(e) => setActivityContent(e.target.value)}
                  rows={2}
                />
              </form>
            </CardContent>
          </Card>

          {/* Activity feed */}
          <div className="space-y-1">
            {lead.lead_activities?.map((activity: LeadActivity) => {
              const Icon = ACTIVITY_ICONS[activity.activity_type] || MessageSquare;
              return (
                <div key={activity.id} className="flex gap-3 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{activity.content}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              );
            })}
            {(!lead.lead_activities || lead.lead_activities.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-8">No activity yet.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
