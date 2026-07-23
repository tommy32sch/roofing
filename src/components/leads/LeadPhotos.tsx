'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/layout/empty-state';
import { downscaleImage } from '@/lib/leads/downscale';
import { MAX_PHOTO_BYTES } from '@/lib/leads/photos';

interface Photo {
  id: string;
  caption: string | null;
  created_at: string;
  url: string | null;
  admin_users?: { name: string } | null;
}

/**
 * Damage photos for a lead.
 *
 * `capture="environment"` opens the rear camera directly on a phone, which is
 * the actual use: standing in front of the house, not picking from a library.
 * Desktop browsers ignore it and show a normal file picker.
 */
export function LeadPhotos({ leadId }: { leadId: string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/photos`);
      const data = await res.json();
      if (data.success) setPhotos(data.photos);
    } catch {
      // leave whatever is on screen
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  async function uploadOne(file: File) {
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error(`${file.name} is too large`);
      return;
    }
    const { blob, width, height, contentType } = await downscaleImage(file);

    const signRes = await fetch(`/api/admin/leads/${leadId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'sign', content_type: contentType, size_bytes: blob.size }),
    });
    const sign = await signRes.json();
    if (!sign.success) throw new Error(sign.error || 'Could not start upload');

    // Straight to storage — deliberately not through our API (body size limit).
    const put = await fetch(sign.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
    });
    if (!put.ok) throw new Error('Upload failed');

    const recRes = await fetch(`/api/admin/leads/${leadId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step: 'record', path: sign.path, content_type: contentType,
        size_bytes: blob.size, width, height,
      }),
    });
    const rec = await recRes.json();
    if (!rec.success) throw new Error(rec.error || 'Could not save photo');
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    setUploading(list.length);
    let failed = 0;
    for (const file of list) {
      try {
        await uploadOne(file);
      } catch (e) {
        failed++;
        toast.error(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (failed < list.length) {
      toast.success(`${list.length - failed} photo${list.length - failed === 1 ? '' : 's'} added`);
      load();
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function remove(photo: Photo) {
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/photos/${photo.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setPhotos((p) => p.filter((x) => x.id !== photo.id));
        toast.success('Photo deleted');
      } else {
        toast.error(data.error || 'Failed to delete photo');
      }
    } catch {
      toast.error('Failed to delete photo');
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            <Camera className="h-3.5 w-3.5" />
            Photos{photos.length > 0 ? ` (${photos.length})` : ''}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={uploading > 0}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mr-1 h-3 w-3" />
            {uploading > 0 ? `Uploading ${uploading}…` : 'Add'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid grid-cols-3 gap-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="aspect-square w-full rounded-md" />)}
          </div>
        ) : photos.length === 0 ? (
          <EmptyState
            icon={Camera}
            title="No photos yet"
            description="Add damage photos here — they're what carriers want to see on a claim."
            className="py-6"
          />
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo) => (
              <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-md border">
                {photo.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.url}
                    alt={photo.caption || 'Lead photo'}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    Unavailable
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => remove(photo)}
                  aria-label="Delete photo"
                  className="absolute right-1 top-1 rounded bg-background/80 p-1 text-destructive opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
