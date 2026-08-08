export type LeadStatus = 'new' | 'contacted' | 'appointment_set' | 'inspected' | 'proposal_sent' | 'sold' | 'lost';
export type LeadPriority = 'low' | 'medium' | 'high' | 'hot';
export type RoofType = 'asphalt_shingle' | 'metal' | 'tile' | 'slate' | 'wood_shake' | 'flat' | 'other' | 'unknown';
export type ActivityType = 'note' | 'status_change' | 'call' | 'email' | 'visit' | 'created' | 'updated';
export type UserRole = 'admin' | 'setter' | 'closer';
export type AppointmentType = 'inspection' | 'adjuster';

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
  phone2: string | null;
  phone2_normalized: string | null;
  phone3: string | null;
  phone3_normalized: string | null;
  email: string | null;
  email2: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  mailing_street: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
  home_value: number | null;
  year_built: number | null;
  sqft: number | null;
  lot_size: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  stories: number | null;
  assessed_value: number | null;
  last_sale_date: string | null;
  last_sale_price: number | null;
  owner_type: string | null;
  apn: string | null;
  roof_age: number | null;
  roof_type: RoofType;
  roof_score: number | null;
  roof_material_notes: string | null;
  hail_date: string | null;
  hail_size_inches: number | null;
  storm_id: string | null;
  latitude: number | null;
  longitude: number | null;
  enriched_at: string | null;
  enrichment_source: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  source_id: number | null;
  source_notes: string | null;
  assigned_to: string | null;
  // Won-lead demographics
  career: string | null;
  family_size: number | null;
  marital_status: string | null;
  age_range: string | null;
  household_income_range: string | null;
  education_level: string | null;
  years_in_home: number | null;
  insurance_carrier: string | null;
  decision_maker: string | null;
  referral_source: string | null;
  demographic_captured_at: string | null;
  // Assignment
  assigned_setter_id: string | null;
  assigned_closer_id: string | null;
  // Deal value
  deal_value: number | null;
  // System-estimated roof replacement value (derived from property data)
  estimated_roof_value: number | null;
  // Follow-up
  follow_up_date: string | null;
  // Duplicate flagging
  is_flagged_duplicate: boolean;
  duplicate_of_id: string | null;
  // Do Not Call (flagged from the source CSV on import)
  is_dnc: boolean;
  // Door-knock history (migration 013). Written by the map's knock logging.
  last_knock_at: string | null;
  last_disposition: string | null;
  knock_count: number;
  do_not_knock: boolean;
  // Structured cold-call history, denormalized for map/list summaries.
  last_call_at: string | null;
  last_call_disposition: string | null;
  call_count: number;
  /** Office this lead belongs to. Set at import, never derived from the
   *  address — most imported leads have no city/state at all. */
  market_id: number | null;
  /** Account that added this lead; null for leads predating attribution. */
  created_by: string | null;
  /** Display name snapshot — also carries "Webhook: x" / "Email: x" for feeds. */
  created_by_name: string | null;
  /** The upload this lead arrived in, when it came from a file. */
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

/** An office / branch. Leads and users are both assigned to one. */
export interface Market {
  id: number;
  name: string;
  /** Geocoding fallback for street-only addresses in this market, so a bare
   *  Minnesota street doesn't resolve into Arizona. */
  default_geo_city: string | null;
  default_geo_state: string | null;
  /** Where the map jumps to when this office is selected. Independent of its
   *  leads, so an office with none yet still puts the map in the right place. */
  center_lat: number | null;
  center_lng: number | null;
  center_zoom: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

/** A saved canvassing area drawn on the lead map. */
export interface Territory {
  id: string;
  market_id: number;
  name: string;
  /** Polygon vertices in the same [latitude, longitude] order Leaflet uses. */
  boundary: [number, number][];
  color: string;
  /** Geographic ownership is separate from a lead's sales attribution. */
  owner_user_id: string | null;
  owner_name: string | null;
  owner_role: UserRole | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type StormAlertType = 'hail' | 'wind';

/** A grouped, market-scoped alert built from preliminary NOAA point reports. */
export interface StormAlert {
  id: string;
  market_id: number;
  market_name: string;
  type: StormAlertType;
  occurred_on: string;
  peak_value: number | null;
  report_count: number;
  closest_distance_miles: number;
  centroid_lat: number;
  centroid_lon: number;
  severity_band: number;
  updated_at: string;
  read_at: string | null;
}

/** A single uploaded list — who, what file, and what landed. */
export interface LeadImportBatch {
  id: string;
  filename: string;
  uploaded_by: string | null;
  uploaded_by_name: string;
  market_id: number | null;
  row_count: number;
  imported_count: number;
  duplicate_count: number;
  dnc_count: number;
  created_at: string;
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

export interface LeadAppointment {
  id: string;
  lead_id: string;
  appointment_type: AppointmentType;
  scheduled_at: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadKnock {
  id: string;
  lead_id: string;
  disposition: string;
  notes: string | null;
  knocked_at: string;
  created_by: string | null;
  client_id: string | null;
  created_at: string;
  admin_users?: { name: string } | null;
}

export interface LeadCall {
  id: string;
  lead_id: string;
  disposition: string;
  notes: string | null;
  called_at: string;
  created_by: string | null;
  client_id: string | null;
  created_at: string;
  admin_users?: { name: string } | null;
}

export const APPOINTMENT_TYPE_OPTIONS: { value: AppointmentType; label: string }[] = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'adjuster', label: 'Adjuster' },
];

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
  role: UserRole;
  /** Home office. Drives the default market filter; not an access restriction. */
  market_id: number | null;
  created_at: string;
}

export const MARITAL_STATUS_OPTIONS = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'];
export const AGE_RANGE_OPTIONS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
export const INCOME_RANGE_OPTIONS = ['<$35k', '$35k-$50k', '$50k-$75k', '$75k-$100k', '$100k-$150k', '$150k+'];
export const EDUCATION_OPTIONS = ['High School', 'Some College', 'Associate', "Bachelor's", "Master's", 'Doctorate'];
export const DECISION_MAKER_OPTIONS = [
  { value: 'sole', label: 'Sole Decision Maker' },
  { value: 'joint', label: 'Joint Decision Maker' },
];

export interface AppSettings {
  id: string;
  company_name: string;
  default_lead_status: LeadStatus;
  default_lead_priority: LeadPriority;
  regrid_api_key: string | null;
  auto_enrich_enabled: boolean;
  roof_price_per_square: number | null;
  default_geo_city: string | null;
  default_geo_state: string | null;
  email_import_enabled: boolean;
  allowed_sender_emails: string[] | null;
  updated_at: string;
}

export interface EmailImportLog {
  id: string;
  sender_email: string;
  subject: string | null;
  attachment_name: string | null;
  source_id: number | null;
  leads_imported: number;
  duplicates_skipped: number;
  errors: string[] | null;
  created_at: string;
}

/** The rep each assignment column points at, embedded by the list route. */
export interface AssignedRep {
  id: string;
  name: string;
}

export interface LeadWithSource extends Lead {
  lead_sources?: LeadSource;
  /** Null when nobody owns this lead in that role — the case worth surfacing. */
  assigned_setter?: AssignedRep | null;
  assigned_closer?: AssignedRep | null;
}

export interface LeadWithActivities extends Lead {
  lead_activities?: LeadActivity[];
  lead_sources?: LeadSource;
  lead_appointments?: LeadAppointment[];
  lead_knocks?: LeadKnock[];
  lead_calls?: LeadCall[];
  /** The upload this lead arrived in, embedded by the detail route. */
  lead_import_batches?: Pick<LeadImportBatch, 'id' | 'filename' | 'uploaded_by_name' | 'created_at'> | null;
}

export interface ContactActivityEvent {
  id: string;
  channel: 'knock' | 'cold_call';
  leadId: string;
  disposition: string;
  occurredAt: string;
  accountId: string | null;
  accountName: string | null;
  lead: {
    id: string;
    first_name: string;
    last_name: string;
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
  } | null;
}

export interface ContactActivitySummary {
  knockCount: number;
  callCount: number;
  events: ContactActivityEvent[];
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
  totalPipelineValue: number;
  totalWonValue: number;
  totalEstimatedRoofValue: number;
  overdueFollowUps: number;
  /**
   * The last 30 days against the 30 before them.
   *
   * `won` counts leads that ARRIVED in the window and have since sold. A lead
   * has no sold_at column, so this cannot mean "closed in the window". The
   * dashboard labels it accordingly.
   */
  period?: {
    days: number;
    current: PeriodSummary;
    previous: PeriodSummary;
  };
  /** One point per day, oldest first. Quiet days are kept as zero. */
  leadTrend?: { date: string; value: number }[];
}

export interface PeriodSummary {
  newLeads: number;
  hot: number;
  won: number;
  wonValue: number;
}

export interface CSVImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  flagged: number;
  errors: string[];
}

export interface IntegrationApiKey {
  id: string;
  name: string;
  api_key: string;
  source_id: number | null;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  lead_sources?: LeadSource;
}

export interface WebhookLog {
  id: string;
  api_key_id: string;
  source_name: string | null;
  payload_summary: string | null;
  leads_imported: number;
  duplicates_skipped: number;
  errors: string[] | null;
  created_at: string;
  integration_api_keys?: { name: string };
}
