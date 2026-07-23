import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import { PHOTO_BUCKET, pathBelongsToLead } from '@/lib/leads/photos';

/**
 * Delete a photo — the stored file as well as the row, so removing a photo
 * really removes it rather than orphaning the object in the bucket.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ leadId: string; photoId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const { leadId, photoId } = await params;
    if (!isValidUUID(leadId) || !isValidUUID(photoId)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const supabase = db();
    const { data: photo } = await supabase
      .from('lead_photos')
      .select('id, storage_path, lead_id')
      .eq('id', photoId)
      .single();

    // Scope by lead as well as id, so a photo can't be deleted via the wrong lead.
    if (!photo || photo.lead_id !== leadId) {
      return NextResponse.json({ success: false, error: 'Photo not found' }, { status: 404 });
    }
    if (!pathBelongsToLead(photo.storage_path, leadId)) {
      return NextResponse.json({ success: false, error: 'Invalid path' }, { status: 400 });
    }

    // Remove the object first; if the row delete then failed we'd rather have a
    // row pointing at a missing file than a file nobody can see or reach.
    const { error: storageError } = await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path]);
    if (storageError) {
      return NextResponse.json({ success: false, error: storageError.message }, { status: 500 });
    }

    const { error } = await supabase.from('lead_photos').delete().eq('id', photoId);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
