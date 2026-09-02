import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * MapLibre は Map の生成時に worker を1つ掴む（描画には使っていないが、外せない
 * ——src/map/haruki-map.ts の setWorkerUrl のコメント）。worker は本体とは別ファイルで、
 * さらに `./maplibre-gl-shared.mjs` を相対で読む。バンドラ任せだと両方とも出力されず、
 * worker の生成が失敗して**地図そのものが出ない**。実体を固定名で置く。
 */
function maplibreWorker(): Plugin {
  const dist = dirname(require.resolve('maplibre-gl/dist/maplibre-gl.mjs'));
  const files = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];
  return {
    name: 'haruki-maplibre-worker',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const hit = files.find((f) => req.url?.startsWith(`/build/${f}`));
        if (!hit) return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(resolve(dist, hit)));
      });
    },
    generateBundle() {
      for (const file of files) {
        this.emitFile({ type: 'asset', fileName: `build/${file}`, source: readFileSync(resolve(dist, file)) });
      }
    },
  };
}

export default defineConfig({
  // `public/` は Play Console が参照する法務ページと画像。Vite はそのまま複製するので、
  // /privacy と /terms は URL も本文も変わらない。
  publicDir: 'public',
  plugins: [maplibreWorker()],
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
