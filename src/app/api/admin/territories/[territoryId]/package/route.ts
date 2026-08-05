import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidDateString } from '@/lib/leads/today';
import { db } from '@/lib/supabase/server';
import { canExecuteTerritories } from '@/lib/territories/execution';
import { loadTerritoryExecutionSnapshot } from '@/lib/territories/execution.server';
import { buildTerritoryPackage, type PackagedLead } from '@/lib/offline/territory-package';
import { isValidUUID } from '@/lib/utils/validation';

/**
 * Everything needed to work one territory with no network.
 *
 * Built from the same execution snapshot the online screen uses, rather than a
 * parallel query, so an offline rep and an online rep are looking at the same
 * definition of "which doors are in this territory" — exact polygon membership,
 * role-scoped, unaffected by whatever map filters happen to be set.
 *
 * The package is assembled server-side so the client stores one validated
 * object instead of stitching several responses together, and so `repId` is
 * stamped from the session rather than claimed by the caller.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ territoryId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    // Closers do not enter the door-knocking workflow, so they have nothing to
    // take offline — same rule as entering execution mode itself.
    if (!canExecuteTerritories(admin.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { territoryId } = await params;
    if (!isValidUUID(territoryId)) {
      return NextResponse.json({ success: false, error: 'Invalid territory ID' }, { status: 400 });
    }

    const today = new URL(request.url).searchParams.get('date');
    if (!isValidDateString(today)) {
      return NextResponse.json(
        { success: false, error: 'A local date in YYYY-MM-DD form is required' },
        { status: 400 }
      );
    }

    const result = await loadTerritoryExecutionSnapshot(
      db(),
      territoryId,
      admin.role,
      { today, now: new Date().toISOString() }
    );
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    /*
     * Only the fields the offline screen actually draws or decides with. The
     * snapshot carries more — appointment evidence, call history, roof values —
     * and copying all of it onto a phone would inflate the download for data no
     * offline path reads.
     */
    const leads: PackagedLead[] = result.snapshot.leads.map((l) => ({
      id: l.id,
      first_name: l.first_name ?? null,
      last_name: l.last_name ?? null,
      address_street: l.address_street ?? null,
      address_city: l.address_city ?? null,
      latitude: l.latitude,
      longitude: l.longitude,
      status: l.status ?? null,
      priority: l.priority ?? null,
      phone: null,
      do_not_knock: l.do_not_knock ?? null,
      is_dnc: l.is_dnc ?? null,
      last_knock_at: l.last_knock_at ?? null,
      last_disposition: l.last_disposition ?? null,
      knock_count: l.knock_count ?? null,
      follow_up_date: l.follow_up_date ?? null,
    }));

    const pkg = buildTerritoryPackage({
      territoryId,
      name: result.snapshot.territory.name,
      boundary: result.snapshot.territory.boundary as [number, number][],
      leads,
      repId: admin.sub,
      downloadedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, package: pkg });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
