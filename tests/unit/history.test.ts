import { describe, it, expect } from 'vitest';
import { enforceRetention, exportRecords, toCsv } from '../../src/storage/history';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import type { HistoryRecord, Settings } from '../../src/shared/types';

function rec(over: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    content: 'x',
    encoding: 'utf8',
    contentType: 'text',
    ...over,
  };
}

const DAY = 86_400_000;

describe('enforceRetention', () => {
  it('按天数淘汰过期记录', () => {
    const now = Date.now();
    const records = [rec({ timestamp: now }), rec({ timestamp: now - 40 * DAY })];
    const { keep, remove } = enforceRetention(
      records,
      { ...DEFAULT_SETTINGS, retentionDays: 30, retentionCount: 500 } as Settings,
      now
    );
    expect(keep.map((r) => r.timestamp)).toEqual([now]);
    expect(remove).toHaveLength(1);
  });

  it('天数内但超条数时淘汰最旧的', () => {
    const now = Date.now();
    const records = [
      rec({ timestamp: now }),
      rec({ timestamp: now - DAY }),
      rec({ timestamp: now - 2 * DAY }),
    ];
    const { keep, remove } = enforceRetention(
      records,
      { ...DEFAULT_SETTINGS, retentionDays: 30, retentionCount: 2 } as Settings,
      now
    );
    expect(keep).toHaveLength(2);
    expect(remove).toHaveLength(1);
    expect(keep.every((r) => r.timestamp > remove[0]!.timestamp)).toBe(true);
  });

  it('两个条件同时生效：先过滤天数再截断条数', () => {
    const now = Date.now();
    const records = [
      rec({ timestamp: now }),
      rec({ timestamp: now - 40 * DAY }),
      rec({ timestamp: now - 41 * DAY }),
    ];
    const { keep, remove } = enforceRetention(
      records,
      { ...DEFAULT_SETTINGS, retentionDays: 30, retentionCount: 100 } as Settings,
      now
    );
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
