import browser from 'webextension-polyfill';
import type { DecodeResult, ImageRef, PreprocessOptions } from '../shared/types';
import { DEFAULT_PREPROCESS } from '../shared/types';
import type { HostResponse } from '../shared/messages';
import type { DecoderHost } from './index';

const OFFSCREEN_URL = 'offscreen/index.html';

async function ensureDocument(): Promise<void> {
  const offscreen = (browser as unknown as { offscreen?: any }).offscreen;
  if (!offscreen) throw new Error('offscreen API unavailable');
  if (await offscreen.hasDocument?.()) return;
  await offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['DOM_SCRAPING'],
    justification:
      'QR decoding requires Canvas/ImageBitmap and WebAssembly, unavailable in service workers',
  });
}

export function create(): DecoderHost {
  return {
    kind: 'chrome-offscreen',
    async decode(ref: ImageRef, options: PreprocessOptions = DEFAULT_PREPROCESS): Promise<DecodeResult> {
      await ensureDocument();
      const requestId = crypto.randomUUID();
      const res = (await browser.runtime.sendMessage({
        type: 'DECODE',
        requestId,
        imageRef: ref,
        options,
        engines: ['jsqr', 'zxing-wasm'],
      })) as HostResponse | undefined;
      if (!res || res.type !== 'DECODE_RESULT') {
        return { success: false, error: 'ENGINE_LOAD_FAILED', attempts: [] };
      }
      return res.result;
    },
    async dispose() {
      await (browser as unknown as { offscreen?: any }).offscreen?.closeDocument?.();
    },
  };
}
