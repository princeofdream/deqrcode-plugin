import type { PixelMatrix } from '../../shared/types';
import type { Decoder } from '../fallback';

function toImageData(m: PixelMatrix): ImageData {
  return new ImageData(new Uint8ClampedArray(m.data), m.width, m.height);
}

export async function createZxingDecoder(): Promise<Decoder> {
  const mod = await import('zxing-wasm');
  return {
    name: 'zxing-wasm',
    async decode(matrix: PixelMatrix): Promise<string | null> {
      const results = await mod.readBarcodes(toImageData(matrix), {
        formats: ['QRCode'],
        tryHarder: true,
        maxNumberOfSymbols: 1,
      });
      const first = results[0];
      if (!first) return null;
      const text = (first as { text?: string }).text;
      if (text) return text;
      const bytes = (first as { bytes?: Uint8Array }).bytes;
      if (bytes?.length) return btoa(String.fromCharCode(...bytes));
      return null;
    },
  };
}
