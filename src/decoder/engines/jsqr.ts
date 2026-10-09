import jsQR from 'jsqr';
import type { PixelMatrix } from '../../shared/types';
import type { Decoder } from '../fallback';

export function createJsQrDecoder(): Decoder {
  return {
    name: 'jsqr',
    async decode(matrix: PixelMatrix): Promise<string | null> {
      const r = jsQR(matrix.data, matrix.width, matrix.height, { inversionAttempts: 'dontInvert' });
      return r?.data ?? null;
    },
  };
}
