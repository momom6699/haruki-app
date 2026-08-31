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
// MapLibre は GeoJSON の解析を worker で行う。worker は本体とは別ファイルなので、
// バンドラに実体を出させて URL を渡す。これが無いと source が永久に load されず、
// 「地図は出るがルートだけ出ない」という分かりにくい壊れ方をする。
import { setWorkerUrl, Map as MlMap, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import { HarukiFieldLayer } from './field-layer';
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

// vite.config.ts の haruki-maplibre-worker プラグインがこの名前で実体を置く。
setWorkerUrl('/build/maplibre-gl-worker.mjs');

const AREA_URL = '/data/area.geojson';
const HERO_URL = '/data/route-hero.geojson';
const CUMULATIVE_URL = '/data/routes-cumulative.geojson';

const cache = new Map<string, Promise<GeoJSON.FeatureCollection>>();
function load(url: string): Promise<GeoJSON.FeatureCollection> {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => r.json()));
  return cache.get(url)!;
}

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 紙だけのスタイル。外部への通信はここでは一切起きない。 */
const paperStyle = (): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: 'paper', type: 'background', paint: { 'background-color': TOKENS.bg } }],
});

export type HarukiMap = { map: MlMap; destroy: () => void };

export async function createHarukiMap(spec: MapSpec): Promise<HarukiMap> {
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

  await new Promise<void>((resolve) => map.on('load', () => resolve()));

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

    map.addSource('routes', { type: 'geojson', data: cumulative ? data : emptyCollection() });
    // Android と同じ手当て：白に近いハローを敷いてから、半透明のルート線を重ねる。
    // 何度も通った道は線が重なって濃くなる——色分けをしないで密度を出す（ヒートマップにしない）。
    map.addLayer({
      id: 'route-halo',
      type: 'line',
      source: 'routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#FFFDF4',
        'line-opacity': cumulative ? 0.91 : 0.95,
        'line-width': cumulative ? 5.5 : 15,
      },
    });
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': TOKENS.routeLine,
        'line-opacity': cumulative ? 0.34 : 0.95,
        'line-width': cumulative ? 3.5 : 8,
      },
    });

    if (!cumulative) {
      const coords = (data.features[0].geometry as GeoJSON.LineString).coordinates;
      // 始終点の印。積み重ねの地図には付けない（何百本ぶんの点は形を潰す）。
      map.addSource('route-ends', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [coords[0], coords[coords.length - 1]].map((c) => ({
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'Point' as const, coordinates: c },
          })),
        },
      });
      map.addLayer({
        id: 'route-ends',
        type: 'circle',
        source: 'route-ends',
        paint: {
          'circle-radius': 5,
          'circle-color': TOKENS.routeMarker,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FBF8EF',
        },
      });
      stopDraw = drawRoute(map, coords, spec.drawRoute !== false);
    }

    if (spec.fitRoutes) fitToRoutes(map, data);
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

const emptyCollection = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });

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
function drawRoute(map: MlMap, coords: number[][], animate: boolean): () => void {
  const source = map.getSource('routes') as GeoJSONSource;
  const asLine = (c: number[][]): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } }],
  });

  if (!animate || prefersReducedMotion()) {
    source.setData(asLine(coords));
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
    source.setData(asLine(coords.slice(0, upto)));
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
