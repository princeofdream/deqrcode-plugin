import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build as esbuild } from 'esbuild';

const root = process.cwd();
const browser = (process.argv.find((a) => a.startsWith('--browser=')) ?? '--browser=firefox').split('=')[1];

const viteBin = () => resolve(root, 'node_modules/vite/bin/vite.js');

// 1) 扩展页（ESM 多页构建）
execFileSync(process.execPath, [viteBin(), 'build'], { stdio: 'inherit' });

// 2) background + content script
// 两者都以 classic script 形式加载（Firefox 不支持 background 的 type: module），
// 因此统一打成自包含 IIFE
await esbuild({
  entryPoints: ['src/background/index.ts'],
  bundle: true,
  format: 'iife',
  target: 'firefox115',
  outfile: 'dist/assets/background.js',
  logLevel: 'info',
});

await esbuild({
  entryPoints: ['src/content/index.ts'],
  bundle: true,
  format: 'iife',
  target: 'firefox115',
  loader: { '.css': 'text' },
  outfile: 'dist/assets/content.js',
  logLevel: 'info',
});

// 3) 合并 manifest
const base = JSON.parse(readFileSync(resolve(root, 'manifest.base.json'), 'utf8'));
const override = JSON.parse(readFileSync(resolve(root, `manifest.${browser}.json`), 'utf8'));
const manifest = { ...base, ...override };
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/manifest.json'), JSON.stringify(manifest, null, 2));

// 4) 图标
mkdirSync(resolve(root, 'dist/icons'), { recursive: true });
for (const size of [48, 96, 128]) {
  copyFileSync(resolve(root, `icons/${size}.png`), resolve(root, `dist/icons/${size}.png`));
}

// 5) 语言包
cpSync(resolve(root, '_locales'), resolve(root, 'dist/_locales'), { recursive: true });
if (existsSync(resolve(root, 'PRIVACY.md'))) {
  copyFileSync(resolve(root, 'PRIVACY.md'), resolve(root, 'dist/PRIVACY.md'));
}

// 6) zxing wasm（懒加载引擎运行时需要，必须与 chunks 同级）
const wasmSrc = resolve(root, 'node_modules/zxing-wasm/dist/full/zxing_full.wasm');
mkdirSync(resolve(root, 'dist/assets/chunks'), { recursive: true });
copyFileSync(wasmSrc, resolve(root, 'dist/assets/chunks/zxing_full.wasm'));

console.log(`built for ${browser} -> dist/`);
