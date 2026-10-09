import { describe, it, expect } from 'vitest';
import { isBackgroundCommand } from '../../src/shared/messages';

describe('isBackgroundCommand', () => {
  it('accepts GRAB_PIXELS', () => {
    expect(isBackgroundCommand({ type: 'GRAB_PIXELS', srcUrl: 'https://a/b.png' })).toBe(true);
  });
  it('accepts SHOW_RESULT', () => {
    expect(
      isBackgroundCommand({
        type: 'SHOW_RESULT',
        result: { success: false, error: 'NO_QR_CODE_DETECTED', attempts: [] },
        autoCopy: true,
      })
    ).toBe(true);
  });
  it('rejects unknown types', () => {
    expect(isBackgroundCommand({ type: 'NOPE' })).toBe(false);
    expect(isBackgroundCommand(null)).toBe(false);
  });
});
