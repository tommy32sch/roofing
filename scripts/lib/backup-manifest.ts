import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { PHOTO_BUCKET } from '../../src/lib/leads/photos';

/**
 * Tables are ordered parent-first so the data file is useful during a careful,
 * manual restore. Keep this list explicit: the schema-parity test makes a new
 * migration fail CI until its restore position has been considered.
 */
export const BACKUP_TABLES = [
  'app_settings',
  'markets',
  'admin_users',
  'lead_sources',
  'tags',
  'integration_api_keys',
  'lead_import_batches',
  'territories',
  'leads',
  'lead_activities',
  'lead_appointments',
  'appointment_reminder_settings',
  'appointment_reminder_deliveries',
  'lead_knocks',
  'lead_calls',
  'lead_photos',
  'lead_tags',
  'email_import_logs',
  'webhook_logs',
  'storm_reports',
  'storm_ingestion_state',
  'storm_alert_rules',
  'storm_alert_subscriptions',
  'storm_alert_events',
  'storm_alert_hits',
  'storm_alert_deliveries',
  'storm_alert_reads',
  'lead_deletions',
  'scheduled_job_runs',
] as const;

/** Private buckets whose object bytes are part of the application backup. */
export const BACKUP_STORAGE_BUCKETS = [PHOTO_BUCKET] as const;

/**
 * Never place a Storage object name directly on the local filesystem. Object
 * keys can contain path separators and traversal segments; a digest is both
 * collision-resistant and portable. The manifest retains the original key for
 * restore.
 */
export function storageObjectLocalPath(bucket: string, objectPath: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(bucket) || bucket === '.' || bucket === '..') {
    throw new Error(`Unsafe Storage bucket name: ${bucket}`);
  }
  if (!objectPath) throw new Error('Storage object path cannot be empty');

  const digest = createHash('sha256')
    .update(bucket)
    .update('\0')
    .update(objectPath)
    .digest('hex');

  return posix.join('storage', bucket, 'objects', digest.slice(0, 2), digest);
}
