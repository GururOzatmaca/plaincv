import type { Photo } from '@/schema/resume';

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
const MAX_FILE = 12_000_000;

/**
 * The whole library is dumped into localStorage as a crash pad on pagehide, and that write
 * fails silently past ~5MB - so every photo is re-encoded small before it reaches the store.
 */
const TARGET_BYTES = 300_000;
const HARD_BYTES = 400_000;

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(z) ? z : 1));

/** Pan is a percentage of the frame; past this the scaled image stops covering the frame. */
export const panLimit = (zoom: number): number => ((clampZoom(zoom) - 1) / 2) * 100;

export function clampPan(zoom: number, x: number, y: number): { x: number; y: number } {
  const lim = panLimit(zoom);
  const fix = (v: number) => (Number.isFinite(v) ? Math.min(lim, Math.max(-lim, v)) : 0);
  return { x: fix(x), y: fix(y) };
}

export const isPhotoSrc = (s: unknown): s is string => typeof s === 'string' && s.startsWith('data:image/');

export const newPhoto = (src: string): Photo => ({ src, zoom: 1, x: 0, y: 0 });

function encode(bitmap: ImageBitmap, longest: number, quality: number): string {
  const ratio = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

export type PhotoError = 'type' | 'size' | 'decode' | 'huge';
export type PhotoResult = { src: string } | { error: PhotoError };

export async function loadPhotoFile(file: File): Promise<PhotoResult> {
  if (!TYPES.includes(file.type as (typeof TYPES)[number])) return { error: 'type' };
  if (file.size > MAX_FILE) return { error: 'size' };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { error: 'decode' };
  }

  try {
    let src = encode(bitmap, 768, 0.82);
    if (src.length > TARGET_BYTES) src = encode(bitmap, 768, 0.7);
    if (src.length > TARGET_BYTES) src = encode(bitmap, 512, 0.7);
    return src.length > HARD_BYTES ? { error: 'huge' } : { src };
  } catch {
    return { error: 'decode' };
  } finally {
    bitmap.close();
  }
}

export function pickImageFile(onPick: (file: File) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = TYPES.join(',');
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) onPick(f);
  };
  input.click();
}

export const imageFromDrop = (dt: DataTransfer | null): File | null => {
  const f = dt?.files?.[0];
  return f && TYPES.includes(f.type as (typeof TYPES)[number]) ? f : null;
};
