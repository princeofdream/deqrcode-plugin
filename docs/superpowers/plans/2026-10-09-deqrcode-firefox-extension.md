# deQRCode Firefox Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Firefox MV3 扩展，右键网页图片即可解码其中的二维码，结果以页面内浮层呈现并自动复制到剪贴板，同时提供历史记录与设置。

**Architecture:** 解码能力被封装为「DecoderHost」抽象：Firefox 直接在 background event page 内解码（自带 DOM/WASM），Chrome 走 Offscreen Document；解码核心（预处理 + jsQR/zxing-wasm 降级）以纯 `PixelMatrix` 数据结构运作，不依赖 DOM，因而可在 Node 中做识别率回归测试。Content Script 以 IIFE 形式按需注入，负责取图像素、渲染 Shadow DOM 结果浮层、执行剪贴板写入。

**Tech Stack:** TypeScript 5 / Vite 5（多页构建 + esbuild 单独打 content script IIFE）/ Vitest / webextension-polyfill / jsqr（内联）/ zxing-wasm（懒加载）/ idb / web-ext / pngjs + qrcode（测试造样本）

## Global Constraints

以下为全项目约束，每个 Task 隐式包含：

- Manifest V3；Firefox 优先，目标最低版本 `115.0`
- 代码统一使用 `browser.*`（`webextension-polyfill`），不使用裸 `chrome.*`
- 扩展页 CSP 必须显式声明 `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`
- jsQR 内联进主包并作为默认引擎；zxing-wasm 必须动态 `import()` 懒加载
- 解码输入统一为 `PixelMatrix { data: Uint8ClampedArray; width; height }`，解码核心不得触碰 DOM
- 单次解码超时 5s；预处理 `maxEdge = 1600`
- 历史记录默认保留 `30 天 / 500 条`；缩略图为 ≤96px 的 data URL，不存 Blob；不存原图 URL
- `<all_urls>` 只能是 `optional_host_permissions`，不得安装即申请
- 端到端 P90 < 1.0s；样本集综合识别率 ≥ 95%；jsQR 首引擎命中率 ≥ 80%
- 构建产物不得混淆（AMO 需提交可读源码）；`web-ext lint` 必须通过
- 每个 Task 结束必须可独立测试并 commit

## 检查点

- 完成 **Task 9** 后即得到一个可用的 P0 扩展（右键 → 解码 → 浮层 → 复制）
- Task 10/11 为历史与设置，Task 12 为选区截图，Task 13 为发布打磨
- 若需分期，可在 Task 9 或 Task 11 后暂停交付

---

## 文件结构总览

```
deqrcode-plugin/
├── package.json  tsconfig.json  vite.config.ts  vitest.config.ts  web-ext.config.ts
├── manifest.base.json  manifest.firefox.json  manifest.chrome.json
├── scripts/build.mjs            # vite build + esbuild content + 合并 manifest
├── tools/
│   ├── make-icons.mjs           # 生成占位/正式图标 PNG
│   ├── generate-fixtures.mjs    # 生成 QR 样本集
│   └── evaluate.mjs             # 识别率评测 CLI（CI 门禁）
├── public/                      # 由 scripts 生成到 dist，无需手写
├── src/
│   ├── shared/
│   │   ├── types.ts             # PixelMatrix / ImageRef / DecodeResult / PreprocessOptions
│   │   ├── messages.ts          # 消息类型与 type guard
│   │   └── classify.ts          # 内容类型判定 + URL/WiFi 解析
│   ├── decoder/
│   │   ├── preprocess.ts        # 降采样/灰度/自动对比度/反色/旋转/多尺度/分块
│   │   ├── engines/jsqr.ts
│   │   ├── engines/zxing.ts
│   │   └── fallback.ts          # decodeWithFallback + 变体枚举 + 超时
│   ├── decoder-host/
│   │   ├── index.ts             # getDecoderHost() 能力探测
│   │   ├── image-ref.ts         # ImageRef → PixelMatrix（DOM 侧适配）
│   │   ├── event-page.ts        # Firefox：进程内解码
│   │   ├── chrome-offscreen.ts  # Chrome：runtime message 到 offscreen
│   │   └── offscreen/index.html + offscreen.ts
│   ├── background/
│   │   ├── index.ts             # 入口：菜单 + 消息路由
│   │   ├── menus.ts
│   │   ├── inject.ts            # 按需注入 content script（幂等）
│   │   └── pipeline.ts          # 取图三级策略 → 解码 → 下发结果 → 写历史
│   ├── content/
│   │   ├── index.ts             # IIFE 入口，消息处理
│   │   ├── grab-image.ts        # 从 <img> 取像素
│   │   ├── overlay.ts           # Shadow DOM 结果浮层
│   │   └── copy.ts              # 剪贴板写入 + execCommand 兜底
│   ├── storage/
│   │   ├── db.ts  history.ts  settings.ts
│   ├── popup/ (index.html, popup.ts, popup.css)
│   ├── options/ (index.html, options.ts, options.css)
│   └── result/ (index.html, result.ts, result.css)
└── tests/
    ├── unit/*.test.ts
    └── fixtures/qr/*.png        # 由 tools/generate-fixtures.mjs 生成
```

---

### Task 1: 项目脚手架与构建管线

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `web-ext.config.ts`, `.gitignore`
- Create: `manifest.base.json`, `manifest.firefox.json`, `manifest.chrome.json`
- Create: `scripts/build.mjs`, `tools/make-icons.mjs`
- Create: `src/popup/index.html`, `src/options/index.html`, `src/result/index.html`, `src/offscreen/index.html`（占位页面）
- Create: `src/background/index.ts`, `src/content/index.ts`（占位入口）

**Interfaces:** 本 Task 不产出被依赖的 API，但后续所有 Task 依赖以下构建约定：
- `npm run build` → 产出 `dist/`，含 `dist/manifest.json`、`dist/assets/background.js`、`dist/assets/content.js`、`dist/popup/index.html`、`dist/options/index.html`、`dist/result/index.html`、`dist/offscreen/index.html`
- `npm run build:firefox` / `npm run build:chrome` 按浏览器合并 manifest

- [ ] **Step 1: 写入 package.json 并安装依赖**

```json
{
  "name": "deqrcode-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "node scripts/build.mjs",
    "build:firefox": "node scripts/build.mjs --browser=firefox",
    "build:chrome": "node scripts/build.mjs --browser=chrome",
    "icons": "node tools/make-icons.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "fixtures": "node tools/generate-fixtures.mjs",
    "eval": "node tools/evaluate.mjs",
    "lint": "web-ext lint --source-dir ./dist",
    "start": "web-ext run --source-dir ./dist"
  },
  "dependencies": {
    "webextension-polyfill": "^0.10.0",
    "jsqr": "^1.4.0",
    "zxing-wasm": "^1.0.0",
    "idb": "^8.0.0"
  },
  "devDependencies": {
    "@types/webextension-polyfill": "^0.10.0",
    "esbuild": "^0.21.0",
    "pngjs": "^7.0.0",
    "qrcode": "^1.5.3",
    "typescript": "^5.4.0",
    "vite": "^5.4.0",
    "vitest": "^1.6.0",
    "web-ext": "^7.11.0"
  }
}
```

Run: `npm install`
Expected: 安装成功无 peer 冲突。若 `zxing-wasm@^1.0.0` 解析失败，改用 `npm view zxing-wasm version` 查询最新大版本并相应调整。

- [ ] **Step 2: 写入 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "types": ["vite/client"],
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src", "tests", "tools", "scripts", "*.ts"]
}
```

- [ ] **Step 3: 写入 vite.config.ts（多页构建，扩展页 ESM）**

```ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const r = (p: string) => resolve(__dirname, p);

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'firefox115',
    rollupOptions: {
      input: {
        background: r('src/background/index.ts'),
        popup: r('src/popup/index.html'),
        options: r('src/options/index.html'),
        result: r('src/result/index.html'),
        offscreen: r('src/offscreen/index.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
```

- [ ] **Step 4: 写入 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: 写入三个 manifest 片段**

`manifest.base.json`：

```json
{
  "manifest_version": 3,
  "name": "deQRCode",
  "version": "0.1.0",
  "description": "右键解码网页图片中的二维码",
  "default_locale": "zh_CN",
  "icons": { "48": "icons/48.png", "96": "icons/96.png", "128": "icons/128.png" },
  "permissions": ["contextMenus", "activeTab", "scripting", "storage", "clipboardWrite"],
  "optional_permissions": ["notifications", "downloads", "unlimitedStorage"],
  "optional_host_permissions": ["<all_urls>"],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  },
  "background": {
    "scripts": ["assets/background.js"],
    "service_worker": "assets/background.js",
    "type": "module"
  },
  "action": { "default_popup": "popup/index.html", "default_icon": "icons/48.png" },
  "options_ui": { "page": "options/index.html", "open_in_tab": false },
  "web_accessible_resources": [{ "resources": ["assets/*.wasm"], "matches": ["<all_urls>"] }]
}
```

`manifest.firefox.json`：

```json
{
  "browser_specific_settings": {
    "gecko": { "id": "deqrcode@example.com", "strict_min_version": "115.0" }
  }
}
```

`manifest.chrome.json`：

```json
{
  "permissions": ["offscreen", "contextMenus", "activeTab", "scripting", "storage", "clipboardWrite"],
  "background": { "service_worker": "assets/background.js", "type": "module" }
}
```

> `permissions` 在 chrome 片段中整体覆盖以追加 `offscreen`；`background` 覆盖为仅 `service_worker`（Chrome 忽略 `scripts`）。

- [ ] **Step 6: 写入 scripts/build.mjs**

```js
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = process.cwd();
const browser = (process.argv.find((a) => a.startsWith('--browser=')) ?? '--browser=firefox').split('=')[1];

function viteBin() {
  return resolve(root, 'node_modules/vite/bin/vite.js');
}
function esbuildBin() {
  return resolve(root, 'node_modules/esbuild/bin/esbuild');
}

// 1) 扩展页（ESM）
execFileSync(process.execPath, [viteBin(), 'build'], { stdio: 'inherit' });

// 2) content script（必须是 IIFE：Firefox 以 classic script 注入）
execFileSync(process.execPath, [esbuildBin(), 'src/content/index.ts',
  '--bundle', '--format=iife', '--target=firefox115',
  '--loader:.css=text', '--outfile=dist/assets/content.js'], { stdio: 'inherit' });

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
console.log(`built for ${browser} -> dist/`);
```

- [ ] **Step 7: 写入 tools/make-icons.mjs（生成占位图标）**

```js
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('icons', { recursive: true });
for (const size of [48, 96, 128]) {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (size * y + x) << 2;
      const border = x < size * 0.12 || y < size * 0.12 || x > size * 0.88 || y > size * 0.88;
      const inFinder = border && (x < size * 0.3 || x > size * 0.7 || y < size * 0.3 || y > size * 0.7);
      png.data[i] = inFinder ? 0 : 245;
      png.data[i + 1] = inFinder ? 0 : 245;
      png.data[i + 2] = inFinder ? 0 : 245;
      png.data[i + 3] = 255;
    }
  }
  writeFileSync(`icons/${size}.png`, PNG.sync.write(png));
}
console.log('icons written');
```

Run: `npm run icons`
Expected: 生成 `icons/48.png`、`icons/96.png`、`icons/128.png`

- [ ] **Step 8: 写入占位页面与入口**

`src/popup/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8" /><title>deQRCode</title></head>
  <body>
    <div id="app">deQRCode</div>
    <script type="module" src="./popup.ts"></script>
  </body>
</html>
```

`src/popup/popup.ts`（占位）：

```ts
document.getElementById('app')!.textContent = 'deQRCode';
```

以同样方式创建 `src/options/index.html` + `options.ts`、`src/result/index.html` + `result.ts`、`src/offscreen/index.html` + `offscreen.ts`（内容分别为 `deQRCode Options` / `deQRCode Result` / `deQRCode Offscreen`）。

`src/background/index.ts`（占位）：

```ts
import browser from 'webextension-polyfill';
browser.runtime.onInstalled.addListener(() => {
  console.log('deQRCode installed');
});
```

`src/content/index.ts`（占位）：

```ts
console.log('deQRCode content loaded');
```

- [ ] **Step 9: 构建并 lint 验证**

Run: `npm run build:firefox && npx web-ext lint --source-dir ./dist`
Expected: 构建成功；`web-ext lint` 报 0 error（可能有 "manifest version" 与 icons 的 warning；若报 `background.type` 不被支持，说明该 Firefox 版本不支持 module background —— 此时删除 base manifest 中的 `"type": "module"` 并在后续 Task 6 中把 background 也改为 esbuild IIFE 构建，zxing-wasm 将被内联进包，接受约 1MB 体积增量）

- [ ] **Step 10: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Vite+TS MV3 extension build pipeline"
```

---

### Task 2: 共享类型与消息契约

**Files:**
- Create: `src/shared/types.ts`, `src/shared/messages.ts`
- Test: `tests/unit/messages.test.ts`

**Interfaces:**
- Produces（后续 Task 全部依赖）: `PixelMatrix`, `ImageRef`, `PreprocessOptions`, `DEFAULT_PREPROCESS`, `EngineAttempt`, `DecodeResult`, `ContentType`, `HistoryRecord`, `Settings`
- Produces: `BackgroundCommand`, `ContentReply`, `HostRequest`, `HostResponse`, `isBackgroundCommand()`

- [ ] **Step 1: 写失败测试（消息 type guard）**

`tests/unit/messages.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { isBackgroundCommand } from '../../src/shared/messages';

describe('isBackgroundCommand', () => {
  it('accepts GRAB_PIXELS', () => {
    expect(isBackgroundCommand({ type: 'GRAB_PIXELS', srcUrl: 'https://a/b.png' })).toBe(true);
  });
  it('accepts SHOW_RESULT', () => {
    expect(isBackgroundCommand({ type: 'SHOW_RESULT', result: { success: false, error: 'NO_QR_CODE_DETECTED', attempts: [] }, autoCopy: true })).toBe(true);
  });
  it('rejects unknown types', () => {
    expect(isBackgroundCommand({ type: 'NOPE' })).toBe(false);
    expect(isBackgroundCommand(null)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/messages.test.ts`
Expected: FAIL，找不到模块 `../../src/shared/messages`

- [ ] **Step 3: 实现 src/shared/types.ts**

```ts
export interface PixelMatrix {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type ImageRef =
  | { kind: 'pixels'; data: ArrayBuffer; width: number; height: number }
  | { kind: 'blob'; blob: Blob }
  | { kind: 'url'; url: string };

export interface PreprocessOptions {
  maxEdge: number;
  grayscale: boolean;
  tryInverted: boolean;
  rotations: number[];
  scales: number[];
  tileScan: boolean;
}

export const DEFAULT_PREPROCESS: PreprocessOptions = {
  maxEdge: 1600,
  grayscale: true,
  tryInverted: true,
  rotations: [0, 90, 180, 270],
  scales: [1, 0.5, 0.25],
  tileScan: true,
};

export type ContentType = 'url' | 'wifi' | 'contact' | 'event' | 'text' | 'binary';

export interface EngineAttempt {
  engine: string;
  variant: string;
  ms: number;
  ok: boolean;
  error?: string;
}

export type DecodeError =
  | 'NO_QR_CODE_DETECTED'
  | 'TIMEOUT'
  | 'ENGINE_LOAD_FAILED'
  | 'INVALID_IMAGE'
  | 'IMAGE_UNREADABLE';

export interface DecodeSuccess {
  success: true;
  data: string;
  encoding: 'utf8' | 'binary';
  contentType: ContentType;
  engineUsed: string;
  variant: string;
  attempts: EngineAttempt[];
}

export interface DecodeFailure {
  success: false;
  error: DecodeError;
  attempts: EngineAttempt[];
}

export type DecodeResult = DecodeSuccess | DecodeFailure;

export interface HistoryRecord {
  id: string;
  timestamp: number;
  content: string;
  encoding: 'utf8' | 'binary';
  contentType: ContentType;
  thumbnail?: string;
  sourceUrl?: string;
}

export interface Settings {
  autoCopy: boolean;
  autoOpenUrl: boolean;
  historyEnabled: boolean;
  retentionDays: number;
  retentionCount: number;
  preferredEngine: 'auto' | 'jsqr' | 'zxing-wasm';
}

export const DEFAULT_SETTINGS: Settings = {
  autoCopy: true,
  autoOpenUrl: false,
  historyEnabled: true,
  retentionDays: 30,
  retentionCount: 500,
  preferredEngine: 'auto',
};
```

- [ ] **Step 4: 实现 src/shared/messages.ts**

```ts
import type { DecodeResult, ImageRef, PreprocessOptions } from './types';

export type BackgroundCommand =
  | { type: 'GRAB_PIXELS'; srcUrl: string }
  | { type: 'SHOW_RESULT'; result: DecodeResult; autoCopy: boolean }
  | { type: 'START_AREA_SELECT' };

export type ContentReply =
  | { ok: true; data: ArrayBuffer; width: number; height: number }
  | { ok: false; error: 'TAINTED' | 'NOT_FOUND' | 'NOT_DECODED' | 'TOO_LARGE' };

export type AreaSelection = { x: number; y: number; width: number; height: number; dpr: number };

export type HostRequest = {
  type: 'DECODE';
  requestId: string;
  imageRef: ImageRef;
  options: PreprocessOptions;
  engines: string[];
};

export type HostResponse = { type: 'DECODE_RESULT'; requestId: string; result: DecodeResult };

const KNOWN = new Set(['GRAB_PIXELS', 'SHOW_RESULT', 'START_AREA_SELECT']);

export function isBackgroundCommand(v: unknown): v is BackgroundCommand {
  return typeof v === 'object' && v !== null && KNOWN.has((v as { type?: string }).type ?? '');
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/unit/messages.test.ts`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add src/shared tests/unit/messages.test.ts
git commit -m "feat: add shared types and message contracts"
```

---

### Task 3: 图像预处理管线

**Files:**
- Create: `src/decoder/preprocess.ts`
- Test: `tests/unit/preprocess.test.ts`

**Interfaces:**
- Consumes: `PixelMatrix`, `PreprocessOptions`, `DEFAULT_PREPROCESS`（Task 2）
- Produces: `createMatrix`, `toGrayscale`, `autoContrast`, `downscaleToMaxEdge`, `scaleMatrix`, `invert`, `rotate90`, `enumerateVariants`, `generateTiles`, `Variant { matrix: PixelMatrix; descriptor: string }`

- [ ] **Step 1: 写失败测试**

`tests/unit/preprocess.test.ts`：

```ts
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
    expect(g.data[0]).toBeCloseTo(76.245, 2);
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/preprocess.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 src/decoder/preprocess.ts**

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/preprocess.test.ts`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add src/decoder/preprocess.ts tests/unit/preprocess.test.ts
git commit -m "feat: add image preprocessing pipeline"
```

---

### Task 4: 解码引擎与降级策略

**Files:**
- Create: `src/decoder/engines/jsqr.ts`, `src/decoder/engines/zxing.ts`, `src/decoder/fallback.ts`
- Create: `src/shared/classify.ts`
- Test: `tests/unit/classify.test.ts`, `tests/unit/fallback.test.ts`

**Interfaces:**
- Consumes: `PixelMatrix`, `PreprocessOptions`, `DEFAULT_PREPROCESS`, `DecodeResult`, `EngineAttempt`（Task 2）；`enumerateVariants`, `generateTiles`（Task 3）
- Produces: `Decoder { name; decode(matrix): Promise<string | null> }`, `createJsQrDecoder()`, `createZxingDecoder()`, `decodeWithFallback(matrix, opts)`, `classify(text)`, `parseWifi(text)`

- [ ] **Step 1: 写 classify 失败测试**

`tests/unit/classify.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { classify, parseWifi } from '../../src/shared/classify';

describe('classify', () => {
  it('识别 http/https 为 url', () => {
    expect(classify('https://example.com/a?b=1')).toBe('url');
    expect(classify('http://example.com')).toBe('url');
  });
  it('危险 scheme 不作为 url', () => {
    expect(classify('javascript:alert(1)')).toBe('text');
    expect(classify('data:text/html,<script>')).toBe('text');
    expect(classify('file:///etc/passwd')).toBe('text');
  });
  it('识别 WIFI / MECARD / VCARD / VEVENT', () => {
    expect(classify('WIFI:T:WPA;S:Net;P:pw;;')).toBe('wifi');
    expect(classify('MECARD:N:Alice;TEL:123;;')).toBe('contact');
    expect(classify('BEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD')).toBe('contact');
    expect(classify('BEGIN:VEVENT\r\nEND:VEVENT')).toBe('event');
  });
  it('普通文本为 text', () => {
    expect(classify('hello world')).toBe('text');
  });
});

describe('parseWifi', () => {
  it('解析并还原转义', () => {
    const wifi = parseWifi('WIFI:T:WPA;S:My\\:Net;P:a\\;b;;');
    expect(wifi).toEqual({ ssid: 'My:Net', password: 'a;b', auth: 'WPA', hidden: false });
  });
  it('非 WIFI 返回 null', () => {
    expect(parseWifi('https://x')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/classify.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 src/shared/classify.ts**

```ts
import type { ContentType } from './types';

const SAFE_SCHEMES = ['https:', 'http:', 'ftp:', 'mailto:', 'tel:', 'sms:', 'geo:'];

export function classify(text: string): ContentType {
  const trimmed = text.trim();
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (schemeMatch) {
    const scheme = `${schemeMatch[1]!.toLowerCase()}:`;
    if (SAFE_SCHEMES.includes(scheme)) return 'url';
    if (scheme === 'javascript:' || scheme === 'data:' || scheme === 'file:') return 'text';
  }
  if (/^WIFI:/i.test(trimmed)) return 'wifi';
  if (/^MECARD:/i.test(trimmed)) return 'contact';
  if (/^BEGIN:VCARD/i.test(trimmed)) return 'contact';
  if (/^BEGIN:VEVENT/i.test(trimmed)) return 'event';
  return 'text';
}

export interface WifiPayload {
  ssid: string;
  password: string;
  auth: string;
  hidden: boolean;
}

function unescapeValue(v: string): string {
  return v.replace(/\\([\\;,:"])/g, '$1');
}

export function parseWifi(text: string): WifiPayload | null {
  if (!/^WIFI:/i.test(text.trim())) return null;
  const body = text.trim().slice('WIFI:'.length);
  const fields: Record<string, string> = {};
  for (const raw of body.split(';')) {
    if (!raw) continue;
    const idx = raw.indexOf(':');
    if (idx <= 0) continue;
    fields[raw.slice(0, idx).toUpperCase()] = unescapeValue(raw.slice(idx + 1));
  }
  return {
    ssid: fields['S'] ?? '',
    password: fields['P'] ?? '',
    auth: fields['T'] ?? 'nopass',
    hidden: fields['H'] === 'true',
  };
}
```

- [ ] **Step 4: 运行 classify 测试确认通过**

Run: `npx vitest run tests/unit/classify.test.ts`
Expected: 6 passed

- [ ] **Step 5: 实现两个引擎适配器**

`src/decoder/engines/jsqr.ts`：

```ts
import jsQR from 'jsqr';
import type { PixelMatrix } from '../../shared/types';
import type { Decoder } from '../fallback';

export function createJsQrDecoder(): Decoder {
  return {
    name: 'jsqr',
    async decode(matrix: PixelMatrix): Promise<string | null> {
      const r = jsQR(matrix.data, matrix.width, matrix.height, { inversionAttempts: 'dontInvert' });
      return r?.data ?? null;
    },
  };
}
```

`src/decoder/engines/zxing.ts`：

```ts
import type { PixelMatrix } from '../../shared/types';
import type { Decoder } from '../fallback';

function toImageData(m: PixelMatrix): ImageData {
  return new ImageData(new Uint8ClampedArray(m.data), m.width, m.height);
}

export async function createZxingDecoder(): Promise<Decoder> {
  const mod = await import('zxing-wasm');
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
      if (first.text) return first.text;
      const bytes = (first as { bytes?: Uint8Array }).bytes;
      if (bytes?.length) return btoa(String.fromCharCode(...bytes));
      return null;
    },
  };
}
```

- [ ] **Step 6: 写 fallback 失败测试**

`tests/unit/fallback.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { decodeWithFallback } from '../../src/decoder/fallback';
import { createMatrix } from '../../src/decoder/preprocess';
import { DEFAULT_PREPROCESS } from '../../src/shared/types';

function noise(w: number, h: number): ReturnType<typeof createMatrix> {
  const m = createMatrix(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = (i * 37) % 256;
    m.data[i * 4] = v; m.data[i * 4 + 1] = v; m.data[i * 4 + 2] = v; m.data[i * 4 + 3] = 255;
  }
  return m;
}

describe('decodeWithFallback', () => {
  it('纯噪声图返回 NO_QR_CODE_DETECTED 且记录 attempts', async () => {
    const res = await decodeWithFallback(noise(64, 64), { ...DEFAULT_PREPROCESS, tileScan: false });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('NO_QR_CODE_DETECTED');
    expect(res.attempts.length).toBeGreaterThan(0);
  });

  it('超时返回 TIMEOUT', async () => {
    const res = await decodeWithFallback(noise(256, 256), { ...DEFAULT_PREPROCESS, tileScan: false }, 0);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('TIMEOUT');
  });

  it('注入引擎命中时返回 success 并带 contentType', async () => {
    const res = await decodeWithFallback(noise(32, 32), { ...DEFAULT_PREPROCESS, tileScan: false }, 5000, [
      { name: 'fake', decode: async () => 'https://example.com/x' },
    ]);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toBe('https://example.com/x');
      expect(res.contentType).toBe('url');
      expect(res.engineUsed).toBe('fake');
    }
  });
});
```

- [ ] **Step 7: 运行确认失败**

Run: `npx vitest run tests/unit/fallback.test.ts`
Expected: FAIL

- [ ] **Step 8: 实现 src/decoder/fallback.ts**

```ts
import type { DecodeResult, EngineAttempt, PixelMatrix, PreprocessOptions } from '../shared/types';
import { classify } from '../shared/classify';
import { DEFAULT_PREPROCESS } from '../shared/types';
import { enumerateVariants, generateTiles } from './preprocess';

export interface Decoder {
  readonly name: string;
  decode(matrix: PixelMatrix): Promise<string | null>;
}

export type EngineFactory = () => Decoder | Promise<Decoder>;

const DEFAULT_FACTORIES: EngineFactory[] = [
  () => createJsQrDecoderLazy(),
  () => createZxingDecoderLazy(),
];

let jsqrFactory: EngineFactory | null = null;
let zxingFactory: EngineFactory | null = null;

function createJsQrDecoderLazy(): Decoder | Promise<Decoder> {
  if (!jsqrFactory) throw new Error('jsqr factory not registered');
  return jsqrFactory();
}

function createZxingDecoderLazy(): Decoder | Promise<Decoder> {
  if (!zxingFactory) throw new Error('zxing factory not registered');
  return zxingFactory();
}

export function registerEngines(jsqr: EngineFactory, zxing: EngineFactory): void {
  jsqrFactory = jsqr;
  zxingFactory = zxing;
}

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

  const runEngine = async (engine: Decoder, matrixVariant: PixelMatrix, descriptor: string): Promise<string | null> => {
    const started = Date.now();
    try {
      const text = await engine.decode(matrixVariant);
      attempts.push({ engine: engine.name, variant: descriptor, ms: Date.now() - started, ok: text !== null });
      return text;
    } catch (e) {
      attempts.push({ engine: engine.name, variant: descriptor, ms: Date.now() - started, ok: false, error: String(e) });
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
    for (const engine of engines.length ? engines : [await safeFirst(factories)]) {
      for (const tile of tiles) {
        if (Date.now() > deadline) return { success: false, error: 'TIMEOUT', attempts };
        for (const inverted of [false, true]) {
          const m = inverted ? invertTile(tile) : tile;
          const text = await runEngine(engine, m, `tile${inverted ? 'i' : ''}`);
          if (text) return succeed(text, engine.name, `tile${inverted ? 'i' : ''}`);
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

function invertTile(tile: PixelMatrix): PixelMatrix {
  const out = { data: new Uint8ClampedArray(tile.data.length), width: tile.width, height: tile.height };
  for (let i = 0; i < tile.data.length; i += 4) {
    out.data[i] = 255 - tile.data[i]!;
    out.data[i + 1] = 255 - tile.data[i + 1]!;
    out.data[i + 2] = 255 - tile.data[i + 2]!;
    out.data[i + 3] = 255;
  }
  return out;
}
```

> 注册式引擎工厂是为了让 Node 测试环境不强制加载 WASM：浏览器侧在 Task 6 调用 `registerEngines(createJsQrDecoder, createZxingDecoder)`；测试侧直接传 `explicitEngines`。

- [ ] **Step 9: 运行全部测试**

Run: `npx vitest run`
Expected: 全部通过（`fallback.test.ts` 的前两个用例会走 `DEFAULT_FACTORIES`，因工厂未注册会记录 `load failed` 并最终返回 `NO_QR_CODE_DETECTED`，符合断言）

- [ ] **Step 10: Commit**

```bash
git add src/decoder src/shared/classify.ts tests/unit
git commit -m "feat: add decode engines, fallback strategy and content classification"
```

---

### Task 5: QR 样本集与识别率评测

**Files:**
- Create: `tools/generate-fixtures.mjs`, `tools/evaluate.mjs`
- Create: `tests/fixtures/qr/`（生成物，加入 .gitignore 或提交取决于体积 —— 默认提交以保证 CI 可复现）
- Create: `tests/unit/fixtures.test.ts`

**Interfaces:**
- Consumes: `decodeWithFallback`（Task 4）, `createMatrix`
- Produces: `npm run fixtures`（生成样本）、`npm run eval`（输出识别率报告，CI 门禁）

- [ ] **Step 1: 实现 tools/generate-fixtures.mjs**

```js
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const OUT = 'tests/fixtures/qr';
mkdirSync(OUT, { recursive: true });

const PAYLOADS = [
  { name: 'url', text: 'https://example.com/path/to/page?x=1&y=2' },
  { name: 'text', text: 'deQRCode 测试文本 hello world' },
  { name: 'wifi', text: 'WIFI:T:WPA;S:Office-5G;P:s3cret;;' },
  { name: 'contact', text: 'MECARD:N:Alice;TEL:+8613800000000;;' },
  { name: 'long', text: 'https://example.com/' + 'a'.repeat(300) },
];

function readPng(buf) { return PNG.sync.read(buf); }
function writePng(name, png) { writeFileSync(`${OUT}/${name}.png`, PNG.sync.write(png)); }
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
        out.data[d] = m.data[s]; out.data[d + 1] = m.data[s + 1]; out.data[d + 2] = m.data[s + 2]; out.data[d + 3] = 255;
      }
    }
    m = out;
  }
  return m;
}

let count = 0;
for (const { name, text } of PAYLOADS) {
  const base = readPng(await QRCode.toBuffer(text, { width: 300, margin: 2 }));
  writePng(`${name}-base`, base); count++;

  writePng(`${name}-inverted`, transform(base, (r, g, b) => [255 - r, 255 - g, 255 - b])); count++;

  for (const q of [1, 2, 3]) { writePng(`${name}-rot${q * 90}`, rotate(base, q)); count++; }

  // 大图内小码
  const big = blank(1600, 1200, 240);
  const small = readPng(await QRCode.toBuffer(text, { width: 120, margin: 1 }));
  blit(big, small, 1100, 800);
  writePng(`${name}-small-in-large`, big); count++;

  // 低对比度
  writePng(`${name}-lowcontrast`, transform(base, (r, g, b) => {
    const v = Math.round(128 + (r - 128) * 0.35);
    return [v, v, v];
  })); count++;

  // 噪声
  writePng(`${name}-noisy`, transform(base, (r, g, b, x, y) => {
    const n = ((x * 7919 + y * 104729) % 61) - 30;
    const c = (v) => Math.min(255, Math.max(0, v + n));
    return [c(r), c(g), c(b)];
  })); count++;
}

// 非二维码噪声图（负样本，必须识别失败）
writePng('negative-noise', transform(blank(200, 200, 255), (r, g, b, x, y) => {
  const v = (x * 31 + y * 17) % 256; return [v, v, v];
})); count++;

writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ count, generatedAt: new Date().toISOString() }, null, 2));
console.log(`generated ${count} fixtures -> ${OUT}`);
```

- [ ] **Step 2: 生成样本集**

Run: `npm run fixtures`
Expected: `tests/fixtures/qr/` 下约 46 张 PNG + `manifest.json`

- [ ] **Step 3: 实现 tools/evaluate.mjs**

```js
import { readFileSync, readdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// 用 vite-node 能力在 Node 中直接跑 TS 源码
const { createServer } = await import('vite');
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
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
let ok = 0, total = 0, negativeFalsePositive = 0;
let firstEngineHits = 0;
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
    if (res.success) { negativeFalsePositive++; failures.push(`${f}: 期望失败却成功`); }
    else ok++;
    continue;
  }
  if (res.success) { ok++; firstEngineHits++; }
  else failures.push(`${f}: ${res.error}`);
}

durations.sort((a, b) => a - b);
const p90 = durations[Math.floor(durations.length * 0.9)];
const rate = ((ok / total) * 100).toFixed(1);
const firstRate = ((firstEngineHits / (total - 1)) * 100).toFixed(1);

console.log(JSON.stringify({
  total, success: ok, recognitionRate: `${rate}%`,
  jsqrFirstEngineRate: `${firstRate}%`,
  p90ms: p90,
  negativeFalsePositive,
  failures,
}, null, 2));

await server.close();
const passRate = parseFloat(rate);
const passP90 = p90 <= 1000;
const passFirst = parseFloat(firstRate) >= 80;
if (passRate < 95 || !passP90 || negativeFalsePositive > 0) {
  console.error(`GATE FAILED: rate=${rate}% (需≥95%) p90=${p90}ms (需≤1000ms) fp=${negativeFalsePositive} (需=0)`);
  process.exit(1);
}
console.log('GATE PASSED');
```

- [ ] **Step 4: 运行评测**

Run: `npm run eval`
Expected: 输出 JSON 报告；**首次运行大概率 GATE FAILED**（旋转/低对比/小码样本 jsQR 命中率低）

- [ ] **Step 5: 依据失败项调优（不修改测试期望值）**

允许的调优手段：调整 `DEFAULT_PREPROCESS.scales`（如加入 `0.75`）、`generateTiles` 的 `sizeRatio/overlapRatio`、`autoContrast` 的分位阈值。禁止手段：删除失败样本、降低门禁阈值。

Run: `npm run eval`（重复直至 GATE PASSED）
Expected: `recognitionRate ≥ 95%`、`p90ms ≤ 1000`、`negativeFalsePositive = 0`

- [ ] **Step 6: 把评测接入 CI 测试**

`tests/unit/fixtures.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';

describe('fixture set', () => {
  it('样本集已生成且覆盖各类别', () => {
    const files = readdirSync('tests/fixtures/qr').filter((f) => f.endsWith('.png'));
    expect(files.length).toBeGreaterThanOrEqual(40);
    expect(files.some((f) => f.includes('-inverted'))).toBe(true);
    expect(files.some((f) => f.includes('-rot90'))).toBe(true);
    expect(files.some((f) => f.includes('-small-in-large'))).toBe(true);
    expect(files.some((f) => f.startsWith('negative-'))).toBe(true);
  });
});
```

- [ ] **Step 7: Commit**

```bash
git add tools tests
git commit -m "test: add QR fixture generator and recognition-rate gate"
```

---

### Task 6: DecoderHost 抽象与解码入口

**Files:**
- Create: `src/decoder-host/index.ts`, `src/decoder-host/image-ref.ts`, `src/decoder-host/event-page.ts`, `src/decoder-host/chrome-offscreen.ts`, `src/decoder-host/offscreen.ts`, `src/decoder-host/offscreen/index.html`
- Modify: `src/background/index.ts`
- Test: `tests/unit/decoder-host.test.ts`

**Interfaces:**
- Consumes: `ImageRef`, `DecodeResult`, `PreprocessOptions`, `HostRequest`, `HostResponse`（Task 2）；`decodeWithFallback`, `registerEngines`（Task 4）
- Produces: `getDecoderHost(): Promise<DecoderHost>`、`DecoderHost { kind; decode(ref, options): Promise<DecodeResult>; dispose(): Promise<void> }`、`imageRefToMatrix(ref): Promise<PixelMatrix>`

- [ ] **Step 1: 写失败测试（能力探测）**

`tests/unit/decoder-host.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { pickHostKind } from '../../src/decoder-host/index';

describe('pickHostKind', () => {
  it('存在 chrome.offscreen 时选 chrome-offscreen', () => {
    const g = { chrome: { offscreen: { createDocument: () => {} } } } as any;
    expect(pickHostKind(g)).toBe('chrome-offscreen');
  });
  it('不存在时回落到 firefox-event-page', () => {
    expect(pickHostKind({} as any)).toBe('firefox-event-page');
    expect(pickHostKind({ chrome: {} } as any)).toBe('firefox-event-page');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/decoder-host.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 src/decoder-host/image-ref.ts**

```ts
import type { ImageRef, PixelMatrix } from '../shared/types';

async function blobToMatrix(blob: Blob): Promise<PixelMatrix> {
  const bitmap = await createImageBitmap(blob);
  try {
    return bitmapToMatrix(bitmap);
  } finally {
    bitmap.close?.();
  }
}

function bitmapToMatrix(bitmap: ImageBitmap): PixelMatrix {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(bitmap.width, bitmap.height)
    : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  if (!ctx) throw new Error('2D context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { data, width: bitmap.width, height: bitmap.height };
}

export async function imageRefToMatrix(ref: ImageRef): Promise<PixelMatrix> {
  if (ref.kind === 'pixels') {
    return { data: new Uint8ClampedArray(ref.data), width: ref.width, height: ref.height };
  }
  if (ref.kind === 'blob') return blobToMatrix(ref.blob);
  const res = await fetch(ref.url, { credentials: 'include' });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return blobToMatrix(await res.blob());
}
```

- [ ] **Step 4: 实现 src/decoder-host/index.ts**

```ts
import type { DecodeResult, ImageRef, PreprocessOptions } from '../shared/types';
import { DEFAULT_PREPROCESS } from '../shared/types';
import { decodeWithFallback, registerEngines } from '../decoder/fallback';
import { createJsQrDecoder } from '../decoder/engines/jsqr';
import { createZxingDecoder } from '../decoder/engines/zxing';
import { imageRefToMatrix } from './image-ref';

export type HostKind = 'firefox-event-page' | 'chrome-offscreen';

export interface DecoderHost {
  readonly kind: HostKind;
  decode(ref: ImageRef, options?: PreprocessOptions): Promise<DecodeResult>;
  dispose(): Promise<void>;
}

export function pickHostKind(g: Record<string, any> = globalThis as any): HostKind {
  const offscreen = g?.chrome?.offscreen;
  if (offscreen && typeof offscreen.createDocument === 'function') return 'chrome-offscreen';
  return 'firefox-event-page';
}

let cached: Promise<DecoderHost> | null = null;

export function getDecoderHost(): Promise<DecoderHost> {
  if (!cached) {
    cached = (async () => {
      registerEngines(createJsQrDecoder, createZxingDecoder);
      const kind = pickHostKind();
      const mod = kind === 'chrome-offscreen'
        ? await import('./chrome-offscreen')
        : await import('./event-page');
      return mod.create();
    })();
  }
  return cached;
}
```

- [ ] **Step 5: 实现两个适配器**

`src/decoder-host/event-page.ts`：

```ts
import type { DecodeResult, ImageRef, PreprocessOptions } from '../shared/types';
import { DEFAULT_PREPROCESS } from '../shared/types';
import { decodeWithFallback } from '../decoder/fallback';
import { imageRefToMatrix } from './image-ref';
import type { DecoderHost } from './index';

export function create(): DecoderHost {
  return {
    kind: 'firefox-event-page',
    async decode(ref: ImageRef, options: PreprocessOptions = DEFAULT_PREPROCESS): Promise<DecodeResult> {
      try {
        const matrix = await imageRefToMatrix(ref);
        if (matrix.width < 8 || matrix.height < 8) {
          return { success: false, error: 'INVALID_IMAGE', attempts: [] };
        }
        return await decodeWithFallback(matrix, options);
      } catch (e) {
        return { success: false, error: 'IMAGE_UNREADABLE', attempts: [{ engine: '-', variant: '-', ms: 0, ok: false, error: String(e) }] };
      }
    },
    async dispose() {},
  };
}
```

`src/decoder-host/chrome-offscreen.ts`：

```ts
import browser from 'webextension-polyfill';
import type { DecodeResult, ImageRef, PreprocessOptions } from '../shared/types';
import { DEFAULT_PREPROCESS } from '../shared/types';
import type { HostResponse } from '../shared/messages';
import type { DecoderHost } from './index';

const OFFSCREEN_URL = 'offscreen/index.html';

async function ensureDocument(): Promise<void> {
  if (await browser.offscreen?.hasDocument?.()) return;
  await browser.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['DOM_SCRAPING'],
    justification: 'QR decoding requires Canvas/ImageBitmap and WebAssembly, unavailable in service workers',
  } as never);
}

export function create(): DecoderHost {
  return {
    kind: 'chrome-offscreen',
    async decode(ref: ImageRef, options: PreprocessOptions = DEFAULT_PREPROCESS): Promise<DecodeResult> {
      await ensureDocument();
      const requestId = crypto.randomUUID();
      const res = (await browser.runtime.sendMessage({
        type: 'DECODE', requestId, imageRef: ref, options, engines: ['jsqr', 'zxing-wasm'],
      })) as HostResponse | undefined;
      if (!res || res.type !== 'DECODE_RESULT') {
        return { success: false, error: 'ENGINE_LOAD_FAILED', attempts: [] };
      }
      return res.result;
    },
    async dispose() {
      await browser.offscreen?.closeDocument?.();
    },
  };
}
```

`src/decoder-host/offscreen.ts`：

```ts
import browser from 'webextension-polyfill';
import type { HostRequest, HostResponse } from '../shared/messages';
import { decodeWithFallback, registerEngines } from '../decoder/fallback';
import { createJsQrDecoder } from '../decoder/engines/jsqr';
import { createZxingDecoder } from '../decoder/engines/zxing';
import { imageRefToMatrix } from './image-ref';

registerEngines(createJsQrDecoder, createZxingDecoder);

browser.runtime.onMessage.addListener(async (msg: unknown): Promise<HostResponse | undefined> => {
  const req = msg as HostRequest;
  if (req?.type !== 'DECODE') return undefined;
  try {
    const matrix = await imageRefToMatrix(req.imageRef);
    const result = await decodeWithFallback(matrix, req.options);
    return { type: 'DECODE_RESULT', requestId: req.requestId, result };
  } catch {
    return {
      type: 'DECODE_RESULT',
      requestId: req.requestId,
      result: { success: false, error: 'IMAGE_UNREADABLE', attempts: [] },
    };
  }
});
```

`src/decoder-host/offscreen/index.html`：

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>deQRCode Offscreen</title></head>
  <body><script type="module" src="../offscreen.ts"></script></body>
</html>
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 7: 在 background 中接入宿主并冒烟**

`src/background/index.ts`：

```ts
import browser from 'webextension-polyfill';
import { getDecoderHost } from '../decoder-host';
import type { ImageRef } from '../shared/types';

export async function decodeImage(ref: ImageRef) {
  const host = await getDecoderHost();
  return host.decode(ref);
}

browser.runtime.onInstalled.addListener(() => {
  console.log('deQRCode installed, host kind will be resolved lazily');
});

browser.runtime.onMessage.addListener(async (msg: unknown) => {
  if ((msg as { type?: string })?.type === 'PING') return { pong: true, kind: (await getDecoderHost()).kind };
  return undefined;
});
```

- [ ] **Step 8: 构建**

Run: `npm run build:firefox && npx web-ext lint --source-dir ./dist`
Expected: lint 0 error

- [ ] **Step 9: Commit**

```bash
git add src/decoder-host src/background tests/unit/decoder-host.test.ts
git commit -m "feat: add cross-browser decoder host abstraction"
```

---

### Task 7: 上下文菜单、按需注入与后台编排

**Files:**
- Create: `src/background/menus.ts`, `src/background/inject.ts`, `src/background/pipeline.ts`
- Modify: `src/background/index.ts`
- Test: `tests/unit/pipeline.test.ts`

**Interfaces:**
- Consumes: `getDecoderHost`（Task 6）、`ContentReply`, `BackgroundCommand`（Task 2）、`getSettings`（Task 10，**本 Task 先注入一个最小 `SettingsProvider` 参数**）
- Produces: `registerMenus()`, `handleDecodeRequest(tabId, srcUrl)`, `ensureContentScript(tabId)`, `sendToTab<T>(tabId, msg)`

- [ ] **Step 1: 写失败测试（三级取图编排）**

`tests/unit/pipeline.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { runDecodePipeline } from '../../src/background/pipeline';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import type { Settings } from '../../src/shared/types';

function ctx(overrides: Partial<Parameters<typeof runDecodePipeline>[0]> = {}) {
  return {
    tabId: 1,
    srcUrl: 'https://site.test/a.png',
    settings: { ...DEFAULT_SETTINGS } as Settings,
    grabPixels: vi.fn(async () => ({ ok: true, data: new ArrayBuffer(4), width: 1, height: 1 }) as const),
    fetchBlob: vi.fn(async () => new Blob([new Uint8Array([1])], { type: 'image/png' })),
    hasHostPermission: vi.fn(async () => true),
    requestHostPermission: vi.fn(async () => true),
    decode: vi.fn(async () => ({ success: true, data: 'https://example.com', encoding: 'utf8', contentType: 'url', engineUsed: 'jsqr', variant: 's1r0', attempts: [] }) as const),
    showResult: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
    record: vi.fn(async () => {}),
    ...overrides,
  } as Parameters<typeof runDecodePipeline>[0];
}

describe('runDecodePipeline', () => {
  it('策略①成功时不发起 fetch、不申请权限', async () => {
    const c = ctx();
    await runDecodePipeline(c);
    expect(c.grabPixels).toHaveBeenCalledTimes(1);
    expect(c.fetchBlob).not.toHaveBeenCalled();
    expect(c.requestHostPermission).not.toHaveBeenCalled();
    expect(c.showResult).toHaveBeenCalledTimes(1);
  });

  it('策略①返回 TAINTED 时回退到 fetch', async () => {
    const c = ctx({ grabPixels: vi.fn(async () => ({ ok: false, error: 'TAINTED' }) as const) });
    await runDecodePipeline(c);
    expect(c.fetchBlob).toHaveBeenCalledTimes(1);
    expect(c.decode).toHaveBeenCalledTimes(1);
  });

  it('无宿主权限时先申请，用户拒绝则不再 fetch', async () => {
    const c = ctx({
      grabPixels: vi.fn(async () => ({ ok: false, error: 'TAINTED' }) as const),
      hasHostPermission: vi.fn(async () => false),
      requestHostPermission: vi.fn(async () => false),
    });
    await runDecodePipeline(c);
    expect(c.fetchBlob).not.toHaveBeenCalled();
    expect(c.notify).toHaveBeenCalledTimes(1);
  });

  it('解码失败时展示失败结果且不写历史', async () => {
    const c = ctx({ decode: vi.fn(async () => ({ success: false, error: 'NO_QR_CODE_DETECTED', attempts: [] }) as const) });
    await runDecodePipeline(c);
    expect(c.showResult).toHaveBeenCalledTimes(1);
    expect(c.record).not.toHaveBeenCalled();
  });

  it('成功且历史开启时写入历史', async () => {
    const c = ctx();
    await runDecodePipeline(c);
    expect(c.record).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/pipeline.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 src/background/inject.ts**

```ts
import browser from 'webextension-polyfill';

export async function ensureContentScript(tabId: number): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ['assets/content.js'],
  });
}

export async function sendToTab<T>(tabId: number, message: unknown): Promise<T | null> {
  try {
    return (await browser.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return null;
  }
}
```

> `executeScript` 重复注入由 content script 自身的 `window.__DEQRCODE_LOADED__` 守卫保证幂等（Task 8）。

- [ ] **Step 4: 实现 src/background/pipeline.ts**

```ts
import type { ContentReply, AreaSelection } from '../shared/messages';
import type { DecodeResult, ImageRef, Settings } from '../shared/types';
import { ensureContentScript, sendToTab } from './inject';

export interface PipelineContext {
  tabId: number;
  srcUrl?: string;
  selection?: AreaSelection;
  settings: Settings;
  grabPixels: (srcUrl: string) => Promise<ContentReply>;
  captureArea: (sel: AreaSelection) => Promise<ImageRef | null>;
  fetchBlob: (url: string) => Promise<Blob>;
  hasHostPermission: () => Promise<boolean>;
  requestHostPermission: () => Promise<boolean>;
  decode: (ref: ImageRef) => Promise<DecodeResult>;
  showResult: (result: DecodeResult, autoCopy: boolean) => Promise<boolean>;
  notify: (message: string) => Promise<void>;
  record: (result: DecodeResult, sourceUrl?: string) => Promise<void>;
}

export async function runDecodePipeline(ctx: PipelineContext): Promise<DecodeResult> {
  await ensureContentScript(ctx.tabId);

  let result: DecodeResult | null = null;

  if (ctx.selection) {
    const ref = await ctx.captureArea(ctx.selection);
    if (ref) result = await ctx.decode(ref);
    if (!result) result = { success: false, error: 'IMAGE_UNREADABLE', attempts: [] };
  } else if (ctx.srcUrl) {
    const grabbed = await ctx.grabPixels(ctx.srcUrl);
    if (grabbed.ok) {
      result = await ctx.decode({ kind: 'pixels', data: grabbed.data, width: grabbed.width, height: grabbed.height });
    } else if (grabbed.error === 'TAINTED') {
      if (!(await ctx.hasHostPermission()) && !(await ctx.requestHostPermission())) {
        await ctx.notify('需要站点权限才能读取跨域图片，已取消');
        result = { success: false, error: 'IMAGE_UNREADABLE', attempts: [] };
      } else {
        const blob = await ctx.fetchBlob(ctx.srcUrl);
        result = await ctx.decode({ kind: 'blob', blob });
      }
    } else {
      result = { success: false, error: 'IMAGE_UNREADABLE', attempts: [] };
    }
  } else {
    result = { success: false, error: 'INVALID_IMAGE', attempts: [] };
  }

  const shown = await ctx.showResult(result, ctx.settings.autoCopy && result.success);
  if (!shown) await ctx.notify(result.success ? result.data.slice(0, 100) : '未检测到 QR Code');

  if (result.success && ctx.settings.historyEnabled) {
    await ctx.record(result, ctx.srcUrl);
  }
  return result;
}
```

- [ ] **Step 5: 实现 src/background/menus.ts**

```ts
import browser from 'webextension-polyfill';

export const MENU_DECODE_IMAGE = 'deqrcode-decode-image';
export const MENU_AREA_SELECT = 'deqrcode-area-select';
export const MENU_OPEN_HISTORY = 'deqrcode-open-history';

export async function registerMenus(): Promise<void> {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: MENU_DECODE_IMAGE,
    title: '解码 QR Code',
    contexts: ['image'],
  });
  browser.contextMenus.create({
    id: MENU_AREA_SELECT,
    title: '选区截图解码',
    contexts: ['page'],
  });
  browser.contextMenus.create({
    id: MENU_OPEN_HISTORY,
    title: '打开历史记录',
    contexts: ['page'],
  });
}
```

> 说明：原设计中的「解码并打开链接」菜单项已移除 —— 菜单是静态的，点击前无法预知内容是否为 URL；改为解码完成后按 `contentType` 在浮层上动态呈现「新标签打开」按钮。`contexts: ['page']` 与 `['image']` 若在某些场景同时命中导致重复，`registerMenus` 后需在 Firefox 实机核对，必要时改为父子菜单合并。

- [ ] **Step 6: 接线 src/background/index.ts**

```ts
import browser from 'webextension-polyfill';
import { getDecoderHost } from '../decoder-host';
import { MENU_AREA_SELECT, MENU_DECODE_IMAGE, MENU_OPEN_HISTORY, registerMenus } from './menus';
import { sendToTab } from './inject';
import { runDecodePipeline } from './pipeline';
import type { ContentReply } from '../shared/messages';
import type { ImageRef } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

browser.runtime.onInstalled.addListener(() => { void registerMenus(); });
browser.runtime.onStartup?.addListener(() => { void registerMenus(); });

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  const tabId = tab.id;

  if (info.menuItemId === MENU_OPEN_HISTORY) {
    await browser.action.openPopup();
    return;
  }
  if (info.menuItemId === MENU_AREA_SELECT) {
    await ensureAndSend(tabId, { type: 'START_AREA_SELECT' });
    return;
  }
  if (info.menuItemId !== MENU_DECODE_IMAGE || !info.srcUrl) return;

  await runDecodePipeline({
    tabId,
    srcUrl: info.srcUrl,
    settings: DEFAULT_SETTINGS,
    async grabPixels(srcUrl) {
      const reply = await ensureAndSend<ContentReply>(tabId, { type: 'GRAB_PIXELS', srcUrl });
      return reply ?? { ok: false, error: 'NOT_FOUND' };
    },
    async captureArea() { return null; },
    async fetchBlob(url) {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`fetch failed ${res.status}`);
      return res.blob();
    },
    async hasHostPermission() { return browser.permissions.contains({ origins: ['<all_urls>'] }); },
    async requestHostPermission() { return browser.permissions.request({ origins: ['<all_urls>'] }); },
    async decode(ref: ImageRef) { return (await getDecoderHost()).decode(ref); },
    async showResult(result, autoCopy) {
      const ok = await ensureAndSend<boolean>(tabId, { type: 'SHOW_RESULT', result, autoCopy });
      return ok === true;
    },
    async notify(message) {
      await browser.notifications.create({
        type: 'basic',
        iconUrl: 'icons/48.png',
        title: 'deQRCode',
        message,
      });
    },
    async record() { /* Task 10 接线 */ },
  });
});

async function ensureAndSend<T>(tabId: number, message: unknown): Promise<T | null> {
  const { ensureContentScript } = await import('./inject');
  await ensureContentScript(tabId);
  return sendToTab<T>(tabId, message);
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 8: Commit**

```bash
git add src/background tests/unit/pipeline.test.ts
git commit -m "feat: add context menus, on-demand injection and decode pipeline"
```

---

### Task 8: Content Script 取图像素

**Files:**
- Create: `src/content/grab-image.ts`
- Modify: `src/content/index.ts`
- Test: `tests/unit/grab-image.test.ts`

**Interfaces:**
- Consumes: `ContentReply`（Task 2）
- Produces: `grabPixels(srcUrl): ContentReply`；`src/content/index.ts` 中注册 `window.__DEQRCODE_LOADED__` 守卫与消息处理

- [ ] **Step 1: 写失败测试（URL 解析与元素定位）**

`tests/unit/grab-image.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { findTargetImage, MAX_PIXELS } from '../../src/content/grab-image';

function docWith(attrs: Record<string, string>[]) {
  const imgs = attrs.map((a) => {
    const el: any = { tagName: 'IMG', complete: true, naturalWidth: 200, naturalHeight: 200 };
    Object.assign(el, a);
    return el;
  });
  return { images: imgs } as any;
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/grab-image.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 src/content/grab-image.ts**

```ts
import type { ContentReply } from '../shared/messages';

export const MAX_PIXELS = 40_000_000;

export function findTargetImage(doc: Document, srcUrl: string): HTMLImageElement | null {
  const images = Array.from(doc.images ?? []) as HTMLImageElement[];
  let fallback: HTMLImageElement | null = null;
  for (const img of images) {
    const current = img.currentSrc || img.src || '';
    if (current === srcUrl) {
      if (img.complete && img.naturalWidth > 0) return img;
      fallback = img;
    }
  }
  if (fallback && fallback.complete && fallback.naturalWidth > 0) return fallback;
  return null;
}

export function grabPixels(srcUrl: string): ContentReply {
  const img = findTargetImage(document, srcUrl);
  if (!img) return { ok: false, error: 'NOT_FOUND' };

  const w = img.naturalWidth || img.clientWidth;
  const h = img.naturalHeight || img.clientHeight;
  if (!w || !h) return { ok: false, error: 'NOT_DECODED' };
  if (w * h > MAX_PIXELS) return { ok: false, error: 'TOO_LARGE' };

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ok: false, error: 'NOT_DECODED' };
  ctx.drawImage(img, 0, 0, w, h);

  try {
    const { data } = ctx.getImageData(0, 0, w, h);
    return { ok: true, data: data.buffer.slice(0) as ArrayBuffer, width: w, height: h };
  } catch {
    // canvas 被跨域图片污染 → 交由 background 走 fetch 策略
    return { ok: false, error: 'TAINTED' };
  }
}
```

- [ ] **Step 4: 接线 src/content/index.ts**

```ts
import browser from 'webextension-polyfill';
import type { BackgroundCommand, ContentReply } from '../shared/messages';
import { isBackgroundCommand } from '../shared/messages';
import { grabPixels } from './grab-image';
import { showOverlay } from './overlay';
import { copyText } from './copy';

const w = window as unknown as { __DEQRCODE_LOADED__?: boolean };
if (w.__DEQRCODE_LOADED__) {
  // 幂等：重复注入不重复注册监听
} else {
  w.__DEQRCODE_LOADED__ = true;

  browser.runtime.onMessage.addListener((msg: unknown): Promise<unknown> | undefined => {
    if (!isBackgroundCommand(msg)) return undefined;
    const cmd = msg as BackgroundCommand;

    if (cmd.type === 'GRAB_PIXELS') {
      return Promise.resolve(grabPixels(cmd.srcUrl) satisfies ContentReply);
    }

    if (cmd.type === 'SHOW_RESULT') {
      return (async () => {
        let copied = false;
        if (cmd.autoCopy && cmd.result.success) copied = await copyText(cmd.result.data);
        showOverlay({ result: cmd.result, copied, onOpen: openLink, onCopy: copyText });
        return true;
      })();
    }

    return undefined;
  });
}

function openLink(url: string): void {
  void browser.runtime.sendMessage({ type: 'OPEN_URL', url });
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run`
Expected: 全部通过（`src/content/index.ts` 不被单元测试加载，仅构建时校验）

Run: `npm run build:firefox`
Expected: 构建成功，`dist/assets/content.js` 为 IIFE（可用 `head -c 80 dist/assets/content.js` 确认不含 `import`/`export`）

- [ ] **Step 6: Commit**

```bash
git add src/content tests/unit/grab-image.test.ts
git commit -m "feat: add content script image pixel extraction"
```

---

### Task 9: 结果浮层与剪贴板复制

**Files:**
- Create: `src/content/overlay.ts`, `src/content/copy.ts`, `src/content/overlay.css`
- Modify: `src/background/index.ts`（新增 `OPEN_URL` 处理）
- Test: `tests/unit/copy.test.ts`

**Interfaces:**
- Consumes: `DecodeResult`, `ContentType`（Task 2）；`classify`, `parseWifi`（Task 4）
- Produces: `copyText(text): Promise<boolean>`、`showOverlay(opts): void`；`OverlayOptions { result: DecodeResult; copied: boolean; onOpen(url): void; onCopy(text): Promise<boolean> }`

- [ ] **Step 1: 写失败测试（复制兜底逻辑）**

`tests/unit/copy.test.ts`：

```ts
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
      createElement: () => ({ style: {}, value: '', select() {} }),
      execCommand,
    });
    expect(await copyText('abc')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('两者都失败返回 false', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    vi.stubGlobal('document', {
      body: { appendChild: () => {}, removeChild: () => {} },
      createElement: () => ({ style: {}, value: '', select() {} }),
      execCommand: () => false,
    });
    expect(await copyText('abc')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/copy.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 src/content/copy.ts**

```ts
export async function copyText(text: string): Promise<boolean> {
  try {
    const clip = (globalThis.navigator as Navigator | undefined)?.clipboard;
    if (clip?.writeText) {
      await clip.writeText(text);
      return true;
    }
  } catch {
    // 后台文档非聚焦时会被拒绝 → 走兜底
  }
  return fallbackCopy(text);
}

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 实现 src/content/overlay.css**

```css
:host { all: initial; }
.deqr-root {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  width: 360px; max-width: calc(100vw - 32px);
  font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #f5f5f5; background: #1b1b1f;
  border: 1px solid #34343c; border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.45);
  padding: 12px 14px;
}
.deqr-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.deqr-title { font-weight: 600; font-size: 13px; }
.deqr-close { background: none; border: 0; color: #9a9aa5; cursor: pointer; font-size: 16px; line-height: 1; }
.deqr-type { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 999px; background: #2c2c34; color: #b9b9c6; margin-right: 6px; }
.deqr-content {
  background: #121216; border: 1px solid #2c2c34; border-radius: 6px;
  padding: 8px; max-height: 140px; overflow: auto; word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; user-select: text;
}
.deqr-actions { display: flex; gap: 8px; margin-top: 10px; }
.deqr-btn {
  appearance: none; border: 1px solid #3a3a44; background: #26262e; color: #f5f5f5;
  border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer;
}
.deqr-btn:hover { background: #30303a; }
.deqr-btn[data-primary="true"] { background: #2f6feb; border-color: #2f6feb; }
.deqr-meta { margin-top: 8px; font-size: 11px; color: #8b8b96; }
.deqr-error { color: #ff8f8f; }
```

- [ ] **Step 5: 实现 src/content/overlay.ts**

```ts
import type { DecodeResult, ContentType } from '../shared/types';
import { parseWifi } from '../shared/classify';
import cssText from './overlay.css';

export interface OverlayOptions {
  result: DecodeResult;
  copied: boolean;
  onOpen: (url: string) => void;
  onCopy: (text: string) => Promise<boolean>;
}

const TYPE_LABEL: Record<ContentType, string> = {
  url: 'URL', wifi: 'WiFi', contact: '联系人', event: '事件', text: '文本', binary: '二进制',
};

let current: ShadowRoot | null = null;

export function showOverlay(opts: OverlayOptions): void {
  current?.host.remove();
  const host = document.createElement('div');
  host.style.all = 'initial';
  const shadow = host.attachShadow({ mode: 'closed' });
  current = shadow;

  const style = document.createElement('style');
  style.textContent = cssText;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'deqr-root';
  root.innerHTML = `
    <div class="deqr-head">
      <span class="deqr-title">${opts.result.success ? 'QR Code 解码结果' : '解码失败'}</span>
      <button class="deqr-close" data-act="close">×</button>
    </div>
    ${opts.result.success ? renderSuccess(opts.result) : renderFailure(opts.result)}
    <div class="deqr-meta">${metaLine(opts)}</div>
  `;
  shadow.appendChild(root);

  root.querySelector('[data-act="close"]')?.addEventListener('click', () => host.remove());
  root.querySelector('[data-act="copy"]')?.addEventListener('click', async (e) => {
    if (!opts.result.success) return;
    const ok = await opts.onCopy(opts.result.data);
    (e.currentTarget as HTMLElement).textContent = ok ? '已复制' : '复制失败';
  });
  root.querySelector('[data-act="open"]')?.addEventListener('click', () => {
    if (opts.result.success) opts.onOpen(opts.result.data);
  });

  document.body.appendChild(host);
  let timer = window.setTimeout(() => host.remove(), 8000);
  root.addEventListener('mouseenter', () => window.clearTimeout(timer));
  root.addEventListener('mouseleave', () => { timer = window.setTimeout(() => host.remove(), 4000); });
}

function renderSuccess(result: Extract<DecodeResult, { success: true }>): string {
  const label = TYPE_LABEL[result.contentType];
  const body = result.contentType === 'wifi'
    ? renderWifi(result.data)
    : `<div class="deqr-content">${escapeHtml(result.data)}</div>`;
  const openBtn = result.contentType === 'url'
    ? '<button class="deqr-btn" data-act="open">新标签打开</button>'
    : '';
  return `<div><span class="deqr-type">${label}</span></div>${body}
    <div class="deqr-actions">
      <button class="deqr-btn" data-primary="true" data-act="copy">复制内容</button>
      ${openBtn}
    </div>`;
}

function renderWifi(data: string): string {
  const wifi = parseWifi(data);
  if (!wifi) return `<div class="deqr-content">${escapeHtml(data)}</div>`;
  return `<div class="deqr-content">SSID: ${escapeHtml(wifi.ssid)}<br/>密码: ${escapeHtml(wifi.password)}<br/>加密: ${escapeHtml(wifi.auth)}</div>`;
}

function renderFailure(result: Extract<DecodeResult, { success: false }>): string {
  const msg: Record<string, string> = {
    NO_QR_CODE_DETECTED: '未检测到 QR Code',
    TIMEOUT: '解码超时，请重试',
    ENGINE_LOAD_FAILED: '解码引擎加载失败',
    INVALID_IMAGE: '图片无效或过小',
    IMAGE_UNREADABLE: '无法读取该图片（跨域或需要登录）',
  };
  return `<div class="deqr-content deqr-error">${msg[result.error] ?? '解码失败'}</div>`;
}

function metaLine(opts: OverlayOptions): string {
  if (!opts.result.success) return '';
  const r = opts.result;
  return `${opts.copied ? '已自动复制到剪贴板 · ' : ''}${r.engineUsed} · ${r.variant}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
```

- [ ] **Step 6: 在 background 中处理 OPEN_URL**

在 `src/background/index.ts` 的消息监听中追加：

```ts
browser.runtime.onMessage.addListener(async (msg: unknown) => {
  const m = msg as { type?: string; url?: string };
  if (m.type === 'OPEN_URL' && m.url) {
    await browser.tabs.create({ url: m.url });
    return true;
  }
  return undefined;
});
```

- [ ] **Step 7: 运行测试并构建**

Run: `npx vitest run && npm run build:firefox && npx web-ext lint --source-dir ./dist`
Expected: 测试通过、构建成功、lint 0 error

- [ ] **Step 8: Firefox 实机冒烟**

Run: `npm run start`
Expected: 启动 Firefox 并临时安装扩展；右键任意网页图片 → 出现「解码 QR Code」→ 点击后页面右下角出现浮层并显示内容；剪贴板已包含该内容。**若复制失败**，在浮层上确认「复制失败」提示出现（说明兜底也失败），记录到 Task 9 的验收备注并调整 `copyText` 调用位置。

- [ ] **Step 9: Commit**

```bash
git add src/content src/background
git commit -m "feat: add result overlay and clipboard copy"
```

---

### Task 10: 存储层 —— IndexedDB 历史与设置

**Files:**
- Create: `src/storage/db.ts`, `src/storage/history.ts`, `src/storage/settings.ts`
- Test: `tests/unit/history.test.ts`, `tests/unit/settings.test.ts`

**Interfaces:**
- Consumes: `HistoryRecord`, `Settings`, `DEFAULT_SETTINGS`, `ContentType`（Task 2）
- Produces: `addRecord`, `listRecords`, `searchRecords`, `deleteRecord`, `clearAll`, `enforceRetention`, `exportRecords`, `getSettings`, `setSettings`

- [ ] **Step 1: 写失败测试（保留策略与导出）**

`tests/unit/history.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { enforceRetention, exportRecords, toCsv } from '../../src/storage/history';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import type { HistoryRecord, Settings } from '../../src/shared/types';

function rec(over: Partial<HistoryRecord>): HistoryRecord {
  return { id: Math.random().toString(36).slice(2), timestamp: Date.now(), content: 'x', encoding: 'utf8', contentType: 'text', ...over };
}

const DAY = 86_400_000;

describe('enforceRetention', () => {
  it('按天数淘汰过期记录', () => {
    const now = Date.now();
    const records = [rec({ timestamp: now }), rec({ timestamp: now - 40 * DAY })];
    const { keep, remove } = enforceRetention(records, { ...DEFAULT_SETTINGS, retentionDays: 30, retentionCount: 500 }, now);
    expect(keep.map((r) => r.timestamp)).toEqual([now]);
    expect(remove).toHaveLength(1);
  });

  it('天数内但超条数时淘汰最旧的', () => {
    const now = Date.now();
    const records = [rec({ timestamp: now }), rec({ timestamp: now - DAY }), rec({ timestamp: now - 2 * DAY })];
    const { keep, remove } = enforceRetention(records, { ...DEFAULT_SETTINGS, retentionDays: 30, retentionCount: 2 }, now);
    expect(keep).toHaveLength(2);
    expect(remove).toHaveLength(1);
    expect(keep.every((r) => r.timestamp > remove[0]!.timestamp)).toBe(true);
  });

  it('两个条件同时生效：先过滤天数再截断条数', () => {
    const now = Date.now();
    const records = [rec({ timestamp: now }), rec({ timestamp: now - 40 * DAY }), rec({ timestamp: now - 41 * DAY })];
    const { keep, remove } = enforceRetention(records, { ...DEFAULT_SETTINGS, retentionDays: 30, retentionCount: 100 }, now);
    expect(keep).toHaveLength(1);
    expect(remove).toHaveLength(2);
  });
});

describe('exportRecords', () => {
  it('JSON 导出可被解析还原', () => {
    const records = [rec({ content: 'https://a' })];
    const json = exportRecords(records, 'json');
    expect(JSON.parse(json)).toHaveLength(1);
  });

  it('CSV 转义逗号与引号', () => {
    const csv = toCsv([rec({ content: 'a,b"c' })]);
    expect(csv).toContain('"a,b""c"');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/history.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 src/storage/db.ts**

```ts
import { openDB, type DBSchema } from 'idb';
import type { ContentType, HistoryRecord } from '../shared/types';

export interface DeQRCodeDB extends DBSchema {
  history: {
    key: string;
    value: HistoryRecord;
    indexes: { 'by-timestamp': number; 'by-type': ContentType };
  };
}

export const DB_NAME = 'deqrcode';
export const DB_VERSION = 1;

export function openHistoryDb() {
  return openDB<DeQRCodeDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore('history', { keyPath: 'id' });
      store.createIndex('by-timestamp', 'timestamp');
      store.createIndex('by-type', 'contentType');
    },
  });
}
```

- [ ] **Step 4: 实现 src/storage/history.ts**

```ts
import type { HistoryRecord, Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { openHistoryDb } from './db';

export interface RetentionPlan {
  keep: HistoryRecord[];
  remove: HistoryRecord[];
}

export function enforceRetention(
  records: HistoryRecord[],
  settings: Settings = DEFAULT_SETTINGS,
  now = Date.now()
): RetentionPlan {
  const cutoff = now - settings.retentionDays * 86_400_000;
  const fresh = records.filter((r) => r.timestamp >= cutoff);
  const expired = records.filter((r) => r.timestamp < cutoff);
  const sorted = [...fresh].sort((a, b) => b.timestamp - a.timestamp);
  const keep = sorted.slice(0, settings.retentionCount);
  const overflow = sorted.slice(settings.retentionCount);
  return { keep, remove: [...expired, ...overflow] };
}

export async function addRecord(input: Omit<HistoryRecord, 'id' | 'timestamp'>): Promise<HistoryRecord> {
  const db = await openHistoryDb();
  const record: HistoryRecord = { ...input, id: crypto.randomUUID(), timestamp: Date.now() };
  await db.add('history', record);
  await prune();
  return record;
}

export async function listRecords(limit = 200, offset = 0): Promise<HistoryRecord[]> {
  const db = await openHistoryDb();
  const all = await db.getAllFromIndex('history', 'by-timestamp');
  return all.reverse().slice(offset, offset + limit);
}

export async function searchRecords(query: string, limit = 200): Promise<HistoryRecord[]> {
  const q = query.trim().toLowerCase();
  if (!q) return listRecords(limit);
  const all = await listRecords(limit);
  return all.filter((r) => r.content.toLowerCase().includes(q));
}

export async function deleteRecord(id: string): Promise<void> {
  const db = await openHistoryDb();
  await db.delete('history', id);
}

export async function clearAll(): Promise<void> {
  const db = await openHistoryDb();
  await db.clear('history');
}

export async function prune(settings?: Settings): Promise<number> {
  const db = await openHistoryDb();
  const all = await db.getAll('history');
  const plan = enforceRetention(all, settings ?? (await readSettingsForPrune()));
  const tx = db.transaction('history', 'readwrite');
  await Promise.all(plan.remove.map((r) => tx.store.delete(r.id)));
  await tx.done;
  return plan.remove.length;
}

async function readSettingsForPrune(): Promise<Settings> {
  const { getSettings } = await import('./settings');
  return getSettings();
}

export function toCsv(records: HistoryRecord[]): string {
  const head = 'timestamp,contentType,content,sourceUrl';
  const rows = records.map((r) => [
    new Date(r.timestamp).toISOString(),
    r.contentType,
    csvCell(r.content),
    csvCell(r.sourceUrl ?? ''),
  ].join(','));
  return [head, ...rows].join('\n');
}

function csvCell(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

export function exportRecords(records: HistoryRecord[], format: 'json' | 'csv'): string {
  return format === 'json' ? JSON.stringify(records, null, 2) : toCsv(records);
}
```

- [ ] **Step 5: 实现 src/storage/settings.ts**

```ts
import browser from 'webextension-polyfill';
import type { Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...((stored[KEY] as Partial<Settings>) ?? {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ [KEY]: next });
  return next;
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[KEY]) {
    void import('./history').then((m) => m.prune(next(changes[KEY])));
  }
});

function next(change: { newValue?: unknown }): Settings {
  return { ...DEFAULT_SETTINGS, ...((change.newValue as Partial<Settings>) ?? {}) };
}
```

- [ ] **Step 6: 写并跑 settings 测试**

`tests/unit/settings.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

describe('settings defaults', () => {
  it('默认开启自动复制、关闭自动打开 URL', () => {
    expect(DEFAULT_SETTINGS.autoCopy).toBe(true);
    expect(DEFAULT_SETTINGS.autoOpenUrl).toBe(false);
  });
  it('默认保留 30 天 / 500 条', () => {
    expect(DEFAULT_SETTINGS.retentionDays).toBe(30);
    expect(DEFAULT_SETTINGS.retentionCount).toBe(500);
  });
});
```

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 7: 在 pipeline 中接线历史写入**

修改 `src/background/index.ts` 中 `record` 实现：

```ts
async record(result, sourceUrl) {
  if (!result.success) return;
  const { addRecord } = await import('../storage/history');
  await addRecord({
    content: result.data,
    encoding: result.encoding,
    contentType: result.contentType,
    sourceUrl,
  });
},
```

并把 `settings: DEFAULT_SETTINGS` 改为 `settings: await getSettings()`（从 `../storage/settings` 导入）。

- [ ] **Step 8: 构建并 Commit**

Run: `npm run build:firefox && npx web-ext lint --source-dir ./dist`

```bash
git add src/storage src/background tests/unit/history.test.ts tests/unit/settings.test.ts
git commit -m "feat: add IndexedDB history and settings storage"
```

---

### Task 11: Popup 历史面板与设置页

**Files:**
- Create: `src/popup/popup.ts`, `src/popup/popup.css`
- Create: `src/options/options.ts`, `src/options/options.css`
- Modify: `src/popup/index.html`, `src/options/index.html`
- Test: `tests/unit/popup-filter.test.ts`

**Interfaces:**
- Consumes: `listRecords`, `searchRecords`, `deleteRecord`, `clearAll`, `exportRecords`（Task 10）；`getSettings`, `setSettings`
- Produces: `filterRecords(records, query, type)`（纯函数，供测试）

- [ ] **Step 1: 写失败测试（过滤逻辑）**

新增 `src/popup/filter.ts`，先写测试 `tests/unit/popup-filter.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { filterRecords } from '../../src/popup/filter';
import type { HistoryRecord } from '../../src/shared/types';

const rec = (o: Partial<HistoryRecord>): HistoryRecord =>
  ({ id: '1', timestamp: 0, content: '', encoding: 'utf8', contentType: 'text', ...o });

describe('filterRecords', () => {
  it('空查询返回全部', () => {
    const rs = [rec({ content: 'a' }), rec({ content: 'b' })];
    expect(filterRecords(rs, '', 'all')).toHaveLength(2);
  });
  it('按关键字大小写不敏感过滤', () => {
    const rs = [rec({ content: 'HTTPS://A' }), rec({ content: 'zzz' })];
    expect(filterRecords(rs, 'https', 'all')).toHaveLength(1);
  });
  it('按类型过滤', () => {
    const rs = [rec({ contentType: 'url' }), rec({ contentType: 'wifi' })];
    expect(filterRecords(rs, '', 'wifi')).toHaveLength(1);
  });
  it('关键字与类型同时生效', () => {
    const rs = [rec({ contentType: 'url', content: 'abc' }), rec({ contentType: 'url', content: 'xyz' }), rec({ contentType: 'wifi', content: 'abc' })];
    expect(filterRecords(rs, 'abc', 'url')).toHaveLength(1);
  });
});
```

Run: `npx vitest run tests/unit/popup-filter.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现 src/popup/filter.ts**

```ts
import type { ContentType, HistoryRecord } from '../shared/types';

export function filterRecords(
  records: HistoryRecord[],
  query: string,
  type: ContentType | 'all'
): HistoryRecord[] {
  const q = query.trim().toLowerCase();
  return records.filter((r) => {
    if (type !== 'all' && r.contentType !== type) return false;
    if (q && !r.content.toLowerCase().includes(q)) return false;
    return true;
  });
}
```

Run: `npx vitest run tests/unit/popup-filter.test.ts`
Expected: 4 passed

- [ ] **Step 3: 实现 popup UI**

`src/popup/popup.css`：

```css
:root { color-scheme: dark; }
body { margin: 0; width: 380px; font: 13px/1.5 system-ui, sans-serif; background: #16161a; color: #eee; }
header { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid #2a2a32; }
header input { flex: 1; background: #101014; border: 1px solid #2a2a32; color: #eee; border-radius: 6px; padding: 5px 8px; }
header button { background: #26262e; border: 1px solid #3a3a44; color: #eee; border-radius: 6px; padding: 5px 8px; cursor: pointer; }
ul { list-style: none; margin: 0; padding: 0; max-height: 420px; overflow: auto; }
li { padding: 8px; border-bottom: 1px solid #22222a; }
.meta { font-size: 11px; color: #8b8b96; }
.content { font-family: ui-monospace, Menlo, monospace; font-size: 12px; word-break: break-all; margin: 4px 0 6px; }
.row { display: flex; gap: 6px; }
.row button { background: none; border: 1px solid #3a3a44; color: #bbb; border-radius: 5px; font-size: 11px; padding: 2px 7px; cursor: pointer; }
.empty { padding: 16px; text-align: center; color: #8b8b96; }
```

`src/popup/popup.ts`：

```ts
import browser from 'webextension-polyfill';
import { listRecords, deleteRecord, clearAll, exportRecords } from '../storage/history';
import { filterRecords } from './filter';
import type { ContentType, HistoryRecord } from '../shared/types';
import './popup.css';

const app = document.getElementById('app')!;
app.innerHTML = `
  <header>
    <input id="q" placeholder="搜索历史" />
    <select id="type">
      <option value="all">全部</option>
      <option value="url">URL</option>
      <option value="wifi">WiFi</option>
      <option value="contact">联系人</option>
      <option value="text">文本</option>
      <option value="binary">二进制</option>
    </select>
    <button id="export">导出</button>
    <button id="clear">清空</button>
  </header>
  <ul id="list"></ul>
`;

const listEl = document.getElementById('list')!;
const qEl = document.getElementById('q') as HTMLInputElement;
const typeEl = document.getElementById('type') as HTMLSelectElement;

async function render(): Promise<void> {
  const records = await listRecords(500);
  const shown = filterRecords(records, qEl.value, typeEl.value as ContentType | 'all');
  listEl.innerHTML = shown.length ? '' : '<div class="empty">暂无记录</div>';
  for (const r of shown) listEl.appendChild(item(r));
}

function item(r: HistoryRecord): HTMLLIElement {
  const li = document.createElement('li');
  li.innerHTML = `
    <div class="meta">${new Date(r.timestamp).toLocaleString()} · ${r.contentType}</div>
    <div class="content"></div>
    <div class="row">
      <button data-act="copy">复制</button>
      ${r.contentType === 'url' ? '<button data-act="open">打开</button>' : ''}
      <button data-act="del">删除</button>
    </div>`;
  li.querySelector('.content')!.textContent = r.content.slice(0, 300);
  li.querySelector('[data-act="copy"]')!.addEventListener('click', () => {
    void navigator.clipboard.writeText(r.content);
  });
  li.querySelector('[data-act="open"]')?.addEventListener('click', () => {
    void browser.tabs.create({ url: r.content });
  });
  li.querySelector('[data-act="del"]')!.addEventListener('click', async () => {
    await deleteRecord(r.id);
    await render();
  });
  return li;
}

qEl.addEventListener('input', () => void render());
typeEl.addEventListener('change', () => void render());

document.getElementById('clear')!.addEventListener('click', async () => {
  await clearAll();
  await render();
});

document.getElementById('export')!.addEventListener('click', async () => {
  const records = await listRecords(500);
  const blob = new Blob([exportRecords(records, 'json')], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `deqrcode-history-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

void render();
```

- [ ] **Step 4: 实现设置页**

`src/options/options.css`：

```css
body { font: 14px/1.6 system-ui, sans-serif; max-width: 520px; margin: 32px auto; padding: 0 16px; }
fieldset { border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
legend { padding: 0 6px; font-weight: 600; }
label { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
input[type="number"] { width: 80px; }
.hint { color: #666; font-size: 12px; }
```

`src/options/options.ts`：

```ts
import { getSettings, setSettings } from '../storage/settings';
import './options.css';

const app = document.getElementById('app')!;
app.innerHTML = `
  <h1>deQRCode 设置</h1>
  <fieldset>
    <legend>解码结果</legend>
    <label><input type="checkbox" id="autoCopy" /> 自动复制到剪贴板</label>
    <label><input type="checkbox" id="autoOpenUrl" /> 识别为 URL 时自动在新标签打开</label>
    <div class="hint">自动打开存在钓鱼风险，建议保持关闭。</div>
  </fieldset>
  <fieldset>
    <legend>历史记录</legend>
    <label><input type="checkbox" id="historyEnabled" /> 保存解码历史</label>
    <label>保留天数 <input type="number" id="retentionDays" min="1" max="3650" /></label>
    <label>最大条数 <input type="number" id="retentionCount" min="10" max="20000" /></label>
    <div class="hint">历史仅保存在本机 IndexedDB，不会上传；可包含 WiFi 密码等敏感内容。</div>
  </fieldset>
  <fieldset>
    <legend>解码引擎</legend>
    <label>首选引擎
      <select id="preferredEngine">
        <option value="auto">自动（jsQR → zxing-wasm）</option>
        <option value="jsqr">仅 jsQR</option>
        <option value="zxing-wasm">优先 zxing-wasm</option>
      </select>
    </label>
  </fieldset>
`;

const bind = async () => {
  const s = await getSettings();
  (document.getElementById('autoCopy') as HTMLInputElement).checked = s.autoCopy;
  (document.getElementById('autoOpenUrl') as HTMLInputElement).checked = s.autoOpenUrl;
  (document.getElementById('historyEnabled') as HTMLInputElement).checked = s.historyEnabled;
  (document.getElementById('retentionDays') as HTMLInputElement).value = String(s.retentionDays);
  (document.getElementById('retentionCount') as HTMLInputElement).value = String(s.retentionCount);
  (document.getElementById('preferredEngine') as HTMLSelectElement).value = s.preferredEngine;
};

const ids = ['autoCopy', 'autoOpenUrl', 'historyEnabled'] as const;
for (const id of ids) {
  document.getElementById(id)!.addEventListener('change', async (e) => {
    await setSettings({ [id]: (e.currentTarget as HTMLInputElement).checked });
  });
}
for (const id of ['retentionDays', 'retentionCount'] as const) {
  document.getElementById(id)!.addEventListener('change', async (e) => {
    await setSettings({ [id]: Number((e.currentTarget as HTMLInputElement).value) });
  });
}
document.getElementById('preferredEngine')!.addEventListener('change', async (e) => {
  await setSettings({ preferredEngine: (e.currentTarget as HTMLSelectElement).value as never });
});

void bind();
```

- [ ] **Step 5: 更新两个 HTML 引入样式脚本**

`src/popup/index.html` 的 `<script type="module" src="./popup.ts">` 已存在，确认 `src/options/index.html` 同样引入 `./options.ts`。

- [ ] **Step 6: 运行测试并构建**

Run: `npx vitest run && npm run build:firefox && npx web-ext lint --source-dir ./dist`
Expected: 通过

- [ ] **Step 7: 实机验证**

Run: `npm run start`
Expected: 点击工具栏图标 → 弹窗显示历史列表，可搜索/删除/导出；右键页面 →「打开历史记录」能唤起弹窗；`about:addons` → 扩展选项页可修改设置并持久化

- [ ] **Step 8: Commit**

```bash
git add src/popup src/options tests/unit/popup-filter.test.ts
git commit -m "feat: add history popup and options page"
```

---

### Task 12: 选区截图解码

**Files:**
- Create: `src/content/area-select.ts`
- Modify: `src/content/index.ts`（处理 `START_AREA_SELECT`）
- Modify: `src/background/index.ts`（实现 `captureArea`）
- Test: `tests/unit/area-select.test.ts`

**Interfaces:**
- Consumes: `AreaSelection`, `START_AREA_SELECT`（Task 2）；`runDecodePipeline`（Task 7）
- Produces: `startAreaSelect(onSelected): void`、`cropToMatrix(selection)`（background 侧）、`toDeviceRect(selection)`（纯函数，供测试）

- [ ] **Step 1: 写失败测试（坐标系换算）**

`tests/unit/area-select.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { toDeviceRect } from '../../src/content/area-select';

describe('toDeviceRect', () => {
  it('按 dpr 换算到设备像素', () => {
    expect(toDeviceRect({ x: 10, y: 20, width: 100, height: 50, dpr: 2 }))
      .toEqual({ sx: 20, sy: 40, sw: 200, sh: 100 });
  });
  it('dpr 为 1 时保持原值', () => {
    expect(toDeviceRect({ x: 0, y: 0, width: 33, height: 44, dpr: 1 }))
      .toEqual({ sx: 0, sy: 0, sw: 33, sh: 44 });
  });
  it('取整避免小数下标', () => {
    const r = toDeviceRect({ x: 1.6, y: 2.4, width: 10.2, height: 10.8, dpr: 1.5 });
    expect(Number.isInteger(r.sx)).toBe(true);
    expect(Number.isInteger(r.sw)).toBe(true);
  });
});
```

Run: `npx vitest run tests/unit/area-select.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现 src/content/area-select.ts**

```ts
import type { AreaSelection } from '../shared/messages';

export interface DeviceRect { sx: number; sy: number; sw: number; sh: number }

export function toDeviceRect(sel: AreaSelection): DeviceRect {
  const d = sel.dpr || 1;
  return {
    sx: Math.round(sel.x * d),
    sy: Math.round(sel.y * d),
    sw: Math.round(sel.width * d),
    sh: Math.round(sel.height * d),
  };
}

export function startAreaSelect(onSelected: (sel: AreaSelection) => void): void {
  const mask = document.createElement('div');
  Object.assign(mask.style, {
    position: 'fixed', inset: '0', zIndex: '2147483646', cursor: 'crosshair',
    background: 'rgba(0,0,0,0.25)',
  } as Partial<CSSStyleDeclaration>);

  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', border: '2px solid #2f6feb', background: 'rgba(47,111,235,0.12)', display: 'none',
  } as Partial<CSSStyleDeclaration>);

  mask.appendChild(box);
  document.body.appendChild(mask);

  let start: { x: number; y: number } | null = null;

  const cleanup = () => {
    mask.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup(); };
  window.addEventListener('keydown', onKey, true);

  mask.addEventListener('mousedown', (e) => {
    start = { x: e.clientX, y: e.clientY };
    box.style.display = 'block';
    box.style.left = `${start.x}px`;
    box.style.top = `${start.y}px`;
    box.style.width = '0';
    box.style.height = '0';
  });

  mask.addEventListener('mousemove', (e) => {
    if (!start) return;
    box.style.left = `${Math.min(start.x, e.clientX)}px`;
    box.style.top = `${Math.min(start.y, e.clientY)}px`;
    box.style.width = `${Math.abs(e.clientX - start.x)}px`;
    box.style.height = `${Math.abs(e.clientY - start.y)}px`;
  });

  mask.addEventListener('mouseup', (e) => {
    if (!start) return;
    const sel: AreaSelection = {
      x: Math.min(start.x, e.clientX),
      y: Math.min(start.y, e.clientY),
      width: Math.abs(e.clientX - start.x),
      height: Math.abs(e.clientY - start.y),
      dpr: window.devicePixelRatio || 1,
    };
    cleanup();
    if (sel.width >= 8 && sel.height >= 8) onSelected(sel);
  });
}
```

- [ ] **Step 3: 接线 content 入口**

在 `src/content/index.ts` 的消息分支中追加：

```ts
if (cmd.type === 'START_AREA_SELECT') {
  startAreaSelect(async (sel) => {
    await browser.runtime.sendMessage({ type: 'AREA_SELECTED', selection: sel });
  });
  return Promise.resolve(true);
}
```

并在文件顶部加入 `import { startAreaSelect } from './area-select';`

- [ ] **Step 4: 实现 background 截图与裁剪**

在 `src/background/index.ts` 中新增监听与实现：

```ts
browser.runtime.onMessage.addListener(async (msg: unknown, sender) => {
  const m = msg as { type?: string; selection?: AreaSelection };
  if (m.type !== 'AREA_SELECTED' || !m.selection || !sender.tab?.id) return undefined;
  await runDecodePipeline({
    ...baseContext(sender.tab.id),
    selection: m.selection,
  });
  return true;
});
```

其中 `captureArea` 实现（新增到 `src/background/index.ts`）：

```ts
async function captureArea(sel: AreaSelection): Promise<ImageRef | null> {
  const dataUrl = await browser.tabs.captureVisibleTab(undefined as never, { format: 'png' });
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const rect = toDeviceRect(sel);
  const canvas = new OffscreenCanvas(rect.sw, rect.sh);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh);
  bitmap.close?.();
  const cropped = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  return { kind: 'blob', blob: cropped };
}
```

`baseContext(tabId)` 为把 Task 7 中构造 pipeline 参数的代码抽成的工厂函数，供菜单点击与选区两条路径复用。

- [ ] **Step 5: 运行测试并构建**

Run: `npx vitest run && npm run build:firefox && npx web-ext lint --source-dir ./dist`
Expected: 通过

- [ ] **Step 6: 实机验证**

Run: `npm run start`
Expected: 右键页面空白处 →「选区截图解码」→ 拖拽框选含二维码的区域（含 CSS 背景图 / canvas 场景）→ 浮层显示解码结果

- [ ] **Step 7: Commit**

```bash
git add src/content src/background tests/unit/area-select.test.ts
git commit -m "feat: add area screenshot decoding"
```

---

### Task 13: 发布打磨 —— i18n、图标、合规、构建冒烟

**Files:**
- Create: `_locales/zh_CN/messages.json`, `_locales/en/messages.json`
- Create: `LICENSE`, `NOTICE`, `PRIVACY.md`
- Modify: `manifest.base.json`（i18n key）、`scripts/build.mjs`（拷贝 `_locales`）、`tools/make-icons.mjs`（正式图标）
- Create: `tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: 全部前述模块
- Produces: 可提交 AMO 的构建包

- [ ] **Step 1: 写 i18n 一致性测试**

`tests/unit/i18n.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';

const langDirs = readdirSync('_locales');

describe('i18n', () => {
  it('至少包含 zh_CN 与 en', () => {
    expect(langDirs).toContain('zh_CN');
    expect(langDirs).toContain('en');
  });

  it('各语言 key 完全一致', () => {
    const keysOf = (d: string) => Object.keys(JSON.parse(readFileSync(`_locales/${d}/messages.json`, 'utf8'))).sort();
    const base = keysOf('zh_CN');
    for (const d of langDirs) expect(keysOf(d)).toEqual(base);
  });

  it('manifest 中引用的 __MSG_xxx__ 均有定义', () => {
    const manifest = readFileSync('manifest.base.json', 'utf8');
    const refs = [...manifest.matchAll(/__MSG_([a-zA-Z0-9_]+)__/g)].map((m) => m[1]!);
    const keys = Object.keys(JSON.parse(readFileSync('_locales/zh_CN/messages.json', 'utf8')));
    for (const r of refs) expect(keys).toContain(r);
  });
});
```

Run: `npx vitest run tests/unit/i18n.test.ts`
Expected: FAIL（`_locales` 不存在）

- [ ] **Step 2: 创建 `_locales/zh_CN/messages.json`**

```json
{
  "extensionName": { "message": "deQRCode 二维码解码", "description": "扩展名称" },
  "extensionDescription": { "message": "右键解码网页图片中的二维码", "description": "扩展描述" },
  "menuDecodeImage": { "message": "解码 QR Code", "description": "图片右键菜单" },
  "menuAreaSelect": { "message": "选区截图解码", "description": "页面右键菜单" },
  "menuOpenHistory": { "message": "打开历史记录", "description": "页面右键菜单" },
  "resultTitle": { "message": "QR Code 解码结果", "description": "结果浮层标题" },
  "copyContent": { "message": "复制内容", "description": "复制按钮" },
  "openInNewTab": { "message": "新标签打开", "description": "打开链接按钮" },
  "noQrCode": { "message": "未检测到 QR Code", "description": "解码失败提示" }
}
```

`_locales/en/messages.json` 使用相同的 key，message 改为对应英文（`"deQRCode"`, `"Decode QR Code from web images"` 等）。

- [ ] **Step 3: manifest 改用 i18n key**

修改 `manifest.base.json`：`"name": "__MSG_extensionName__"`、`"description": "__MSG_extensionDescription__"`，并保留 `"default_locale": "zh_CN"`。

修改 `src/background/menus.ts`，标题改用 `browser.i18n.getMessage('menuDecodeImage')` 等。

- [ ] **Step 4: 拷贝 _locales 到构建产物**

在 `scripts/build.mjs` 第 4 步后追加：

```js
import { cpSync } from 'node:fs';
cpSync(resolve(root, '_locales'), resolve(root, 'dist/_locales'), { recursive: true });
cpSync(resolve(root, 'PRIVACY.md'), resolve(root, 'dist/PRIVACY.md'));
```

- [ ] **Step 5: 写入 LICENSE / NOTICE / PRIVACY.md**

`LICENSE`：项目自有代码采用 MIT，并注明第三方依赖许可 —— jsQR 为 Apache-2.0、zxing-wasm 为 Apache-2.0/MIT（**以 `node_modules/<pkg>/LICENSE` 实际内容为准，实现时逐字核对后填写**）。

`NOTICE`：

```
deQRCode Firefox Extension
本产品包含以下第三方组件：
- jsQR (https://github.com/cozmo/jsQR) — Apache License 2.0
- zxing-wasm (https://github.com/Sec-ant/zxing-wasm) — 以其仓库声明为准
- webextension-polyfill — Mozilla Public License 2.0
- idb — ISC
```

`PRIVACY.md`：

```markdown
# deQRCode 隐私说明

- 解码在**本机**完成，二维码内容与图片数据不会上传到任何服务器。
- 历史记录（解码文本、时间、类型、来源页面）保存在本机浏览器的 IndexedDB 中，可在设置中关闭或一键清空。
- 仅在跨域图片无法直接从页面读取时，才会请求站点访问权限以重新下载图片；该权限可选且可随时撤销。
- 本扩展不收集任何遥测数据，不包含第三方统计脚本。
```

- [ ] **Step 6: 生成正式图标**

修改 `tools/make-icons.mjs`，绘制带三个定位角的二维码图形（深色 `#1b1b1f` 底 + 白色模块 + `#2f6feb` 定位角），输出 48/96/128 三种尺寸。Run: `npm run icons`

- [ ] **Step 7: 全量校验**

Run: `npx vitest run && npm run eval && npm run build:firefox && npx web-ext lint --source-dir ./dist`
Expected: 单元测试通过、识别率门禁通过、构建成功、`web-ext lint` **0 error 0 warning**

- [ ] **Step 8: Chrome 分支构建冒烟**

Run: `npm run build:chrome`
Expected: 构建成功，`dist/manifest.json` 含 `offscreen` 权限且 `background` 仅 `service_worker`；在 Chrome 中 `chrome://extensions` 加载未打包目录，右键图片解码成功（走 offscreen 分支）

- [ ] **Step 9: 打包**

Run: `npx web-ext build --source-dir ./dist --artifacts-dir ./artifacts`
Expected: 产出 `artifacts/deqrcode-<version>.zip`

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: add i18n, icons, licenses and release packaging"
```

---

## 自审清单

| 规格条目 | 落地 Task |
|---|---|
| §4.1 DecoderHost 抽象 | Task 6 |
| §4.2 预处理管线 | Task 3 |
| §4.3 引擎降级 | Task 4 |
| §4.4 剪贴板 | Task 9 |
| §4.5 结果浮层 | Task 9 |
| §4.6 IndexedDB / 隐私 | Task 10 |
| §4.7 内容类型判定 | Task 4 (`classify`) |
| §4.8 WASM / CSP | Task 1 (manifest) + Task 4/6 |
| §3.3 取图三级策略 | Task 7 + Task 8 |
| §5.1 菜单结构 | Task 7 |
| §5.3 历史面板 | Task 11 |
| §6.1 权限最小化 | Task 1 + Task 7 |
| §8.1 样本集/指标门禁 | Task 5 |
| §12 合规发布 | Task 13 |
| 选区截图（P1） | Task 12 |
| 独立结果页（P1） | 未排期 —— 当前计划中 `src/result/` 仅为占位页面；如需交付，追加 Task 14 |
