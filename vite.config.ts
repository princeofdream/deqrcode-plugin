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
      // 扩展页面（ESM，可代码分割）；background 与 content 由 esbuild 单独打成 IIFE
      input: {
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
