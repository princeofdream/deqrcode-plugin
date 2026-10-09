import { describe, it, expect } from 'vitest';
import { classify, parseWifi } from '../../src/shared/classify';

describe('classify', () => {
  it('识别 http/https 为 url', () => {
    expect(classify('https://example.com/a?b=1')).toBe('url');
    expect(classify('http://example.com')).toBe('url');
  });
  it('危险 scheme 不作为 url', () => {
    expect(classify('javascript:alert(1)')).toBe('text');
    expect(classify('data:text/html,<script>')).toBe('text');
    expect(classify('file:///etc/passwd')).toBe('text');
  });
  it('识别 WIFI / MECARD / VCARD / VEVENT', () => {
    expect(classify('WIFI:T:WPA;S:Net;P:pw;;')).toBe('wifi');
    expect(classify('MECARD:N:Alice;TEL:123;;')).toBe('contact');
    expect(classify('BEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD')).toBe('contact');
    expect(classify('BEGIN:VEVENT\r\nEND:VEVENT')).toBe('event');
  });
  it('普通文本为 text', () => {
    expect(classify('hello world')).toBe('text');
  });
});

describe('parseWifi', () => {
  it('解析并还原转义', () => {
    const wifi = parseWifi('WIFI:T:WPA;S:My\\:Net;P:a\\;b;;');
    expect(wifi).toEqual({ ssid: 'My:Net', password: 'a;b', auth: 'WPA', hidden: false });
  });
  it('非 WIFI 返回 null', () => {
    expect(parseWifi('https://x')).toBeNull();
  });
});
