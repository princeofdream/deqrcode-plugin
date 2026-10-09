import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';

describe('fixture set', () => {
  it('样本集已生成且覆盖各类别', () => {
    const files = readdirSync('tests/fixtures/qr').filter((f) => f.endsWith('.png'));
    expect(files.length).toBeGreaterThanOrEqual(40);
    expect(files.some((f) => f.includes('-inverted'))).toBe(true);
    expect(files.some((f) => f.includes('-rot90'))).toBe(true);
    expect(files.some((f) => f.includes('-small-in-large'))).toBe(true);
    expect(files.some((f) => f.startsWith('negative-'))).toBe(true);
  });
});
