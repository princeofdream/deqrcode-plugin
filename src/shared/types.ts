export interface PixelMatrix {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type ImageRef =
  | { kind: 'pixels'; data: ArrayBuffer; width: number; height: number }
  | { kind: 'blob'; blob: Blob }
  | { kind: 'url'; url: string };

export interface PreprocessOptions {
  maxEdge: number;
  grayscale: boolean;
  tryInverted: boolean;
  rotations: number[];
  scales: number[];
  tileScan: boolean;
}

export const DEFAULT_PREPROCESS: PreprocessOptions = {
  maxEdge: 1600,
  grayscale: true,
  tryInverted: true,
  rotations: [0, 90, 180, 270],
  scales: [1, 0.5, 0.25],
  tileScan: true,
};

export type ContentType = 'url' | 'wifi' | 'contact' | 'event' | 'text' | 'binary';

export interface EngineAttempt {
  engine: string;
  variant: string;
  ms: number;
  ok: boolean;
  error?: string;
}

export type DecodeError =
  | 'NO_QR_CODE_DETECTED'
  | 'TIMEOUT'
  | 'ENGINE_LOAD_FAILED'
  | 'INVALID_IMAGE'
  | 'IMAGE_UNREADABLE';

export interface DecodeSuccess {
  success: true;
  data: string;
  encoding: 'utf8' | 'binary';
  contentType: ContentType;
  engineUsed: string;
  variant: string;
  attempts: EngineAttempt[];
}

export interface DecodeFailure {
  success: false;
  error: DecodeError;
  attempts: EngineAttempt[];
}

export type DecodeResult = DecodeSuccess | DecodeFailure;

export interface HistoryRecord {
  id: string;
  timestamp: number;
  content: string;
  encoding: 'utf8' | 'binary';
  contentType: ContentType;
  thumbnail?: string;
  sourceUrl?: string;
}

export interface Settings {
  autoCopy: boolean;
  autoOpenUrl: boolean;
  historyEnabled: boolean;
  retentionDays: number;
  retentionCount: number;
  preferredEngine: 'auto' | 'jsqr' | 'zxing-wasm';
}

export const DEFAULT_SETTINGS: Settings = {
  autoCopy: true,
  autoOpenUrl: false,
  historyEnabled: true,
  retentionDays: 30,
  retentionCount: 500,
  preferredEngine: 'auto',
};
