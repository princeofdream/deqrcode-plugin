import browser from 'webextension-polyfill';

export async function ensureContentScript(tabId: number): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ['assets/content.js'],
  });
}

export async function sendToTab<T>(tabId: number, message: unknown): Promise<T | null> {
  try {
    return (await browser.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return null;
  }
}

export async function ensureAndSend<T>(tabId: number, message: unknown): Promise<T | null> {
  await ensureContentScript(tabId);
  return sendToTab<T>(tabId, message);
}
