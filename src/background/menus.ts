import browser from 'webextension-polyfill';

export const MENU_DECODE_IMAGE = 'deqrcode-decode-image';
export const MENU_AREA_SELECT = 'deqrcode-area-select';
export const MENU_OPEN_HISTORY = 'deqrcode-open-history';

export async function registerMenus(): Promise<void> {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: MENU_DECODE_IMAGE,
    title: browser.i18n.getMessage('menuDecodeImage'),
    contexts: ['image'],
  });
  browser.contextMenus.create({
    id: MENU_AREA_SELECT,
    title: browser.i18n.getMessage('menuAreaSelect'),
    contexts: ['page'],
  });
  browser.contextMenus.create({
    id: MENU_OPEN_HISTORY,
    title: browser.i18n.getMessage('menuOpenHistory'),
    contexts: ['page'],
  });
}
