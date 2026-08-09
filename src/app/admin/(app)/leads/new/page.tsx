'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { LeadForm } from '@/components/leads/lead-form';
import { PageHeader } from '@/components/layout/page-header';

export default function NewLeadPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/leads">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <PageHeader title="Add New Lead" />
      </div>
      <LeadForm />
    </div>
  );
}
