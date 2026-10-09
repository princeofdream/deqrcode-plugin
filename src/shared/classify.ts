import type { ContentType } from './types';

const SAFE_SCHEMES = ['https:', 'http:', 'ftp:', 'mailto:', 'tel:', 'sms:', 'geo:'];

export function classify(text: string): ContentType {
  const trimmed = text.trim();
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (schemeMatch) {
    const scheme = `${schemeMatch[1]!.toLowerCase()}:`;
    if (SAFE_SCHEMES.includes(scheme)) return 'url';
    if (scheme === 'javascript:' || scheme === 'data:' || scheme === 'file:') return 'text';
  }
  if (/^WIFI:/i.test(trimmed)) return 'wifi';
  if (/^MECARD:/i.test(trimmed)) return 'contact';
  if (/^BEGIN:VCARD/i.test(trimmed)) return 'contact';
  if (/^BEGIN:VEVENT/i.test(trimmed)) return 'event';
  return 'text';
}

export interface WifiPayload {
  ssid: string;
  password: string;
  auth: string;
  hidden: boolean;
}

function unescapeValue(v: string): string {
  return v.replace(/\\([\\;,:"])/g, '$1');
}

/** 按未转义的分隔符切分，跳过被反斜杠转义的字符 */
function splitUnescaped(input: string, seps: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === '\\' && i + 1 < input.length) {
      cur += c + input[i + 1]!;
      i++;
      continue;
    }
    if (seps.includes(c)) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

export function parseWifi(text: string): WifiPayload | null {
  if (!/^WIFI:/i.test(text.trim())) return null;
  const body = text.trim().slice('WIFI:'.length);
  const fields: Record<string, string> = {};
  for (const segment of splitUnescaped(body, ';')) {
    if (!segment) continue;
    const parts = splitUnescaped(segment, ':');
    if (parts.length < 2) continue;
    const key = parts[0]!.trim().toUpperCase();
    if (!key) continue;
    fields[key] = unescapeValue(parts.slice(1).join(':'));
  }
  return {
    ssid: fields['S'] ?? '',
    password: fields['P'] ?? '',
    auth: fields['T'] ?? 'nopass',
    hidden: fields['H'] === 'true',
  };
}
