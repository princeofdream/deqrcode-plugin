import { describe, it, expect } from 'vitest';
import { toDeviceRect } from '../../src/content/area-select';

describe('toDeviceRect', () => {
  it('按 dpr 换算到设备像素', () => {
    expect(toDeviceRect({ x: 10, y: 20, width: 100, height: 50, dpr: 2 })).toEqual({
      sx: 20, sy: 40, sw: 200, sh: 100,
    });
  });
  it('dpr 为 1 时保持原值', () => {
    expect(toDeviceRect({ x: 0, y: 0, width: 33, height: 44, dpr: 1 })).toEqual({
      sx: 0, sy: 0, sw: 33, sh: 44,
    });
  });
  it('取整避免小数下标', () => {
    const r = toDeviceRect({ x: 1.6, y: 2.4, width: 10.2, height: 10.8, dpr: 1.5 });
    expect(Number.isInteger(r.sx)).toBe(true);
    expect(Number.isInteger(r.sw)).toBe(true);
  });
});
