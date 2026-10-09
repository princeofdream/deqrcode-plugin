import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const langDirs = readdirSync('_locales');
const keysOf = (d: string) =>
  Object.keys(JSON.parse(readFileSync(`_locales/${d}/messages.json`, 'utf8'))).sort();

describe('i18n', () => {
  it('至少包含 zh_CN 与 en', () => {
    expect(langDirs).toContain('zh_CN');
    expect(langDirs).toContain('en');
  });

  it('各语言 key 完全一致', () => {
    const base = keysOf('zh_CN');
    for (const d of langDirs) expect(keysOf(d)).toEqual(base);
  });

  it('manifest 中引用的 __MSG_xxx__ 均有定义', () => {
    const manifest = readFileSync('manifest.base.json', 'utf8');
    const refs = [...manifest.matchAll(/__MSG_([a-zA-Z0-9_]+)__/g)].map((m) => m[1]!);
    const keys = keysOf('zh_CN');
    for (const r of refs) expect(keys).toContain(r);
  });

  it('每个 message 都有非空的 message 与 description', () => {
    for (const d of langDirs) {
      const json = JSON.parse(readFileSync(`_locales/${d}/messages.json`, 'utf8'));
      for (const [key, value] of Object.entries<any>(json)) {
        expect(value.message, `${d}/${key}`).toBeTruthy();
        expect(value.description, `${d}/${key}`).toBeTruthy();
      }
    }
  });
});
