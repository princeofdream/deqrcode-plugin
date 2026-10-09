import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

describe('settings defaults', () => {
  it('默认开启自动复制、关闭自动打开 URL', () => {
    expect(DEFAULT_SETTINGS.autoCopy).toBe(true);
    expect(DEFAULT_SETTINGS.autoOpenUrl).toBe(false);
  });
  it('默认保留 30 天 / 500 条', () => {
    expect(DEFAULT_SETTINGS.retentionDays).toBe(30);
    expect(DEFAULT_SETTINGS.retentionCount).toBe(500);
  });
});
