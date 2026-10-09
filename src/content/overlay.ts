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

const FAILURE_TEXT: Record<string, string> = {
  NO_QR_CODE_DETECTED: '未检测到 QR Code',
  TIMEOUT: '解码超时，请重试',
  ENGINE_LOAD_FAILED: '解码引擎加载失败',
  INVALID_IMAGE: '图片无效或过小',
  IMAGE_UNREADABLE: '无法读取该图片（跨域或需要登录）',
};

let current: HTMLElement | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function showOverlay(opts: OverlayOptions): void {
  current?.remove();

  const host = el('div');
  host.style.all = 'initial';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = cssText;
  shadow.appendChild(style);

  const root = el('div', 'deqr-root');

  const head = el('div', 'deqr-head');
  head.appendChild(el('span', 'deqr-title', opts.result.success ? 'QR Code 解码结果' : '解码失败'));
  const close = el('button', 'deqr-close', '×');
  close.addEventListener('click', () => host.remove());
  head.appendChild(close);
  root.appendChild(head);

  if (opts.result.success) {
    const r = opts.result;
    root.appendChild(el('span', 'deqr-type', TYPE_LABEL[r.contentType]));
    root.appendChild(buildContent(r));

    const actions = el('div', 'deqr-actions');
    const copyBtn = el('button', 'deqr-btn', '复制内容');
    copyBtn.dataset.primary = 'true';
    copyBtn.addEventListener('click', async () => {
      const ok = await opts.onCopy(r.data);
      copyBtn.textContent = ok ? '已复制' : '复制失败';
    });
    actions.appendChild(copyBtn);

    if (r.contentType === 'url') {
      const openBtn = el('button', 'deqr-btn', '新标签打开');
      openBtn.addEventListener('click', () => opts.onOpen(r.data));
      actions.appendChild(openBtn);
    }
    root.appendChild(actions);
    root.appendChild(
      el('div', 'deqr-meta', `${opts.copied ? '已自动复制到剪贴板 · ' : ''}${r.engineUsed} · ${r.variant}`)
    );
  } else {
    const box = el('div', 'deqr-content deqr-error');
    box.textContent = FAILURE_TEXT[opts.result.error] ?? '解码失败';
    root.appendChild(box);
    root.appendChild(el('div', 'deqr-meta', ''));
  }

  shadow.appendChild(root);
  document.body.appendChild(host);
  current = host;

  let timer = window.setTimeout(() => host.remove(), 8000);
  root.addEventListener('mouseenter', () => window.clearTimeout(timer));
  root.addEventListener('mouseleave', () => {
    timer = window.setTimeout(() => host.remove(), 4000);
  });
}

function buildContent(result: Extract<DecodeResult, { success: true }>): HTMLElement {
  const box = el('div', 'deqr-content');
  if (result.contentType === 'wifi') {
    const wifi = parseWifi(result.data);
    if (wifi) {
      box.appendChild(document.createTextNode(`SSID: ${wifi.ssid}`));
      box.appendChild(document.createElement('br'));
      box.appendChild(document.createTextNode(`密码: ${wifi.password}`));
      box.appendChild(document.createElement('br'));
      box.appendChild(document.createTextNode(`加密: ${wifi.auth}`));
      return box;
    }
  }
  box.textContent = result.data;
  return box;
}
