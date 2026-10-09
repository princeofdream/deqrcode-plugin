import { describe, it, expect } from 'vitest';
import { pickHostKind } from '../../src/decoder-host/index';

describe('pickHostKind', () => {
  it('存在 chrome.offscreen 时选 chrome-offscreen', () => {
    const g = { chrome: { offscreen: { createDocument: () => {} } } } as unknown as Record<string, any>;
    expect(pickHostKind(g)).toBe('chrome-offscreen');
  });
  it('不存在时回落到 firefox-event-page', () => {
    expect(pickHostKind({} as Record<string, any>)).toBe('firefox-event-page');
    expect(pickHostKind({ chrome: {} } as Record<string, any>)).toBe('firefox-event-page');
  });
});
