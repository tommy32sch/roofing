/**
 * Which lead columns a client may write, and which of those are admin-only.
 *
 * This is the mass-assignment guard. Supabase is reached with the service-role
 * key, so RLS is bypassed and there is no database-side backstop — if a route
 * hands a client-supplied object to .insert() or .update(), every column in it
 * is written. The whitelist here IS the protection.
 *
 * It lives in its own module because the rule has to be identical on create and
 * on update. It previously existed only on the update path, and the create path
 * spread the raw request body straight into the insert, so a setter could POST a
 * lead with deal_value and assigned_setter_id set and award themselves a sale
 * that the leaderboard then counted. Two copies of a rule like this drift; one
 * copy cannot.
 */

/**
 * Fields only an admin may set. Everything financial or assignment-related lives
 * here so a setter/closer can't award themselves leads or edit deal value.
 *
 * market_id sits with the assignment fields: moving a lead to the other office
 * changes whose book it lands in, so it is an admin action.
 */
export const LEAD_ADMIN_ONLY_FIELDS = new Set(['deal_value', 'assigned_setter_id', 'market_id']);

/**
 * A setter may hand a door to a closer. That is the booking handoff: the
 * closer only sees leads assigned to them, so the appointment is invisible
 * until this field is set. Closers cannot reassign work.
 */
export const LEAD_SETTER_HANDOFF_FIELDS = new Set(['assigned_closer_id']);

/**
 * The complete set of lead columns a client may write. Anything not listed —
 * id, coordinates, enrichment/estimate/normalized fields, timestamps, duplicate
 * flags, created_by — is server-controlled and silently ignored.
 */
export const LEAD_EDITABLE_FIELDS = new Set<string>([
  'first_name', 'last_name', 'phone', 'phone2', 'phone3', 'email', 'email2',
  'address_street', 'address_city', 'address_state', 'address_zip',
  'mailing_street', 'mailing_city', 'mailing_state', 'mailing_zip',
  'home_value', 'year_built', 'sqft', 'lot_size', 'bedrooms', 'bathrooms', 'stories',
  'assessed_value', 'last_sale_date', 'last_sale_price', 'owner_type', 'apn',
  'roof_age', 'roof_type', 'roof_score', 'roof_material_notes',
  'hail_date', 'hail_size_inches', 'storm_id',
  'status', 'priority', 'source_id', 'source_notes', 'follow_up_date',
  'career', 'family_size', 'marital_status', 'age_range', 'household_income_range',
  'education_level', 'years_in_home', 'insurance_carrier', 'decision_maker', 'referral_source',
  ...LEAD_ADMIN_ONLY_FIELDS,
  ...LEAD_SETTER_HANDOFF_FIELDS,
]);

/** Statuses a setter may move a lead into. */
export const SETTER_ALLOWED_STATUSES = new Set(['new', 'contacted', 'appointment_set', 'lost']);

export type LeadWriterRole = 'admin' | 'setter' | 'closer';

/**
 * Strip a client payload down to what this role is allowed to write.
 *
 * Unknown keys and admin-only keys are dropped SILENTLY rather than rejected.
 * Rejecting would turn every stray field the UI happens to send — and every
 * column added to the table later — into a failed save, whereas dropping fails
 * closed on exactly the thing that matters: the value never reaches the row.
 */
export function pickWritableLeadFields(
  body: Record<string, unknown>,
  role: LeadWriterRole
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (!LEAD_EDITABLE_FIELDS.has(key)) continue;
    if (LEAD_ADMIN_ONLY_FIELDS.has(key) && role !== 'admin') continue;
    if (LEAD_SETTER_HANDOFF_FIELDS.has(key) && role === 'closer') continue;
    out[key] = body[key];
  }
  return out;
}

/**
 * Why this role may not set this status, or null if it may.
 *
 * Returned as a message rather than a boolean so create and update produce the
 * same 403 text for the same reason. Dropping a disallowed status silently (the
 * way an unknown field is dropped) would be wrong here: the caller asked for a
 * specific state transition, and quietly saving a different state than the one
 * requested is worse than refusing.
 */
export function statusDenialReason(
  status: unknown,
  role: LeadWriterRole,
  currentStatus?: string | null
): string | null {
  if (typeof status !== 'string' || status === '') return null;
  if (role === 'setter' && currentStatus === 'sold' && status !== 'sold') {
    return 'Setters cannot change a sold lead';
  }
  if (role !== 'setter') return null;
  if (status === 'sold') return 'Setters cannot mark a lead as sold';
  if (!SETTER_ALLOWED_STATUSES.has(status)) return 'Setters cannot set this status';
  return null;
}
