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
