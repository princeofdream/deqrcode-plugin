import browser from 'webextension-polyfill';
import { getDecoderHost } from '../decoder-host';
import type { ImageRef } from '../shared/types';

export async function decodeImage(ref: ImageRef) {
  const host = await getDecoderHost();
  return host.decode(ref);
}

browser.runtime.onInstalled.addListener(() => {
  console.log('deQRCode installed, host kind will be resolved lazily');
});

browser.runtime.onMessage.addListener(async (msg: unknown) => {
  if ((msg as { type?: string })?.type === 'PING') return { pong: true, kind: (await getDecoderHost()).kind };
  return undefined;
});
