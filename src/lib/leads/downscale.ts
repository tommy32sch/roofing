import { MAX_IMAGE_DIMENSION, JPEG_QUALITY } from './photos';

/**
 * Shrink a photo in the browser before uploading.
 *
 * A modern phone camera produces 4–12MB files. Roof damage is perfectly legible
 * at 1600px, so downscaling turns a 5MB original into roughly 300–500KB. That's
 * the difference between an upload that completes on a job site and one that
 * doesn't — and it keeps storage costs proportionate.
 *
 * Falls back to the original file if anything goes wrong: a slightly slow
 * upload beats losing the photo a rep just took.
 */
export async function downscaleImage(
  file: File
): Promise<{ blob: Blob; width: number; height: number; contentType: string }> {
  const original = {
    blob: file as Blob,
    width: 0,
    height: 0,
    contentType: file.type || 'image/jpeg',
  };

  // HEIC can't be decoded by canvas in most browsers — send it as-is.
  if (file.type === 'image/heic') return original;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));

    // Already small enough — re-encoding would only lose quality.
    if (scale === 1) {
      bitmap.close?.();
      return { ...original, width, height };
    }

    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return original;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob) return original;

    return { blob, width: w, height: h, contentType: 'image/jpeg' };
  } catch {
    return original;
  }
}
