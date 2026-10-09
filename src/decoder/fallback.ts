import type { DecodeResult, EngineAttempt, PixelMatrix, PreprocessOptions } from '../shared/types';
import { DEFAULT_PREPROCESS } from '../shared/types';
import { classify } from '../shared/classify';
import { enumerateVariants, generateTiles, invert } from './preprocess';

export interface Decoder {
  readonly name: string;
  decode(matrix: PixelMatrix): Promise<string | null>;
}

export type EngineFactory = () => Decoder | Promise<Decoder>;

let jsqrFactory: EngineFactory | null = null;
let zxingFactory: EngineFactory | null = null;

/**
 * 注册式工厂：浏览器侧在 DecoderHost 初始化时注入真实引擎，
 * 使 Node 测试环境不必强制加载 WASM。
 */
export function registerEngines(jsqr: EngineFactory, zxing: EngineFactory): void {
  jsqrFactory = jsqr;
  zxingFactory = zxing;
}

const DEFAULT_FACTORIES: EngineFactory[] = [
  () => {
    if (!jsqrFactory) throw new Error('jsqr factory not registered');
    return jsqrFactory();
  },
  () => {
    if (!zxingFactory) throw new Error('zxing factory not registered');
    return zxingFactory();
  },
];

export async function decodeWithFallback(
  matrix: PixelMatrix,
  options: PreprocessOptions = DEFAULT_PREPROCESS,
  timeoutMs = 5000,
  explicitEngines?: Decoder[]
): Promise<DecodeResult> {
  const deadline = Date.now() + timeoutMs;
  const attempts: EngineAttempt[] = [];
  const variants = enumerateVariants(matrix, options);

  const engines: Decoder[] = explicitEngines ?? [];
  const factories = explicitEngines ? [] : DEFAULT_FACTORIES;

  const runEngine = async (
    engine: Decoder,
    variantMatrix: PixelMatrix,
    descriptor: string
  ): Promise<string | null> => {
    const started = Date.now();
    try {
      const text = await engine.decode(variantMatrix);
      attempts.push({ engine: engine.name, variant: descriptor, ms: Date.now() - started, ok: text !== null });
      return text;
    } catch (e) {
      attempts.push({
        engine: engine.name,
        variant: descriptor,
        ms: Date.now() - started,
        ok: false,
        error: String(e),
      });
      return null;
    }
  };

  const succeed = (text: string, engineUsed: string, variant: string): DecodeResult => ({
    success: true,
    data: text,
    encoding: 'utf8',
    contentType: classify(text),
    engineUsed,
    variant,
    attempts,
  });

  for (const engine of engines) {
    for (const v of variants) {
      if (Date.now() > deadline) return { success: false, error: 'TIMEOUT', attempts };
      const text = await runEngine(engine, v.matrix, v.descriptor);
      if (text) return succeed(text, engine.name, v.descriptor);
    }
  }

  for (const factory of factories) {
    if (Date.now() > deadline) return { success: false, error: 'TIMEOUT', attempts };
    let engine: Decoder;
    try {
      engine = await factory();
    } catch (e) {
      attempts.push({ engine: 'unknown', variant: '-', ms: 0, ok: false, error: `load failed: ${String(e)}` });
      continue;
    }
    for (const v of variants) {
      if (Date.now() > deadline) return { success: false, error: 'TIMEOUT', attempts };
      const text = await runEngine(engine, v.matrix, v.descriptor);
      if (text) return succeed(text, engine.name, v.descriptor);
    }
  }

  if (options.tileScan) {
    const tiles = generateTiles(matrix);
    const scanEngines = engines.length ? engines : [await safeFirst(factories)].filter(Boolean) as Decoder[];
    for (const engine of scanEngines) {
      for (const tile of tiles) {
        if (Date.now() > deadline) return { success: false, error: 'TIMEOUT', attempts };
        for (const inverted of [false, true]) {
          const m = inverted ? invert(tile) : tile;
          const descriptor = `tile${inverted ? 'i' : ''}`;
          const text = await runEngine(engine, m, descriptor);
          if (text) return succeed(text, engine.name, descriptor);
        }
      }
    }
  }

  return { success: false, error: 'NO_QR_CODE_DETECTED', attempts };
}

async function safeFirst(factories: EngineFactory[]): Promise<Decoder | null> {
  try {
    return await factories[0]!();
  } catch {
    return null;
  }
}
