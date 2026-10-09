# deQRCode Firefox Extension - 设计文档

## 1. 项目概述

**项目名称**: deQRCode (Firefox 扩展)
**核心功能**: 右键网页图片 → 解码其中的 QR Code → 多种方式处理结果
**技术栈**: Manifest V3 + TypeScript + Vite
**目标浏览器**: Firefox (兼容 Chrome/Edge)

---

## 2. 功能需求

### 2.1 核心交互流程

```
用户右键点击网页图片
    ↓
上下文菜单显示 "解码 QR Code" 选项
    ↓
获取图片数据 (URL → Blob → ImageBitmap)
    ↓
发送至 Offscreen Document 解码
    ↓
多引擎降级解码 (jsQR → zxing-wasm)
    ↓
返回解码结果
    ↓
多选项结果处理:
  ├─ Toast 提示 + 自动复制到剪贴板
  ├─ 弹窗显示内容 + 复制按钮
  ├─ 若为 URL: 提供"新标签打开"选项
  └─ 记录至历史面板 (IndexedDB)
```

### 2.2 详细功能清单

| 功能模块 | 子功能 | 优先级 |
|---------|-------|-------|
| **上下文菜单** | 右键图片显示"解码 QR Code" | P0 |
| | 右键页面空白处显示"从剪贴板解码" | P1 |
| **解码引擎** | jsQR (主引擎, ~30KB, 纯 JS) | P0 |
| | zxing-wasm (备选引擎, 高准确率) | P0 |
| | 自动降级重试机制 | P0 |
| **结果处理** | Toast 通知 + 自动复制 | P0 |
| | 结果弹窗 (内容预览 + 复制按钮) | P0 |
| | URL 检测 + "新标签打开" 动作 | P0 |
| **历史记录** | IndexedDB 存储 (文本 + 缩略图) | P0 |
| | 历史面板 (搜索/筛选/删除/再次复制) | P0 |
| | 导出历史记录 (JSON/CSV) | P1 |
| **设置** | 启用/禁用自动复制 | P1 |
| | 启用/禁用 URL 自动打开询问 | P1 |
| | 历史记录保留天数配置 | P1 |

---

## 3. 架构设计

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      Firefox Extension                       │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────┐  │
│  │ Content      │    │ Background   │    │ Offscreen      │  │
│  │ Script       │◄───│ Script       │◄───│ Document       │  │
│  │ (页面注入)    │    │ (事件总线)    │    │ (解码引擎)      │  │
│  └──────┬───────┘    └──────┬───────┘    └───────┬────────┘  │
│         │                   │                    │            │
│         ▼                   ▼                    ▼            │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────┐  │
│  │ 获取图片数据  │    │ 菜单/消息路由 │    │ jsQR           │  │
│  │ (fetch/Blob)  │    │ 状态管理      │    │ zxing-wasm     │  │
│  └──────────────┘    └──────┬───────┘    └────────────────┘  │
│                             │                                │
│                    ┌────────▼────────┐                         │
│                    │ IndexedDB       │                         │
│                    │ (历史记录存储)   │                         │
│                    └─────────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 核心模块职责

| 模块 | 文件路径 | 职责 |
|------|----------|------|
| **Content Script** | `src/content/` | 监听右键菜单、获取图片 Blob、与 background 通信 |
| **Background Script** | `src/background/` | 生命周期管理、菜单注册、消息路由、Offscreen 管理 |
| **Offscreen Document** | `src/offscreen/` | 解码引擎加载、多引擎降级、Canvas/WASM 运行环境 |
| **Popup UI** | `src/popup/` | 结果展示弹窗、历史面板、设置页面 |
| **Storage Layer** | `src/storage/` | IndexedDB 封装、历史记录 CRUD、迁移 |
| **Decoder Core** | `src/decoder/` | 解码器抽象、引擎注册、降级策略 |

### 3.3 通信协议 (Message Passing)

```typescript
// Content → Background
interface DecodeRequest {
  type: 'DECODE_QR';
  payload: { imageUrl: string; imageBlob?: Blob; tabId: number };
}

// Background → Offscreen
interface OffscreenDecodeRequest {
  type: 'DECODE';
  payload: { imageData: ImageData | ImageBitmap; engines: DecoderEngine[] };
}

// Offscreen → Background
interface DecodeResponse {
  type: 'DECODE_RESULT';
  payload: { success: boolean; data?: string; error?: string; engineUsed: string };
}

// Background → Content/Popup
interface ResultNotification {
  type: 'QR_DECODED';
  payload: DecodeResult & { sourceTabId: number };
}
```

---

## 4. 关键技术决策

### 4.1 Offscreen Document 方案细节

**为什么选择 Offscreen Document**:
- Manifest V3 移除了 background page 的持久化，Service Worker 不支持 DOM/API (Canvas, ImageBitmap, WASM)
- Offscreen Document 提供完整的 Window 环境，支持 OffscreenCanvas、WebAssembly
- 可按需创建/关闭，不常驻内存

**实现要点**:
```typescript
// background.ts - 确保 offscreen 文档存在
async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS', 'IFRAME_SCRIPTING'],
    justification: 'QR Code decoding requires Canvas and WASM support'
  });
}
```

### 4.2 多引擎降级策略

```typescript
type DecoderEngine = 'jsqr' | 'zxing-wasm';

const ENGINE_PRIORITY: DecoderEngine[] = ['jsqr', 'zxing-wasm'];

async function decodeWithFallback(imageData: ImageData): Promise<DecodeResult> {
  for (const engine of ENGINE_PRIORITY) {
    try {
      const result = await decodeWithEngine(engine, imageData);
      if (result.success) return { ...result, engineUsed: engine };
    } catch (e) {
      console.warn(`Engine ${engine} failed:`, e);
    }
  }
  return { success: false, error: 'All engines failed' };
}
```

### 4.3 IndexedDB Schema

```typescript
interface HistoryRecord {
  id: string;              // UUID
  timestamp: number;       // Unix ms
  content: string;         // 解码文本
  contentType: 'text' | 'url' | 'wifi' | 'contact' | 'other';
  imageThumbnail: Blob;    // 缩略图 (max 200px)
  imageUrl?: string;       // 原图 URL (可选)
  sourceTabUrl: string;    // 来源页面
}
```

**索引**: `timestamp` (降序), `contentType`, `content` (全文搜索用)

---

## 5. UI/UX 设计

### 5.1 上下文菜单结构

```
右键图片:
├── 🔍 解码 QR Code
└── 🔍 解码并打开链接 (仅当识别为 URL)

右键页面空白处:
├── 📋 从剪贴板解码
└── 📜 打开历史记录
```

### 5.2 结果弹窗设计

```
┌─────────────────────────────────┐
│  QR Code 解码结果                │
├─────────────────────────────────┤
│  内容预览区域 (可选中/复制)       │
│  https://example.com/path...     │
├─────────────────────────────────┤
│  [复制内容] [新标签打开] [关闭]   │
└─────────────────────────────────┘
```

### 5.3 历史面板

```
┌─────────────────────────────────┐
│  🔍 搜索  [清空] [导出] [设置]    │
├─────────────────────────────────┤
│  2026-10-09 14:32  https://...  │
│  🌐 URL        [复制] [打开] [删]│
├─────────────────────────────────┤
│  2026-10-08 09:15  WiFi:...     │
│  📶 WiFi       [复制] [删除]     │
└─────────────────────────────────┘
```

---

## 6. 权限声明 (manifest.json)

```json
{
  "permissions": [
    "contextMenus",
    "activeTab",
    "scripting",
    "storage",
    "offscreen",
    "clipboardWrite",
    "notifications"
  ],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }]
}
```

---

## 7. 错误处理与边界情况

| 场景 | 处理策略 |
|------|---------|
| 图片跨域无法获取 | 尝试 `<img crossOrigin="anonymous">` → 失败则提示用户下载后拖拽 |
| 图片过大 (>50MB) | 压缩后再解码，或分块处理 |
| 无 QR Code | 友好提示"未检测到 QR Code" |
| 解码引擎加载失败 | 降级到下一个引擎，全失败则报错 |
| Offscreen Document 意外关闭 | 重建并重试 |
| IndexedDB 配额超限 | LRU 淘汰最旧记录，保留最新 1000 条 |

---

## 8. 测试策略

| 层级 | 工具 | 覆盖范围 |
|------|------|---------|
| 单元测试 | Vitest | 解码器逻辑、存储层、工具函数 |
| 集成测试 | Playwright + Firefox | 完整用户流程 (右键→解码→结果) |
| 手动测试 | Checklist | 各类 QR Code (URL/文本/WiFi/联系人)、大图、跨域图片 |

---

## 9. 里程碑与交付物

| 阶段 | 任务 | 产出 |
|------|------|------|
| **M1: 基础框架** | Vite + TypeScript 配置、Manifest V3、基础目录结构 | 可构建的空扩展 |
| **M2: 解码核心** | Offscreen Document、jsQR 集成、zxing-wasm 集成、降级逻辑 | 可独立运行的解码模块 |
| **M3: 交互闭环** | Context Menu、Content Script 通信、结果弹窗、Toast | 完整解码流程 |
| **M4: 历史记录** | IndexedDB、历史面板、搜索/导出 | 数据持久化 |
| **M5: 打磨发布** | 设置页、国际化、图标、发布包、AMO 提交 | 可上架版本 |

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| Firefox Offscreen Document API 差异 | 高 | 优先在 Firefox 开发，参考 MDN 文档，必要时 polyfill |
| zxing-wasm 体积过大影响加载 | 中 | 动态 import、预加载、或仅在 jsQR 失败时按需加载 |
| 跨域图片无法读取 | 中 | 提供"下载后拖拽"备选方案 |
| Manifest V3 迁移问题 | 低 | 严格遵循 MV3 规范，避免使用废弃 API |

---

## 11. 后续扩展性预留

- **批量解码**: 选中多张图片一次性解码
- **屏幕区域截图解码**: 捕获可见区域或选区
- **二维码生成**: 反向功能，文本生成 QR Code
- **同步支持**: 可选 Firefox Sync 同步历史 (需用户登录)
- **导出格式**: 支持更多格式 (vCard, iCal 等)

---

*文档版本: 1.0*
*创建日期: 2026-10-09*
*状态: 待评审*