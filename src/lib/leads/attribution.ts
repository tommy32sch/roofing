/**
 * Who added a lead.
 *
 * Four paths create leads — an uploaded list, the Add Lead form, an integration
 * webhook, and email import — and only two of them involve a signed-in account.
 * A single "Added by" column is only trustworthy if all four write to it, so
 * webhook and email leads get a labelled machine identity rather than a blank.
 */

/** Prefix marking an automated source, so it can't be mistaken for a person. */
export const MACHINE_PREFIX = {
  webhook: 'Webhook',
  email: 'Email',
} as const;

/**
 * Label for a lead created by an integration webhook.
 *
 * Named after the API key, because that is the thing an admin revokes when a
 * feed starts sending junk.
 */
export function webhookAttribution(keyName: string | null | undefined): string {
  const name = keyName?.trim();
  return name ? `${MACHINE_PREFIX.webhook}: ${name}` : MACHINE_PREFIX.webhook;
}

/** Label for a lead created by email import, named after the sender. */
export function emailAttribution(sender: string | null | undefined): string {
  const from = sender?.trim();
  return from && from !== 'unknown' ? `${MACHINE_PREFIX.email}: ${from}` : MACHINE_PREFIX.email;
}

/** True when the attribution is an automated feed rather than a person. */
export function isMachineAttribution(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.startsWith(`${MACHINE_PREFIX.webhook}`) || name.startsWith(`${MACHINE_PREFIX.email}`);
}

/**
 * What to show in an "Added by" cell.
 *
 * Leads that predate attribution tracking return null so the caller can render
 * a muted dash. Inventing a name for them would be worse than admitting we
 * don't know.
 */
export function attributionLabel(createdByName: string | null | undefined): string | null {
  const name = createdByName?.trim();
  return name ? name : null;
}

/**
 * Validate an uploader filter value.
 *
 * Mirrors resolveMarketFilter's stance: a malformed id must narrow to nothing
 * rather than silently widening the query to every lead.
 */
export function resolveUploaderFilter(param: string | null | undefined): string | null {
  const value = param?.trim();
  if (!value) return null;
  // admin_users.id is a UUID; anything else is not a real uploader.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  return isUuid ? value : null;
}
