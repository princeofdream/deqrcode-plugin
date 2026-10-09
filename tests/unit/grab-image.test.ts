import { describe, it, expect } from 'vitest';
import { findTargetImage, MAX_PIXELS } from '../../src/content/grab-image';

function docWith(attrs: Record<string, unknown>[]) {
  const images = attrs.map((a) => {
    const el: Record<string, unknown> = {
      tagName: 'IMG',
      complete: true,
      naturalWidth: 200,
      naturalHeight: 200,
    };
    Object.assign(el, a);
    return el;
  });
  return { images } as unknown as Document;
}

describe('findTargetImage', () => {
  it('优先匹配 currentSrc', () => {
    const doc = docWith([{ src: 'https://s/a.png', currentSrc: 'https://s/b.png' }]);
    expect(findTargetImage(doc, 'https://s/b.png')).toBe(doc.images[0]);
  });
  it('回退匹配 src', () => {
    const doc = docWith([{ src: 'https://s/a.png' }]);
    expect(findTargetImage(doc, 'https://s/a.png')).toBe(doc.images[0]);
  });
  it('跳过未解码完成的懒加载占位图', () => {
    const doc = docWith([{ src: 'https://s/a.png', complete: false }]);
    expect(findTargetImage(doc, 'https://s/a.png')).toBeNull();
  });
  it('找不到返回 null', () => {
    expect(findTargetImage(docWith([]), 'https://s/x.png')).toBeNull();
  });
});

describe('MAX_PIXELS', () => {
  it('限制单图最大像素数以防 OOM', () => {
    expect(MAX_PIXELS).toBe(40_000_000);
  });
});
