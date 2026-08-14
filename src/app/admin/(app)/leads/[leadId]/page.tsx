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
  DoorOpen,
  Copy,
  Ban,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';
import { formatPhone, mapsUrl } from '@/lib/utils/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
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
import type { AppointmentOutcome, LeadWithActivities, LeadActivity, ActivityType, AdminUser, AppointmentType, LeadAppointment } from '@/types';
import { estimateRoofValue } from '@/lib/leads/roof-value';
import { EmptyState } from '@/components/layout/empty-state';
import { LeadPhotos } from '@/components/leads/LeadPhotos';
import { DateTimeFields } from '@/components/leads/DateTimeFields';
import { useMarkets } from '@/components/markets/use-markets';
import { FollowUpMenu } from '@/components/leads/FollowUpMenu';
import { AppointmentConflictWarning } from '@/components/leads/AppointmentConflictWarning';
import type { AppointmentConflict } from '@/lib/leads/appointment-conflicts';
import { isMachineAttribution } from '@/lib/leads/attribution';
import { knockLabel } from '@/lib/leads/knocks';
import { callLabel } from '@/lib/leads/calls';
import { useAppShell } from '@/components/providers/app-shell-provider';
import { DataErrorState } from '@/components/layout/data-error-state';
import { AppointmentOutcomeActions, type RecordableAppointmentOutcome } from '@/components/leads/AppointmentOutcomeActions';
import { appointmentOutcomeLabel, canRecordAppointmentOutcome } from '@/lib/leads/appointment-outcomes';
import { saveAppointmentOutcome } from '@/lib/leads/appointment-outcome-client';
import { cn } from '@/lib/utils';

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

function WorkSectionHeading({
  index,
  title,
  description,
  actions,
  id,
}: {
  index: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/80 pb-3">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {index}
        </p>
        <h2 id={id} className="mt-1 text-lg font-semibold tracking-[-0.02em]">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

function RailHeading({
  icon: Icon,
  children,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </h2>
  );
}

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

export default function LeadDetailPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { user } = useAppShell();
  const { leadId } = use(params);
  const router = useRouter();
  const [lead, setLead] = useState<LeadWithActivities | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteAppointmentTarget, setDeleteAppointmentTarget] = useState<LeadAppointment | null>(null);
  const [appointmentOutcomePending, setAppointmentOutcomePending] = useState<Record<string, AppointmentOutcome | undefined>>({});
  const userRole = user.role;
  const [wonModalOpen, setWonModalOpen] = useState(false);
  const [apptModalOpen, setApptModalOpen] = useState(false);
  const { markets } = useMarkets();
  const [addApptOpen, setAddApptOpen] = useState(false);
  const [apptType, setApptType] = useState<AppointmentType>('inspection');
  const [apptDateTime, setApptDateTime] = useState('');
  const [apptNotes, setApptNotes] = useState('');
  const [apptSaving, setApptSaving] = useState(false);
  const [apptConflicts, setApptConflicts] = useState<AppointmentConflict[]>([]);
  // Set once the server has refused for a clash, so the next press means
  // "I've seen the warning, book it anyway" rather than silently overriding.
  const [apptOverride, setApptOverride] = useState(false);
  const [editingApptId, setEditingApptId] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [apptCloserId, setApptCloserId] = useState('');
  const [dealValueInput, setDealValueInput] = useState('');

  // Activity form
  const [activityType, setActivityType] = useState<ActivityType>('note');
  const [activityContent, setActivityContent] = useState('');
  const [activityLoading, setActivityLoading] = useState(false);

  async function fetchLead() {
    setLoadError('');
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`);
      const data = await res.json().catch(() => null);
      if (res.status === 404) {
        toast.error('Lead not found');
        router.push('/admin/leads');
        return;
      }
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Could not load this lead');
      }
      setLead(data.lead);
      setDealValueInput(data.lead.deal_value != null ? String(data.lead.deal_value) : '');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not load this lead';
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLead();
    fetch(userRole === 'admin' ? '/api/admin/users' : '/api/admin/team')
      .then((response) => response.json())
      .then((payload) => {
        if (!payload.success) return;
        setUsers(userRole === 'admin' ? payload.users : payload.members);
      })
      .catch(() => {});
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
    setApptConflicts([]);
    setApptOverride(false);
    setEditingApptId(null);
    setApptType('inspection');
    setApptDateTime('');
    setApptNotes('');
    setApptCloserId(lead?.assigned_closer_id || '');
    setAddApptOpen(true);
  }

  function openEditAppointment(appt: LeadAppointment) {
    setApptConflicts([]);
    setApptOverride(false);
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
          assigned_closer_id: apptCloserId || undefined,
          allow_conflict: apptOverride,
        }),
      });
      const data = await res.json();
      // 409: the slot is taken. Show what it clashes with and let the next
      // press through — legitimate double-booking exists (two crews), so this
      // warns rather than blocks.
      if (res.status === 409 && data.error === 'appointment_conflict') {
        setApptConflicts(data.conflicts ?? []);
        setApptOverride(true);
        toast.error('That time is already booked — save again to book it anyway');
        return;
      }
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

  /**
   * Permanent deletion is confirmed because it destroys the booking and any
   * recorded result. Normal cancellation is an outcome and must use PATCH.
   *
   * The rule this follows: confirm when the action destroys work that cannot be
   * recreated from what is on screen. Not "is it a delete" — removing an
   * offline download is a delete and needs no dialog, because it re-downloads.
   */
  async function handleDeleteAppointment(appt: LeadAppointment) {
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/appointments/${appt.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Appointment deleted permanently');
        setDeleteAppointmentTarget(null);
        fetchLead();
      } else {
        toast.error(data.error || 'Failed to delete appointment');
      }
    } catch {
      toast.error('Failed to delete appointment');
    }
  }

  async function handleAppointmentOutcome(
    appointment: LeadAppointment,
    outcome: RecordableAppointmentOutcome
  ) {
    setAppointmentOutcomePending((current) => ({ ...current, [appointment.id]: outcome }));
    try {
      await saveAppointmentOutcome({ leadId, appointmentId: appointment.id, outcome });
      toast.success(`Appointment marked ${appointmentOutcomeLabel(outcome).toLowerCase()}`);
      await fetchLead();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not record the appointment result');
    } finally {
      setAppointmentOutcomePending((current) => ({ ...current, [appointment.id]: undefined }));
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
      <div className="space-y-5 pb-8">
        <div className="border-b border-border/80 pb-5">
          <Skeleton className="h-11 w-28" />
          <Skeleton className="mt-5 h-9 w-64" />
          <Skeleton className="mt-3 h-4 w-full max-w-md" />
          <div className="mt-5 flex flex-wrap gap-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-11 w-28" />)}
          </div>
        </div>
        <div className="grid gap-px border-y border-border bg-border sm:grid-cols-2 xl:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-background px-4 py-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-11 w-full" />
            </div>
          ))}
        </div>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-8">
            {[...Array(2)].map((_, i) => (
              <div key={i}>
                <Skeleton className="h-6 w-40" />
                <div className="mt-3 divide-y border-y border-border">
                  {[...Array(3)].map((__, row) => (
                    <div key={row} className="flex gap-4 py-5">
                      <Skeleton className="h-11 w-11 shrink-0" />
                      <div className="w-full space-y-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-6 border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="border-b border-border pb-6">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-4 h-24 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!lead && loadError) {
    return (
      <DataErrorState
        title="Lead did not load"
        description={loadError}
        onRetry={() => {
          setLoading(true);
          void fetchLead();
        }}
      />
    );
  }

  if (!lead) return null;

  // The upload this lead arrived in, when it came from a file. Embedded by the
  // detail route so the source section can name the list.
  const importBatch =
    (lead.lead_import_batches as { filename?: string; uploaded_by_name?: string } | null) ?? null;

  const fullAddress = [lead.address_street, lead.address_city, lead.address_state, lead.address_zip]
    .filter(Boolean)
    .join(', ');
  const primaryPhone = lead.phone || lead.phone2 || lead.phone3;
  const primaryEmail = lead.email || lead.email2;
  const directionsUrl = mapsUrl(lead);
  const isAbsentee = Boolean(
    lead.mailing_street
      && fullAddress
      && lead.mailing_street.toLowerCase() !== lead.address_street?.toLowerCase()
  );
  const calculatedRoofEstimate = estimateRoofValue({
    sqft: lead.sqft,
    stories: lead.stories,
    roof_type: lead.roof_type,
  });

  const contactHistory = [
    ...(lead.lead_knocks ?? []).map((knock) => ({
      key: `knock-${knock.id}`,
      channel: 'knock' as const,
      label: knockLabel(knock.disposition),
      occurredAt: knock.knocked_at,
      notes: knock.notes,
      accountName: knock.admin_users?.name ?? null,
    })),
    ...(lead.lead_calls ?? []).map((call) => ({
      key: `call-${call.id}`,
      channel: 'cold_call' as const,
      label: callLabel(call.disposition),
      occurredAt: call.called_at,
      notes: call.notes,
      accountName: call.admin_users?.name ?? null,
    })),
  ].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

  const timelineEvents = [
    ...contactHistory.map((event) => ({
      kind: 'contact' as const,
      key: event.key,
      occurredAt: event.occurredAt,
      event,
    })),
    ...(lead.lead_activities ?? []).map((activity) => ({
      kind: 'activity' as const,
      key: `activity-${activity.id}`,
      occurredAt: activity.created_at,
      activity,
    })),
  ].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

  return (
    <div className="space-y-5 pb-8">
      <header className="border-b border-border/80 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/admin/leads"
            className={cn(buttonVariants({ variant: 'ghost' }), 'h-11 px-2 text-muted-foreground')}
          >
            <ArrowLeft />
            Lead queue
          </Link>
          <div className="flex items-center gap-2">
            {userRole !== 'closer' && (
              <Link
                href={`/admin/leads/${leadId}/edit`}
                className={cn(buttonVariants({ variant: 'outline' }), 'h-11 px-3')}
              >
                <Edit2 />
                Edit record
              </Link>
            )}
            {userRole === 'admin' && (
              <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogTrigger
                  aria-label={`Delete ${lead.first_name} ${lead.last_name}`}
                  className={cn(buttonVariants({ variant: 'destructive', size: 'icon' }), 'h-11 w-11')}
                >
                  <Trash2 />
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

        <div className="mt-5 max-w-4xl">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
            Homeowner record
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-4xl">
              {lead.first_name} {lead.last_name}
            </h1>
            <span className="border-l border-border pl-3 text-sm font-medium capitalize text-muted-foreground">
              {LEAD_STATUS_OPTIONS.find((option) => option.value === lead.status)?.label ?? lead.status}
            </span>
          </div>
          {fullAddress && (
            <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{fullAddress}</span>
            </p>
          )}
        </div>

        {(lead.is_dnc || lead.do_not_knock || lead.is_flagged_duplicate) && (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Lead restrictions and warnings">
            {lead.is_dnc && (
              <span className="inline-flex min-h-8 items-center gap-1.5 border border-destructive/30 bg-destructive/10 px-2.5 text-xs font-semibold text-destructive">
                <PhoneOff className="h-3.5 w-3.5" />
                Do Not Call
              </span>
            )}
            {lead.do_not_knock && (
              <span className="inline-flex min-h-8 items-center gap-1.5 border border-destructive/30 bg-destructive/10 px-2.5 text-xs font-semibold text-destructive">
                <Ban className="h-3.5 w-3.5" />
                Do Not Knock
              </span>
            )}
            {lead.is_flagged_duplicate && (
              <span className="inline-flex min-h-8 items-center gap-1.5 border border-amber-500/30 bg-amber-500/10 px-2.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                <Copy className="h-3.5 w-3.5" />
                Flagged duplicate
              </span>
            )}
          </div>
        )}

        <nav
          aria-label="Lead record actions"
          className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center"
        >
          {primaryPhone && !lead.is_dnc && (
            <>
              <a
                href={`tel:${primaryPhone}`}
                className={cn(buttonVariants(), 'h-11 px-4')}
              >
                <Phone />
                Call
              </a>
              <a
                href={`sms:${primaryPhone}`}
                className={cn(buttonVariants({ variant: 'outline' }), 'h-11 px-4')}
              >
                <MessageSquare />
                Text
              </a>
            </>
          )}
          {directionsUrl && (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: 'outline' }), 'h-11 px-4')}
            >
              <Navigation />
              Directions
            </a>
          )}
          {primaryEmail && (
            <a
              href={`mailto:${primaryEmail}`}
              className={cn(buttonVariants({ variant: 'outline' }), 'h-11 px-4')}
            >
              <Mail />
              Email
            </a>
          )}
          <Button type="button" variant="outline" className="h-11 px-4" onClick={openAddAppointment}>
            <CalendarClock />
            Schedule
          </Button>
        </nav>

        {lead.is_dnc && (
          <p className="mt-3 border-l-2 border-destructive/60 pl-3 text-xs text-muted-foreground">
            Do not call this lead. Door knocking is still allowed unless the property is also marked Do Not Knock.
          </p>
        )}
      </header>

      <section
        aria-label="Lead record controls"
        className={cn(
          'grid gap-px border-y border-border bg-border sm:grid-cols-2',
          userRole !== 'closer' && 'xl:grid-cols-3'
        )}
      >
        <div className="bg-background px-4 py-4">
          <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Status
          </label>
          <Select
            value={lead.status}
            onValueChange={handleStatusChange}
            disabled={userRole === 'setter' && lead.status === 'sold'}
          >
            <SelectTrigger className="mt-2 h-11 w-full rounded-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_STATUS_OPTIONS.filter((option) =>
                userRole === 'admin'
                  ? true
                  : userRole === 'setter'
                    ? SETTER_ALLOWED_STATUSES.has(option.value)
                    : CLOSER_ALLOWED_STATUSES.has(option.value)
              ).map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="bg-background px-4 py-4">
          <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Priority
          </label>
          <Select value={lead.priority} onValueChange={handlePriorityChange}>
            <SelectTrigger className="mt-2 h-11 w-full rounded-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_PRIORITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {userRole !== 'closer' && (
          <div className="bg-background px-4 py-4">
            <label
              htmlFor="follow_up_date"
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
            >
              Follow-up
            </label>
            <div className="mt-2 flex gap-2 [&_[data-slot=button]]:h-11">
              <Input
                id="follow_up_date"
                type="date"
                value={lead.follow_up_date || ''}
                onChange={(event) => handleFollowUpChange(event.target.value)}
                className="h-11 min-w-0 flex-1 text-sm"
              />
              <FollowUpMenu
                leadId={leadId}
                followUpDate={lead.follow_up_date}
                onChange={fetchLead}
                compact
              />
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-8 pt-2 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-10">
        <main className="min-w-0 space-y-10">
          <section aria-labelledby="appointments-heading">
            <WorkSectionHeading
              index="01 / Schedule"
              title="Appointments"
              description="Upcoming work and recorded results for this homeowner."
              id="appointments-heading"
              actions={(
                <Button variant="outline" className="h-11 px-3" onClick={openAddAppointment}>
                  <Plus />
                  Add appointment
                </Button>
              )}
            />

            {!lead.lead_appointments || lead.lead_appointments.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="No appointments scheduled"
                description="Add one here, or set this lead's status to Appointment Set."
                className="border-b border-border py-10"
              />
            ) : (
              <div className="divide-y divide-border border-b border-border">
                {lead.lead_appointments.map((appt) => {
                  const when = new Date(appt.scheduled_at);
                  const past = when.getTime() < Date.now();
                  const outcome = appt.outcome ?? 'scheduled';
                  const canRecordResult = canRecordAppointmentOutcome({
                    role: user.role,
                    userId: user.id,
                    leadAssignedSetterId: lead.assigned_setter_id ?? null,
                    leadAssignedCloserId: lead.assigned_closer_id ?? null,
                    existingOutcomeBy: appt.outcome_by ?? null,
                  });
                  const pendingOutcome = appointmentOutcomePending[appt.id] ?? null;

                  return (
                    <article
                      key={appt.id}
                      className="grid gap-4 py-5 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] sm:items-start"
                    >
                      <div>
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          <time dateTime={appt.scheduled_at}>{format(when, 'EEE · MMM d')}</time>
                        </p>
                        <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
                          {format(when, 'h:mm a')}
                        </p>
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold capitalize">{appt.appointment_type}</p>
                          {outcome !== 'scheduled' && (
                            <span className={cn(
                              'inline-flex border px-2 py-0.5 text-xs font-medium',
                              outcome === 'completed'
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : outcome === 'no_show'
                                  ? 'border-destructive/25 bg-destructive/10 text-destructive'
                                  : 'border-border bg-muted text-muted-foreground'
                            )}>
                              {appointmentOutcomeLabel(outcome)}
                            </span>
                          )}
                        </div>
                        {appt.notes ? (
                          <p className="mt-1 text-sm text-muted-foreground">{appt.notes}</p>
                        ) : (
                          <p className="mt-1 text-sm text-muted-foreground/70">No appointment notes</p>
                        )}
                      </div>

                      <div className="flex gap-2 sm:justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 border border-border"
                          aria-label="Edit appointment"
                          onClick={() => openEditAppointment(appt)}
                        >
                          <Edit2 />
                        </Button>
                        {user.role === 'admin' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 border border-border text-destructive"
                            aria-label="Delete appointment permanently"
                            onClick={() => setDeleteAppointmentTarget(appt)}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>

                      <div className="sm:col-span-2 sm:col-start-2">
                        {outcome === 'scheduled' && past && canRecordResult && (
                          <AppointmentOutcomeActions
                            label={`${format(when, 'MMM d at h:mm a')} appointment`}
                            pending={pendingOutcome}
                            onSelect={(nextOutcome) => handleAppointmentOutcome(appt, nextOutcome)}
                          />
                        )}
                        {outcome === 'scheduled' && past && !canRecordResult && (
                          <p className="border-l-2 border-border pl-3 text-xs text-muted-foreground">
                            Awaiting result from the appointment owner.
                          </p>
                        )}
                        {outcome === 'scheduled' && !past && canRecordResult && (
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-11 px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-destructive"
                            disabled={pendingOutcome !== null}
                            onClick={() => handleAppointmentOutcome(appt, 'cancelled')}
                          >
                            {pendingOutcome === 'cancelled' ? 'Saving cancellation…' : 'Mark appointment cancelled'}
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="activity-timeline-heading">
            <WorkSectionHeading
              index="02 / History"
              title="Activity timeline"
              description="Calls, knocks, notes, visits, email, and record changes in one sequence."
              id="activity-timeline-heading"
            />

            <form onSubmit={handleAddActivity} className="grid gap-2 border-b border-border py-4 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-start">
              <Select value={activityType} onValueChange={(value) => value && setActivityType(value as ActivityType)}>
                <SelectTrigger className="h-11 w-full rounded-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                aria-label="Activity details"
                placeholder="Add a note, call summary, or update..."
                value={activityContent}
                onChange={(event) => setActivityContent(event.target.value)}
                rows={2}
                className="min-h-11"
              />
              <Button type="submit" className="h-11 px-4" disabled={activityLoading || !activityContent.trim()}>
                <Plus />
                {activityLoading ? 'Adding…' : 'Add update'}
              </Button>
            </form>

            <div className="grid divide-y divide-border border-b border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div className="px-1 py-4 sm:pr-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <DoorOpen className="h-3.5 w-3.5" />
                    Door knocks
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">{lead.knock_count.toLocaleString()}</p>
                </div>
                {lead.lead_knocks?.[0] ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Last: {knockLabel(lead.lead_knocks[0].disposition)} ·{' '}
                    {formatDistanceToNow(new Date(lead.lead_knocks[0].knocked_at), { addSuffix: true })}
                    {lead.lead_knocks[0].admin_users?.name ? ` · ${lead.lead_knocks[0].admin_users.name}` : ''}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No knocks recorded</p>
                )}
              </div>
              <div className="px-1 py-4 sm:pl-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <PhoneCall className="h-3.5 w-3.5" />
                    Cold calls
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">{lead.call_count.toLocaleString()}</p>
                </div>
                {lead.lead_calls?.[0] ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Last: {callLabel(lead.lead_calls[0].disposition)} ·{' '}
                    {formatDistanceToNow(new Date(lead.lead_calls[0].called_at), { addSuffix: true })}
                    {lead.lead_calls[0].admin_users?.name ? ` · ${lead.lead_calls[0].admin_users.name}` : ''}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No cold calls recorded</p>
                )}
              </div>
            </div>

            <p className="mt-5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Full History
            </p>
            {timelineEvents.length > 0 ? (
              <div className="mt-2 divide-y divide-border border-y border-border">
                {timelineEvents.map((entry) => {
                  if (entry.kind === 'contact') {
                    const event = entry.event;
                    const Icon = event.channel === 'knock' ? DoorOpen : PhoneCall;
                    return (
                      <article key={entry.key} className="grid gap-3 py-4 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:items-start">
                        <div className="flex h-9 w-9 items-center justify-center border border-border bg-muted/50">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {event.channel === 'knock' ? 'Door knock' : 'Cold call'} · {event.label}
                          </p>
                          {event.notes && <p className="mt-1 text-sm text-muted-foreground">{event.notes}</p>}
                          {event.accountName && (
                            <p className="mt-1 text-xs text-muted-foreground">Recorded by {event.accountName}</p>
                          )}
                        </div>
                        <time dateTime={event.occurredAt} className="text-xs text-muted-foreground sm:text-right">
                          {format(new Date(event.occurredAt), 'MMM d, yyyy · h:mm a')}
                        </time>
                      </article>
                    );
                  }

                  const activity: LeadActivity = entry.activity;
                  const Icon = ACTIVITY_ICONS[activity.activity_type] || MessageSquare;
                  return (
                    <article key={entry.key} className="grid gap-3 py-4 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:items-start">
                      <div className="flex h-9 w-9 items-center justify-center border border-border bg-muted/50">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm">{activity.content || 'Activity recorded'}</p>
                        <p className="mt-1 text-xs capitalize text-muted-foreground">
                          {activity.activity_type.replace('_', ' ')}
                        </p>
                      </div>
                      <time dateTime={activity.created_at} className="text-xs text-muted-foreground sm:text-right">
                        {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                      </time>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={MessageSquare}
                title="No activity yet"
                description="Log a call, note or visit above and it will show up here."
                className="border-y border-border py-10"
              />
            )}
          </section>
        </main>

        <aside className="min-w-0 border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <section className="border-b border-border pb-6">
            <RailHeading icon={Phone}>Contact details</RailHeading>
            <div className="mt-3 space-y-3">
              {lead.is_dnc && (
                <p className="border-l-2 border-destructive/60 pl-3 text-xs text-destructive">
                  Phone actions are blocked for this record.
                </p>
              )}
              {[lead.phone, lead.phone2, lead.phone3].map((phone, index) =>
                phone && !lead.is_dnc ? (
                  <div key={`phone-${index}`} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                    <p className="font-mono text-sm tabular-nums">{formatPhone(phone)}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <a href={`tel:${phone}`} className={cn(buttonVariants({ variant: 'outline' }), 'h-11')}>
                        <Phone />
                        Call{index > 0 ? ` ${index + 1}` : ''}
                      </a>
                      <a href={`sms:${phone}`} className={cn(buttonVariants({ variant: 'outline' }), 'h-11')}>
                        <MessageSquare />
                        Text{index > 0 ? ` ${index + 1}` : ''}
                      </a>
                    </div>
                  </div>
                ) : null
              )}
              {[lead.email, lead.email2].map((email, index) =>
                email ? (
                  <a
                    key={`email-${index}`}
                    href={`mailto:${email}`}
                    className="flex min-h-11 items-center gap-2 border-t border-border pt-3 text-sm hover:text-primary"
                  >
                    <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 break-all">{email}</span>
                  </a>
                ) : null
              )}
              {!primaryPhone && !primaryEmail && !lead.is_dnc && (
                <p className="text-sm text-muted-foreground">No contact info</p>
              )}
            </div>
          </section>

          <section className="border-b border-border py-6">
            <RailHeading icon={UserCheck}>Ownership and deal</RailHeading>
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">Setter</p>
                {userRole === 'admin' ? (
                  <Select
                    value={lead.assigned_setter_id || 'none'}
                    onValueChange={(value) => handleAssignment('assigned_setter_id', value === 'none' ? null : value)}
                  >
                    <SelectTrigger className="mt-1.5 h-11 w-full rounded-md">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {users.filter((member) => member.role === 'setter' || member.role === 'admin').map((member) => (
                        <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="mt-1 text-sm font-medium">
                    {users.find((member) => member.id === lead.assigned_setter_id)?.name
                      || <span className="text-muted-foreground">Unassigned</span>}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Closer</p>
                {userRole === 'admin' ? (
                  <Select
                    value={lead.assigned_closer_id || 'none'}
                    onValueChange={(value) => handleAssignment('assigned_closer_id', value === 'none' ? null : value)}
                  >
                    <SelectTrigger className="mt-1.5 h-11 w-full rounded-md">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {users.filter((member) => member.role === 'closer' || member.role === 'admin').map((member) => (
                        <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="mt-1 text-sm font-medium">
                    {users.find((member) => member.id === lead.assigned_closer_id)?.name
                      || <span className="text-muted-foreground">Unassigned</span>}
                  </p>
                )}
              </div>
              <div>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <DollarSign className="h-3 w-3" />
                  Deal value
                </p>
                {userRole === 'admin' || userRole === 'closer' ? (
                  <Input
                    aria-label="Deal value"
                    type="number"
                    min="0"
                    step="100"
                    placeholder="0.00"
                    value={dealValueInput}
                    onChange={(event) => setDealValueInput(event.target.value)}
                    onBlur={handleDealValueSave}
                    onKeyDown={(event) => { if (event.key === 'Enter') handleDealValueSave(); }}
                    className="mt-1.5 h-11"
                  />
                ) : (
                  <p className="mt-1 text-sm font-medium">
                    {lead.deal_value != null
                      ? `$${Number(lead.deal_value).toLocaleString()}`
                      : <span className="text-muted-foreground">Not set</span>}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="border-b border-border py-6">
            <RailHeading icon={Home}>Property</RailHeading>
            {fullAddress && (
              <div className="mt-4">
                <p className="text-sm leading-6">{fullAddress}</p>
                {directionsUrl && (
                  <a
                    href={directionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ variant: 'outline' }), 'mt-3 h-11 w-full')}
                  >
                    <Navigation />
                    Get directions
                  </a>
                )}
              </div>
            )}
            <dl className="mt-3 divide-y divide-border">
              {lead.home_value && <FactRow label="Est. home value">${Number(lead.home_value).toLocaleString()}</FactRow>}
              {lead.assessed_value && <FactRow label="Assessed">${Number(lead.assessed_value).toLocaleString()}</FactRow>}
              {lead.year_built && <FactRow label="Built">{lead.year_built}</FactRow>}
              {lead.sqft && <FactRow label="Living area">{Number(lead.sqft).toLocaleString()} sqft</FactRow>}
              {lead.lot_size && <FactRow label="Lot">{Number(lead.lot_size).toLocaleString()} sqft</FactRow>}
              {lead.bedrooms && <FactRow label="Beds">{lead.bedrooms}</FactRow>}
              {lead.bathrooms && <FactRow label="Baths">{lead.bathrooms}</FactRow>}
              {lead.stories && <FactRow label="Stories">{lead.stories}</FactRow>}
              {lead.owner_type && <FactRow label="Owner type">{lead.owner_type}</FactRow>}
              {markets.length > 1 && (
                <FactRow label="Market">{markets.find((market) => market.id === lead.market_id)?.name ?? 'Unassigned'}</FactRow>
              )}
              {lead.apn && <FactRow label="APN"><span className="break-all font-mono text-xs">{lead.apn}</span></FactRow>}
              {lead.last_sale_date && <FactRow label="Last sold">{lead.last_sale_date}</FactRow>}
              {lead.last_sale_price && <FactRow label="Sale price">${Number(lead.last_sale_price).toLocaleString()}</FactRow>}
            </dl>
          </section>

          <section className="border-b border-border py-6">
            <RailHeading icon={Building}>Roof</RailHeading>
            {!lead.roof_type && !lead.roof_age && lead.roof_score === null && lead.estimated_roof_value == null ? (
              <EmptyState
                icon={Home}
                title="No roof details yet"
                description="Roof type, age and estimated value fill in from enrichment or when you edit the lead."
                className="py-6"
              />
            ) : (
              <dl className="mt-3 divide-y divide-border">
                <FactRow label="Type">
                  {!lead.roof_type || lead.roof_type === 'unknown' ? '-' : lead.roof_type.replace('_', ' ')}
                </FactRow>
                <FactRow label="Age">{lead.roof_age ? `${lead.roof_age} yrs` : '-'}</FactRow>
                <FactRow label="Score">{lead.roof_score !== null ? `${lead.roof_score}/100` : '-'}</FactRow>
                <FactRow label="Est. value">
                  {lead.estimated_roof_value != null ? (
                    <>
                      ${Number(lead.estimated_roof_value).toLocaleString()}
                      {calculatedRoofEstimate ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          About {calculatedRoofEstimate.squares} squares
                        </span>
                      ) : null}
                    </>
                  ) : '-'}
                </FactRow>
                {lead.roof_material_notes && <FactRow label="Notes">{lead.roof_material_notes}</FactRow>}
              </dl>
            )}
          </section>

          {lead.mailing_street && (
            <section className="border-b border-border py-6">
              <RailHeading icon={MailOpen}>Mailing address</RailHeading>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {isAbsentee && (
                  <span className="border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                    Absentee
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm">{lead.mailing_street}</p>
              <p className="text-sm text-muted-foreground">
                {[lead.mailing_city, lead.mailing_state, lead.mailing_zip].filter(Boolean).join(', ')}
              </p>
            </section>
          )}

          <div className="border-b border-border py-6 [&_[data-slot=card]]:rounded-none [&_[data-slot=card]]:border-0 [&_[data-slot=card]]:bg-transparent [&_[data-slot=card]]:py-0 [&_[data-slot=card-content]]:px-0 [&_[data-slot=card-header]]:px-0">
            <LeadPhotos leadId={leadId} />
          </div>

          <section className="border-b border-border py-6">
            <RailHeading icon={FileText}>Source</RailHeading>
            <p className="mt-3 text-sm font-medium">
              {(lead.lead_sources as { display_name: string } | undefined)?.display_name
                || lead.created_by_name
                || 'Unknown'}
            </p>
            {lead.source_notes && <p className="mt-1 text-sm text-muted-foreground">{lead.source_notes}</p>}
            {lead.created_by_name && (lead.lead_sources as { display_name: string } | undefined)?.display_name && (
              <p className="mt-2 text-xs text-muted-foreground">
                Added by{' '}
                <span className={isMachineAttribution(lead.created_by_name) ? 'italic' : ''}>
                  {lead.created_by_name}
                </span>
              </p>
            )}
            {importBatch?.filename && (
              <p className="mt-2 break-all text-xs text-muted-foreground">
                From <span className="text-foreground">{importBatch.filename}</span>
              </p>
            )}
            {lead.enriched_at && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
                Enriched via {lead.enrichment_source || 'unknown'} on {format(new Date(lead.enriched_at), 'MMM d, yyyy')}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Created {format(new Date(lead.created_at), 'MMM d, yyyy')}
            </p>
          </section>

          {(lead.hail_date || lead.hail_size_inches) && (
            <section className="border-b border-border py-6">
              <RailHeading icon={CloudRain}>Storm data</RailHeading>
              <dl className="mt-3 divide-y divide-border">
                {lead.hail_date && <FactRow label="Hail date">{lead.hail_date}</FactRow>}
                {lead.hail_size_inches && <FactRow label="Hail size">{lead.hail_size_inches}&quot;</FactRow>}
                {lead.storm_id && <FactRow label="Storm ID"><span className="break-all font-mono text-xs">{lead.storm_id}</span></FactRow>}
              </dl>
            </section>
          )}
        </aside>
      </div>
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
        currentCloserId={lead.assigned_closer_id}
        onSuccess={() => { toast.success('Appointment set!'); fetchLead(); }}
      />
      {/* Add or edit an appointment from the schedule section. */}
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
            <div className="space-y-2">
              <DateTimeFields
                idPrefix="card_appt"
                value={apptDateTime}
                onChange={setApptDateTime}
                disabled={apptSaving}
              />
              <AppointmentConflictWarning
                value={apptDateTime}
                excludeAppointmentId={editingApptId}
                onConflictsChange={setApptConflicts}
              />
            </div>
            {!editingApptId && (
              <div className="space-y-1">
                <label className="text-sm font-medium">Closer</label>
                <Select value={apptCloserId || null} onValueChange={(value) => setApptCloserId(value ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a closer" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.filter((member) => member.role === 'closer' || member.role === 'admin').map((member) => (
                      <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
              disabled={
                apptSaving
                || !apptDateTime
                || Number.isNaN(new Date(apptDateTime).getTime())
                || (!editingApptId && !apptCloserId && !lead.assigned_closer_id)
              }
            >
              {apptSaving
                ? 'Saving...'
                : apptConflicts.length > 0
                  ? 'Book anyway'
                  : editingApptId
                    ? 'Save Changes'
                    : 'Add Appointment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permanent deletion destroys any recorded outcome along with the
          booking, and the control is an icon beside Edit — so this asks first. */}
      <Dialog
        open={deleteAppointmentTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteAppointmentTarget(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this appointment permanently?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This deletes the booking and any result recorded against it,
            including its contribution to the performance report. It cannot be
            undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAppointmentTarget(null)}>
              Keep appointment
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteAppointmentTarget && handleDeleteAppointment(deleteAppointmentTarget)}
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
