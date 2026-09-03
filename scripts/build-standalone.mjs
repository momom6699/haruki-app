#!/usr/bin/env node
/**
 * ページを**1枚のHTML**に畳む。確認用で、配信するものではない。
 *
 *   node scripts/build-standalone.mjs index.html out.html [他言語ページのURL]
 *
 * 本番は Vite が複数ファイルへ吐く（HTML・CSS・JS・フォント・GeoJSON・画像）。
 * それを1枚にまとめて、サーバも無しにブラウザで開けるようにする。中身は本物と同じ
 * ——同じ src/ をバンドルし、同じ fixture、同じサブセットフォントを埋める。差し替えるのは
 * 「ファイルの取り方」だけ：
 *   - フォントと画像は data: URI
 *   - ルートの GeoJSON は fetch を差し替えて、埋め込んだものを返す
 *
 * 地図の下地タイルだけは差し替えない。本番と同じく CARTO から引くので、この1枚も
 * ネットにつながった状態で開く必要がある。CARTO キーは `VITE_CARTO_KEY` を export して
 * おけば埋まる（無ければ透かし付きのタイルで出る）。
 *
 * 本番のコードには手を入れない。差し替えはここで**バンドル済みの文字列に対して**行う。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [page, out, otherLangUrl] = process.argv.slice(2);
if (!page || !out) {
  console.error('usage: build-standalone.mjs <page.html> <out.html> [other-language-url]');
  process.exit(1);
}

const esbuild = 'node_modules/.bin/esbuild';
const tmp = mkdtempSync(join(tmpdir(), 'haruki-standalone-'));
const run = (args) => execFileSync(esbuild, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

/* --- 本体（JS と CSS）------------------------------------------------------ */

run([
  'src/main.ts',
  '--bundle',
  '--format=iife',
  '--target=es2020',
  '--minify',
  '--loader:.woff2=file',
  // Leaflet の CSS がマーカーの画像を参照する（この地図では使わない）。1枚に畳むので埋める。
  '--loader:.png=dataurl',
  '--external:/fonts/*',
  // Vite の `import.meta.env` は esbuild では展開されない。CARTO キーだけ環境から差し込む
  // （非モジュールの <script> に畳むので `import.meta` を残せない）。
  `--define:import.meta.env.VITE_CARTO_KEY=${JSON.stringify(process.env.VITE_CARTO_KEY ?? '')}`,
  `--outfile=${join(tmp, 'app.js')}`,
]);
let js = readFileSync(join(tmp, 'app.js'), 'utf8');
let css = readFileSync(join(tmp, 'app.css'), 'utf8');

/* --- 埋め込む素材 ----------------------------------------------------------- */

const dataUri = (file, mime) => `data:${mime};base64,${readFileSync(file).toString('base64')}`;

// esbuild の minify は url() の引用符を落とすので、引用符ありなしの両方を拾う。
css = css.replace(/url\(\s*['"]?\/fonts\/([^'")]+)['"]?\s*\)/g, (_, name) =>
  `url("${dataUri(`public/fonts/${name}`, 'font/woff2')}")`,
);
if (/url\(\s*['"]?\//.test(css)) {
  console.error('CSS still points at files this build cannot ship:', css.match(/url\([^)]*\)/g).filter((u) => /\(\s*['"]?\//.test(u)));
  process.exit(1);
}

const fixtures = Object.fromEntries(
  ['route-hero', 'routes-cumulative'].map((name) => [
    `/data/${name}.geojson`,
    readFileSync(`public/data/${name}.geojson`, 'utf8'),
  ]),
);

/* --- HTML ------------------------------------------------------------------ */

const html = readFileSync(page, 'utf8');
const title = html.match(/<title>([\s\S]*?)<\/title>/)[1];
const lang = html.match(/<html lang="([^"]+)"/)[1];
let body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));

body = body.replace(/<script type="module"[^>]*><\/script>/g, '');
body = body.replace(/(src|href)="\/assets\/([^"]+)"/g, (_, attr, name) => {
  const mime = name.endsWith('.png') ? 'image/png' : 'image/webp';
  return `${attr}="${dataUri(`public/assets/${name}`, mime)}"`;
});
// 言語ボタンは別ページへのリンク。1枚に畳むと行き先が無いので、渡された URL へ向ける。
body = otherLangUrl
  ? body.replace(/(<a class="langbtn"[^>]*?)href="[^"]*"/, `$1href="${otherLangUrl}"`)
  : body.replace(/(<a class="langbtn"[^>]*?)href="[^"]*"/, '$1href="#" aria-disabled="true"');

const prelude = `
// 確認用の1枚に畳んだ版。ファイルを取りに行く先だけを差し替える。
document.documentElement.lang = ${JSON.stringify(lang)};
const HARUKI_FIXTURES = ${JSON.stringify(fixtures)};
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const body = HARUKI_FIXTURES[url];
  return body === undefined
    ? nativeFetch(input, init)
    : Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }));
};
`;

writeFileSync(
  out,
  `<title>${title}</title>\n<style>\n${css}\n</style>\n${body}\n<script>\n${prelude}\n${js}\n</script>\n`,
);
const kb = (readFileSync(out).length / 1024).toFixed(0);
console.log(`wrote ${out} (${kb} KB, self-contained)`);
