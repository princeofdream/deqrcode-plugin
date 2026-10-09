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
  const rows = records.map((r) =>
    [new Date(r.timestamp).toISOString(), r.contentType, csvCell(r.content), csvCell(r.sourceUrl ?? '')].join(',')
  );
  return [head, ...rows].join('\n');
}

function csvCell(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

export function exportRecords(records: HistoryRecord[], format: 'json' | 'csv'): string {
  return format === 'json' ? JSON.stringify(records, null, 2) : toCsv(records);
}
