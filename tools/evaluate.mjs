import { readFileSync, readdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { createServer } from 'vite';

// 不加载 vite.config.ts（它的 root 指向 src），评测需要以项目根为 root 解析 TS 源码
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

const { decodeWithFallback } = await server.ssrLoadModule('/src/decoder/fallback.ts');
const { createJsQrDecoder } = await server.ssrLoadModule('/src/decoder/engines/jsqr.ts');

const dir = 'tests/fixtures/qr';
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();

function toMatrix(png) {
  const data = new Uint8ClampedArray(png.width * png.height * 4);
  for (let i = 0; i < png.data.length; i += 4) {
    data[i] = png.data[i]; data[i + 1] = png.data[i + 1]; data[i + 2] = png.data[i + 2]; data[i + 3] = 255;
  }
  return { data, width: png.width, height: png.height };
}

const engine = createJsQrDecoder();
let ok = 0, total = 0, negativeFalsePositive = 0, firstEngineHits = 0, expectedTotal = 0;
const failures = [];
const durations = [];

for (const f of files) {
  const png = PNG.sync.read(readFileSync(`${dir}/${f}`));
  const started = Date.now();
  const res = await decodeWithFallback(toMatrix(png), undefined, 5000, [engine]);
  const ms = Date.now() - started;
  durations.push(ms);
  total++;
  const isNegative = f.startsWith('negative-');
  if (isNegative) {
    if (res.success) {
      negativeFalsePositive++;
      failures.push(`${f}: 期望失败却解码出 ${res.data.slice(0, 40)}`);
    } else {
      ok++;
    }
    continue;
  }
  expectedTotal++;
  if (res.success) { ok++; firstEngineHits++; }
  else failures.push(`${f}: ${res.error}`);
}

durations.sort((a, b) => a - b);
const p90 = durations[Math.floor(durations.length * 0.9)];
const rate = ((ok / total) * 100).toFixed(1);
const firstRate = expectedTotal ? ((firstEngineHits / expectedTotal) * 100).toFixed(1) : '0.0';

console.log(JSON.stringify({
  total, success: ok, recognitionRate: `${rate}%`,
  jsqrFirstEngineRate: `${firstRate}%`,
  p90ms: p90,
  negativeFalsePositive,
  failures,
}, null, 2));

await server.close();

const passRate = parseFloat(rate) >= 95;
const passP90 = p90 <= 1000;
const passFirst = parseFloat(firstRate) >= 80;
if (!passRate || !passP90 || negativeFalsePositive > 0) {
  console.error(`GATE FAILED: rate=${rate}% (需≥95%) p90=${p90}ms (需≤1000ms) fp=${negativeFalsePositive} (需=0)`);
  process.exit(1);
}
if (!passFirst) {
  console.warn(`WARN: jsQR 首引擎命中率 ${firstRate}% 低于目标 80%（降级引擎可补偿，不阻断）`);
}
console.log('GATE PASSED');
