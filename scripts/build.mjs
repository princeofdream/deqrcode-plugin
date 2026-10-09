import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { build as esbuild } from 'esbuild';

const root = process.cwd();
const browser = (process.argv.find((a) => a.startsWith('--browser=')) ?? '--browser=firefox').split('=')[1];

const viteBin = () => resolve(root, 'node_modules/vite/bin/vite.js');

// 1) 扩展页（ESM 多页构建）
execFileSync(process.execPath, [viteBin(), 'build'], { stdio: 'inherit' });

// 2) content script（必须是 IIFE：Firefox 以 classic script 注入）
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

console.log(`built for ${browser} -> dist/`);
