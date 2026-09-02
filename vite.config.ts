import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // `public/` は Play Console が参照する法務ページと画像。Vite はそのまま複製するので、
  // /privacy と /terms は URL も本文も変わらない。
  publicDir: 'public',
  build: {
    // "assets" は既に公開 URL として使っているので、バンドル出力は別名にする。
    assetsDir: 'build',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        en: resolve(__dirname, 'index-en.html'),
      },
    },
  },
});
