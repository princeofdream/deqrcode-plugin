import browser from 'webextension-polyfill';
import { listRecords, deleteRecord, clearAll, exportRecords } from '../storage/history';
import { filterRecords } from './filter';
import type { ContentType, HistoryRecord } from '../shared/types';
import './popup.css';

const app = document.getElementById('app')!;

const header = document.createElement('header');
const search = document.createElement('input');
search.id = 'q';
search.placeholder = '搜索历史';

const typeSelect = document.createElement('select');
typeSelect.id = 'type';
for (const [value, label] of [
  ['all', '全部'],
  ['url', 'URL'],
  ['wifi', 'WiFi'],
  ['contact', '联系人'],
  ['text', '文本'],
  ['binary', '二进制'],
] as const) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  typeSelect.appendChild(opt);
}

const exportBtn = document.createElement('button');
exportBtn.id = 'export';
exportBtn.textContent = '导出';

const clearBtn = document.createElement('button');
clearBtn.id = 'clear';
clearBtn.textContent = '清空';

header.append(search, typeSelect, exportBtn, clearBtn);

const listEl = document.createElement('ul');
listEl.id = 'list';

app.replaceChildren(header, listEl);

async function render(): Promise<void> {
  const records = await listRecords(500);
  const shown = filterRecords(records, search.value, typeSelect.value as ContentType | 'all');
  listEl.replaceChildren();
  if (!shown.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '暂无记录';
    listEl.appendChild(empty);
    return;
  }
  for (const r of shown) listEl.appendChild(item(r));
}

function item(r: HistoryRecord): HTMLLIElement {
  const li = document.createElement('li');

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${new Date(r.timestamp).toLocaleString()} · ${r.contentType}`;

  const content = document.createElement('div');
  content.className = 'content';
  content.textContent = r.content.slice(0, 300);

  const row = document.createElement('div');
  row.className = 'row';

  const copyBtn = document.createElement('button');
  copyBtn.textContent = '复制';
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard.writeText(r.content);
  });
  row.appendChild(copyBtn);

  if (r.contentType === 'url') {
    const openBtn = document.createElement('button');
    openBtn.textContent = '打开';
    openBtn.addEventListener('click', () => {
      void browser.tabs.create({ url: r.content });
    });
    row.appendChild(openBtn);
  }

  const delBtn = document.createElement('button');
  delBtn.textContent = '删除';
  delBtn.addEventListener('click', async () => {
    await deleteRecord(r.id);
    await render();
  });
  row.appendChild(delBtn);

  li.append(meta, content, row);
  return li;
}

search.addEventListener('input', () => void render());
typeSelect.addEventListener('change', () => void render());

clearBtn.addEventListener('click', async () => {
  await clearAll();
  await render();
});

exportBtn.addEventListener('click', async () => {
  const records = await listRecords(500);
  const blob = new Blob([exportRecords(records, 'json')], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `deqrcode-history-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

void render();
