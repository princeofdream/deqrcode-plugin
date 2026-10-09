import type { ImageRef, PixelMatrix } from '../shared/types';

function bitmapToMatrix(bitmap: ImageBitmap): PixelMatrix {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : Object.assign(document.createElement('canvas'), {
          width: bitmap.width,
          height: bitmap.height,
        });
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error('2D context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { data, width: bitmap.width, height: bitmap.height };
}

async function blobToMatrix(blob: Blob): Promise<PixelMatrix> {
  const bitmap = await createImageBitmap(blob);
  try {
    return bitmapToMatrix(bitmap);
  } finally {
    bitmap.close?.();
  }
}

export async function imageRefToMatrix(ref: ImageRef): Promise<PixelMatrix> {
  if (ref.kind === 'pixels') {
    return { data: new Uint8ClampedArray(ref.data), width: ref.width, height: ref.height };
  }
  if (ref.kind === 'blob') return blobToMatrix(ref.blob);
  const res = await fetch(ref.url, { credentials: 'include' });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return blobToMatrix(await res.blob());
}
