import { describe, it, expect } from 'vitest';
import { decodeWithFallback } from '../../src/decoder/fallback';
import { createMatrix } from '../../src/decoder/preprocess';
import { DEFAULT_PREPROCESS } from '../../src/shared/types';

function noise(w: number, h: number) {
  const m = createMatrix(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = (i * 37) % 256;
    m.data[i * 4] = v; m.data[i * 4 + 1] = v; m.data[i * 4 + 2] = v; m.data[i * 4 + 3] = 255;
  }
  return m;
}

describe('decodeWithFallback', () => {
  it('纯噪声图返回 NO_QR_CODE_DETECTED 且记录 attempts', async () => {
    const res = await decodeWithFallback(noise(64, 64), { ...DEFAULT_PREPROCESS, tileScan: false });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('NO_QR_CODE_DETECTED');
    expect(res.attempts.length).toBeGreaterThan(0);
  });

  it('超时返回 TIMEOUT', async () => {
    const res = await decodeWithFallback(noise(256, 256), { ...DEFAULT_PREPROCESS, tileScan: false }, 0);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('TIMEOUT');
  });

  it('注入引擎命中时返回 success 并带 contentType', async () => {
    const res = await decodeWithFallback(noise(32, 32), { ...DEFAULT_PREPROCESS, tileScan: false }, 5000, [
      { name: 'fake', decode: async () => 'https://example.com/x' },
    ]);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toBe('https://example.com/x');
      expect(res.contentType).toBe('url');
      expect(res.engineUsed).toBe('fake');
    }
  });
});
