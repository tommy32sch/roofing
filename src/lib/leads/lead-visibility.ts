/**
 * Who may see a given lead, and everything hanging off it.
 *
 * Closers work sold accounts, so the lead detail route already refuses them any
 * lead that is not sold. But that rule lived inline in one handler, and the
 * collections beneath a lead — activities, knocks, calls, photos — each answer
 * the question separately or not at all. The activity feed did not ask at all:
 * its GET never authenticated, which also meant it never reached the
 * token_version revocation check inside getAuthenticatedAdmin, so a rep whose
 * access had been revoked kept reading lead history until their JWT expired.
 *
 * Stated once here so a child collection cannot quietly disagree with its
 * parent about who is allowed to look.
 */

export type LeadViewerRole = 'admin' | 'setter' | 'closer';

/**
 * May this role read this lead?
 *
 * Mirrors the lead detail route: only closers are restricted, and only to sold
 * leads. Setters knock every door, so they see everything — deliberate, since
 * knowing who owns a door is what stops two reps knocking it.
 *
 * A null/unknown status fails CLOSED for a closer. A missing status usually
 * means the lead row could not be read, and guessing "probably fine" is the
 * wrong default for an access check.
 */
export function canViewLead(role: LeadViewerRole, leadStatus: string | null | undefined): boolean {
  if (role !== 'closer') return true;
  return leadStatus === 'sold';
}
