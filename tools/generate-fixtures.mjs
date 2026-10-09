import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'tests/fixtures/qr';
mkdirSync(OUT, { recursive: true });

const PAYLOADS = [
  { name: 'url', text: 'https://example.com/path/to/page?x=1&y=2' },
  { name: 'text', text: 'deQRCode 测试文本 hello world' },
  { name: 'wifi', text: 'WIFI:T:WPA;S:Office-5G;P:s3cret;;' },
  { name: 'contact', text: 'MECARD:N:Alice;TEL:+8613800000000;;' },
  { name: 'long', text: 'https://example.com/' + 'a'.repeat(300) },
];

function blank(w, h, fill = 255) {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = fill; p.data[i + 1] = fill; p.data[i + 2] = fill; p.data[i + 3] = 255;
  }
  return p;
}

function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) << 2;
      const d = ((y + dy) * dst.width + (x + dx)) << 2;
      dst.data[d] = src.data[s]; dst.data[d + 1] = src.data[s + 1];
      dst.data[d + 2] = src.data[s + 2]; dst.data[d + 3] = 255;
    }
  }
}

function transform(png, fn) {
  const out = new PNG({ width: png.width, height: png.height });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const s = (y * png.width + x) << 2;
      const d = (y * png.width + x) << 2;
      const v = fn(png.data[s], png.data[s + 1], png.data[s + 2], x, y);
      out.data[d] = v[0]; out.data[d + 1] = v[1]; out.data[d + 2] = v[2]; out.data[d + 3] = 255;
    }
  }
  return out;
}

function rotate(png, quarter) {
  const times = ((quarter % 4) + 4) % 4;
  let m = png;
  for (let t = 0; t < times; t++) {
    const out = new PNG({ width: m.height, height: m.width });
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const s = (y * m.width + x) << 2;
        const d = (x * m.height + (m.height - 1 - y)) << 2;
        out.data[d] = m.data[s]; out.data[d + 1] = m.data[s + 1];
        out.data[d + 2] = m.data[s + 2]; out.data[d + 3] = 255;
      }
    }
    m = out;
  }
  return m;
}

const writePng = (name, png) => writeFileSync(`${OUT}/${name}.png`, PNG.sync.write(png));

let count = 0;
for (const { name, text } of PAYLOADS) {
  const base = PNG.sync.read(await QRCode.toBuffer(text, { width: 300, margin: 2 }));
  writePng(`${name}-base`, base); count++;

  writePng(`${name}-inverted`, transform(base, (r, g, b) => [255 - r, 255 - g, 255 - b])); count++;

  for (const q of [1, 2, 3]) { writePng(`${name}-rot${q * 90}`, rotate(base, q)); count++; }

  const big = blank(1600, 1200, 240);
  const small = PNG.sync.read(await QRCode.toBuffer(text, { width: 120, margin: 1 }));
  blit(big, small, 1100, 800);
  writePng(`${name}-small-in-large`, big); count++;

  writePng(`${name}-lowcontrast`, transform(base, (r, g, b) => {
    const v = Math.round(128 + (r - 128) * 0.35);
    return [v, v, v];
  })); count++;

  writePng(`${name}-noisy`, transform(base, (r, g, b, x, y) => {
    const n = ((x * 7919 + y * 104729) % 61) - 30;
    const c = (v) => Math.min(255, Math.max(0, v + n));
    return [c(r), c(g), c(b)];
  })); count++;
}

writePng('negative-noise', transform(blank(200, 200, 255), (r, g, b, x, y) => {
  const v = (x * 31 + y * 17) % 256; return [v, v, v];
})); count++;

writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ count, generatedAt: new Date().toISOString() }, null, 2));
console.log(`generated ${count} fixtures -> ${OUT}`);
