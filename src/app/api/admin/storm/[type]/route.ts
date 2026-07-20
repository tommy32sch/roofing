import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';

export const maxDuration = 60;

const SPC_BASE = 'https://www.spc.noaa.gov/climo/reports';
const MAX_DAYS = 90;
const MAX_POINTS = 3000;
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const TYPES = new Set(['hail', 'wind']);

export interface StormReport {
  lat: number;
  lon: number;
  value: number | null; // hail: inches; wind: mph (null = UNK/damage-only)
  date: string;
  location: string;
  state: string;
}

// Cache US-wide parsed reports, keyed by "type:days".
const cache = new Map<string, { expires: number; reports: StormReport[] }>();

function yymmdd(d: Date): { url: string; iso: string } {
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return { url: `${yy}${mm}${dd}`, iso: `20${yy}-${mm}-${dd}` };
}

function parseCsv(text: string, iso: string, type: string): StormReport[] {
  const out: StormReport[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('Time,')) continue;
    const parts = line.split(',');
    if (parts.length < 7) continue;
    const lat = parseFloat(parts[5]);
    const lon = parseFloat(parts[6]);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;

    const raw = parseInt(parts[1], 10);
    let value: number | null;
    if (type === 'hail') {
      if (Number.isNaN(raw)) continue; // hail with no size is useless
      value = raw / 100; // hundredths of an inch -> inches
    } else {
      value = Number.isNaN(raw) ? null : raw; // wind mph; UNK -> null but still plotted
    }

    out.push({ lat, lon, value, date: iso, location: parts[2] || '', state: parts[4] || '' });
  }
  return out;
}

async function fetchDay(d: Date, type: string): Promise<StormReport[]> {
  const { url, iso } = yymmdd(d);
  try {
    const res = await fetch(`${SPC_BASE}/${url}_rpts_${type}.csv`, {
      headers: { 'User-Agent': 'RoofLeadsCRM/1.0 (storm overlay)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    return parseCsv(await res.text(), iso, type);
  } catch {
    return [];
  }
}

async function getReports(type: string, days: number): Promise<StormReport[]> {
  const key = `${type}:${days}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.reports;

  const today = new Date();
  const dates: Date[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d);
  }
  const perDay = await Promise.all(dates.map((d) => fetchDay(d, type)));
  const reports = perDay.flat();
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, reports });
  return reports;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { type } = await params;
    if (!TYPES.has(type)) {
      return NextResponse.json({ success: false, error: 'Invalid storm type' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10) || 30, 1), MAX_DAYS);
    const minValue = parseFloat(searchParams.get('min') || '0') || 0;

    const [n, s, e, w] = ['n', 's', 'e', 'w'].map((k) => {
      const v = searchParams.get(k);
      return v === null ? null : parseFloat(v);
    });
    const hasBbox = [n, s, e, w].every((v) => v !== null && !Number.isNaN(v));

    let reports = await getReports(type, days);
    if (minValue > 0) reports = reports.filter((r) => r.value != null && r.value >= minValue);
    if (hasBbox) {
      reports = reports.filter((r) => r.lat <= n! && r.lat >= s! && r.lon <= e! && r.lon >= w!);
    }

    const truncated = reports.length > MAX_POINTS;
    if (truncated) reports = reports.slice(0, MAX_POINTS);

    return NextResponse.json({ success: true, type, reports, days, count: reports.length, truncated });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
