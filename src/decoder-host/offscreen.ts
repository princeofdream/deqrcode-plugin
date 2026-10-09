import browser from 'webextension-polyfill';
import type { HostRequest, HostResponse } from '../shared/messages';
import { decodeWithFallback, registerEngines } from '../decoder/fallback';
import { createJsQrDecoder } from '../decoder/engines/jsqr';
import { createZxingDecoder } from '../decoder/engines/zxing';
import { imageRefToMatrix } from './image-ref';

registerEngines(createJsQrDecoder, createZxingDecoder);

browser.runtime.onMessage.addListener(async (msg: unknown): Promise<HostResponse | undefined> => {
  const req = msg as HostRequest;
  if (req?.type !== 'DECODE') return undefined;
  try {
    const matrix = await imageRefToMatrix(req.imageRef);
    const result = await decodeWithFallback(matrix, req.options);
    return { type: 'DECODE_RESULT', requestId: req.requestId, result };
  } catch {
    return {
      type: 'DECODE_RESULT',
      requestId: req.requestId,
      result: { success: false, error: 'IMAGE_UNREADABLE', attempts: [] },
    };
  }
});
