import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { db } from '@/lib/supabase/server';
import type {
  OperationsOverviewResponse,
  ReportingApiError,
} from '@/lib/reporting/contracts';
import { loadOperationsOverview } from '@/lib/reporting/operations.server';
import { loadReportRequestScope } from '@/lib/reporting/request-scope.server';

function errorResponse(error: string, status: number) {
  return NextResponse.json<ReportingApiError>({ success: false, error }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return errorResponse('Not authenticated', 401);

    const client = db();
    const requestScope = await loadReportRequestScope(
      client,
      admin,
      new URL(request.url).searchParams
    );
    if (!requestScope.ok) return errorResponse(requestScope.error, requestScope.status);

    const loaded = await loadOperationsOverview({
      client,
      resolved: requestScope.resolved,
      members: requestScope.members,
      currentUserId: admin.sub,
    });
    const response: OperationsOverviewResponse = {
      success: true,
      overview: {
        scope: requestScope.resolved.scope,
        scopeLabel: requestScope.resolved.scopeLabel,
        members: requestScope.members,
        sections: loaded.sections,
        partialErrors: loaded.partialErrors,
      },
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('[operations-overview] request', error);
    return errorResponse('Internal server error', 500);
  }
}
