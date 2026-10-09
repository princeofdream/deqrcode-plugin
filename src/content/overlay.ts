import type { ContentType, DecodeResult } from '../shared/types';
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
  const body =
    result.contentType === 'wifi'
      ? renderWifi(result.data)
      : `<div class="deqr-content">${escapeHtml(result.data)}</div>`;
  const openBtn =
    result.contentType === 'url' ? '<button class="deqr-btn" data-act="open">新标签打开</button>' : '';
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
  return s.replace(/[&<>"']/g, (c) => {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!;
  });
}
