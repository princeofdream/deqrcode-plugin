import { describe, it, expect } from 'vitest';
import {
  createMatrix, toGrayscale, downscaleToMaxEdge, invert, rotate90,
  enumerateVariants, generateTiles,
} from '../../src/decoder/preprocess';
import { DEFAULT_PREPROCESS } from '../../src/shared/types';

function solid(w: number, h: number, rgb: [number, number, number]) {
  const m = createMatrix(w, h);
  for (let i = 0; i < w * h; i++) {
    m.data[i * 4] = rgb[0]; m.data[i * 4 + 1] = rgb[1]; m.data[i * 4 + 2] = rgb[2]; m.data[i * 4 + 3] = 255;
  }
  return m;
}

describe('preprocess', () => {
  it('toGrayscale 保留 alpha 并输出灰度', () => {
    const g = toGrayscale(solid(2, 2, [255, 0, 0]));
    // 0.299*255 = 76.245，写入 Uint8ClampedArray 后取整为 76
    expect(g.data[0]).toBe(76);
    expect(g.data[1]).toBe(g.data[0]);
    expect(g.data[3]).toBe(255);
  });

  it('downscaleToMaxEdge 按长边缩放到阈值', () => {
    const out = downscaleToMaxEdge(solid(4000, 1000, [0, 0, 0]), 1600);
    expect(out.width).toBe(1600);
    expect(out.height).toBe(400);
  });

  it('downscaleToMaxEdge 不放大小图', () => {
    const src = solid(100, 50, [0, 0, 0]);
    expect(downscaleToMaxEdge(src, 1600)).toBe(src);
  });

  it('invert 反转像素', () => {
    const inv = invert(solid(1, 1, [10, 20, 30]));
    expect([inv.data[0], inv.data[1], inv.data[2]]).toEqual([245, 235, 225]);
  });

  it('rotate90 旋转 4 次回到原图', () => {
    const src = createMatrix(2, 3);
    src.data.set([1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255]);
    let r = src;
    for (let i = 0; i < 4; i++) r = rotate90(r, 1);
    expect(r.width).toBe(src.width);
    expect(r.height).toBe(src.height);
    expect(Array.from(r.data)).toEqual(Array.from(src.data));
  });

  it('enumerateVariants 覆盖 缩放×旋转×反色 且首个为原尺寸不旋转', () => {
    const variants = enumerateVariants(solid(3000, 2000, [128, 128, 128]), DEFAULT_PREPROCESS);
    expect(variants[0]!.descriptor).toBe('s1r0');
    expect(variants[1]!.descriptor).toBe('s1r0i');
    const descs = new Set(variants.map((v) => v.descriptor));
    expect(descs.size).toBe(DEFAULT_PREPROCESS.scales.length * 4 * 2);
    expect(variants.every((v) => v.matrix.width <= 1600)).toBe(true);
  });

  it('generateTiles 产出重叠且覆盖全图的块', () => {
    const tiles = generateTiles(solid(1000, 800, [0, 0, 0]), 0.5, 0.25);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.every((t) => t.width <= 1000 && t.height <= 800)).toBe(true);
  });
});
