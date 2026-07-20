import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';

export const maxDuration = 60;

const SPC_BASE = 'https://www.spc.noaa.gov/climo/reports';
const MAX_DAYS = 90;
const MAX_POINTS = 3000;
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

export interface HailReport {
  lat: number;
  lon: number;
  size: number; // inches
  date: string; // YYYY-MM-DD
  location: string;
  state: string;
}

// Module-scoped cache of US-wide parsed reports, keyed by day count.
const cache = new Map<number, { expires: number; reports: HailReport[] }>();

function yymmdd(d: Date): { url: string; iso: string } {
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return { url: `${yy}${mm}${dd}`, iso: `20${yy}-${mm}-${dd}` };
}

function parseSpcCsv(text: string, iso: string): HailReport[] {
  const out: HailReport[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('Time,')) continue;
    const parts = line.split(',');
    if (parts.length < 7) continue;
    const size = parseInt(parts[1], 10);
    const lat = parseFloat(parts[5]);
    const lon = parseFloat(parts[6]);
    if (Number.isNaN(size) || Number.isNaN(lat) || Number.isNaN(lon)) continue;
    out.push({
      lat,
      lon,
      size: size / 100, // hundredths of an inch -> inches
      date: iso,
      location: parts[2] || '',
      state: parts[4] || '',
    });
  }
  return out;
}

async function fetchDay(d: Date): Promise<HailReport[]> {
  const { url, iso } = yymmdd(d);
  try {
    const res = await fetch(`${SPC_BASE}/${url}_rpts_hail.csv`, {
      headers: { 'User-Agent': 'RoofLeadsCRM/1.0 (hail overlay)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    return parseSpcCsv(await res.text(), iso);
  } catch {
    return [];
  }
}

async function getReports(days: number): Promise<HailReport[]> {
  const cached = cache.get(days);
  if (cached && cached.expires > Date.now()) return cached.reports;

  const today = new Date();
  const dates: Date[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d);
  }
  const perDay = await Promise.all(dates.map(fetchDay));
  const reports = perDay.flat();
  cache.set(days, { expires: Date.now() + CACHE_TTL_MS, reports });
  return reports;
}

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10) || 30, 1), MAX_DAYS);
    const minSize = parseFloat(searchParams.get('min') || '0') || 0;

    const bbox = ['n', 's', 'e', 'w'].map((k) => {
      const v = searchParams.get(k);
      return v === null ? null : parseFloat(v);
    });
    const [n, s, e, w] = bbox;
    const hasBbox = [n, s, e, w].every((v) => v !== null && !Number.isNaN(v));

    let reports = await getReports(days);
    reports = reports.filter((r) => r.size >= minSize);
    if (hasBbox) {
      reports = reports.filter((r) => r.lat <= n! && r.lat >= s! && r.lon <= e! && r.lon >= w!);
    }

    const truncated = reports.length > MAX_POINTS;
    if (truncated) reports = reports.slice(0, MAX_POINTS);

    return NextResponse.json({ success: true, reports, days, count: reports.length, truncated });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
