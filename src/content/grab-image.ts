import type { ContentReply } from '../shared/messages';

export const MAX_PIXELS = 40_000_000;

export function findTargetImage(doc: Document, srcUrl: string): HTMLImageElement | null {
  const images = Array.from(doc.images ?? []) as HTMLImageElement[];
  let fallback: HTMLImageElement | null = null;
  for (const img of images) {
    const current = img.currentSrc || img.src || '';
    if (current === srcUrl) {
      if (img.complete && img.naturalWidth > 0) return img;
      fallback = img;
    }
  }
  if (fallback && fallback.complete && fallback.naturalWidth > 0) return fallback;
  return null;
}

export function grabPixels(srcUrl: string): ContentReply {
  const img = findTargetImage(document, srcUrl);
  if (!img) return { ok: false, error: 'NOT_FOUND' };

  const w = img.naturalWidth || img.clientWidth;
  const h = img.naturalHeight || img.clientHeight;
  if (!w || !h) return { ok: false, error: 'NOT_DECODED' };
  if (w * h > MAX_PIXELS) return { ok: false, error: 'TOO_LARGE' };

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ok: false, error: 'NOT_DECODED' };
  ctx.drawImage(img, 0, 0, w, h);

  try {
    const { data } = ctx.getImageData(0, 0, w, h);
    return { ok: true, data: data.buffer.slice(0) as ArrayBuffer, width: w, height: h };
  } catch {
    // canvas 被跨域图片污染 → 交由 background 走 fetch 策略
    return { ok: false, error: 'TAINTED' };
  }
}
