import {
  LEAD_PRIORITY_OPTIONS,
  LEAD_STATUS_OPTIONS,
  type LeadPriority,
  type LeadStatus,
} from '@/types';

export const SETTINGS_INTEGRATION_FIELDS = [
  'regrid_api_key',
  'auto_enrich_enabled',
  'email_import_enabled',
  'allowed_sender_emails',
] as const;

export interface PublicAppSettings {
  company_name: string;
  default_lead_status: LeadStatus;
  default_lead_priority: LeadPriority;
  auto_enrich_enabled: boolean;
  roof_price_per_square: number | null;
  default_geo_city: string | null;
  default_geo_state: string | null;
  email_import_enabled: boolean;
  allowed_sender_emails: string[];
  geocode_configured: boolean;
  regrid_configured: boolean;
  updated_at: string | null;
}

export type SettingsPatchDecision =
  | { ok: true; updates: Record<string, unknown> }
  | { ok: false; error: string; status: 400 };

const STATUS_VALUES = new Set(LEAD_STATUS_OPTIONS.map((option) => option.value));
const PRIORITY_VALUES = new Set(LEAD_PRIORITY_OPTIONS.map((option) => option.value));

function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === 'string' && STATUS_VALUES.has(value as LeadStatus);
}

function isLeadPriority(value: unknown): value is LeadPriority {
  return typeof value === 'string' && PRIORITY_VALUES.has(value as LeadPriority);
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function secretIsStored(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Strip secrets before settings leave the server. */
export function publicSettingsFromRow(row: Record<string, unknown>): PublicAppSettings {
  return {
    company_name: typeof row.company_name === 'string' ? row.company_name : '',
    default_lead_status: isLeadStatus(row.default_lead_status) ? row.default_lead_status : 'new',
    default_lead_priority: isLeadPriority(row.default_lead_priority) ? row.default_lead_priority : 'medium',
    auto_enrich_enabled: row.auto_enrich_enabled === true,
    roof_price_per_square:
      typeof row.roof_price_per_square === 'number' && Number.isFinite(row.roof_price_per_square)
        ? row.roof_price_per_square
        : null,
    default_geo_city: asTrimmedString(row.default_geo_city),
    default_geo_state: asTrimmedString(row.default_geo_state),
    email_import_enabled: row.email_import_enabled === true,
    allowed_sender_emails: Array.isArray(row.allowed_sender_emails)
      ? row.allowed_sender_emails.filter((entry): entry is string => typeof entry === 'string')
      : [],
    geocode_configured: secretIsStored(row.geocode_api_key),
    regrid_configured: secretIsStored(row.regrid_api_key),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}

export function settingsPatchFromBody(body: unknown): SettingsPatchDecision {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid request body', status: 400 };
  }

  const input = body as Record<string, unknown>;
  const blocked = SETTINGS_INTEGRATION_FIELDS.find((field) => field in input);
  if (blocked) {
    return {
      ok: false,
      error: 'Regrid and email import are configured in Integrations.',
      status: 400,
    };
  }

  const updates: Record<string, unknown> = {};

  if (input.company_name !== undefined) {
    if (typeof input.company_name !== 'string') {
      return { ok: false, error: 'company_name must be a string', status: 400 };
    }
    updates.company_name = input.company_name.trim();
  }

  if (input.default_lead_status !== undefined) {
    if (!isLeadStatus(input.default_lead_status)) {
      return { ok: false, error: 'default_lead_status is not a valid status', status: 400 };
    }
    updates.default_lead_status = input.default_lead_status;
  }

  if (input.default_lead_priority !== undefined) {
    if (!isLeadPriority(input.default_lead_priority)) {
      return { ok: false, error: 'default_lead_priority is not a valid priority', status: 400 };
    }
    updates.default_lead_priority = input.default_lead_priority;
  }

  if (input.roof_price_per_square !== undefined) {
    if (input.roof_price_per_square === '' || input.roof_price_per_square === null) {
      updates.roof_price_per_square = null;
    } else {
      const price = typeof input.roof_price_per_square === 'number'
        ? input.roof_price_per_square
        : Number(input.roof_price_per_square);
      if (!Number.isFinite(price) || price < 0) {
        return { ok: false, error: 'roof_price_per_square must be a number of 0 or more', status: 400 };
      }
      updates.roof_price_per_square = price;
    }
  }

  if (input.default_geo_city !== undefined) {
    if (typeof input.default_geo_city !== 'string' && input.default_geo_city !== null) {
      return { ok: false, error: 'default_geo_city must be a string', status: 400 };
    }
    updates.default_geo_city = asTrimmedString(input.default_geo_city);
  }

  if (input.default_geo_state !== undefined) {
    if (typeof input.default_geo_state !== 'string' && input.default_geo_state !== null) {
      return { ok: false, error: 'default_geo_state must be a string', status: 400 };
    }
    updates.default_geo_state = asTrimmedString(input.default_geo_state);
  }

  if (input.clear_geocode_api_key === true) {
    updates.geocode_api_key = null;
  } else if (typeof input.geocode_api_key === 'string' && input.geocode_api_key.trim()) {
    updates.geocode_api_key = input.geocode_api_key.trim();
  }

  if (Object.keys(updates).length === 0) {
    return { ok: false, error: 'No settings to update', status: 400 };
  }

  return { ok: true, updates };
}

export function changedFieldLabels<T extends Record<string, unknown>>(
  saved: T,
  draft: T,
  labels: Partial<Record<keyof T, string>>,
): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(labels) as Array<keyof T>) {
    const label = labels[key];
    if (!label) continue;
    if (saved[key] !== draft[key]) changed.push(label);
  }
  return changed;
}

export function roofPriceDraft(value: number | null): string {
  return value == null ? '' : String(value);
}

export function roofPriceUnchanged(saved: number | null, draft: string): boolean {
  const trimmed = draft.trim();
  if (trimmed === '') return saved == null;
  return Number(trimmed) === saved;
}
