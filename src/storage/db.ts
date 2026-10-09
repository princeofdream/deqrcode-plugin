import { openDB, type DBSchema } from 'idb';
import type { ContentType, HistoryRecord } from '../shared/types';

export interface DeQRCodeDB extends DBSchema {
  history: {
    key: string;
    value: HistoryRecord;
    indexes: { 'by-timestamp': number; 'by-type': ContentType };
  };
}

export const DB_NAME = 'deqrcode';
export const DB_VERSION = 1;

export function openHistoryDb() {
  return openDB<DeQRCodeDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore('history', { keyPath: 'id' });
      store.createIndex('by-timestamp', 'timestamp');
      store.createIndex('by-type', 'contentType');
    },
  });
}
