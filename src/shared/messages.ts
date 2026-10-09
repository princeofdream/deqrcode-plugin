import type { DecodeResult, ImageRef, PreprocessOptions } from './types';

export type BackgroundCommand =
  | { type: 'GRAB_PIXELS'; srcUrl: string }
  | { type: 'SHOW_RESULT'; result: DecodeResult; autoCopy: boolean }
  | { type: 'START_AREA_SELECT' };

export type ContentReply =
  | { ok: true; data: ArrayBuffer; width: number; height: number }
  | { ok: false; error: 'TAINTED' | 'NOT_FOUND' | 'NOT_DECODED' | 'TOO_LARGE' };

export type AreaSelection = { x: number; y: number; width: number; height: number; dpr: number };

export type HostRequest = {
  type: 'DECODE';
  requestId: string;
  imageRef: ImageRef;
  options: PreprocessOptions;
  engines: string[];
};

export type HostResponse = { type: 'DECODE_RESULT'; requestId: string; result: DecodeResult };

const KNOWN = new Set(['GRAB_PIXELS', 'SHOW_RESULT', 'START_AREA_SELECT']);

export function isBackgroundCommand(v: unknown): v is BackgroundCommand {
  return typeof v === 'object' && v !== null && KNOWN.has((v as { type?: string }).type ?? '');
}
