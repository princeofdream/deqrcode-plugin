import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('icons', { recursive: true });
for (const size of [48, 96, 128]) {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (size * y + x) << 2;
      const border = x < size * 0.12 || y < size * 0.12 || x > size * 0.88 || y > size * 0.88;
      const inFinder = border && (x < size * 0.3 || x > size * 0.7 || y < size * 0.3 || y > size * 0.7);
      png.data[i] = inFinder ? 0 : 245;
      png.data[i + 1] = inFinder ? 0 : 245;
      png.data[i + 2] = inFinder ? 0 : 245;
      png.data[i + 3] = 255;
    }
  }
  writeFileSync(`icons/${size}.png`, PNG.sync.write(png));
}
console.log('icons written');
