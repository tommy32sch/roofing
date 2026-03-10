export type LeadStatus = 'new' | 'contacted' | 'appointment_set' | 'inspected' | 'proposal_sent' | 'sold' | 'lost';
export type LeadPriority = 'low' | 'medium' | 'high' | 'hot';
export type RoofType = 'asphalt_shingle' | 'metal' | 'tile' | 'slate' | 'wood_shake' | 'flat' | 'other' | 'unknown';
export type ActivityType = 'note' | 'status_change' | 'call' | 'email' | 'visit' | 'created' | 'updated';

export const LEAD_STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'appointment_set', label: 'Appointment Set' },
  { value: 'inspected', label: 'Inspected' },
  { value: 'proposal_sent', label: 'Proposal Sent' },
  { value: 'sold', label: 'Sold' },
  { value: 'lost', label: 'Lost' },
];

export const LEAD_PRIORITY_OPTIONS: { value: LeadPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'hot', label: 'Hot' },
];

export const ROOF_TYPE_OPTIONS: { value: RoofType; label: string }[] = [
  { value: 'asphalt_shingle', label: 'Asphalt Shingle' },
  { value: 'metal', label: 'Metal' },
  { value: 'tile', label: 'Tile' },
  { value: 'slate', label: 'Slate' },
  { value: 'wood_shake', label: 'Wood Shake' },
  { value: 'flat', label: 'Flat' },
  { value: 'other', label: 'Other' },
  { value: 'unknown', label: 'Unknown' },
];

export interface Lead {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  home_value: number | null;
  year_built: number | null;
  roof_age: number | null;
  roof_type: RoofType;
  roof_score: number | null;
  roof_material_notes: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  source_id: number | null;
  source_notes: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadSource {
  id: number;
  name: string;
  display_name: string;
  sort_order: number;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  activity_type: ActivityType;
  content: string | null;
  old_status: LeadStatus | null;
  new_status: LeadStatus | null;
  created_by: string | null;
  created_at: string;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface AdminUser {
  id: string;
  email: string;
  password_hash: string;
  name: string;
}

export interface AppSettings {
  id: string;
  company_name: string;
  default_lead_status: LeadStatus;
  default_lead_priority: LeadPriority;
  updated_at: string;
}

export interface LeadWithSource extends Lead {
  lead_sources?: LeadSource;
}

export interface LeadWithActivities extends Lead {
  lead_activities?: LeadActivity[];
  lead_sources?: LeadSource;
}

export interface DashboardStats {
  totalLeads: number;
  leadsThisWeek: number;
  leadsThisMonth: number;
  hotLeads: number;
  pipelineCounts: { status: LeadStatus; label: string; count: number }[];
  conversionRate: number;
  recentLeads: LeadWithSource[];
  leadsBySource: { source: string; count: number }[];
}

export interface CSVImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
}
