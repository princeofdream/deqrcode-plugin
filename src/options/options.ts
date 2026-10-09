import { getSettings, setSettings } from '../storage/settings';
import type { Settings } from '../shared/types';
import './options.css';

const app = document.getElementById('app')!;

function fieldset(legend: string, children: HTMLElement[], hint?: string): HTMLFieldSetElement {
  const fs = document.createElement('fieldset');
  const lg = document.createElement('legend');
  lg.textContent = legend;
  fs.appendChild(lg);
  for (const c of children) fs.appendChild(c);
  if (hint) {
    const p = document.createElement('div');
    p.className = 'hint';
    p.textContent = hint;
    fs.appendChild(p);
  }
  return fs;
}

function checkbox(id: string, text: string): HTMLLabelElement {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  label.append(input, document.createTextNode(text));
  return label;
}

function numberField(id: string, text: string, min: number, max: number): HTMLLabelElement {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'number';
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  label.append(document.createTextNode(text), input);
  return label;
}

const engineSelect = document.createElement('select');
engineSelect.id = 'preferredEngine';
for (const [value, label] of [
  ['auto', '自动（jsQR → zxing-wasm）'],
  ['jsqr', '仅 jsQR'],
  ['zxing-wasm', '优先 zxing-wasm'],
] as const) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  engineSelect.appendChild(opt);
}
const engineLabel = document.createElement('label');
engineLabel.append(document.createTextNode('首选引擎'), engineSelect);

const title = document.createElement('h1');
title.textContent = 'deQRCode 设置';

app.replaceChildren(
  title,
  fieldset(
    '解码结果',
    [checkbox('autoCopy', '自动复制到剪贴板'), checkbox('autoOpenUrl', '识别为 URL 时自动在新标签打开')],
    '自动打开存在钓鱼风险，建议保持关闭。'
  ),
  fieldset(
    '历史记录',
    [
      checkbox('historyEnabled', '保存解码历史'),
      numberField('retentionDays', '保留天数', 1, 3650),
      numberField('retentionCount', '最大条数', 10, 20000),
    ],
    '历史仅保存在本机 IndexedDB，不会上传；可包含 WiFi 密码等敏感内容。'
  ),
  fieldset('解码引擎', [engineLabel])
);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function bind(): Promise<void> {
  const s = await getSettings();
  ($<HTMLInputElement>('autoCopy')).checked = s.autoCopy;
  ($<HTMLInputElement>('autoOpenUrl')).checked = s.autoOpenUrl;
  ($<HTMLInputElement>('historyEnabled')).checked = s.historyEnabled;
  ($<HTMLInputElement>('retentionDays')).value = String(s.retentionDays);
  ($<HTMLInputElement>('retentionCount')).value = String(s.retentionCount);
  ($<HTMLSelectElement>('preferredEngine')).value = s.preferredEngine;
}

for (const id of ['autoCopy', 'autoOpenUrl', 'historyEnabled'] as const) {
  $<HTMLInputElement>(id).addEventListener('change', async (e) => {
    await setSettings({ [id]: (e.currentTarget as HTMLInputElement).checked });
  });
}

for (const id of ['retentionDays', 'retentionCount'] as const) {
  $<HTMLInputElement>(id).addEventListener('change', async (e) => {
    await setSettings({ [id]: Number((e.currentTarget as HTMLInputElement).value) });
  });
}

$<HTMLSelectElement>('preferredEngine').addEventListener('change', async (e) => {
  await setSettings({
    preferredEngine: (e.currentTarget as HTMLSelectElement).value as Settings['preferredEngine'],
  });
});

void bind();
