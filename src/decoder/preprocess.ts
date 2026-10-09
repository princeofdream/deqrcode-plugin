import type { PixelMatrix, PreprocessOptions } from '../shared/types';

export interface Variant {
  matrix: PixelMatrix;
  descriptor: string;
}

export function createMatrix(width: number, height: number): PixelMatrix {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

function luminance(d: Uint8ClampedArray, o: number): number {
  return 0.299 * d[o]! + 0.587 * d[o + 1]! + 0.114 * d[o + 2]!;
}

export function toGrayscale(src: PixelMatrix): PixelMatrix {
  const out = createMatrix(src.width, src.height);
  for (let i = 0; i < src.width * src.height; i++) {
    const o = i * 4;
    const y = luminance(src.data, o);
    out.data[o] = y; out.data[o + 1] = y; out.data[o + 2] = y; out.data[o + 3] = 255;
  }
  return out;
}

/** 1% / 99% 分位拉伸，用于低对比度图 */
export function autoContrast(src: PixelMatrix): PixelMatrix {
  const n = src.width * src.height;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[src.data[i * 4]!]!++;
  const cut = Math.max(1, Math.floor(n * 0.01));
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]!; if (acc >= cut) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]!; if (acc >= cut) { hi = v; break; } }
  if (hi - lo < 8) return src;
  const out = createMatrix(src.width, src.height);
  const scale = 255 / (hi - lo);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const v = Math.min(255, Math.max(0, (src.data[o]! - lo) * scale));
    out.data[o] = v; out.data[o + 1] = v; out.data[o + 2] = v; out.data[o + 3] = 255;
  }
  return out;
}

export function scaleMatrix(src: PixelMatrix, factor: number): PixelMatrix {
  const w = Math.max(1, Math.round(src.width * factor));
  const h = Math.max(1, Math.round(src.height * factor));
  const out = createMatrix(w, h);
  const sx = src.width / w;
  const sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(src.height, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(src.width, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * src.width + xx) * 4;
          r += src.data[o]!; g += src.data[o + 1]!; b += src.data[o + 2]!; n++;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = 255;
    }
  }
  return out;
}

export function downscaleToMaxEdge(src: PixelMatrix, maxEdge: number): PixelMatrix {
  const longest = Math.max(src.width, src.height);
  if (longest <= maxEdge) return src;
  return scaleMatrix(src, maxEdge / longest);
}

export function invert(src: PixelMatrix): PixelMatrix {
  const out = createMatrix(src.width, src.height);
  for (let i = 0; i < src.data.length; i += 4) {
    out.data[i] = 255 - src.data[i]!;
    out.data[i + 1] = 255 - src.data[i + 1]!;
    out.data[i + 2] = 255 - src.data[i + 2]!;
    out.data[i + 3] = 255;
  }
  return out;
}

export function rotate90(src: PixelMatrix, times: number): PixelMatrix {
  let m = src;
  for (let t = 0; t < ((times % 4) + 4) % 4; t++) {
    const out = createMatrix(m.height, m.width);
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const from = (y * m.width + x) * 4;
        const to = (x * m.height + (m.height - 1 - y)) * 4;
        out.data[to] = m.data[from]!;
        out.data[to + 1] = m.data[from + 1]!;
        out.data[to + 2] = m.data[from + 2]!;
        out.data[to + 3] = 255;
      }
    }
    m = out;
  }
  return m;
}

export function enumerateVariants(src: PixelMatrix, opts: PreprocessOptions): Variant[] {
  const normalized = downscaleToMaxEdge(src, opts.maxEdge);
  const base = opts.grayscale ? autoContrast(toGrayscale(normalized)) : autoContrast(normalized);
  const out: Variant[] = [];
  for (const scale of [...opts.scales].sort((a, b) => b - a)) {
    const scaled = scale >= 1 ? base : scaleMatrix(base, scale);
    for (const rot of opts.rotations) {
      const rotated = rotate90(scaled, rot / 90);
      out.push({ matrix: rotated, descriptor: `s${scale}r${rot}` });
      if (opts.tryInverted) out.push({ matrix: invert(rotated), descriptor: `s${scale}r${rot}i` });
    }
  }
  return out;
}

/** 重叠分块：仅在全图失败时使用，避免把码切开 */
export function generateTiles(src: PixelMatrix, sizeRatio = 0.5, overlapRatio = 0.25): PixelMatrix[] {
  const step = Math.max(64, Math.floor(Math.min(src.width, src.height) * sizeRatio));
  const stride = Math.max(1, Math.floor(step * (1 - overlapRatio)));
  const tiles: PixelMatrix[] = [];
  for (let y = 0; y < src.height; y += stride) {
    for (let x = 0; x < src.width; x += stride) {
      const w = Math.min(step, src.width - x);
      const h = Math.min(step, src.height - y);
      if (w < 32 || h < 32) continue;
      const tile = createMatrix(w, h);
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          const from = ((y + yy) * src.width + (x + xx)) * 4;
          const to = (yy * w + xx) * 4;
          tile.data[to] = src.data[from]!;
          tile.data[to + 1] = src.data[from + 1]!;
          tile.data[to + 2] = src.data[from + 2]!;
          tile.data[to + 3] = 255;
        }
      }
      tiles.push(tile);
    }
  }
  return tiles;
}
