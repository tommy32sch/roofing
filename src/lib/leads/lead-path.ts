import { isValidUUID } from '@/lib/utils/validation';

/**
 * Readable lead page addresses: /admin/leads/jane-smith-3f9c2a1b.
 *
 * The name part is for people; the trailing code is the first 8 hex digits of
 * the lead's UUID and is what actually finds the lead. So a renamed lead's old
 * address still resolves, and the server redirects any non-canonical address
 * (including the old full-UUID form) to the current one. The API keeps full
 * UUIDs; only page addresses change.
 */

/** Hex digits of the UUID kept in the address. */
export const LEAD_CODE_LENGTH = 8;
const MAX_SLUG_NAME = 40;

export interface LeadPathInput {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
}

/** "Jane O'Brien-Smith" → "jane-obrien-smith"; never empty. */
export function slugifyLeadName(firstName?: string | null, lastName?: string | null): string {
  const name = [firstName, lastName]
    .filter((part) => part && part !== '(unknown)')
    .join(' ');
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_NAME)
    .replace(/-+$/g, '');
  return slug || 'lead';
}

/** The address segment for a lead whose name is known. */
export function leadSlug(lead: Required<Pick<LeadPathInput, 'id'>> & LeadPathInput): string {
  const code = lead.id.replace(/-/g, '').slice(0, LEAD_CODE_LENGTH).toLowerCase();
  return `${slugifyLeadName(lead.first_name, lead.last_name)}-${code}`;
}

/**
 * The page address for a lead. Use this for every link to a lead.
 *
 * Without a name it falls back to the full UUID, which the server redirects to
 * the readable form, so a caller that only has an id still links correctly.
 */
export function leadPath(lead: LeadPathInput): string {
  const hasName = Boolean(lead.first_name?.trim() || lead.last_name?.trim());
  return `/admin/leads/${hasName ? leadSlug(lead) : lead.id}`;
}

export type LeadRef =
  | { kind: 'uuid'; id: string }
  | { kind: 'code'; code: string; slug: string };

/** Read a page address segment: a full UUID (old links) or name-code. */
export function parseLeadRef(segment: string): LeadRef | null {
  const value = decodeURIComponent(segment).trim().toLowerCase();
  if (isValidUUID(value)) return { kind: 'uuid', id: value };
  const match = value.match(new RegExp(`(?:^|-)([0-9a-f]{${LEAD_CODE_LENGTH}})$`));
  return match ? { kind: 'code', code: match[1], slug: value } : null;
}

/**
 * The UUID range that starts with a code, for an index-friendly lookup:
 * every UUID beginning "3f9c2a1b" sorts between these two bounds.
 */
export function leadCodeBounds(code: string): { from: string; to: string } {
  return {
    from: `${code}-0000-0000-0000-000000000000`,
    to: `${code}-ffff-ffff-ffff-ffffffffffff`,
  };
}
