// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copyText } from '../../src/content/copy';

beforeEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('copyText', () => {
  it('优先使用 navigator.clipboard.writeText', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('abc')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
  });

  it('clipboard 不可用时回退 execCommand', async () => {
    vi.stubGlobal('navigator', {});
    const execCommand = vi.fn(() => true);
    vi.stubGlobal('document', {
      body: { appendChild: () => {}, removeChild: () => {} },
      createElement: () => ({ style: {}, value: '', select() {}, setAttribute() {} }),
      execCommand,
    });
    expect(await copyText('abc')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('两者都失败返回 false', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) },
    });
    vi.stubGlobal('document', {
      body: { appendChild: () => {}, removeChild: () => {} },
      createElement: () => ({ style: {}, value: '', select() {}, setAttribute() {} }),
      execCommand: () => false,
    });
    expect(await copyText('abc')).toBe(false);
  });
});
