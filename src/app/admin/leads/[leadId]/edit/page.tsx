'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LeadForm } from '@/components/leads/lead-form';
import type { Lead } from '@/types';

export default function EditLeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = use(params);
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/leads/${leadId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setLead(data.lead);
        } else {
          toast.error('Lead not found');
          router.push('/admin/leads');
        }
      })
      .catch(() => toast.error('Failed to load lead'))
      .finally(() => setLoading(false));
  }, [leadId, router]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!lead) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/admin/leads/${leadId}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">
          Edit: {lead.first_name} {lead.last_name}
        </h1>
      </div>
      <LeadForm lead={lead} isEdit />
    </div>
  );
}
