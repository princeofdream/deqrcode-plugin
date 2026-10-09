import { describe, it, expect, vi } from 'vitest';

// pipeline 会注入 content script，Node 环境下屏蔽（webextension-polyfill 需要浏览器全局）
vi.mock('../../src/background/inject', () => ({
  ensureContentScript: vi.fn(async () => {}),
  sendToTab: vi.fn(async () => null),
  ensureAndSend: vi.fn(async () => null),
}));

import { runDecodePipeline } from '../../src/background/pipeline';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import type { Settings } from '../../src/shared/types';

type Ctx = Parameters<typeof runDecodePipeline>[0];

function ctx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    tabId: 1,
    srcUrl: 'https://site.test/a.png',
    settings: { ...DEFAULT_SETTINGS } as Settings,
    grabPixels: vi.fn(async () => ({ ok: true, data: new ArrayBuffer(4), width: 1, height: 1 }) as const),
    captureArea: vi.fn(async () => null),
    fetchBlob: vi.fn(async () => new Blob([new Uint8Array([1])], { type: 'image/png' })),
    hasHostPermission: vi.fn(async () => true),
    requestHostPermission: vi.fn(async () => true),
    decode: vi.fn(
      async () =>
        ({
          success: true,
          data: 'https://example.com',
          encoding: 'utf8',
          contentType: 'url',
          engineUsed: 'jsqr',
          variant: 's1r0',
          attempts: [],
        }) as const
    ),
    showResult: vi.fn(async () => true),
    notify: vi.fn(async () => {}),
    record: vi.fn(async () => {}),
    ...overrides,
  } as Ctx;
}

describe('runDecodePipeline', () => {
  it('策略①成功时不发起 fetch、不申请权限', async () => {
    const c = ctx();
    await runDecodePipeline(c);
    expect(c.grabPixels).toHaveBeenCalledTimes(1);
    expect(c.fetchBlob).not.toHaveBeenCalled();
    expect(c.requestHostPermission).not.toHaveBeenCalled();
    expect(c.showResult).toHaveBeenCalledTimes(1);
  });

  it('策略①返回 TAINTED 时回退到 fetch', async () => {
    const c = ctx({ grabPixels: vi.fn(async () => ({ ok: false, error: 'TAINTED' }) as const) });
    await runDecodePipeline(c);
    expect(c.fetchBlob).toHaveBeenCalledTimes(1);
    expect(c.decode).toHaveBeenCalledTimes(1);
  });

  it('无宿主权限时先申请，用户拒绝则不再 fetch', async () => {
    const c = ctx({
      grabPixels: vi.fn(async () => ({ ok: false, error: 'TAINTED' }) as const),
      hasHostPermission: vi.fn(async () => false),
      requestHostPermission: vi.fn(async () => false),
    });
    await runDecodePipeline(c);
    expect(c.requestHostPermission).toHaveBeenCalledTimes(1);
    expect(c.fetchBlob).not.toHaveBeenCalled();
    expect(c.notify).toHaveBeenCalledTimes(1);
  });

  it('解码失败时展示失败结果且不写历史', async () => {
    const c = ctx({
      decode: vi.fn(async () => ({ success: false, error: 'NO_QR_CODE_DETECTED', attempts: [] }) as const),
    });
    await runDecodePipeline(c);
    expect(c.showResult).toHaveBeenCalledTimes(1);
    expect(c.record).not.toHaveBeenCalled();
  });

  it('成功且历史开启时写入历史', async () => {
    const c = ctx();
    await runDecodePipeline(c);
    expect(c.record).toHaveBeenCalledTimes(1);
  });

  it('浮层展示失败时降级为系统通知', async () => {
    const c = ctx({ showResult: vi.fn(async () => false) });
    await runDecodePipeline(c);
    expect(c.notify).toHaveBeenCalledTimes(1);
  });
});
