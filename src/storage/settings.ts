import browser from 'webextension-polyfill';
import type { Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...((stored[KEY] as Partial<Settings>) ?? {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ [KEY]: next });
  return next;
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[KEY]) {
    void import('./history').then((m) => m.prune(next(changes[KEY])));
  }
});

function next(change: { newValue?: unknown }): Settings {
  return { ...DEFAULT_SETTINGS, ...((change.newValue as Partial<Settings>) ?? {}) };
}
