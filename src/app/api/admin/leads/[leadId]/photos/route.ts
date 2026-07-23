import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import {
  PHOTO_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  ALLOWED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  photoPath,
  pathBelongsToLead,
} from '@/lib/leads/photos';

/** List a lead's photos, each with a freshly signed, short-lived read URL. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const { leadId } = await params;
    if (!isValidUUID(leadId)) {
      return NextResponse.json({ success: false, error: 'Invalid lead ID' }, { status: 400 });
    }

    const supabase = db();
    const { data: rows, error } = await supabase
      .from('lead_photos')
      .select('*, admin_users(name)')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

    const paths = (rows ?? []).map((r) => r.storage_path);
    const signed = paths.length
      ? (await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)).data ?? []
      : [];
    const urlByPath = new Map(signed.map((s) => [s.path, s.signedUrl]));

    return NextResponse.json({
      success: true,
      photos: (rows ?? []).map((r) => ({ ...r, url: urlByPath.get(r.storage_path) ?? null })),
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Two-step upload.
 *
 * step=sign  -> mint a signed upload URL; the browser PUTs the file straight to
 *               storage, so the bytes never pass through this function (and so
 *               a 5MB roof photo can't hit the serverless body limit).
 * step=record -> after that succeeds, persist the row.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const { leadId } = await params;
    if (!isValidUUID(leadId)) {
      return NextResponse.json({ success: false, error: 'Invalid lead ID' }, { status: 400 });
    }

    const supabase = db();
    const { data: lead } = await supabase.from('leads').select('id').eq('id', leadId).single();
    if (!lead) return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });

    const body = await request.json();

    if (body.step === 'sign') {
      const contentType = String(body.content_type || '');
      if (!ALLOWED_PHOTO_TYPES.has(contentType)) {
        return NextResponse.json({ success: false, error: 'Unsupported image type' }, { status: 400 });
      }
      if (typeof body.size_bytes === 'number' && body.size_bytes > MAX_PHOTO_BYTES) {
        return NextResponse.json({ success: false, error: 'Image too large' }, { status: 400 });
      }
      const path = photoPath(leadId, randomUUID(), contentType);
      const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path);
      if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, path, signedUrl: data.signedUrl, token: data.token });
    }

    if (body.step === 'record') {
      const path = String(body.path || '');
      // The path is minted above, but re-check: a client must not be able to
      // attach another lead's photo (or an arbitrary object) to this lead.
      if (!pathBelongsToLead(path, leadId)) {
        return NextResponse.json({ success: false, error: 'Invalid path' }, { status: 400 });
      }
      const { data, error } = await supabase
        .from('lead_photos')
        .insert({
          lead_id: leadId,
          storage_path: path,
          caption: typeof body.caption === 'string' && body.caption.trim() ? body.caption.trim() : null,
          content_type: body.content_type ?? null,
          size_bytes: typeof body.size_bytes === 'number' ? body.size_bytes : null,
          width: typeof body.width === 'number' ? body.width : null,
          height: typeof body.height === 'number' ? body.height : null,
          created_by: admin.sub,
        })
        .select('*')
        .single();
      if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'note',
        content: `Photo added${data.caption ? `: ${data.caption}` : ''}`,
        created_by: admin.sub,
      });

      return NextResponse.json({ success: true, photo: data }, { status: 201 });
    }

    return NextResponse.json({ success: false, error: 'Unknown step' }, { status: 400 });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
