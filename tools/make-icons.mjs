import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';

// 确定性伪随机模块分布（不依赖随机源，保证每次生成的图标一致）
function moduleFilled(x, y, size) {
  const h = (x * 73856093 ^ y * 19349663 ^ size * 83492791) >>> 0;
  return ((h >>> 8) & 0xff) % 100 < 45;
}

function isFinder(x, y, n) {
  const inBox = (ox, oy) => {
    const bx = x - ox;
    const by = y - oy;
    return bx >= 0 && bx < 7 && by >= 0 && by < 7;
  };
  const boxes = [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ];
  for (const [ox, oy] of boxes) {
    if (!inBox(ox, oy)) continue;
    const bx = x - ox;
    const by = y - oy;
    const ring = Math.max(Math.abs(bx - 3), Math.abs(by - 3));
    return ring === 3 || ring <= 1;
  }
  return null;
}

mkdirSync('icons', { recursive: true });

for (const size of [48, 96, 128]) {
  const n = 25; // 25×25 模块
  const cell = size / n;
  const png = new PNG({ width: size, height: size });

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const mx = Math.floor(px / cell);
      const my = Math.floor(py / cell);
      const finder = isFinder(mx, my, n);
      const filled = finder === null ? moduleFilled(mx, my, n) : finder;
      const i = (size * py + px) << 2;
      if (filled) {
        // 定位角使用品牌蓝，其余为深色
        const blue = finder === true;
        png.data[i] = blue ? 47 : 24;
        png.data[i + 1] = blue ? 111 : 24;
        png.data[i + 2] = blue ? 235 : 27;
      } else {
        png.data[i] = 245; png.data[i + 1] = 245; png.data[i + 2] = 245;
      }
      png.data[i + 3] = 255;
    }
  }

  writeFileSync(`icons/${size}.png`, PNG.sync.write(png));
}

console.log('icons written');
