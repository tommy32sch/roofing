/**
 * Lead photo storage.
 *
 * Files live in a private Supabase Storage bucket, not in Postgres, and are
 * never publicly readable — these are photographs of customers' homes. Reads go
 * through short-lived signed URLs minted per request.
 *
 * Uploads go from the browser straight to storage using a signed upload URL,
 * deliberately bypassing our own API. A serverless request body is capped
 * around 4.5MB on Vercel and a phone photo of a roof routinely exceeds that, so
 * routing the bytes through an API route would fail in the field — which is the
 * one place this feature has to work.
 */

export const PHOTO_BUCKET = 'lead-photos';

/** Signed read URLs are short-lived; the gallery re-mints them on load. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export const ALLOWED_PHOTO_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

/**
 * Downscale target. Roof damage stays legible well below original phone
 * resolution, and a 5MB original becomes roughly 300–500KB — which matters a
 * lot on a job-site connection, and keeps storage costs sane.
 */
export const MAX_IMAGE_DIMENSION = 1600;
export const JPEG_QUALITY = 0.82;

/** Extension from a mime type, defaulting to jpg. */
export function extensionFor(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/heic') return 'heic';
  return 'jpg';
}

/**
 * Storage path for a lead's photo. Prefixed with the lead id so a path can be
 * checked against the lead it claims to belong to, and so a lead's photos are
 * grouped for bulk deletion.
 */
export function photoPath(leadId: string, fileId: string, contentType: string): string {
  return `${leadId}/${fileId}.${extensionFor(contentType)}`;
}

/** True when the path really belongs to this lead. */
export function pathBelongsToLead(path: string, leadId: string): boolean {
  return path.startsWith(`${leadId}/`) && !path.includes('..');
}
