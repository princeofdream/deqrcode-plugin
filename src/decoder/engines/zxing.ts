import type { PixelMatrix } from '../../shared/types';
import type { Decoder } from '../fallback';

/** 不引入 webextension-polyfill，保持解码核心可在 Node 中被测试 */
function runtimeUrl(path: string): string {
  const g = globalThis as unknown as { browser?: any; chrome?: any };
  const api = g.browser ?? g.chrome;
  return api?.runtime?.getURL?.(path) ?? path;
}

function toImageData(m: PixelMatrix): ImageData {
  return new ImageData(new Uint8ClampedArray(m.data), m.width, m.height);
}

export async function createZxingDecoder(): Promise<Decoder> {
  const mod = await import('zxing-wasm');
  // 显式指定 wasm 位置：构建时把 zxing_full.wasm 拷到 dist/assets/chunks/，
  // 避免 Emscripten 按相对路径解析到不存在的地址（默认解析依赖 import.meta.url）
  mod.prepareZXingModule({
    overrides: {
      locateFile: (path: string) => runtimeUrl(`assets/chunks/${path}`),
    },
  });
  return {
    name: 'zxing-wasm',
    async decode(matrix: PixelMatrix): Promise<string | null> {
      const results = await mod.readBarcodes(toImageData(matrix), {
        formats: ['QRCode'],
        tryHarder: true,
        maxNumberOfSymbols: 1,
      });
      const first = results[0];
      if (!first) return null;
      const text = (first as { text?: string }).text;
      if (text) return text;
      const bytes = (first as { bytes?: Uint8Array }).bytes;
      if (bytes?.length) return btoa(String.fromCharCode(...bytes));
      return null;
    },
  };
}
