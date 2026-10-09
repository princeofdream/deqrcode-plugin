import type { DecodeResult, ImageRef, PreprocessOptions } from '../shared/types';
import { DEFAULT_PREPROCESS } from '../shared/types';
import { registerEngines } from '../decoder/fallback';
import { createJsQrDecoder } from '../decoder/engines/jsqr';
import { createZxingDecoder } from '../decoder/engines/zxing';

export type HostKind = 'firefox-event-page' | 'chrome-offscreen';

export interface DecoderHost {
  readonly kind: HostKind;
  decode(ref: ImageRef, options?: PreprocessOptions): Promise<DecodeResult>;
  dispose(): Promise<void>;
}

export function pickHostKind(g: Record<string, any> = globalThis as unknown as Record<string, any>): HostKind {
  const offscreen = g?.chrome?.offscreen;
  if (offscreen && typeof offscreen.createDocument === 'function') return 'chrome-offscreen';
  return 'firefox-event-page';
}

let cached: Promise<DecoderHost> | null = null;

export function getDecoderHost(): Promise<DecoderHost> {
  if (!cached) {
    cached = (async () => {
      registerEngines(createJsQrDecoder, createZxingDecoder);
      const kind = pickHostKind();
      const mod =
        kind === 'chrome-offscreen'
          ? await import('./chrome-offscreen')
          : await import('./event-page');
      return mod.create();
    })();
  }
  return cached;
}

export { DEFAULT_PREPROCESS };
