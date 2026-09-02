/**
 * LP の地図。タイルサービスは使わない。
 *
 * Android 版は CARTO のラスタ下地の上に、Overpass から取った意味地物を重ねている。
 * LP が見せるのは決まったエリアだけなので、下地のタイルを引く代わりに
 * **意味地物を焼いた GeoJSON** を同梱し、その下は生成りの紙で塗る。
 * 結果として出るものは Android と同じ——公園・水・緑道・走れる幅の道と、走ったルート。
 * 店やPOI、ラベル、道路番号は最初から入っていない（§4 の「抑制または非表示」）。
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import { Map as MlMap, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import { HarukiFieldLayer } from './field-layer';
import { HarukiRouteLayer, type RouteStyle } from './route-layer';
import { TOKENS } from './color';
import { MOTION_FRAME_MS } from './materials';

export type RouteMode = 'hero' | 'cumulative' | 'none';

export type MapSpec = {
  container: HTMLElement;
  center: [number, number];
  zoom: number;
  /** 意味地物を描くか。軌跡（積み重ね）の地図は Android と同じくルート線だけにする。 */
  semantic: boolean;
  routes: RouteMode;
  /** ルートを一度だけ描き出すか（ヒーローのみ）。 */
  drawRoute?: boolean;
  /** ルートの範囲へカメラを合わせる。意味地物のある地図では使わない——
   *  線の太さを固定ズーム前提でメルカトル単位に焼いているため。 */
  fitRoutes?: boolean;
};

const AREA_URL = '/data/area.geojson';
const HERO_URL = '/data/route-hero.geojson';
const CUMULATIVE_URL = '/data/routes-cumulative.geojson';

const cache = new Map<string, Promise<GeoJSON.FeatureCollection>>();
function load(url: string): Promise<GeoJSON.FeatureCollection> {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => r.json()));
  return cache.get(url)!;
}

/**
 * すでに読んである GeoJSON を渡しておく。
 *
 * 帰属表示とヒーローの画角を決めるために、本体側は地図モジュールを読み込む前に
 * area と route-hero を取っている。ここへ渡しておかないと、同じ2本をもう一度取りに行く
 * ——キャッシュ指示のない配信だと実際に2回落ちる（27KB の無駄）。
 */
export function primeData(url: string, data: GeoJSON.FeatureCollection) {
  if (!cache.has(url)) cache.set(url, Promise.resolve(data));
}

export const DATA_URLS = { area: AREA_URL, hero: HERO_URL } as const;

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * MapLibre は Map を作った時点で worker を1つ掴む。
 *
 * この地図の描画そのものには要らない——地物もルートも自前の WebGL レイヤで描いていて、
 * source（GeoJSON やタイル）はひとつも無い。ただし `setWorkerCount(0)` にはできない
 * （スタイルの broadcast が actor を要求して "No actors found" で落ちる）。
 * worker は本体とは別ファイルで、さらに `./maplibre-gl-shared.mjs` を相対で読むので、
 * バンドラ任せでは出力されない。実体を固定名で置いて URL を明示する
 * （vite.config.ts の haruki-maplibre-worker）。
 */
setWorkerUrl('/build/maplibre-gl-worker.mjs');

/** 紙だけのスタイル。外部への通信はここでは一切起きない。 */
const paperStyle = (): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: 'paper', type: 'background', paint: { 'background-color': TOKENS.bg } }],
});

export type HarukiMap = { map: MlMap; destroy: () => void };

/**
 * WebGL2 が使えるかを先に見る。
 *
 * 使えない環境で Map を作ると、MapLibre は**投げも `error` も出さずに**コンソールへ
 * 書くだけで止まる（GPUInitializationError）。`load` は永久に来ないので、待っている側は
 * 何も知らされない——地図の枠には帰属表示の一行だけが残り、原因を追う手がかりもない。
 * ここで先に確かめて、失敗として返す。
 */
function supportsWebGL2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export async function createHarukiMap(spec: MapSpec): Promise<HarukiMap> {
  if (!supportsWebGL2()) throw new Error('WebGL2 is unavailable in this browser');

  const map = new MlMap({
    container: spec.container,
    style: paperStyle(),
    center: spec.center,
    zoom: spec.zoom,
    // 見せる地図であって操作する地図ではない（§7「カメラを派手に動かさない」）。
    // 固定ズーム前提なので、線の太さをメルカトル単位で焼ける。
    interactive: false,
    attributionControl: false,
    // 帰属は DOM 側に常時出す。canvas の中だけに閉じ込めない。
    fadeDuration: 0,
    refreshExpiredTiles: false,
  });

  await ready(map);

  let field: HarukiFieldLayer | null = null;
  const month = new Date().getMonth() + 1;

  if (spec.semantic) {
    const area = await load(AREA_URL);
    field = new HarukiFieldLayer('haruki-field', area, spec.zoom, month);
    map.addLayer(field);
  }

  let stopDraw: (() => void) | null = null;

  if (spec.routes !== 'none') {
    const url = spec.routes === 'hero' ? HERO_URL : CUMULATIVE_URL;
    const data = await load(url);
    const cumulative = spec.routes === 'cumulative';
    const lines = data.features
      .filter((f) => f.geometry.type === 'LineString')
      .map((f) => (f.geometry as GeoJSON.LineString).coordinates);

    // 線の太さはメルカトル単位で焼くので、**カメラを合わせたあとの**ズームで焼く。
    // 先に合わせておかないと、fitBounds のぶんだけ線が太く（細く）なる。
    if (spec.fitRoutes) fitToRoutes(map, data);

    // Android と同じ手当て：白に近いハローを敷いてから、半透明のルート線を重ねる。
    // 何度も通った道は線が重なって濃くなる——色分けをしないで密度を出す（ヒートマップにしない）。
    const style: RouteStyle = cumulative
      ? { haloColor: '#FFFDF4', haloWidth: 5.5, haloOpacity: 0.91, lineColor: TOKENS.routeLine, lineWidth: 3.5, lineOpacity: 0.5 }
      : {
          haloColor: '#FFFDF4',
          haloWidth: 15,
          haloOpacity: 0.95,
          lineColor: TOKENS.routeLine,
          lineWidth: 8,
          lineOpacity: 0.95,
          // 始終点の印。積み重ねの地図には付けない（何百本ぶんの点は形を潰す）。
          marker: { color: TOKENS.routeMarker, radius: 5, ringColor: '#FBF8EF', ringWidth: 2 },
        };
    const routeLayer = new HarukiRouteLayer('haruki-routes', map.getZoom(), style);
    map.addLayer(routeLayer);

    if (cumulative) {
      routeLayer.setRoutes(lines);
    } else {
      stopDraw = drawRoute(map, routeLayer, lines[0] ?? [], spec.drawRoute !== false);
    }
  }

  const stopMotion = field ? runMotion(map, field, spec.container) : null;

  return {
    map,
    destroy: () => {
      stopDraw?.();
      stopMotion?.();
      map.remove();
    },
  };
}

/**
 * 地図が使える状態になるまで待つ。
 *
 * `load` だけを待つと、**描けなかったときに永久に待つ**——WebGL が使えない環境では
 * MapLibre は `load` を出さず `error` を出すので、待っている側は解決も失敗もしない。
 * 呼び出し側の catch も走らず、地図の枠には帰属表示の一行だけが残る。
 * 見えない失敗をいちばん作りやすい場所なので、`error` と時間切れの両方で必ず倒す。
 */
function ready(map: MlMap): Promise<void> {
  const LIMIT_MS = 8_000;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error('map did not load within 8s'))), LIMIT_MS);
    map.on('load', () => done(resolve));
    map.on('error', (event) => done(() => reject(event?.error ?? new Error('map failed to initialise'))));
  });
}

/** 走った範囲へカメラを合わせる。Android も軌跡・日記の地図は記録の範囲に合わせている。 */
function fitToRoutes(map: MlMap, data: GeoJSON.FeatureCollection) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const feature of data.features) {
    if (feature.geometry.type !== 'LineString') continue;
    for (const [x, y] of feature.geometry.coordinates) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return;
  map.fitBounds(
    [
      [minX, minY],
      [maxX, maxY],
    ],
    { padding: 44, duration: 0 },
  );
}

/** ルートの重心。意味地物つきの地図はズームを固定したいので、中心だけ寄せる。 */
export function routeCentre(data: GeoJSON.FeatureCollection): [number, number] | null {
  const points: number[][] = [];
  for (const feature of data.features) {
    if (feature.geometry.type === 'LineString') points.push(...feature.geometry.coordinates);
  }
  if (!points.length) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/**
 * ルートを start → finish へ一度だけ描く。ループしない（§7）。
 * reduced motion のときは最初から全部描く——情報は欠けない。
 */
function drawRoute(map: MlMap, layer: HarukiRouteLayer, coords: number[][], animate: boolean): () => void {
  if (!animate || prefersReducedMotion()) {
    layer.setRoutes([coords]);
    map.triggerRepaint();
    return () => {};
  }

  const DURATION = 1400;
  let raf = 0;
  let start = 0;
  const ease = (t: number) => 1 - (1 - t) ** 3;
  const step = (now: number) => {
    if (!start) start = now;
    const t = Math.min((now - start) / DURATION, 1);
    const upto = Math.max(2, Math.round(ease(t) * coords.length));
    layer.setRoutes([coords.slice(0, upto)]);
    // カスタムレイヤは自分から再描画を頼まないと更新されない（source の setData と違う）。
    map.triggerRepaint();
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/**
 * 絵を進める。書き換えるのは uTime ひとつで、ジオメトリには触れない。
 * 画面から出たら止める——見えていないものを回し続けない（§11）。
 */
function runMotion(map: MlMap, field: HarukiFieldLayer, container: HTMLElement): () => void {
  if (prefersReducedMotion()) {
    field.setTime(0);
    map.triggerRepaint();
    return () => {};
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  const started = performance.now();
  const tick = () => {
    field.setTime((performance.now() - started) / 1000);
    map.triggerRepaint();
  };
  const start = () => {
    if (timer === null) timer = setInterval(tick, MOTION_FRAME_MS);
  };
  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) (entry.isIntersecting ? start : stop)();
  });
  observer.observe(container);

  return () => {
    stop();
    observer.disconnect();
  };
}
