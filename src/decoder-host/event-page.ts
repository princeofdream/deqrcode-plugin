import type { DecodeResult, ImageRef, PreprocessOptions } from '../shared/types';
import { DEFAULT_PREPROCESS } from '../shared/types';
import { decodeWithFallback } from '../decoder/fallback';
import { imageRefToMatrix } from './image-ref';
import type { DecoderHost } from './index';

export function create(): DecoderHost {
  return {
    kind: 'firefox-event-page',
    async decode(ref: ImageRef, options: PreprocessOptions = DEFAULT_PREPROCESS): Promise<DecodeResult> {
      try {
        const matrix = await imageRefToMatrix(ref);
        if (matrix.width < 8 || matrix.height < 8) {
          return { success: false, error: 'INVALID_IMAGE', attempts: [] };
        }
        return await decodeWithFallback(matrix, options);
      } catch (e) {
        return {
          success: false,
          error: 'IMAGE_UNREADABLE',
          attempts: [{ engine: '-', variant: '-', ms: 0, ok: false, error: String(e) }],
        };
      }
    },
    async dispose() {},
  };
}
