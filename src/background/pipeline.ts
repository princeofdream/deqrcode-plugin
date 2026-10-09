import type { AreaSelection, ContentReply } from '../shared/messages';
import type { DecodeResult, ImageRef, Settings } from '../shared/types';
import { ensureContentScript } from './inject';

export interface PipelineContext {
  tabId: number;
  srcUrl?: string;
  selection?: AreaSelection;
  settings: Settings;
  grabPixels: (srcUrl: string) => Promise<ContentReply>;
  captureArea: (sel: AreaSelection) => Promise<ImageRef | null>;
  fetchBlob: (url: string) => Promise<Blob>;
  hasHostPermission: () => Promise<boolean>;
  requestHostPermission: () => Promise<boolean>;
  decode: (ref: ImageRef) => Promise<DecodeResult>;
  showResult: (result: DecodeResult, autoCopy: boolean) => Promise<boolean>;
  notify: (message: string) => Promise<void>;
  record: (result: DecodeResult, sourceUrl?: string) => Promise<void>;
}

export async function runDecodePipeline(ctx: PipelineContext): Promise<DecodeResult> {
  await ensureContentScript(ctx.tabId);

  let result: DecodeResult;

  if (ctx.selection) {
    const ref = await ctx.captureArea(ctx.selection);
    result = ref
      ? await ctx.decode(ref)
      : { success: false, error: 'IMAGE_UNREADABLE', attempts: [] };
  } else if (ctx.srcUrl) {
    const grabbed = await ctx.grabPixels(ctx.srcUrl);
    if (grabbed.ok) {
      result = await ctx.decode({
        kind: 'pixels',
        data: grabbed.data,
        width: grabbed.width,
        height: grabbed.height,
      });
    } else if (grabbed.error === 'TAINTED') {
      if (!(await ctx.hasHostPermission()) && !(await ctx.requestHostPermission())) {
        await ctx.notify('需要站点权限才能读取跨域图片，已取消');
        result = { success: false, error: 'IMAGE_UNREADABLE', attempts: [] };
      } else {
        const blob = await ctx.fetchBlob(ctx.srcUrl);
        result = await ctx.decode({ kind: 'blob', blob });
      }
    } else {
      result = { success: false, error: 'IMAGE_UNREADABLE', attempts: [] };
    }
  } else {
    result = { success: false, error: 'INVALID_IMAGE', attempts: [] };
  }

  const shown = await ctx.showResult(result, ctx.settings.autoCopy && result.success);
  if (!shown) {
    await ctx.notify(result.success ? result.data.slice(0, 100) : '未检测到 QR Code');
  }

  if (result.success && ctx.settings.historyEnabled) {
    await ctx.record(result, ctx.srcUrl);
  }
  return result;
}
