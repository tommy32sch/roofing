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
  DollarSign,
  UserCheck,
  CalendarClock,
  PhoneOff,
  Navigation,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';
import { formatPhone, mapsUrl } from '@/lib/utils/format';
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
import { Input } from '@/components/ui/input';
import { WonLeadModal } from '@/components/leads/WonLeadModal';
import { AppointmentModal } from '@/components/leads/AppointmentModal';
import { LEAD_STATUS_OPTIONS, LEAD_PRIORITY_OPTIONS, APPOINTMENT_TYPE_OPTIONS } from '@/types';
import type { LeadWithActivities, LeadActivity, ActivityType, UserRole, AdminUser, AppointmentType, LeadAppointment } from '@/types';
import { estimateRoofValue } from '@/lib/leads/roof-value';
import { EmptyState } from '@/components/layout/empty-state';

const SETTER_ALLOWED_STATUSES = new Set(['new', 'contacted', 'appointment_set', 'lost']);
const CLOSER_ALLOWED_STATUSES = new Set(['sold', 'lost']);

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
  const [userRole, setUserRole] = useState<UserRole>('admin');
  const [wonModalOpen, setWonModalOpen] = useState(false);
  const [apptModalOpen, setApptModalOpen] = useState(false);
  const [addApptOpen, setAddApptOpen] = useState(false);
  const [apptType, setApptType] = useState<AppointmentType>('inspection');
  const [apptDateTime, setApptDateTime] = useState('');
  const [apptNotes, setApptNotes] = useState('');
  const [apptSaving, setApptSaving] = useState(false);
  const [editingApptId, setEditingApptId] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [dealValueInput, setDealValueInput] = useState('');

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
        setDealValueInput(data.lead.deal_value != null ? String(data.lead.deal_value) : '');
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
    Promise.all([
      fetch('/api/admin/auth/me').then(r => r.json()),
      fetch('/api/admin/users').then(r => r.json()),
    ]).then(([me, usersData]) => {
      if (me.success) setUserRole(me.admin.role);
      if (usersData.success) setUsers(usersData.users);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function handleFollowUpChange(date: string) {
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ follow_up_date: date || null }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(date ? 'Follow-up date set' : 'Follow-up cleared');
        fetchLead();
      } else {
        toast.error(data.error || 'Failed to update follow-up date');
      }
    } catch {
      toast.error('Failed to update follow-up date');
    }
  }

  async function handleAssignment(field: 'assigned_setter_id' | 'assigned_closer_id', value: string | null) {
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Assignment updated');
        fetchLead();
      } else {
        toast.error(data.error || 'Failed to update assignment');
      }
    } catch {
      toast.error('Failed to update assignment');
    }
  }

  async function handleDealValueSave() {
    const parsed = dealValueInput.trim() === '' ? null : parseFloat(dealValueInput);
    if (dealValueInput.trim() !== '' && (isNaN(parsed!) || parsed! < 0)) {
      toast.error('Invalid deal value');
      return;
    }
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_value: parsed }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Deal value saved');
        fetchLead();
      } else {
        toast.error(data.error || 'Failed to save deal value');
      }
    } catch {
      toast.error('Failed to save deal value');
    }
  }

  async function handleStatusChange(newStatus: string | null) {
    if (!newStatus) return;
    // Closers and admins marking as sold must complete the demographic form first
    if (newStatus === 'sold' && (userRole === 'closer' || userRole === 'admin')) {
      setWonModalOpen(true);
      return;
    }
    // Setting an appointment requires a date/time — captured in a modal
    if (newStatus === 'appointment_set' && lead?.status !== 'appointment_set') {
      setApptModalOpen(true);
      return;
    }
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
      } else {
        toast.error(data.error || 'Failed to update status');
      }
    } catch {
      toast.error('Failed to update status');
    }
  }

  function openAddAppointment() {
    setEditingApptId(null);
    setApptType('inspection');
    setApptDateTime('');
    setApptNotes('');
    setAddApptOpen(true);
  }

  function openEditAppointment(appt: LeadAppointment) {
    setEditingApptId(appt.id);
    setApptType(appt.appointment_type);
    // datetime-local wants local wall time without zone suffix
    const d = new Date(appt.scheduled_at);
    const pad = (n: number) => String(n).padStart(2, '0');
    setApptDateTime(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
    setApptNotes(appt.notes ?? '');
    setAddApptOpen(true);
  }

  async function handleSaveAppointment() {
    if (!apptDateTime || Number.isNaN(new Date(apptDateTime).getTime())) return;
    setApptSaving(true);
    try {
      const url = editingApptId
        ? `/api/admin/leads/${leadId}/appointments/${editingApptId}`
        : `/api/admin/leads/${leadId}/appointments`;
      const res = await fetch(url, {
        method: editingApptId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editingApptId ? {} : { appointment_type: apptType }),
          scheduled_at: new Date(apptDateTime).toISOString(),
          notes: apptNotes.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(editingApptId ? 'Appointment updated' : 'Appointment added');
        setAddApptOpen(false);
        fetchLead();
      } else {
        toast.error(data.error || 'Failed to save appointment');
      }
    } catch {
      toast.error('Failed to save appointment');
    } finally {
      setApptSaving(false);
    }
  }

  async function handleDeleteAppointment(appt: LeadAppointment) {
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/appointments/${appt.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Appointment canceled');
        fetchLead();
      } else {
        toast.error(data.error || 'Failed to cancel appointment');
      }
    } catch {
      toast.error('Failed to cancel appointment');
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
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">
                {lead.first_name} {lead.last_name}
              </h1>
              {lead.is_dnc && (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                  <PhoneOff className="h-3 w-3" />
                  Do Not Call
                </span>
              )}
            </div>
            {fullAddress && (
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="h-3 w-3" />
                {fullAddress}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {userRole !== 'closer' && (
            <Link href={`/admin/leads/${leadId}/edit`}>
              <Button variant="outline" size="sm">
                <Edit2 className="h-4 w-4 mr-1" />
                Edit
              </Button>
            </Link>
          )}
          {userRole === 'admin' && (
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
          )}
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
              {LEAD_STATUS_OPTIONS.filter(opt =>
                userRole === 'admin' ? true :
                userRole === 'setter' ? SETTER_ALLOWED_STATUSES.has(opt.value) :
                CLOSER_ALLOWED_STATUSES.has(opt.value)
              ).map((opt) => (
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
        {userRole !== 'closer' && (
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Follow-up:</span>
            <Input
              type="date"
              value={lead.follow_up_date || ''}
              onChange={(e) => handleFollowUpChange(e.target.value)}
              className="h-8 w-[150px] text-sm"
            />
            {lead.follow_up_date && (
              <button
                onClick={() => handleFollowUpChange('')}
                className="text-xs text-muted-foreground hover:text-destructive"
                title="Clear follow-up"
              >
                ✕
              </button>
            )}
          </div>
        )}
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
                {lead.is_dnc && (
                  <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                    <PhoneOff className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      <span className="font-semibold">On the Do Not Call list.</span> The phone
                      number was not stored — knock this door instead of calling.
                    </span>
                  </div>
                )}
                {[lead.phone, lead.phone2, lead.phone3].map((p, i) =>
                  p ? (
                    <div key={`phone-${i}`} className="flex items-center justify-between gap-2">
                      <a href={`tel:${p}`} className="flex items-center gap-2 text-sm hover:text-primary min-w-0">
                        <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="tabular-nums truncate">{formatPhone(p)}</span>
                        {i > 0 && <span className="text-xs text-muted-foreground shrink-0">({i + 1})</span>}
                      </a>
                      <span className="flex gap-1 shrink-0">
                        <a
                          href={`tel:${p}`}
                          className="inline-flex h-7 items-center rounded-md border px-2 text-xs hover:bg-accent"
                        >
                          Call
                        </a>
                        <a
                          href={`sms:${p}`}
                          className="inline-flex h-7 items-center rounded-md border px-2 text-xs hover:bg-accent"
                        >
                          Text
                        </a>
                      </span>
                    </div>
                  ) : null
                )}
                {[lead.email, lead.email2].map((e, i) =>
                  e ? (
                    <a
                      key={`email-${i}`}
                      href={`mailto:${e}`}
                      className="flex items-center gap-2 text-sm hover:text-primary min-w-0"
                    >
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate">{e}</span>
                      {i > 0 && <span className="text-xs text-muted-foreground shrink-0">(2)</span>}
                    </a>
                  ) : null
                )}
                {!lead.phone && !lead.email && !lead.is_dnc && (
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
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex items-start gap-2 min-w-0">
                      <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <span>{fullAddress}</span>
                    </span>
                    {mapsUrl(lead) && (
                      <a
                        href={mapsUrl(lead)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-7 shrink-0 items-center rounded-md border px-2 text-xs hover:bg-accent"
                      >
                        <Navigation className="h-3 w-3 mr-1" />
                        Directions
                      </a>
                    )}
                  </div>
                )}
                {lead.home_value && (
                  <div className="flex items-center gap-2">
                    <Home className="h-4 w-4 text-muted-foreground" />
                    Est. ${Number(lead.home_value).toLocaleString()}
                  </div>
                )}
                {lead.assessed_value && (
                  <div className="flex items-center gap-2">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    Assessed ${Number(lead.assessed_value).toLocaleString()}
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
                  {lead.sqft && <div><span className="text-muted-foreground">Sqft:</span> {Number(lead.sqft).toLocaleString()}</div>}
                  {lead.lot_size && <div><span className="text-muted-foreground">Lot:</span> {lead.lot_size} sqft</div>}
                  {lead.bedrooms && <div><span className="text-muted-foreground">Beds:</span> {lead.bedrooms}</div>}
                  {lead.bathrooms && <div><span className="text-muted-foreground">Baths:</span> {lead.bathrooms}</div>}
                  {lead.stories && <div><span className="text-muted-foreground">Stories:</span> {lead.stories}</div>}
                  {lead.owner_type && <div><span className="text-muted-foreground">Type:</span> {lead.owner_type}</div>}
                  {lead.apn && <div className="col-span-2"><span className="text-muted-foreground">APN:</span> {lead.apn}</div>}
                  {lead.last_sale_date && <div><span className="text-muted-foreground">Last sold:</span> {lead.last_sale_date}</div>}
                  {lead.last_sale_price && <div><span className="text-muted-foreground">Sale price:</span> ${Number(lead.last_sale_price).toLocaleString()}</div>}
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
                    {!lead.roof_type || lead.roof_type === 'unknown' ? '-' : lead.roof_type.replace('_', ' ')}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Age:</span>{' '}
                    {lead.roof_age ? `${lead.roof_age} yrs` : '-'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Score:</span>{' '}
                    {lead.roof_score !== null ? `${lead.roof_score}/100` : '-'}
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Est. value:</span>{' '}
                    {lead.estimated_roof_value != null ? (
                      <>
                        <span className="font-medium">${Number(lead.estimated_roof_value).toLocaleString()}</span>
                        {(() => {
                          const est = estimateRoofValue({ sqft: lead.sqft, stories: lead.stories, roof_type: lead.roof_type });
                          return est ? (
                            <span className="text-muted-foreground"> (~{est.squares} squares)</span>
                          ) : null;
                        })()}
                      </>
                    ) : (
                      '-'
                    )}
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

            {/* Appointments */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <CalendarClock className="h-3.5 w-3.5" />
                    Appointments
                  </CardTitle>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={openAddAppointment}>
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!lead.lead_appointments || lead.lead_appointments.length === 0 ? (
                  <EmptyState
                    icon={CalendarClock}
                    title="No appointments scheduled"
                    description="Add one here, or set this lead's status to Appointment Set."
                    className="py-8"
                  />
                ) : (
                  <div className="space-y-2">
                    {lead.lead_appointments.map((appt) => {
                      const when = new Date(appt.scheduled_at);
                      const past = when.getTime() < Date.now();
                      return (
                        <div
                          key={appt.id}
                          className={`flex items-start justify-between gap-2 rounded-md border p-2 text-sm ${past ? 'opacity-60' : ''}`}
                        >
                          <div className="min-w-0">
                            <p className="font-medium">
                              {format(when, 'EEE, MMM d · h:mm a')}
                              <span className="ml-2 text-xs font-normal text-muted-foreground capitalize">
                                {appt.appointment_type}
                              </span>
                            </p>
                            {appt.notes && (
                              <p className="text-xs text-muted-foreground mt-0.5">{appt.notes}</p>
                            )}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => openEditAppointment(appt)}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive"
                              onClick={() => handleDeleteAppointment(appt)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
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

            {/* Assignment & Deal Value */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <UserCheck className="h-3.5 w-3.5" />
                  Assignment &amp; Deal
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Setter</p>
                  {userRole === 'admin' ? (
                    <Select
                      value={lead.assigned_setter_id || 'none'}
                      onValueChange={(v) => handleAssignment('assigned_setter_id', v === 'none' ? null : v)}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {users.filter(u => u.role === 'setter' || u.role === 'admin').map(u => (
                          <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p>{users.find(u => u.id === lead.assigned_setter_id)?.name || <span className="text-muted-foreground">Unassigned</span>}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Closer</p>
                  {userRole === 'admin' ? (
                    <Select
                      value={lead.assigned_closer_id || 'none'}
                      onValueChange={(v) => handleAssignment('assigned_closer_id', v === 'none' ? null : v)}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {users.filter(u => u.role === 'closer' || u.role === 'admin').map(u => (
                          <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p>{users.find(u => u.id === lead.assigned_closer_id)?.name || <span className="text-muted-foreground">Unassigned</span>}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <DollarSign className="h-3 w-3" />
                    Deal Value
                  </p>
                  {userRole === 'admin' || userRole === 'closer' ? (
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min="0"
                        step="100"
                        placeholder="0.00"
                        value={dealValueInput}
                        onChange={(e) => setDealValueInput(e.target.value)}
                        onBlur={handleDealValueSave}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleDealValueSave(); }}
                        className="h-8"
                      />
                    </div>
                  ) : (
                    <p>
                      {lead.deal_value != null
                        ? `$${Number(lead.deal_value).toLocaleString()}`
                        : <span className="text-muted-foreground">Not set</span>}
                    </p>
                  )}
                </div>
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
              <EmptyState
                icon={MessageSquare}
                title="No activity yet"
                description="Log a call, note or visit above and it will show up here."
                className="py-8"
              />
            )}
          </div>
        </TabsContent>
      </Tabs>
      <WonLeadModal
        leadId={leadId}
        open={wonModalOpen}
        onOpenChange={setWonModalOpen}
        onSuccess={() => { toast.success('Lead marked as won!'); fetchLead(); }}
      />
      <AppointmentModal
        leadId={leadId}
        open={apptModalOpen}
        onOpenChange={setApptModalOpen}
        onSuccess={() => { toast.success('Appointment set!'); fetchLead(); }}
      />
      {/* Add / edit appointment from the Appointments card */}
      <Dialog open={addApptOpen} onOpenChange={setAddApptOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingApptId ? 'Edit Appointment' : 'Add Appointment'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editingApptId && (
              <div className="space-y-1">
                <label className="text-sm font-medium">Type</label>
                <Select value={apptType} onValueChange={(v) => v && setApptType(v as AppointmentType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APPOINTMENT_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor="card_appt_datetime" className="text-sm font-medium">
                Date &amp; Time<span className="text-destructive ml-0.5">*</span>
              </label>
              <Input
                id="card_appt_datetime"
                type="datetime-local"
                value={apptDateTime}
                onChange={(e) => setApptDateTime(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="card_appt_notes" className="text-sm font-medium">Notes</label>
              <Textarea
                id="card_appt_notes"
                rows={3}
                value={apptNotes}
                onChange={(e) => setApptNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddApptOpen(false)} disabled={apptSaving}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveAppointment}
              disabled={apptSaving || !apptDateTime || Number.isNaN(new Date(apptDateTime).getTime())}
            >
              {apptSaving ? 'Saving...' : editingApptId ? 'Save Changes' : 'Add Appointment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
