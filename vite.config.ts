import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const r = (p: string) => resolve(process.cwd(), p);

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'firefox115',
    rollupOptions: {
      input: {
        background: r('src/background/index.ts'),
        popup: r('src/popup/index.html'),
        options: r('src/options/index.html'),
        result: r('src/result/index.html'),
        offscreen: r('src/offscreen/index.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
