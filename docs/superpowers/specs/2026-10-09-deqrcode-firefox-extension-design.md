# deQRCode Firefox Extension - 设计文档

## 1. 项目概述

**项目名称**: deQRCode (Firefox 扩展)
**核心功能**: 右键网页图片 → 解码其中的 QR Code → 多种方式处理结果
**技术栈**: Manifest V3 + TypeScript + Vite + webextension-polyfill
**目标浏览器**: Firefox 优先 (兼容 Chrome/Edge)
**最低版本**: Firefox 115 ESR（待与 `browser_specific_settings.gecko.strict_min_version` 对齐验证）

### 1.1 成功指标（验收基线）

| 指标 | 目标 | 测量方式 |
|------|------|---------|
| 端到端时延（右键 → 结果可见） | P90 < 1.0s | 样本集自动化计时 |
| 首引擎命中率（jsQR 直接成功） | ≥ 80% | 样本集统计 |
| 综合识别率（含降级 + 预处理） | ≥ 95% | 样本集统计 |
| 冷启动附加体积 | ≤ 60KB（jsQR 内联），zxing-wasm 懒加载 | 构建产物 |

> 以上指标依赖 §8.1 的 QR 样本集，M2 阶段必须建立基线，否则"降级/预处理"的收益无法量化。

---

## 2. 功能需求

### 2.1 核心交互流程

```
用户右键点击网页图片
    ↓
上下文菜单显示 "解码 QR Code" 选项
    ↓
取图（三级策略，见 §3.3）:
  ① 页面内已加载 <img> → 直接取像素
  ② background fetch(srcUrl) → 干净 Blob（需宿主权限）
  ③ 提示用户改用"选区截图解码"
    ↓
图像预处理（§4.2）：缩放 → 灰度 → 增强 → 多尺度/反色/旋转
    ↓
解码宿主执行多引擎降级 (jsQR → zxing-wasm)（§4.1）
    ↓
返回解码结果
    ↓
结果处理:
  ├─ 页面内浮层/Toast 展示（主路径，§4.5）
  ├─ 自动复制到剪贴板（由 content script 执行，§4.4）
  ├─ 若为 URL: 提供"新标签打开"按钮
  └─ 记录至历史面板 (IndexedDB，可关闭)
```

### 2.2 详细功能清单

| 功能模块 | 子功能 | 优先级 |
|---------|-------|-------|
| **上下文菜单** | 右键图片显示"解码 QR Code" | P0 |
| | 右键页面显示"选区截图解码" | **P1**（覆盖背景图/canvas，见 §2.3） |
| | 右键页面显示"从剪贴板解码"（见 §4.4 限制） | P2 |
| **解码引擎** | jsQR (主引擎, ~30KB, 纯 JS) | P0 |
| | zxing-wasm (备选引擎, 高准确率, 懒加载) | P0 |
| | 图像预处理管线 | P0 |
| | 自动降级重试机制 | P0 |
| **结果处理** | 页面内浮层/Toast + 自动复制 | P0 |
| | URL 检测 + "新标签打开" 动作 | P0 |
| | 独立结果页（长文本/需停留操作） | P1 |
| **历史记录** | IndexedDB 存储（可整体关闭） | P0 |
| | 历史面板 (搜索/筛选/删除/再次复制) | P0 |
| | 导出历史记录 (JSON/CSV) | P1 |
| **设置** | 启用/禁用自动复制 | P1 |
| | 启用/禁用自动打开 URL | P1 |
| | 启用/禁用历史记录 | P1 |
| | 历史记录保留条数/天数 | P1 |

### 2.3 覆盖边界（明确非目标）

Firefox 的 `contextMenus` 仅在 `image` 上下文（即 `<img>` 元素）下提供 `srcUrl`。因此以下场景**无法**通过右键图片触发：

- CSS `background-image` 中的二维码
- `<canvas>` 中绘制的二维码
- SVG 内嵌、WebGL 渲染的二维码

这类场景统一由 **"选区截图解码"（P1）** 兜底，它是覆盖非 `<img>` 场景的唯一通用解，因此优先级由原方案的"后续扩展"上调为 P1。

---

## 3. 架构设计

### 3.1 整体架构图（跨浏览器双宿主）

```
┌──────────────────────────────────────────────────────────────────┐
│                        deQRCode Extension                         │
├──────────────────────────────────────────────────────────────────┤
│  ┌────────────────┐              ┌────────────────────────────┐  │
│  │ Content Script │  ◄──────────►│  Background (Event Page)   │  │
│  │ 按需注入        │   runtime    │  菜单注册 / 消息路由 / 取图   │  │
│  │ · 取 <img> 像素 │   messaging  │  状态管理 / 历史写入         │  │
│  │ · 剪贴板写入    │              └─────────────┬──────────────┘  │
│  │ · 结果浮层 UI   │                            │                 │
│  └────────────────┘                            │ DecoderHost     │
│                                                │ (能力探测)       │
│                          ┌─────────────────────┴───────────┐     │
│                          ▼                                 ▼     │
│         ┌────────────────────────────┐   ┌────────────────────┐  │
│         │ Firefox: 直接在 event page   │   │ Chrome: Offscreen   │  │
│         │ 解码（自带 window/Canvas/    │   │ Document（SW 无 DOM）│  │
│         │ WASM，无需额外文档）          │   │                    │  │
│         └────────────────────────────┘   └────────────────────┘  │
│                          │                                        │
│                          ▼  jsQR (内联) → zxing-wasm (懒加载)      │
│                  ┌───────────────────┐                            │
│                  │ IndexedDB 历史记录 │                            │
│                  └───────────────────┘                            │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 核心模块职责

| 模块 | 文件路径 | 职责 |
|------|----------|------|
| **Content Script** | `src/content/` | 按需注入；取 `<img>` 像素、执行剪贴板写入、渲染结果浮层 |
| **Background** | `src/background/` | 生命周期、菜单注册、消息路由、`fetch` 兜底取图、DecoderHost 选路、历史写入 |
| **Decoder Host** | `src/decoder-host/` | **宿主抽象**：`firefox-event-page` / `chrome-offscreen` 两个适配器 + 能力探测（原 `src/offscreen/` 改名） |
| **Decoder Core** | `src/decoder/` | 解码器抽象、引擎注册、降级策略、**图像预处理管线** |
| **Popup UI** | `src/popup/` | 历史面板、设置页（**不再承载解码结果**） |
| **Result Page** | `src/result/` | 独立结果页（长文本/需停留），P1 |
| **Storage Layer** | `src/storage/` | IndexedDB 封装、历史 CRUD、保留策略、导出 |

### 3.3 取图策略决策表

| 优先级 | 策略 | 适用条件 | 代价 / 风险 |
|-------|------|---------|------------|
| ① | **页面内取像素**：对已加载 `<img>` 做 `drawImage` + `getImageData` | 同源，或跨域图片带 CORS 头（canvas 未被污染） | 零额外权限、零重复下载、保留登录态 |
| ② | **background `fetch(srcUrl)`** → Blob → `createImageBitmap` | 跨域且无 CORS 头（①因 canvas 污染失败） | 需要**宿主权限**；可能丢失 Cookie/Referer、无法处理 POST 动态图 |
| ③ | **提示改用"选区截图解码"** | `data:`/`blob:` 无法二次获取、懒加载占位图、登录态图片、②仍失败 | 需用户多一步操作 |

**失败分支说明**：
- `data:` / `blob:` URL 应**优先**在页面内直接解码（①），不要走 `fetch`。
- `<picture>` / `srcset` 场景须取 `img.currentSrc` 而非 `src`；懒加载图可能仍为占位符，需检测 `img.complete && img.naturalWidth > 0`。
- ①失败（canvas 污染）时**不要**尝试 `<img crossOrigin="anonymous">` 重载 —— 它依赖服务端 CORS 头，失败率高且会触发二次网络请求；直接走 ②。

### 3.4 通信协议 (Message Passing)

```typescript
// Content → Background
interface DecodeRequest {
  type: 'DECODE_QR';
  // 传原始字节，不传 ImageData/ImageBitmap：
  // RGBA 大数组跨进程序列化代价高，ImageBitmap 兼容性差
  payload: {
    imageRef:
      | { kind: 'pixels'; data: ArrayBuffer; width: number; height: number }
      | { kind: 'blob'; blob: Blob }
      | { kind: 'url'; url: string };      // 由 background 侧 fetch
    tabId?: number;                        // 通常省略，background 用 sender.tab.id
    requestId: string;                     // 幂等去重 / 取消
  };
}

// Background → Decoder Host
interface HostDecodeRequest {
  type: 'DECODE';
  payload: {
    imageRef: DecodeRequest['payload']['imageRef'];
    engines: DecoderEngine[];
    preprocess: PreprocessOptions;         // 见 §4.2
    requestId: string;
  };
}

// Decoder Host → Background
interface DecodeResponse {
  type: 'DECODE_RESULT';
  payload: {
    requestId: string;
    success: boolean;
    data?: string;
    encoding?: 'utf8' | 'binary';          // binary 时 data 为 base64
    contentType: ContentType;              // 见 §4.7
    error?: string;
    engineUsed?: string;
    attempts: EngineAttempt[];             // 用于诊断与指标统计
  };
}

// Background → Content（结果展示，§4.5）
interface ShowResultCommand {
  type: 'SHOW_RESULT';
  payload: DecodeResponse['payload'] & { autoCopy: boolean };
}
```

**通用约束**：
- 单次解码超时 5s，超时返回友好错误并中断引擎链。
- 同一 `requestId` 去重；用户连续点击时取消上一个未完成请求。
- Background 为 **event page**，空闲约 30s 会被卸载，瞬时状态须落 `storage.session`，不可依赖模块级变量。

---

## 4. 关键技术决策

### 4.1 跨浏览器解码宿主抽象（DecoderHost）

> **修正说明**：原方案基于 Offscreen Document。该 API 是 **Chrome 专有**，Firefox 未实现且无计划实现；同时 Firefox **不支持 `background.service_worker`**，其 MV3 后台是以 **event page（文档环境）** 运行的，天然具备 `window` / Canvas / `createImageBitmap` / WebAssembly。因此 Firefox 不需要、也无法创建 offscreen 文档。

```typescript
// src/decoder-host/index.ts
export interface DecoderHost {
  readonly kind: 'firefox-event-page' | 'chrome-offscreen';
  decode(req: HostDecodeRequest): Promise<HostDecodeResponse>;
  dispose(): Promise<void>;
}

export async function getDecoderHost(): Promise<DecoderHost> {
  // 能力探测，而非 UA 判断
  if (typeof (globalThis as any).chrome?.offscreen?.createDocument === 'function') {
    return createChromeOffscreenHost();   // Chrome/Edge：SW 无 DOM，必须 offscreen
  }
  return createEventPageHost();           // Firefox：当前文档即宿主，直接解码
}
```

```typescript
// Chrome 分支：按需创建 / 复用 offscreen
async function createChromeOffscreenHost(): Promise<DecoderHost> {
  if (!(await chrome.offscreen.hasDocument?.())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      // Canvas 解码对应 DOM_SCRAPING；WORKERS/IFRAME_SCRIPTING 与本场景不匹配
      reasons: ['DOM_SCRAPING'],
      justification: 'QR decoding requires Canvas/ImageBitmap and WASM, unavailable in service workers'
    });
  }
  /* ... */
}
```

**跨浏览器 manifest 双写**（MDN 推荐；Firefox 121+ 起即便存在 `service_worker` 也会正常启动 background scripts）：

```json
"background": { "scripts": ["background.js"], "service_worker": "background.js" }
```

**统一 API 命名空间**：代码统一使用 `browser.*`，引入 `webextension-polyfill` 以兼容 Chrome。

### 4.2 图像预处理管线（识别率的关键）

识别率的大头不在"选哪个引擎"，而在喂给引擎的图。所有图像进入引擎前统一过管线：

```typescript
interface PreprocessOptions {
  maxEdge: number;        // 默认 1600：兼顾 jsQR 性能与码点密度
  grayscale: boolean;     // 默认 true
  tryInverted: boolean;   // 反色 QR（黑底白码）默认 true
  rotations: number[];    // 默认 [0, 90, 180, 270]，jsQR 对旋转敏感
  scales: number[];       // 多尺度金字塔，默认 [1, 0.5, 0.25]
  tileScan: boolean;      // 全图失败后按重叠网格分块扫描，默认 true（仅在失败时启用）
}
```

执行顺序：
1. **降采样**：长边压到 `maxEdge`（超过阈值时 jsQR 在大图上耗时呈线性增长，且噪声更多）。
2. **灰度 + 对比度增强 / 自适应二值化**。
3. **变体枚举**：`scales × rotations × {原色, 反色}`，按代价从小到大依次尝试，**首个成功即返回**。
4. **全图失败后**才启用 `tileScan`（重叠分块，避免把码切开）。
5. 每个变体的耗时与结果写入 `attempts`，用于 §1.1 指标统计。

> **注意**：原方案"大图分块处理"是错误策略 —— 直接分块会把码切断导致必然失败。正确顺序是"先整体降采样，仍失败再重叠分块扫描"。

### 4.3 多引擎降级策略

```typescript
type DecoderEngine = 'jsqr' | 'zxing-wasm';

const ENGINE_PRIORITY: DecoderEngine[] = ['jsqr', 'zxing-wasm'];

async function decodeWithFallback(
  image: PreprocessedImage,
  opts: PreprocessOptions
): Promise<DecodeResult> {
  const variants = enumerateVariants(image, opts); // 缩放 × 旋转 × 反色
  for (const engine of ENGINE_PRIORITY) {
    const decoder = await loadEngine(engine);      // zxing-wasm 首次使用时动态 import
    for (const variant of variants) {
      try {
        const r = await decoder.decode(variant);
        if (r.success) return { ...r, engineUsed: engine, variant: variant.descriptor };
      } catch (e) {
        console.warn(`[${engine}] variant failed:`, variant.descriptor, e);
      }
    }
  }
  if (opts.tileScan) return scanTiles(image, opts);
  return { success: false, error: 'NO_QR_CODE_DETECTED' };
}
```

**引擎取舍**：
- `jsQR`：纯 JS、~30KB、无 CSP 问题 → **内联进主包**，作为默认引擎（目标首引擎命中率 ≥80%）。
- `zxing-wasm`：准确率更高但体积与编译开销大 → **动态 `import()` 懒加载**，仅在 jsQR 全变体失败后加载，并缓存编译结果。

### 4.4 剪贴板读写

**写入（P0，用于"自动复制"）**：
- Firefox 的后台文档**不是聚焦文档**，`navigator.clipboard.writeText()` 通常在后台页被拒。
- **方案**：复制动作下放到**当前活动标签页的 content script** 执行（`scripting.executeScript` + `navigator.clipboard.writeText`），background 仅下发文本；`document.execCommand('copy')` 作为兜底。
- 该路径必须在 M3 于 Firefox 实机验收，不能只靠 Chrome 验证。

**读取（P2，"从剪贴板解码"）**：
- `navigator.clipboard.read()` 在 Firefox 中支持有限且需 `clipboardRead` 权限 + 用户手势。
- **降级方案**：不直接读剪贴板，改为打开结果页并引导用户 `Ctrl/Cmd+V` 粘贴图片到投放区；**待验证**后再决定是否提供一键读取。

### 4.5 结果展示通道

> **修正说明**：原方案用 browser action popup 展示解码结果，在 Firefox 不可行 —— Firefox 无 `action.openPopup()`（Chrome 专有），且 popup 在用户点击页面后立即关闭，"复制/打开"按钮来不及点。

| 通道 | 用途 | 说明 |
|------|------|------|
| **页面内浮层 / Toast**（主路径） | 解码结果 + [复制] [新标签打开] [关闭] | content script 注入，带 Shadow DOM 隔离样式；默认 8s 自动消失，鼠标悬停暂停 |
| **系统通知**（备选） | 页面内注入失败时（受限页面如 AMO/附加组件管理器） | `browser.notifications`；**待验证** Firefox 对 `buttons` / `onButtonClicked` 的支持，不支持则退化为纯提示 |
| **独立结果页**（P1） | 长文本、需停留操作、注入失败兜底 | `browser.tabs.create`，支持选中/复制/打开 |
| **Popup** | 仅历史面板 + 设置 | 不再承载解码结果 |

### 4.6 IndexedDB Schema 与隐私

```typescript
interface HistoryRecord {
  id: string;              // UUID
  timestamp: number;       // Unix ms
  content: string;         // 解码文本（binary 时为 base64）
  encoding: 'utf8' | 'binary';
  contentType: ContentType;
  thumbnail?: string;      // 降采样后的 data URL（≤ 96px），而非 Blob，控制配额
  sourceUrl?: string;      // 来源页面；不存原图 URL（可能是带 token 的私有链接）
}
```

**索引**：`timestamp`（降序）、`contentType`。**不为 `content` 建索引** —— IndexedDB 无全文检索，普通索引仅支持前缀匹配，且大文本索引显著拖慢写入；搜索在加载记录后进内存过滤。

**保留策略（消除原方案的策略冲突）**：先按**保留天数**过滤过期记录，再按**最大条数**淘汰最旧的，两者同时生效，默认 `30 天 / 500 条`；配额超限时继续淘汰至配额内。

**隐私**：
- QR 内容常含 WiFi 密码、登录 token、私人链接 → **历史记录默认开启但设置页提供整体关闭开关**，并提供"清空全部"入口。
- 设置页与 AMO 列表页需提供隐私说明：收集内容、存储位置、是否上传（**不上传**）。
- 超出配额时申请 `unlimitedStorage`（可选权限）。

### 4.7 内容类型判定规则

```typescript
type ContentType = 'url' | 'wifi' | 'contact' | 'event' | 'text' | 'binary';
```

判定顺序（短路）：

1. **URL**：匹配 `^(https?|ftp|mailto|tel|sms|geo):` 白名单 scheme → `url`。
   **严禁**把 `javascript:` / `data:` / `file:` 判定为可打开链接（钓鱼风险）。
2. **WiFi**：`WIFI:` 前缀，按 `T:WPA;S:<ssid>;P:<password>;H:<hidden>;` 解析，需还原 `\;` `\:` `\` 转义。
3. **联系人**：`MECARD:` 或 `BEGIN:VCARD`。
4. **事件**：`BEGIN:VEVENT`。
5. **文本**：内容为合法 UTF-8 且含可打印字符。
6. **二进制**：byte mode 结果 → `binary`，`data` 以 base64 承载，UI 仅提供复制/下载，不做文本预览。

**多码处理**：zxing-wasm 可能返回多个结果；默认取第一个，UI 提供"查看全部"。

### 4.8 WebAssembly 与 CSP

MV3 下扩展页运行 WebAssembly **必须**在 CSP 中显式声明 `wasm-unsafe-eval`（MDN 明确要求），否则 zxing-wasm 编译被拦截：

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

若 `.wasm` 以 URL 方式加载，还需在 `web_accessible_resources` 中放行。

---

## 5. UI/UX 设计

### 5.1 上下文菜单结构

```
右键图片 (contexts: ['image']):
└── 🔍 解码 QR Code

右键页面 (contexts: ['page']):
├── ✂️ 选区截图解码        [P1]
├── 📋 从剪贴板解码        [P2]
└── 📜 打开历史记录
```

**修正说明**：
- 删除原方案的"解码并打开链接（仅当识别为 URL）"：菜单是**静态**的，点击前无法知道内容是否为 URL，该条目无法实现。改为解码完成后，按 §4.7 的判定结果，在浮层上**动态**呈现"新标签打开"按钮。
- `page` 与 `image` 上下文在部分场景会同时命中导致菜单项重复，需显式测试并按需用 `visible` 或父/子菜单去重。

### 5.2 结果浮层（页面内注入，主路径）

```
┌───────────────────────────────────────┐
│  ✅ QR Code 解码结果            [×]    │
├───────────────────────────────────────┤
│  🌐 URL                               │
│  https://example.com/path/to?x=1      │
│  （可选中，长文本滚动 + 省略号）         │
├───────────────────────────────────────┤
│  [复制内容] [新标签打开] [更多 ▾]       │
│  已自动复制到剪贴板 · jsQR · 120ms     │
└───────────────────────────────────────┘
```

- 使用 **Shadow DOM** 隔离样式，避免被宿主页面 CSS 影响或污染页面。
- 打开 URL 前展示完整 host，且受"启用/禁用自动打开 URL"设置约束，**默认不自动打开**（钓鱼防护）。
- URL 类型才显示"新标签打开"；WiFi/联系人显示结构化字段与复制按钮。

### 5.3 历史面板（Popup）

```
┌───────────────────────────────────────┐
│  🔍 搜索           [清空] [导出] [⚙️]  │
├───────────────────────────────────────┤
│  2026-10-09 14:32                     │
│  🌐 https://example.com/...           │
│              [复制] [打开] [删除]       │
├───────────────────────────────────────┤
│  2026-10-08 09:15                     │
│  📶 SSID: Office-5G                   │
│              [复制] [删除]             │
└───────────────────────────────────────┘
```

- 搜索为**内存过滤**（见 §4.6），按条数上限分页加载，避免一次性读入全部记录。
- 导出 JSON/CSV：在 popup 内用 `<a download>` 触发，避免引入 `downloads` 权限（如需自定义文件名/目录再申请为可选权限）。

### 5.4 设置页

自动复制开关 / 自动打开 URL 开关 / 历史记录开关 / 保留策略（天数 + 条数）/ 引擎偏好 / 隐私说明入口。

---

## 6. manifest.json

```json
{
  "manifest_version": 3,
  "name": "deQRCode",
  "version": "0.1.0",
  "description": "右键解码网页图片中的二维码",
  "default_locale": "zh_CN",
  "icons": { "48": "icons/48.png", "96": "icons/96.png", "128": "icons/128.png" },

  "browser_specific_settings": {
    "gecko": {
      "id": "deqrcode@example.com",
      "strict_min_version": "115.0"
    }
  },

  "permissions": [
    "contextMenus",
    "activeTab",
    "scripting",
    "storage",
    "clipboardWrite"
  ],
  "optional_permissions": ["notifications", "downloads", "unlimitedStorage"],
  "optional_host_permissions": ["<all_urls>"],

  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  },

  "background": {
    "scripts": ["background.js"],
    "service_worker": "background.js"
  },

  "action": { "default_popup": "popup.html", "default_icon": "icons/48.png" },
  "options_ui": { "page": "options.html", "open_in_tab": false },

  "web_accessible_resources": [
    { "resources": ["*.wasm"], "matches": ["<all_urls>"] }
  ]
}
```

**变更要点**：
- 移除 `clipboardRead`（改由粘贴交互降级，见 §4.4）、移除 `notifications` 常驻（降级为可选权限）。
- **不再声明常驻 `content_scripts`**，改为 `activeTab` + `scripting.executeScript` 按需注入（见 §6.1）。
- 补 `browser_specific_settings.gecko.id`（AMO 必需）、`default_locale`、`icons`、`options_ui`、`content_security_policy`、`web_accessible_resources`。
- Chrome 侧额外需要 `offscreen` 权限，通过构建期 manifest 合并（`manifest.chrome.json`）实现，不污染 Firefox 主清单。

### 6.1 权限最小化策略

| 权限 | 时机 | 理由 |
|------|------|------|
| `activeTab` | 安装时 | 用户右键即为用户手势，可注入当前标签页取像素/写剪贴板 |
| `<all_urls>` 宿主权限 | **可选**，①失败时通过 `permissions.request()` 请求 | 仅在跨域无 CORS 图需要 `fetch` 时才要；安装即全量会显著劝退用户并引起 AMO 追问 |
| `notifications` | 可选 | 仅在页面注入失败路径需要 |
| `downloads` / `unlimitedStorage` | 可选 | 导出、历史配额增长时按需 |

安装时的权限提示应控制在 `contextMenus + activeTab + scripting + storage + clipboardWrite`，符合"小工具"预期。

---

## 7. 错误处理与边界情况

| 场景 | 处理策略 |
|------|---------|
| 跨域图片（canvas 被污染） | 策略①失败 → 自动走策略② background `fetch`（请求可选宿主权限）；**不**尝试 `crossOrigin` 重载 |
| `data:` / `blob:` 图片 | 页面内直接解码（策略①），不走 `fetch` |
| 懒加载 / `srcset` 占位图 | 用 `img.currentSrc`，校验 `complete && naturalWidth > 0`，否则提示重试或改用选区截图 |
| 需登录态 / 特殊 Referer 的图 | `fetch` 可能拿到 403/占位图 → 检测到非图像响应时提示改用选区截图 |
| 超大图（> 50MB 或 > 8000px） | 先整体降采样到 `maxEdge`；仍失败再重叠分块扫描（**不再"直接分块"**） |
| 非 `<img>` 二维码（背景图 / canvas） | 菜单不触发 → 引导使用"选区截图解码" |
| 无 QR Code | 友好提示"未检测到 QR Code"，并提供"选区截图重试"入口 |
| 引擎加载失败（含 WASM 被 CSP 拦截） | 跳过该引擎继续降级；全失败则提示 + 诊断信息（写入 `attempts`） |
| 解码超时（> 5s） | 中断引擎链，返回超时提示 |
| Chrome：Offscreen Document 意外关闭 | 重建宿主并重试一次 |
| Firefox：event page 空闲卸载 | 瞬时状态落 `storage.session`；重建时从 session 恢复上下文 |
| 剪贴板写入失败 | 回退 `execCommand('copy')`；仍失败则在浮层展示内容并提示手动复制 |
| IndexedDB 配额超限 | 按 §4.6 保留策略淘汰至配额内，并提示用户 |

---

## 8. 测试策略

| 层级 | 工具 | 覆盖范围 |
|------|------|---------|
| 单元测试 | Vitest | 预处理管线、内容类型判定、保留策略、存储层、工具函数 |
| 识别率评测 | Vitest + Node（`sharp`/`canvas` 造图） | 样本集跑全链路，输出识别率/耗时/首引擎命中率（**CI 门禁**） |
| 端到端 | `web-ext run` + Selenium/geckodriver（或 Playwright 载入临时 XPI） | 右键 → 解码 → 浮层 → 复制 → 历史；权限授予/拒绝两条路径 |
| 兼容性 | 手工 + 双浏览器矩阵 | Firefox（主）、Chrome/Edge（offscreen 分支） |
| 手工 Checklist | — | 各类 QR（URL/文本/WiFi/联系人/事件/二进制）、反色、旋转、低对比、大图、跨域图、登录态图、受限页面 |

**修正说明**：Playwright 对 Firefox 安装扩展的支持很弱，原方案的 "Playwright + Firefox" 端到端不可靠。改为 `web-ext run` 启动带扩展的实例，再用 Selenium/geckodriver 或 Playwright 连接调试端口驱动。

### 8.1 QR 样本集（M2 必须建立）

每类 ≥ 20 张，覆盖：标准/高密度、低分辨率、大图内小码、反色、旋转 90/180/270、模糊/压缩噪声、低对比度、截图（含背景图/canvas 场景）、非 UTF-8 二进制、多码同图。样本集同时作为回归集与新引擎的准入基线。

---

## 9. 里程碑与交付物

| 阶段 | 任务 | 产出 |
|------|------|------|
| **M1: 基础框架** | Vite + TS、完整 manifest（§6）、权限最小化方案、目录结构、`web-ext lint` 入 CI | 可在 Firefox 安装的空扩展 |
| **M2: 解码核心** | DecoderHost 抽象（Firefox event page 优先）、jsQR 集成、**预处理管线**、zxing-wasm 懒加载 + CSP、样本集与识别率基线 | 可独立评测的解码模块 + 指标报告 |
| **M3: 交互闭环** | Context Menu、按需注入、取图三级策略、结果浮层、剪贴板复制（Firefox 实机验收）、Toast | 完整解码流程 |
| **M4: 历史与设置** | IndexedDB、历史面板、搜索/导出、设置页、隐私开关与保留策略 | 数据持久化 + 可配置 |
| **M5: 选区截图解码** | 选区截图、注入受限页面兜底、独立结果页 | 覆盖非 `<img>` 场景 |
| **M6: 打磨发布** | i18n、图标、隐私声明、LICENSE 声明、AMO 源码提交与合规、Chrome 分支验证 | 可上架版本 |

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| ~~Firefox Offscreen Document 差异~~ | — | **已消解**：改用 DecoderHost 抽象，Firefox 直接走 event page，不使用 offscreen |
| 后台页剪贴板写入被拒 | **高** | 复制下放 content script；`execCommand` 兜底；M3 实机验收 |
| 跨域无 CORS 图取不到像素 | 中 | 三级取图策略 + 可选宿主权限；选区截图兜底 |
| zxing-wasm 体积/编译开销 | 中 | 动态 `import()` 懒加载、编译结果缓存；jsQR 覆盖 80% 场景 |
| WASM 被 MV3 CSP 拦截 | 中 | 显式声明 `wasm-unsafe-eval`；M2 增加 CSP 专项用例 |
| 全站权限劝退 / AMO 审核追问 | 中 | 可选宿主权限 + 按需注入；隐私说明前置到列表页 |
| 历史记录存敏感内容 | 中 | 默认可关闭、不存原图 URL、缩略图降采样、保留策略上限 |
| 通知按钮在 Firefox 支持有限 | 低 | 待验证；不支持则退化为纯提示 + 独立结果页 |
| Firefox 版本差异（121 前 background 启动） | 低 | `strict_min_version` 设为 115 并实测；必要时仅声明 `scripts` |
| Manifest V3 迁移问题 | 低 | 严格遵循 MV3 规范，`web-ext lint` 持续校验 |

---

## 11. 后续扩展性预留

- **批量解码**：选中多张图片一次性解码
- **二维码生成**：反向功能，文本生成 QR Code
- **同步支持**：可选 Firefox Sync 同步历史（需用户登录）
- **导出格式**：支持更多格式 (vCard, iCal)
- **历史全文检索**：记录量增长后引入分词 multiEntry 索引或内存倒排

---

## 12. 合规与发布

- **许可证声明**：jsQR (Apache-2.0)、zxing-wasm 需在 `LICENSES` 与扩展内注明。
- **AMO 源码提交**：构建产物不得混淆；需提供可读源码与可复现构建说明（Vite 产物若压缩需同时提交源码包）。
- **隐私政策**：列表页说明收集内容（解码文本/来源页/缩略图）、存储位置（本地 IndexedDB）、**不上传**。
- **发布工具**：`web-ext build` / `web-ext sign`；`web-ext lint` 纳入 CI 门禁。

---

*文档版本: 1.1*
*创建日期: 2026-10-09*
*状态: 已按评审修订（主要变更：DecoderHost 抽象替代 Offscreen、结果展示改页面内注入、剪贴板下放 content script、新增预处理管线与取图策略、权限最小化、CSP/WASM、样本集基线）*
