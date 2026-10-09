import browser from 'webextension-polyfill';
import { getDecoderHost } from '../decoder-host';
import { MENU_AREA_SELECT, MENU_DECODE_IMAGE, MENU_OPEN_HISTORY, registerMenus } from './menus';
import { ensureAndSend } from './inject';
import { runDecodePipeline, type PipelineContext } from './pipeline';
import type { AreaSelection, ContentReply } from '../shared/messages';
import type { DecodeResult, ImageRef } from '../shared/types';
import { getSettings } from '../storage/settings';

browser.runtime.onInstalled.addListener(() => {
  void registerMenus();
});
browser.runtime.onStartup?.addListener(() => {
  void registerMenus();
});

async function baseContext(tabId: number): Promise<PipelineContext> {
  return {
    tabId,
    settings: await getSettings(),
    async grabPixels(srcUrl) {
      const reply = await ensureAndSend<ContentReply>(tabId, { type: 'GRAB_PIXELS', srcUrl });
      return reply ?? { ok: false, error: 'NOT_FOUND' };
    },
    async captureArea() {
      return null;
    },
    async fetchBlob(url) {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`fetch failed ${res.status}`);
      return res.blob();
    },
    async hasHostPermission() {
      return browser.permissions.contains({ origins: ['<all_urls>'] });
    },
    async requestHostPermission() {
      return browser.permissions.request({ origins: ['<all_urls>'] });
    },
    async decode(ref: ImageRef) {
      return (await getDecoderHost()).decode(ref);
    },
    async showResult(result, autoCopy) {
      const ok = await ensureAndSend<boolean>(tabId, { type: 'SHOW_RESULT', result, autoCopy });
      return ok === true;
    },
    async notify(message) {
      await browser.notifications.create({
        type: 'basic',
        iconUrl: 'icons/48.png',
        title: 'deQRCode',
        message,
      });
    },
    async record(result: DecodeResult, sourceUrl?: string) {
      if (!result.success) return;
      const { addRecord } = await import('../storage/history');
      await addRecord({
        content: result.data,
        encoding: result.encoding,
        contentType: result.contentType,
        sourceUrl,
      });
    },
  };
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  const tabId = tab.id;

  if (info.menuItemId === MENU_OPEN_HISTORY) {
    const action = browser.action as unknown as { openPopup?: () => Promise<void> };
    if (typeof action.openPopup === 'function') {
      await action.openPopup();
    } else {
      // Firefox 可能不支持 action.openPopup，退回在新标签打开历史页面
      await browser.tabs.create({ url: browser.runtime.getURL('popup/index.html') });
    }
    return;
  }

  if (info.menuItemId === MENU_AREA_SELECT) {
    await ensureAndSend(tabId, { type: 'START_AREA_SELECT' });
    return;
  }

  if (info.menuItemId === MENU_DECODE_IMAGE && info.srcUrl) {
    await runDecodePipeline({ ...(await baseContext(tabId)), srcUrl: info.srcUrl });
  }
});

browser.runtime.onMessage.addListener(async (msg: unknown) => {
  const m = msg as { type?: string; url?: string; selection?: AreaSelection };

  if (m.type === 'OPEN_URL' && m.url) {
    await browser.tabs.create({ url: m.url });
    return true;
  }

  if (m.type === 'PING') {
    return { pong: true, kind: (await getDecoderHost()).kind };
  }

  return undefined;
});
