import { describe, it, expect } from 'vitest';
import { filterRecords } from '../../src/popup/filter';
import type { HistoryRecord } from '../../src/shared/types';

const rec = (o: Partial<HistoryRecord> = {}): HistoryRecord => ({
  id: '1', timestamp: 0, content: '', encoding: 'utf8', contentType: 'text', ...o,
});

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
    const rs = [
      rec({ contentType: 'url', content: 'abc' }),
      rec({ contentType: 'url', content: 'xyz' }),
      rec({ contentType: 'wifi', content: 'abc' }),
    ];
    expect(filterRecords(rs, 'abc', 'url')).toHaveLength(1);
  });
});
