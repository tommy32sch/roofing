import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';

export interface RepStats {
  id: string;
  name: string;
  role: string;
  // Setter metrics
  setterLeadsAssigned: number;
  appointmentsSet: number;
  appointmentRate: number;
  // Closer metrics
  closerLeadsAssigned: number;
  dealsWon: number;
  closeRate: number;
  totalRevenue: number;
}

export async function GET() {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const supabase = db();

    // Decide which user IDs to compute stats for
    let userIds: string[];
    let users: { id: string; name: string; role: string }[] = [];

    if (admin.role === 'admin') {
      const { data } = await supabase
        .from('admin_users')
        .select('id, name, role')
        .order('name');
      users = data || [];
      userIds = users.map(u => u.id);
    } else {
      // Setter/closer only see themselves
      const { data } = await supabase
        .from('admin_users')
        .select('id, name, role')
        .eq('id', admin.sub)
        .single();
      if (data) {
        users = [data];
        userIds = [data.id];
      } else {
        userIds = [];
      }
    }

    if (userIds.length === 0) {
      return NextResponse.json({ success: true, reps: [] });
    }

    // Fetch all leads assigned to any of these users (as setter or closer)
    const { data: leads } = await supabase
      .from('leads')
      .select('id, status, deal_value, assigned_setter_id, assigned_closer_id')
      .or(`assigned_setter_id.in.(${userIds.join(',')}),assigned_closer_id.in.(${userIds.join(',')})`)
      .eq('is_flagged_duplicate', false);

    const allLeads = leads || [];

    const APPOINTMENT_STATUSES = new Set(['appointment_set', 'inspected', 'proposal_sent', 'sold', 'lost']);

    const reps: RepStats[] = users.map(user => {
      const setterLeads = allLeads.filter(l => l.assigned_setter_id === user.id);
      const closerLeads = allLeads.filter(l => l.assigned_closer_id === user.id);

      const appointmentsSet = setterLeads.filter(l => APPOINTMENT_STATUSES.has(l.status)).length;
      const dealsWon = closerLeads.filter(l => l.status === 'sold').length;
      const totalRevenue = closerLeads
        .filter(l => l.status === 'sold' && l.deal_value)
        .reduce((sum, l) => sum + Number(l.deal_value), 0);

      return {
        id: user.id,
        name: user.name,
        role: user.role,
        setterLeadsAssigned: setterLeads.length,
        appointmentsSet,
        appointmentRate: setterLeads.length > 0 ? Math.round((appointmentsSet / setterLeads.length) * 100) : 0,
        closerLeadsAssigned: closerLeads.length,
        dealsWon,
        closeRate: closerLeads.length > 0 ? Math.round((dealsWon / closerLeads.length) * 100) : 0,
        totalRevenue,
      };
    });

    return NextResponse.json({ success: true, reps });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
