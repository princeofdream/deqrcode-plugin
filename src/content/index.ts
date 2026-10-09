import browser from 'webextension-polyfill';
import type { BackgroundCommand, ContentReply } from '../shared/messages';
import { isBackgroundCommand } from '../shared/messages';
import { grabPixels } from './grab-image';
import { showOverlay } from './overlay';
import { copyText } from './copy';

const w = window as unknown as { __DEQRCODE_LOADED__?: boolean };
if (!w.__DEQRCODE_LOADED__) {
  w.__DEQRCODE_LOADED__ = true;

  browser.runtime.onMessage.addListener((msg: unknown): Promise<unknown> | undefined => {
    if (!isBackgroundCommand(msg)) return undefined;
    const cmd = msg as BackgroundCommand;

    if (cmd.type === 'GRAB_PIXELS') {
      return Promise.resolve(grabPixels(cmd.srcUrl) satisfies ContentReply);
    }

    if (cmd.type === 'SHOW_RESULT') {
      return (async () => {
        let copied = false;
        if (cmd.autoCopy && cmd.result.success) copied = await copyText(cmd.result.data);
        showOverlay({
          result: cmd.result,
          copied,
          onOpen: openLink,
          onCopy: copyText,
        });
        return true;
      })();
    }

    return undefined;
  });
}

function openLink(url: string): void {
  void browser.runtime.sendMessage({ type: 'OPEN_URL', url });
}
