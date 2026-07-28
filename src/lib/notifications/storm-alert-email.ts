import type { StormType } from '@/lib/storm/parse';

export interface StormAlertEmailInput {
  recipientName?: string | null;
  marketName: string;
  type: StormType;
  occurredOn: string;
  peakValue: number | null;
  reportCount: number;
  closestDistanceMiles: number;
  centroidLat: number;
  centroidLon: number;
  severityBand: number;
  kind: 'initial' | 'escalation';
  appUrl?: string | null;
}

export interface BuiltStormAlertEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function peakLabel(type: StormType, value: number | null): string {
  if (type === 'hail') return value == null ? 'unmeasured hail' : `${value.toFixed(2)}” hail`;
  return value == null ? 'reported wind damage (speed unmeasured)' : `${Math.round(value)} mph wind`;
}

/**
 * Preliminary-report-safe internal alert.
 *
 * This intentionally never says a storm is happening now: SPC local storm
 * reports can be delayed or corrected and are not warnings or radar detections.
 */
export function buildStormAlertEmail(
  input: StormAlertEmailInput & { marketId: number }
): BuiltStormAlertEmail {
  const kind = input.type === 'hail' ? 'Hail' : 'Wind';
  const peak = peakLabel(input.type, input.peakValue);
  const escalation = input.kind === 'escalation' ? 'Severity increased — ' : '';
  const subject = `${escalation}${kind} report near ${input.marketName}: ${peak}`;
  const greeting = input.recipientName?.trim() ? `Hi ${input.recipientName.trim()},` : 'Hello,';
  const baseUrl = input.appUrl?.replace(/\/$/, '') || null;
  const params = new URLSearchParams({
    market_id: String(input.marketId),
    storm: input.type,
    days: '7',
    lat: String(input.centroidLat),
    lng: String(input.centroidLon),
    zoom: '12',
  });
  const mapUrl = baseUrl ? `${baseUrl}/admin/map?${params}` : null;
  const distance = input.closestDistanceMiles.toFixed(1);

  const text = [
    greeting,
    '',
    `${input.reportCount} preliminary NOAA ${input.type} report${input.reportCount === 1 ? '' : 's'} matched the ${input.marketName} alert area.`,
    `Peak: ${peak}`,
    `Closest report: ${distance} miles from the market center`,
    `NOAA report date: ${input.occurredOn}`,
    ...(mapUrl ? ['', `Open map: ${mapUrl}`] : []),
    '',
    'These are preliminary NOAA local storm reports. They may be delayed or corrected and are not a forecast, warning, or real-time radar detection.',
  ].join('\n');

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
  <p>${escapeHtml(greeting)}</p>
  <p><strong>${input.reportCount} preliminary NOAA ${escapeHtml(input.type)} report${input.reportCount === 1 ? '' : 's'}</strong> matched the <strong>${escapeHtml(input.marketName)}</strong> alert area.</p>
  <table cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">
    <tr><td style="padding:4px 12px 4px 0;color:#666">Peak</td><td style="padding:4px 0"><strong>${escapeHtml(peak)}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">Closest</td><td style="padding:4px 0">${escapeHtml(distance)} miles from market center</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">Report date</td><td style="padding:4px 0">${escapeHtml(input.occurredOn)}</td></tr>
  </table>
  ${mapUrl ? `<p><a href="${escapeHtml(mapUrl)}" style="color:#2563eb">Open storm area on the map</a></p>` : ''}
  <p style="color:#666;font-size:12px">These are preliminary NOAA local storm reports. They may be delayed or corrected and are not a forecast, warning, or real-time radar detection.</p>
</div>`;

  return { subject, html, text };
}
