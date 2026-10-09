import browser from 'webextension-polyfill';
import type { BackgroundCommand, ContentReply } from '../shared/messages';
import { isBackgroundCommand } from '../shared/messages';
import { grabPixels } from './grab-image';

const w = window as unknown as { __DEQRCODE_LOADED__?: boolean };
if (!w.__DEQRCODE_LOADED__) {
  w.__DEQRCODE_LOADED__ = true;

  browser.runtime.onMessage.addListener((msg: unknown): Promise<unknown> | undefined => {
    if (!isBackgroundCommand(msg)) return undefined;
    const cmd = msg as BackgroundCommand;

    if (cmd.type === 'GRAB_PIXELS') {
      return Promise.resolve(grabPixels(cmd.srcUrl) satisfies ContentReply);
    }

    return undefined;
  });
}
