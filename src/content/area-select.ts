import type { AreaSelection } from '../shared/messages';

export interface DeviceRect { sx: number; sy: number; sw: number; sh: number }

export function toDeviceRect(sel: AreaSelection): DeviceRect {
  const d = sel.dpr || 1;
  return {
    sx: Math.round(sel.x * d),
    sy: Math.round(sel.y * d),
    sw: Math.round(sel.width * d),
    sh: Math.round(sel.height * d),
  };
}

export function startAreaSelect(onSelected: (sel: AreaSelection) => void): void {
  const mask = document.createElement('div');
  Object.assign(mask.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483646',
    cursor: 'crosshair',
    background: 'rgba(0,0,0,0.25)',
  });

  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed',
    border: '2px solid #2f6feb',
    background: 'rgba(47,111,235,0.12)',
    display: 'none',
  });

  mask.appendChild(box);
  document.body.appendChild(mask);

  let start: { x: number; y: number } | null = null;

  const cleanup = () => {
    mask.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cleanup();
  };
  window.addEventListener('keydown', onKey, true);

  mask.addEventListener('mousedown', (e) => {
    start = { x: e.clientX, y: e.clientY };
    box.style.display = 'block';
    box.style.left = `${start.x}px`;
    box.style.top = `${start.y}px`;
    box.style.width = '0';
    box.style.height = '0';
  });

  mask.addEventListener('mousemove', (e) => {
    if (!start) return;
    box.style.left = `${Math.min(start.x, e.clientX)}px`;
    box.style.top = `${Math.min(start.y, e.clientY)}px`;
    box.style.width = `${Math.abs(e.clientX - start.x)}px`;
    box.style.height = `${Math.abs(e.clientY - start.y)}px`;
  });

  mask.addEventListener('mouseup', (e) => {
    if (!start) return;
    const sel: AreaSelection = {
      x: Math.min(start.x, e.clientX),
      y: Math.min(start.y, e.clientY),
      width: Math.abs(e.clientX - start.x),
      height: Math.abs(e.clientY - start.y),
      dpr: window.devicePixelRatio || 1,
    };
    cleanup();
    if (sel.width >= 8 && sel.height >= 8) onSelected(sel);
  });
}
